package cozyssh

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	os_exec "os/exec"
	"strings"

	"cozyssh/auth"
	"cozyssh/config"
	"cozyssh/constants"
	"cozyssh/fsapi"
	"cozyssh/localpty"
	"cozyssh/models"
	"cozyssh/recents"
	"cozyssh/scratchpad"
	"cozyssh/session"
	"cozyssh/sshmanager"
	"cozyssh/ws"

	"github.com/go-http-utils/headers"
)

//go:embed all:frontend/dist
var frontendFS embed.FS

// injected by GoReleaser during build
var (
	version = "dev" // "v" prefix is trimmed
	commit  = "none"
	date    = "unknown"
)

func Run(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("cozyssh", flag.ContinueOnError)
	configDir := flags.String("config", "", "Custom configuration directory (defaults to ~/.config/cozyssh)")
	listenAddr := flags.String("addr", "", "Listen address (overrides config file)")
	allowInsecure := flags.Bool("allow-insecure-http", false, "Lift the security restriction for non-local HTTP environments")
	resetPwd := flags.Bool("do-reset-password", false, "Reset the app password to a random one and exit")
	if err := flags.Parse(args); err != nil {
		return err
	}

	if *resetPwd {
		cfg, err := config.LoadConfig(*configDir)
		if err != nil {
			return fmt.Errorf("failed to load config: %w", err)
		}
		newPwd, err := cfg.ResetAppPassword()
		if err != nil {
			return fmt.Errorf("failed to reset password: %w", err)
		}
		log.Printf("App password has been reset to a new random one.")
		log.Printf("New app password: %s", newPwd)
		return nil
	}

	// 1. Load config and ensure App Password is created
	cfg, err := config.LoadConfig(*configDir)
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}
	if *listenAddr != "" {
		cfg.Addr = *listenAddr
	}
	log.Printf("CozySSH %s; Config file: %s", version, cfg.ConfigPath)

	auth.Init(cfg)
	ws.SetConfig(cfg)
	sshmanager.SetConfig(cfg)
	scratchpad.Init(cfg.ConfigDir)
	recents.Init(cfg.ConfigDir)

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
				InsecureAllowed: *allowInsecure,
				IsSecure:        isSecureRequest(r),
			},
			Hosts:   hosts,
			Buttons: cfg.Buttons,
			Vars:    cfg.Vars,
			Pinned:  pinned,
			Recents: recents.Get(),
		}
	}

	// 3. API Routes setup (to be expanded)
	auth.AddAuthRoutes(mux, getFullData)

	mux.HandleFunc("/api/ws", ws.HandleTerminal)
	mux.HandleFunc("/api/ws/scratchpad", scratchpad.HandleWS)

	securityMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if *allowInsecure || isSecureRequest(r) {
				next.ServeHTTP(w, r)
				return
			}
			http.Error(w, "Security Restriction: CozySSH is not allowed to run in non-local HTTP environment. Use HTTPS or localhost, or lift this restriction with --allow-insecure-http flag.", http.StatusForbidden)
		})
	}

	mux.Handle("/api/fs/download", securityMiddleware(http.HandlerFunc(fsapi.HandleDownloadDirect)))
	mux.Handle("/api/fs/", securityMiddleware(auth.Middleware(http.HandlerFunc(fsapi.HandleFS))))

	mux.HandleFunc("/api/preflight", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(headers.ContentType, constants.MIME_JSON)
		json.NewEncoder(w).Encode(&models.PreflightResponse{
			InsecureAllowed: *allowInsecure,
			IsSecure:        isSecureRequest(r),
		})
	})

	mux.Handle("/api/fulldata", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
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
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusNoContent)
			default:
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			}
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
			if err := cfg.ChangeAppPassword(req.NewPassword); err != nil {
				http.Error(w, "Failed to save", http.StatusInternalServerError)
				return
			}
			w.Header().Set(headers.ContentType, constants.MIME_JSON)
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
			w.WriteHeader(http.StatusOK)
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
		w.WriteHeader(http.StatusOK)
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
		w.WriteHeader(http.StatusOK)
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
			w.WriteHeader(http.StatusOK)
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
			w.WriteHeader(http.StatusOK)
		}))))

	mux.Handle("/api/sessions/close_all_normal", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			session.GlobalManager.CloseAllNormal()
			w.WriteHeader(http.StatusOK)
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
			w.WriteHeader(http.StatusOK)
		}))))

	mux.Handle("/api/buttons", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				w.Header().Set(headers.ContentType, constants.MIME_JSON)
				json.NewEncoder(w).Encode(cfg.Buttons)
			case http.MethodPost:
				var btn models.ButtonData
				if err := json.NewDecoder(r.Body).Decode(&btn); err != nil {
					http.Error(w, "Bad Request", http.StatusBadRequest)
					return
				}
				if btn.Id == "" {
					btn.Id = config.RandString(12, false)
				}
				cfg.AddButton(&btn)
				w.WriteHeader(http.StatusOK)
			default:
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			}
		}))))

	mux.Handle("/api/buttons/", securityMiddleware(auth.Middleware(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			id := strings.TrimPrefix(r.URL.Path, "/api/buttons/")
			switch r.Method {
			case http.MethodPut:
				var btn models.ButtonData
				if err := json.NewDecoder(r.Body).Decode(&btn); err != nil {
					http.Error(w, "Bad Request", http.StatusBadRequest)
					return
				}
				btn.Id = id
				cfg.UpdateButton(&btn)
				w.WriteHeader(http.StatusOK)
			case http.MethodDelete:
				cfg.RemoveButton(id)
				w.WriteHeader(http.StatusOK)
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
			w.WriteHeader(http.StatusOK)
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
			for k, v := range updates {
				if v == nil {
					delete(cfg.Vars, k)
				} else {
					cfg.Vars[k] = *v
				}
			}
			if err := cfg.Save(); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)
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

			var cmd *os_exec.Cmd
			if !localpty.DefaultShellIsLegacyPowershell {
				cmd = os_exec.Command(localpty.DefaultShell, "-l", "-c", req.Cmdline)
			} else {
				cmd = os_exec.Command(localpty.DefaultShell, "-Command", req.Cmdline)
			}
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

	// 4. Serve embedded frontend
	distFS, err := fs.Sub(frontendFS, "frontend/dist")
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
		// Basic SPA routing fallback
		f, err := distFS.Open(r.URL.Path[1:])
		if os.IsNotExist(err) {
			r.URL.Path = "/"
		} else if err == nil {
			f.Close()
		}
		fileServer.ServeHTTP(w, r)
	})

	addr := cfg.Addr
	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	go func() {
		<-ctx.Done()
		log.Printf("Shutting down cozyssh...")
		server.Shutdown(context.Background())
	}()

	log.Printf("Starting cozyssh on http://%s", addr)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
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
