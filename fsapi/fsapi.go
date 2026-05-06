package fsapi

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"time"

	"github.com/pkg/sftp"

	"cozyssh/auth"
	"cozyssh/session"
	"cozyssh/sshmanager"
)

type FileInfo struct {
	Name    string `json:"name"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

func HandleDownloadDirect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sessionID := r.URL.Query().Get("id")
	path := r.URL.Query().Get("path")
	expiresStr := r.URL.Query().Get("expires")
	sig := r.URL.Query().Get("sig")

	if !auth.VerifyDownloadToken(sessionID, path, expiresStr, sig) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	s := session.GlobalManager.Get(sessionID)
	if s == nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	isLocal := (s.Host == "local")
	var sftpClient *sftp.Client
	if !isLocal {
		pClient, ok := s.SSHClient.(*sshmanager.PooledClient)
		if !ok || pClient == nil {
			http.Error(w, "Not connected to SSH", http.StatusServiceUnavailable)
			return
		}
		var err error
		sftpClient, err = sftp.NewClient(pClient.Client)
		if err != nil {
			http.Error(w, "Failed to create SFTP client", http.StatusInternalServerError)
			return
		}
		defer sftpClient.Close()
	}

	handleDownload(w, path, isLocal, sftpClient)
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
	isLocal := (s.Host == "local")

	var sftpClient *sftp.Client
	if !isLocal {
		pClient, ok := s.SSHClient.(*sshmanager.PooledClient)
		if !ok || pClient == nil {
			http.Error(w, "Not connected to SSH", http.StatusServiceUnavailable)
			return
		}
		var err error
		sftpClient, err = sftp.NewClient(pClient.Client)
		if err != nil {
			log.Printf("Failed to create SFTP client: %v", err)
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
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"expires": expires, "sig": sig})
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

	res := FileInfo{
		Name:    info.Name(),
		IsDir:   info.IsDir(),
		Size:    info.Size(),
		ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func handleRename(w http.ResponseWriter, r *http.Request, oldPath string, isLocal bool, sftpClient *sftp.Client) {
	var req struct {
		NewPath string `json:"newPath"`
	}
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

func handleMkdir(w http.ResponseWriter, r *http.Request, parentPath string, isLocal bool, sftpClient *sftp.Client) {
	var req struct {
		Name string `json:"name"`
	}
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
		if err := sftpClient.Mkdir(newPath); err != nil {
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

	var infos []FileInfo

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
				infos = append(infos, FileInfo{
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
			infos = append(infos, FileInfo{
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"path":  displayPath,
		"files": infos,
	})
}

func handleDownload(w http.ResponseWriter, path string, isLocal bool, sftpClient *sftp.Client) {
	if path == "" {
		http.Error(w, "Missing path", http.StatusBadRequest)
		return
	}

	fileName := filepath.Base(path)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+fileName+"\"")
	w.Header().Set("Content-Type", "application/octet-stream")

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
		fullPath := filepath.Join(destPath, header.Filename)
		f, err := os.Create(fullPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer f.Close()
		io.Copy(f, file)
	} else {
		// Join path using / for remote SFTP typically
		if destPath == "~" {
			destPath = "."
		}
		// SFTP path separator is always '/'
		fullPath := destPath
		if !strings.HasSuffix(fullPath, "/") {
			fullPath += "/"
		}
		fullPath += header.Filename

		f, err := sftpClient.Create(fullPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer f.Close()
		io.Copy(f, file)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}
