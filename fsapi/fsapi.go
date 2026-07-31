package fsapi

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"

	"time"

	"github.com/go-http-utils/headers"
	"github.com/pkg/sftp"

	"cozyssh/auth"
	"cozyssh/constants"
	"cozyssh/models"
	"cozyssh/session"
)

func HandleDownloadDirect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sessionID := r.URL.Query().Get("id")
	reqPath := r.URL.Query().Get("path")
	expiresStr := r.URL.Query().Get("expires")
	sig := r.URL.Query().Get("sig")
	isArchive := r.URL.Query().Get("archive") == "1"

	if !auth.VerifyDownloadToken(sessionID, reqPath, expiresStr, sig) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	s := session.GlobalManager.Get(sessionID)
	if s == nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	isLocal := (s.Host == constants.LOCAL_NAME)
	if isArchive {
		handleDownloadArchive(w, reqPath, isLocal, s)
		return
	}

	var sftpClient *sftp.Client
	if !isLocal {
		if s.SSHClient == nil {
			http.Error(w, "Not connected to SSH", http.StatusServiceUnavailable)
			return
		}
		var err error
		sftpClient, err = sftp.NewClient(s.SSHClient.Client)
		if err != nil {
			http.Error(w, "Failed to create SFTP client", http.StatusInternalServerError)
			return
		}
		defer sftpClient.Close()
	}

	handleDownload(w, reqPath, isLocal, sftpClient)
}

func HandleFS(w http.ResponseWriter, r *http.Request) {
	// Must have sessionId
	// For paths: list, download, upload
	// /api/fs/list
	// /api/fs/download
	// /api/fs/upload

	if !strings.HasPrefix(r.URL.Path, "/api/fs/") {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	action := strings.TrimPrefix(r.URL.Path, "/api/fs/")
	// action can be "list", "download", "upload"

	sessionID := r.URL.Query().Get("id")
	if sessionID == "" {
		http.Error(w, "Missing id parameter", http.StatusBadRequest)
		return
	}

	s := session.GlobalManager.Get(sessionID)
	if s == nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	path := r.URL.Query().Get("path")

	// Determine if local or remote
	isLocal := (s.Host == constants.LOCAL_NAME)

	var sftpClient *sftp.Client
	if !isLocal {
		if s.SSHClient == nil {
			http.Error(w, "Not connected to SSH", http.StatusServiceUnavailable)
			return
		}
		var err error
		sftpClient, err = sftp.NewClient(s.SSHClient.Client)
		if err != nil {
			http.Error(w, "Failed to create SFTP client", http.StatusInternalServerError)
			return
		}
		defer sftpClient.Close()
	}

	switch action {
	case "list":
		handleList(w, path, isLocal, sftpClient)
	case "token":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		expires := time.Now().Add(5 * time.Minute).Unix()
		sig := auth.SignDownloadToken(sessionID, path, expires)
		w.Header().Set(headers.ContentType, constants.MIME_JSON)
		json.NewEncoder(w).Encode(&models.FsToken{Expires: expires, Sig: sig})
	case "upload":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleUpload(w, r, path, isLocal, sftpClient)
	case "rename":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleRename(w, r, path, isLocal, sftpClient)
	case "delete":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleDelete(w, path, isLocal, sftpClient)
	case "mkdir":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleMkdir(w, r, path, isLocal, sftpClient)
	case "stat":
		handleStat(w, path, isLocal, sftpClient)
	default:
		http.Error(w, "Not found", http.StatusNotFound)
	}
}

func handleStat(w http.ResponseWriter, path string, isLocal bool, sftpClient *sftp.Client) {
	if isLocal {
		if path == "" || path == "." || path == "~" {
			home, _ := os.UserHomeDir()
			path = home
		}
	} else {
		if path == "" || path == "." || path == "~" {
			lookup := path
			if lookup == "" || lookup == "~" {
				lookup = "."
			}
			if realPath, err := sftpClient.RealPath(lookup); err == nil {
				path = realPath
			} else {
				path = "."
			}
		}
	}

	var info os.FileInfo
	var err error
	if isLocal {
		info, err = os.Stat(path)
	} else {
		info, err = sftpClient.Stat(path)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	res := models.FileInfo{
		Name:    info.Name(),
		IsDir:   info.IsDir(),
		Size:    info.Size(),
		ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
	}

	w.Header().Set(headers.ContentType, constants.MIME_JSON)
	json.NewEncoder(w).Encode(res)
}

func handleRename(w http.ResponseWriter, r *http.Request, oldPath string, isLocal bool, sftpClient *sftp.Client) {
	var req models.FileRenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	if isLocal {
		if err := os.Rename(oldPath, req.NewPath); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		if err := sftpClient.Rename(oldPath, req.NewPath); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
}

func handleDelete(w http.ResponseWriter, path string, isLocal bool, sftpClient *sftp.Client) {
	if path == "" || path == "/" || path == `\` {
		http.Error(w, "Refusing to delete root path", http.StatusBadRequest)
		return
	}
	if isLocal {
		if err := os.RemoveAll(path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		if err := sftpRemoveAll(sftpClient, path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
}

func sftpRemoveAll(c *sftp.Client, path string) error {
	info, err := c.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return c.Remove(path)
	}
	entries, err := c.ReadDir(path)
	if err != nil {
		return err
	}
	for _, e := range entries {
		sub := path
		if !strings.HasSuffix(sub, "/") {
			sub += "/"
		}
		sub += e.Name()
		if err := sftpRemoveAll(c, sub); err != nil {
			return err
		}
	}
	return c.RemoveDirectory(path)
}

func sftpMkdirAll(c *sftp.Client, dirPath string) error {
	dirPath = path.Clean(dirPath)
	if dirPath == "." || dirPath == "/" || dirPath == "" {
		return nil
	}
	if stat, err := c.Stat(dirPath); err == nil && stat.IsDir() {
		return nil
	}
	parent := path.Dir(dirPath)
	if parent != "." && parent != "/" && parent != dirPath {
		if err := sftpMkdirAll(c, parent); err != nil {
			return err
		}
	}
	return c.Mkdir(dirPath)
}

func handleMkdir(w http.ResponseWriter, r *http.Request, parentPath string, isLocal bool, sftpClient *sftp.Client) {
	var req models.FileMkdirRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	newPath := filepath.Join(parentPath, req.Name)
	if !isLocal {
		newPath = parentPath
		if !strings.HasSuffix(newPath, "/") {
			newPath += "/"
		}
		newPath += req.Name
	}

	if isLocal {
		if err := os.MkdirAll(newPath, 0755); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		if err := sftpMkdirAll(sftpClient, newPath); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
}

func handleList(w http.ResponseWriter, path string, isLocal bool, sftpClient *sftp.Client) {
	if isLocal {
		if path == "" || path == "." || path == "~" {
			home, _ := os.UserHomeDir()
			path = home
		}
	} else {
		if path == "" || path == "." || path == "~" {
			lookup := path
			if lookup == "" || lookup == "~" {
				lookup = "."
			}
			if realPath, err := sftpClient.RealPath(lookup); err == nil {
				path = realPath
			} else {
				path = "."
			}
		}
	}

	var infos []*models.FileInfo

	if isLocal {
		// Special case for Windows drives
		if runtime.GOOS == "windows" && (path == "." || path == "" || path == "\\" || path == "/") {
			infos = GetAvailableDrives()
			path = "/"
		} else {
			if runtime.GOOS == "windows" {
				path = filepath.Clean(path)
				if strings.HasPrefix(path, "\\") && len(path) >= 3 && path[2] == ':' {
					path = path[1:]
				}
			}

			entries, err := os.ReadDir(path)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			for _, e := range entries {
				info, err := e.Info()
				if err != nil {
					continue
				}
				infos = append(infos, &models.FileInfo{
					Name:    info.Name(),
					IsDir:   info.IsDir(),
					Size:    info.Size(),
					ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
				})
			}
		}
	} else {
		// SFTP
		entries, err := sftpClient.ReadDir(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		for _, info := range entries {
			infos = append(infos, &models.FileInfo{
				Name:    info.Name(),
				IsDir:   info.IsDir(),
				Size:    info.Size(),
				ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
			})
		}
	}

	displayPath := path
	if isLocal && runtime.GOOS == "windows" && (path == "/" || path == "\\" || path == "") {
		displayPath = "/"
	}

	w.Header().Set(headers.ContentType, constants.MIME_JSON)
	json.NewEncoder(w).Encode(&models.FsList{
		Path:  displayPath,
		Files: infos,
	})
}

func handleDownload(w http.ResponseWriter, path string, isLocal bool, sftpClient *sftp.Client) {
	if path == "" {
		http.Error(w, "Missing path", http.StatusBadRequest)
		return
	}

	fileName := filepath.Base(path)
	w.Header().Set(headers.ContentDisposition, constants.HEADER_CONTENT_DISPOSITION_PREFIX+url.PathEscape(fileName))
	w.Header().Set(headers.ContentType, constants.MIME_BINARY)

	if isLocal {
		f, err := os.Open(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer f.Close()
		io.Copy(w, f)
	} else {
		f, err := sftpClient.Open(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer f.Close()
		io.Copy(w, f)
	}
}

func quoteShellArg(arg string) string {
	return "'" + strings.ReplaceAll(arg, "'", "'\\''") + "'"
}

func archiveLocalFolder(w io.Writer, srcDir string) error {
	gw := gzip.NewWriter(w)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()

	baseDir := filepath.Base(srcDir)

	return filepath.Walk(srcDir, func(file string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(srcDir, file)
		if err != nil {
			return err
		}
		var headerName string
		if rel == "." {
			headerName = baseDir
		} else {
			headerName = filepath.Join(baseDir, rel)
		}
		headerName = filepath.ToSlash(headerName)

		link := ""
		if info.Mode()&os.ModeSymlink != 0 {
			if target, err := os.Readlink(file); err == nil {
				link = target
			}
		}

		header, err := tar.FileInfoHeader(info, link)
		if err != nil {
			return err
		}
		header.Name = headerName

		if err := tw.WriteHeader(header); err != nil {
			return err
		}

		if !info.Mode().IsRegular() {
			return nil
		}

		f, err := os.Open(file)
		if err != nil {
			return err
		}
		defer f.Close()

		_, err = io.Copy(tw, f)
		return err
	})
}

func handleDownloadArchive(w http.ResponseWriter, reqPath string, isLocal bool, s *session.Session) {
	if reqPath == "" {
		http.Error(w, "Missing path", http.StatusBadRequest)
		return
	}

	cleanPath := strings.TrimRight(reqPath, "/\\")
	folderName := path.Base(cleanPath)
	if isLocal {
		folderName = filepath.Base(cleanPath)
	}
	if folderName == "" || folderName == "." || folderName == "/" || folderName == "\\" {
		folderName = "archive"
	}
	fileName := folderName + ".tar.gz"

	w.Header().Set(headers.ContentDisposition, constants.HEADER_CONTENT_DISPOSITION_PREFIX+url.PathEscape(fileName))
	w.Header().Set(headers.ContentType, constants.MIME_BINARY)

	if isLocal {
		if reqPath == "." || reqPath == "~" {
			home, _ := os.UserHomeDir()
			reqPath = home
		}
		if err := archiveLocalFolder(w, reqPath); err != nil {
			log.Printf("archiveLocalFolder error: %v", err)
		}
	} else {
		if s.SSHClient == nil {
			http.Error(w, "Not connected to SSH", http.StatusServiceUnavailable)
			return
		}
		sshSession, err := s.SSHClient.Client.NewSession()
		if err != nil {
			http.Error(w, "Failed to create SSH session: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer sshSession.Close()

		parentDir := path.Dir(cleanPath)
		baseName := path.Base(cleanPath)
		if parentDir == "" || parentDir == "." {
			parentDir = "."
		}

		sshSession.Stdout = w
		cmd := "tar -czf - -C " + quoteShellArg(parentDir) + " " + quoteShellArg(baseName)
		if err := sshSession.Run(cmd); err != nil {
			log.Printf("ssh tar download error: %v", err)
		}
	}
}

func handleUpload(w http.ResponseWriter, r *http.Request, destPath string, isLocal bool, sftpClient *sftp.Client) {
	if destPath == "" {
		http.Error(w, "Missing path", http.StatusBadRequest)
		return
	}

	// Parse multipart form
	err := r.ParseMultipartForm(50 << 20) // 50MB max memory
	if err != nil {
		http.Error(w, "Unable to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Unable to get file from request", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if isLocal {
		if destPath == "." || destPath == "~" {
			home, _ := os.UserHomeDir()
			destPath = home
		}
		safeName := filepath.Base(header.Filename)
		if safeName == "" || safeName == "." || safeName == ".." {
			http.Error(w, "Invalid filename", http.StatusBadRequest)
			return
		}
		if err := os.MkdirAll(destPath, 0755); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		fullPath := filepath.Join(destPath, safeName)

		f, err := os.Create(fullPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer f.Close()
		io.Copy(f, file)
	} else {
		// SFTP path separator is always '/'
		if destPath == "~" {
			destPath = "."
		}

		safeName := path.Base(header.Filename)
		if safeName == "" || safeName == "." || safeName == ".." {
			http.Error(w, "Invalid filename", http.StatusBadRequest)
			return
		}
		if err := sftpMkdirAll(sftpClient, destPath); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		fullPath := path.Join(destPath, safeName)

		f, err := sftpClient.Create(fullPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer f.Close()
		io.Copy(f, file)
	}

	w.Header().Set(headers.ContentType, constants.MIME_JSON)
	w.WriteHeader(http.StatusNoContent)
}
