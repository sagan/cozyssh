package cozyssh

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/pprof"
	"os"
	os_exec "os/exec"
	"slices"
	"strings"
	"time"

	"github.com/go-http-utils/headers"
	"golang.org/x/term"

	"cozyssh/auth"
	"cozyssh/common"
	"cozyssh/config"
	"cozyssh/constants"
	"cozyssh/datasync"
	"cozyssh/fsapi"
	"cozyssh/localpty"
	"cozyssh/models"
	"cozyssh/passstore"
	"cozyssh/recents"
	"cozyssh/scratchpad"
	"cozyssh/session"
	"cozyssh/sshmanager"
	"cozyssh/ws"
)

//go:embed all:frontend/dist
var FrontendFS embed.FS

// injected by GoReleaser during build
var (
	version = "dev" // "v" prefix is trimmed
	commit  = "none"
	date    = "unknown"
)

type CozysshFlags struct {
	ConfigDir       string
	ListenAddr      string
	AllowInsecure   bool
	Debug           bool
	DoResetPassword bool
	Err             error
}

func ParseFlags(args []string) *CozysshFlags {
	flags := &CozysshFlags{}
	fs := flag.NewFlagSet("cozyssh", flag.ContinueOnError)
	fs.StringVar(&flags.ConfigDir, "config", "", "Custom configuration directory (defaults to ~/.config/cozyssh)")
	fs.StringVar(&flags.ListenAddr, "addr", "", "Listen address (overrides config file)")
	fs.BoolVar(&flags.AllowInsecure, "allow-insecure-http", false, "Lift the security restriction for non-local HTTP environments")
	fs.BoolVar(&flags.Debug, "debug", false, "Enable debug mode")
	fs.BoolVar(&flags.DoResetPassword, "do-reset-password", false, "Reset the app password to a random one and exit")
	flags.Err = fs.Parse(args)
	return flags
}

func Run(ctx context.Context, args []string, ready chan<- string) error {
	flags := ParseFlags(args)
	return RunWithFlags(ctx, flags, ready)
}

func RunWithFlags(ctx context.Context, flags *CozysshFlags, ready chan<- string) error {
	if flags.Err != nil {
		return flags.Err
	}

	if flags.DoResetPassword {
		cfg, err := config.LoadConfig(flags.ConfigDir)
		if err != nil {
			return fmt.Errorf("failed to load config: %w", err)
		}

		passstore.Init(cfg.ConfigDir, cfg.AppPasswordHash)

		var oldPwdVal string
		if !passstore.IsEmpty() {
			fmt.Fprint(os.Stderr, "Enter old app password to re-encrypt stored passwords (press ENTER to skip): \n")
			oldPwd, err := term.ReadPassword(int(os.Stdin.Fd()))
			if err != nil {
				return fmt.Errorf("failed to read old password: %w", err)
			}
			oldPwdVal = string(oldPwd)

			if oldPwdVal == "" {
				fmt.Fprintln(os.Stderr, "WARNING: Resetting the app password without providing the old password will result in losing all saved SSH passwords!")
				fmt.Fprint(os.Stderr, "Are you sure you want to continue (y/n) [n]? ")
				answer := strings.ToLower(common.ReadStdinLine())
				if answer != "yes" && answer != "y" {
					fmt.Fprintln(os.Stderr, "Aborted.")
					return nil
				}
				passstore.DeletePasswordFile(true)
			}
		}

		newPwd, err := cfg.ResetAppPassword()
		if err != nil {
			return fmt.Errorf("failed to reset password: %w", err)
		}

		if oldPwdVal != "" && !passstore.IsEmpty() {
			passstore.SetAppPasswordHash(cfg.AppPasswordHash)
			err = passstore.Reencrypt(oldPwdVal, newPwd)
			if err != nil {
				return fmt.Errorf("failed to re-encrypt stored passwords: %w", err)
			} else {
				log.Printf("Successfully re-encrypted saved SSH passwords with the new app password.")
			}
		} else if !passstore.IsEmpty() {
			passstore.DeletePasswordFile(true)
			log.Printf("Saved SSH passwords have been deleted because they cannot be decrypted.")
		}

		log.Printf("App password has been reset to a new random one.")
		log.Printf("New app password: %s", newPwd)
		log.Printf("If CozySSH is running, restart it to make the change take effect")
		return nil
	}

	// 1. Load config and ensure App Password is created
	cfg, err := config.LoadConfig(flags.ConfigDir)
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}
	if flags.ListenAddr != "" {
		cfg.Addr = flags.ListenAddr
	}
	localpty.Load(cfg.Shells)
	log.Printf("local shells:")
	json.NewEncoder(os.Stderr).Encode(localpty.GetShells())
	cfg.ApplyConfig()
	if home, err := os.UserHomeDir(); err == nil {
		os.Chdir(home)
	}
	log.Printf("CozySSH %s; Config file: %s", version, cfg.ConfigPath)

	passstore.Init(cfg.ConfigDir, cfg.AppPasswordHash)
	auth.Init(cfg)
	ws.SetConfig(cfg)
	sshmanager.SetConfig(cfg)
	scratchpad.Init(cfg.ConfigDir)
	recents.Init(cfg.ConfigDir)
	datasync.Init(cfg)

	// 2. Set up HTTP router
	mux := http.NewServeMux()

	getFullData := func(r *http.Request) *models.FullData {
		scratchpad.Reload()
		displayHostname := cfg.SiteName
		if displayHostname == "" {
			if hostname, _ := os.Hostname(); hostname == "" {
				displayHostname = "unknown"
			} else {
				displayHostname = hostname
			}
		}
		hosts, err := sshmanager.ListHosts()
		if err != nil {
			hosts = []*models.HostData{}
		}
		pinned := session.GlobalManager.GetPinned()
		return &models.FullData{
			Sysinfo: models.Sysinfo{
				Hostname:        displayHostname,
				Version:         version,
				InsecureAllowed: flags.AllowInsecure,
				IsSecure:        isSecureRequest(r),
				SavePassword:    cfg.SavePassword,
			},
			Hosts:   hosts,
			Buttons: cfg.GetButtons(), // Use thread-safe GetButtons()
			Vars:    cfg.GetVars(),
			Pinned:  pinned,
			Recents: recents.Get(),
			Shells:  localpty.GetShells(),
		}
	}

	// 3. API Routes setup (to be expanded)
	auth.AddAuthRoutes(mux, getFullData)

	securityMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if flags.AllowInsecure || isSecureRequest(r) {
				next.ServeHTTP(w, r)
				return
			}
			http.Error(w, "Security Restriction: CozySSH is not allowed to run in non-local HTTP environment. Use HTTPS or localhost, or lift this restriction with --allow-insecure-http flag.", http.StatusForbidden)
		})
	}

	mux.Handle("/api/logout_all", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			if err := cfg.ResetSessionSecret(); err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}
			passstore.ClearEncryptionKey()

			session.GlobalManager.DisconnectAllWebsockets()
			scratchpad.DisconnectAll()

			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.HandleFunc("/api/ws", ws.HandleTerminal)
	mux.HandleFunc("/api/ws/scratchpad", scratchpad.HandleWS)

	mux.Handle("/api/fs/download", securityMiddleware(http.HandlerFunc(fsapi.HandleDownloadDirect)))
	mux.Handle("/api/fs/", securityMiddleware(auth.Middleware(http.HandlerFunc(fsapi.HandleFS))))

	mux.HandleFunc("/api/preflight", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(headers.ContentType, constants.MIME_JSON)
		json.NewEncoder(w).Encode(&models.PreflightResponse{
			InsecureAllowed: flags.AllowInsecure,
			IsSecure:        isSecureRequest(r),
		})
	})

	mux.Handle("/api/fulldata", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			query := r.URL.Query()
			refresh := query.Get("refresh") == "1"
			if refresh {
				localpty.Load(cfg.Shells)
			}
			syncFlag := query.Get("sync")
			if syncFlag != "" {
				switch syncFlag {
				case "1":
					datasync.TriggerSync()
				case "2":
					datasync.Sync(false)
				case "3":
					datasync.Sync(true)
				}
			}
			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			json.NewEncoder(w).Encode(getFullData(r))
		}))))

	mux.Handle("/api/recents", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.RecentUpdateRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			recents.Add(req.Host)
			recents.Save()
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/hosts", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				hosts, err := sshmanager.ListHosts()
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set(headers.ContentType, constants.MIME_JSON)
				json.NewEncoder(w).Encode(hosts)
			case http.MethodPost:
				var h models.HostData
				if err := json.NewDecoder(r.Body).Decode(&h); err != nil {
					http.Error(w, "Bad Request", http.StatusBadRequest)
					return
				}
				if err := sshmanager.SaveHost("", h); err != nil {
					if errors.Is(err, passstore.ErrNoKey) {
						http.Error(w, "encryption key not set", http.StatusForbidden)
						return
					}
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusNoContent)
			default:
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			}
		}))))

	mux.Handle("/api/hosts/copy-id", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.CopyIDRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			resp, err := sshmanager.CopySSHID(req.Name, req.Password, req.ExpectedFingerprint)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			json.NewEncoder(w).Encode(resp)
		}))))

	mux.Handle("/api/hosts/", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			name := strings.TrimPrefix(r.URL.Path, "/api/hosts/")
			switch r.Method {
			case http.MethodPut:
				var h models.HostData
				if err := json.NewDecoder(r.Body).Decode(&h); err != nil {
					http.Error(w, "Bad Request", http.StatusBadRequest)
					return
				}
				if err := sshmanager.SaveHost(name, h); err != nil {
					if errors.Is(err, passstore.ErrNoKey) {
						http.Error(w, "encryption key not set", http.StatusForbidden)
						return
					}
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusNoContent)
			case http.MethodDelete:
				if err := sshmanager.DeleteHost(name); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusNoContent)
			default:
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			}
		}))))

	mux.Handle("/api/settings/password", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.PasswordUpdateRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if req.NewPassword == "" {
				http.Error(w, "Password cannot be empty", http.StatusBadRequest)
				return
			}
			if passstore.IsEmpty() {
				passstore.DeletePasswordFile(false)
			} else if !passstore.HasEncryptionKey() {
				if req.Force {
					passstore.DeletePasswordFile(true)
				} else {
					http.Error(w, "Saved passwords are locked. Please connect to a password-saved host first to unlock before changing password.", http.StatusForbidden)
					return
				}
			} else if err := passstore.ReencryptWithInMemoryKey(req.NewPassword); err != nil {
				http.Error(w, "Failed to re-encrypt saved passwords: "+err.Error(), http.StatusInternalServerError)
				return
			}
			if err := cfg.ChangeAppPassword(req.NewPassword); err != nil {
				http.Error(w, "Failed to save", http.StatusInternalServerError)
				return
			}
			passstore.SetAppPasswordHash(cfg.AppPasswordHash)

			session.GlobalManager.DisconnectAllWebsockets()
			scratchpad.DisconnectAll()

			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/passwords", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			keys, err := passstore.ListKeys()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			resp := &models.PasswordsResponse{
				Locked: !passstore.HasEncryptionKey(),
				Keys:   keys,
			}
			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			json.NewEncoder(w).Encode(resp)
		}))))

	mux.Handle("/api/passwords/lock", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			passstore.ClearEncryptionKey()
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/passwords/unlock", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.PasswordsUnlockRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if !cfg.VerifyPassword(req.AppPassword) {
				http.Error(w, "Incorrect app password", http.StatusUnauthorized)
				return
			}
			if !passstore.SetEncryptionKey(req.AppPassword) {
				http.Error(w, "Failed to unlock password store", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/passwords/reveal", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.PasswordsRevealRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Key == "" {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if !passstore.HasEncryptionKey() {
				http.Error(w, "Password store is locked", http.StatusForbidden)
				return
			}
			pwd, err := passstore.Get(req.Key)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			resp := &models.PasswordsRevealResponse{
				Password: pwd,
			}
			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			json.NewEncoder(w).Encode(resp)
		}))))

	mux.Handle("/api/passwords/change", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.PasswordsChangeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Key == "" {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if !passstore.HasEncryptionKey() {
				http.Error(w, "Password store is locked", http.StatusForbidden)
				return
			}
			if err := passstore.Set(req.Key, req.Password); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/passwords/delete", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.PasswordsDeleteRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Key == "" {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if err := passstore.Delete(req.Key); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/settings/config", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req *models.ConfigRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if req.SavePassword != "always" && req.SavePassword != "never" && req.SavePassword != "ask" {
				http.Error(w, "Invalid option. Must be always, never, or ask", http.StatusBadRequest)
				return
			}
			if err := cfg.UpdateSavePassword(req.SavePassword); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/settings/webdav/status", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			cfg, err := config.LoadConfig(flags.ConfigDir)
			if err != nil {
				http.Error(w, "failed to load config", http.StatusInternalServerError)
			}
			status, errMsg, lastTime := datasync.GetStatus()
			res := &models.WebdavStatus{
				WebdavUrl:     cfg.WebdavUrl,
				WebdavUser:    cfg.WebdavUser,
				WebdavEnabled: cfg.WebdavEnabled,
				SyncStatus:    status,
				SyncError:     errMsg,
				SyncTime:      lastTime,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(res)
		}))))

	mux.Handle("/api/settings/webdav", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.SaveWebdavSettingsRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if err := cfg.UpdateWebdavSettings(req.Url, req.User, req.Password, req.Enabled); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if req.Enabled {
				datasync.TriggerSync()
			}
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/settings/webdav/detect", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.SaveWebdavSettingsRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			res, err := datasync.DetectChanges(req.Url, req.User, req.Password)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(res)
		}))))

	mux.Handle("/api/settings/webdav/sync", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			go datasync.Sync(false)
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/tabs/pinned", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			json.NewEncoder(w).Encode(session.GlobalManager.GetPinned())
		}))))

	mux.Handle("/api/tabs/pin", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.TabsPinRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if s := session.GlobalManager.Get(req.Id); s != nil {
				s.IsPinned = true
				s.IsLocked = false
				s.Title = req.Title
				s.BroadcastTabState()
			}
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/tabs/lock", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req models.TabsLockRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		if s := session.GlobalManager.Get(req.Id); s != nil {
			s.IsPinned = true
			s.IsLocked = true
			s.Title = req.Title
			s.BroadcastTabState()
		}
		w.WriteHeader(http.StatusNoContent)
	}))))

	mux.Handle("/api/tabs/unpin", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req models.TabsUnpinRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		if s := session.GlobalManager.Get(req.Id); s != nil {
			s.IsPinned = false
			s.IsLocked = false
			s.BroadcastTabState()
			session.GlobalManager.ClearInactive(req.Id)
		}
		w.WriteHeader(http.StatusNoContent)
	}))))

	mux.Handle("/api/scratchpad/reload", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			scratchpad.Reload()
			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/sessions/pinned", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			json.NewEncoder(w).Encode(session.GlobalManager.GetPinned())
		}))))

	mux.Handle("/api/tunnels", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			tunnels := sshmanager.GetActiveTunnels()
			if tunnels == nil {
				tunnels = []*models.ActiveTunnel{}
			}
			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			json.NewEncoder(w).Encode(tunnels)
		}))))

	mux.Handle("/api/sessions/attach", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.SessionsAttachRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if s := session.GlobalManager.Get(req.Id); s != nil {
				s.Steal()
			}
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/sessions/close", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.SessionsCloseRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			session.GlobalManager.CloseIfNotLocked(req.Id)
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/sessions/close_all_normal", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			session.GlobalManager.CloseAllNormal()
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/tabs/rename", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.TabsRenameRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Id == "" || req.Title == "" {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if s := session.GlobalManager.Get(req.Id); s != nil {
				s.Title = req.Title
			}
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/buttons", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				w.Header().Set(headers.ContentType, constants.MIME_JSON)
				json.NewEncoder(w).Encode(cfg.GetButtons())
			case http.MethodPost, http.MethodPut:
				data, _ := io.ReadAll(r.Body)
				var btns []*models.ButtonData
				if err := json.Unmarshal(data, &btns); err == nil {
					force := r.URL.Query().Get("force") == "1"
					cfg.UpsertButtons(btns, force)
					w.WriteHeader(http.StatusNoContent)
					return
				}
				var btn models.ButtonData
				if err := json.Unmarshal(data, &btn); err != nil {
					log.Printf("error: %v", err)
					http.Error(w, "Bad Request", http.StatusBadRequest)
					return
				}
				cfg.UpsertButton(&btn)
				w.WriteHeader(http.StatusNoContent)
			default:
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			}
		}))))

	mux.Handle("/api/buttons/", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			id := strings.TrimPrefix(r.URL.Path, "/api/buttons/")
			switch r.Method {
			case http.MethodPost, http.MethodPut:
				var btn models.ButtonData
				if err := json.NewDecoder(r.Body).Decode(&btn); err != nil {
					http.Error(w, "Bad Request", http.StatusBadRequest)
					return
				}
				btn.Id = id
				cfg.UpsertButton(&btn)
				w.WriteHeader(http.StatusNoContent)
			case http.MethodDelete:
				cfg.RemoveButton(id)
				w.WriteHeader(http.StatusNoContent)
			default:
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			}
		}))))

	mux.Handle("/api/buttons/move", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.ButtonsMoveRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			cfg.MoveButton(req.Id, req.Direction)
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/vars", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPut {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var updates map[string]*string
			if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if err := cfg.UpdateVars(updates); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		}))))

	mux.Handle("/api/fetch", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			urlStr := r.Header.Get(constants.HEADER_X_COZYSSH_URL)
			if urlStr == "" {
				for k, v := range r.Header {
					if strings.EqualFold(k, constants.HEADER_X_COZYSSH_URL) && len(v) > 0 {
						urlStr = v[0]
						break
					}
				}
			}
			if urlStr == "" {
				http.Error(w, "Missing X-Cozyssh-Url header", http.StatusBadRequest)
				return
			}

			req, err := http.NewRequest(r.Method, urlStr, r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			for k, vv := range r.Header {
				if k == headers.Authorization || k == constants.HEADER_CONNECTION || k == headers.Upgrade ||
					k == headers.Referer || k == headers.Origin {
					continue
				}
				targetKey := k
				if strings.HasPrefix(strings.ToLower(k), constants.HEADER_X_COZYSSH_FETCH_PREFIX_LOWERCASE) {
					targetKey = k[len(constants.HEADER_X_COZYSSH_FETCH_PREFIX_LOWERCASE):]
				} else if strings.HasPrefix(strings.ToLower(k), constants.HEADER_X_COZYSSH_PREFIX_LOWERCASE) {
					continue
				}
				for _, v := range vv {
					req.Header.Add(targetKey, v)
				}
			}
			client := &http.Client{}
			resp, err := client.Do(req)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			defer resp.Body.Close()
			for k, vv := range resp.Header {
				for _, v := range vv {
					w.Header().Add(k, v)
				}
			}
			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)
		}))))

	mux.Handle("/api/exec", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.ExecRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}

			shells := localpty.GetShells()
			args := slices.Clone(shells[0].RunCmdlineArgs)
			args = append(args, req.Cmdline)
			cmd := os_exec.Command(shells[0].Path, args...)
			common.PatchCmd(cmd)
			if home, err := os.UserHomeDir(); err == nil {
				cmd.Dir = home
			}

			var stdoutBuf, stderrBuf bytes.Buffer
			cmd.Stdout = &stdoutBuf
			cmd.Stderr = &stderrBuf
			err := cmd.Run()
			stdout := stdoutBuf.String()
			stderr := stderrBuf.String()

			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			json.NewEncoder(w).Encode(&models.ExecResult{
				Stdout: stdout,
				Stderr: stderr,
				Error:  err,
			})
		}))))

	mux.Handle("/api/exec_in_terminal", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			var req models.ExecInTerminalRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}

			var stdout, stderr string
			var execErr error

			// Look up the session – paneId doubles as the backend session ID.
			s := session.GlobalManager.Get(req.PaneId)
			if s != nil {
				if pClient, ok := s.SSHClient.(*sshmanager.PooledClient); ok {
					// SSH session: run command over a fresh background channel.
					stdout, stderr, execErr = sshmanager.ExecSSHCommand(pClient, req.Cmdline)
				} else {
					// Local-shell session: fall through to local exec below.
					s = nil
				}
			}

			if s == nil {
				// Local fallback (same behaviour as /api/exec).
				shells := localpty.GetShells()
				args := slices.Clone(shells[0].RunCmdlineArgs)
				args = append(args, req.Cmdline)
				cmd := os_exec.Command(shells[0].Path, args...)
				common.PatchCmd(cmd)
				if home, err := os.UserHomeDir(); err == nil {
					cmd.Dir = home
				}
				var stdoutBuf, stderrBuf bytes.Buffer
				cmd.Stdout = &stdoutBuf
				cmd.Stderr = &stderrBuf
				execErr = cmd.Run()
				stdout = stdoutBuf.String()
				stderr = stderrBuf.String()
			}

			w.Header().Set(headers.ContentType, constants.MIME_JSON)
			json.NewEncoder(w).Encode(&models.ExecResult{
				Stdout: stdout,
				Stderr: stderr,
				Error:  execErr,
			})
		}))))

	// 4. Serve embedded frontend
	distFS, err := fs.Sub(FrontendFS, "frontend/dist")
	if err != nil {
		return fmt.Errorf("failed to resolve frontend/dist inside embedded FS")
	}

	fileServer := http.FileServer(http.FS(distFS))

	mux.HandleFunc("/manifest.json", func(w http.ResponseWriter, r *http.Request) {
		shortname := cfg.SiteName
		sitename := cfg.SiteName
		if sitename == "" {
			hostname, _ := os.Hostname()
			if hostname != "" {
				sitename = constants.APP_NAME + " " + hostname
				shortname = hostname
			} else {
				sitename = constants.APP_NAME
				shortname = constants.APP_NAME
			}
		}
		manifest := &models.Manifest{
			Name:            sitename,
			ShortName:       shortname,
			StartURL:        "/",
			Display:         "standalone",
			BackgroundColor: "#ffffff",
			ThemeColor:      "#1976d2",
			Icons: []*models.ManifestIcon{
				{
					Src:   "/favicon.svg",
					Sizes: "any",
					Type:  "image/svg+xml",
				},
			},
		}
		w.Header().Set(headers.ContentType, constants.MIME_JSON)
		json.NewEncoder(w).Encode(manifest)
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// For static asset paths, never fall back to index.html — return 404 so
		// that a stale service worker doesn't get index.html (text/html) in place
		// of a JS module it expects, which would cause a MIME-type error.
		isSwAsset := r.URL.Path == "/sw.js" || r.URL.Path == "/registerSW.js"
		isStaticAsset := isSwAsset ||
			strings.HasPrefix(r.URL.Path, "/assets/") || strings.HasPrefix(r.URL.Path, "/workbox-")
		if isSwAsset {
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
		}

		f, err := distFS.Open(r.URL.Path[1:])
		if os.IsNotExist(err) {
			if isStaticAsset {
				http.NotFound(w, r)
				return
			}
			// SPA fallback: serve index.html for navigation routes
			r.URL.Path = "/"
		} else if err == nil {
			f.Close()
		}
		fileServer.ServeHTTP(w, r)
	})

	addr := cfg.Addr
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second, // longer for streaming responses
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		<-ctx.Done()
		log.Printf("Shutting down cozyssh...")
		server.Shutdown(context.Background())
	}()

	// CHANGE: Replace server.ListenAndServe() with split Listen and Serve steps
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	// Signal back to main.go instantly that the port is open and bound in the kernel
	if ready != nil {
		ready <- ln.Addr().String()
	}

	// debug endpoints are not protected by auth so only enable them when addr is local only
	if flags.Debug && (strings.HasPrefix(addr, "127.0.0.1:") || strings.HasPrefix(addr, "[::1]:")) {
		mux.HandleFunc("/debug/pprof/", pprof.Index)
		mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
		mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
		mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
		mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	}

	log.Printf("Starting cozyssh on http://%s", addr)
	if err := server.Serve(ln); err != http.ErrServerClosed {
		return err
	}

	return context.Cause(ctx)
}

func isSecureRequest(r *http.Request) bool {
	// 1. Check if accessed via localhost
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if host == "127.0.0.1" || host == "::1" || host == "localhost" {
		return true
	}

	// 2. Check if reached via HTTPS
	if r.TLS != nil {
		return true
	}

	// 3. Check for reverse proxy header
	if r.Header.Get(headers.XForwardedProto) == "https" {
		return true
	}

	return false
}
