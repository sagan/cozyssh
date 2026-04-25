package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"flag"
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
	"cozyssh/fsapi"
	"cozyssh/session"
	"cozyssh/sshmanager"
	"cozyssh/ws"
	"cozyssh/scratchpad"
)

//go:embed all:frontend/dist
var frontendFS embed.FS

// injected by GoReleaser during build
var (
	version = "dev" // "v" prefix is trimmed
	commit  = "none"
	date    = "unknown"
)

func main() {
	configDir := flag.String("config", "", "Custom configuration directory (defaults to ~/.config/cozyssh)")
	allowInsecure := flag.Bool("allow-insecure-http", false, "Lift the security restriction for non-local HTTP environments")
	resetPwd := flag.Bool("do-reset-password", false, "Reset the app password to a random one and exit")
	flag.Parse()

	if *resetPwd {
		cfg, err := config.LoadConfig(*configDir)
		if err != nil {
			log.Fatalf("Failed to load config: %v", err)
		}
		newPwd, err := cfg.ResetAppPassword()
		if err != nil {
			log.Fatalf("Failed to reset password: %v", err)
		}
		log.Printf("App password has been reset to a new random one.")
		log.Printf("New app password: %s", newPwd)
		os.Exit(0)
	}

	// 1. Load config and ensure App Password is created
	cfg, err := config.LoadConfig(*configDir)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	log.Printf("CozySSH %s; Config file: %s", version, cfg.ConfigPath)

	auth.Init(cfg)
	ws.SetConfig(cfg)
	scratchpad.Init(cfg.ConfigDir)

	// 2. Set up HTTP router
	mux := http.NewServeMux()

	getFullData := func(r *http.Request) map[string]any {
		scratchpad.Reload()
		hostname, err := os.Hostname()
		if err != nil {
			hostname = "unknown"
		}
		hosts, err := sshmanager.ListHosts()
		if err != nil {
			hosts = []sshmanager.HostInfo{}
		}
		pinned := make([]map[string]any, 0)
		for _, pt := range cfg.PinnedTabs {
			lc := 0
			if s := session.GlobalManager.Get(pt.ID); s != nil {
				lc = s.ListenerCount()
			}
			pinned = append(pinned, map[string]any{
				"id":            pt.ID,
				"host":          pt.Host,
				"title":         pt.Title,
				"listenerCount": lc,
			})
		}
		return map[string]any{
			"sysinfo": map[string]any{
				"hostname":         hostname,
				"version":          version,
				"insecure_allowed": *allowInsecure,
				"is_secure":        isSecureRequest(r),
			},
			"hosts":   hosts,
			"buttons": cfg.Buttons,
			"vars":    cfg.Vars,
			"pinned":  pinned,
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
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"insecure_allowed": *allowInsecure,
			"is_secure":        isSecureRequest(r),
		})
	})

	mux.Handle("/api/fulldata", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(getFullData(r))
	}))))

	mux.Handle("/api/hosts", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			hosts, err := sshmanager.ListHosts()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(hosts)
		case http.MethodPost:
			var h sshmanager.HostConfig
			if err := json.NewDecoder(r.Body).Decode(&h); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if err := sshmanager.SaveHost("", h); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Write([]byte(`{"success":true}`))
		default:
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		}
	}))))

	mux.Handle("/api/hosts/", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		alias := strings.TrimPrefix(r.URL.Path, "/api/hosts/")
		switch r.Method {
		case http.MethodPut:
			var h sshmanager.HostConfig
			if err := json.NewDecoder(r.Body).Decode(&h); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if err := sshmanager.SaveHost(alias, h); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Write([]byte(`{"success":true}`))
		case http.MethodDelete:
			if err := sshmanager.DeleteHost(alias); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Write([]byte(`{"success":true}`))
		default:
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		}
	}))))

	mux.Handle("/api/settings/password", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			NewPassword string `json:"new_password"`
		}
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
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success": true}`))
	}))))

	mux.Handle("/api/tabs/pinned", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cfg.PinnedTabs)
	}))))

	mux.Handle("/api/tabs/pin", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var tab config.PinnedTab
		if err := json.NewDecoder(r.Body).Decode(&tab); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		cfg.AddPinnedTab(tab)
		if s := session.GlobalManager.Get(tab.ID); s != nil {
			s.Pinned = true
		}
		w.WriteHeader(http.StatusOK)
	}))))

	mux.Handle("/api/tabs/unpin", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		cfg.RemovePinnedTab(req.ID)
		if s := session.GlobalManager.Get(req.ID); s != nil {
			s.Pinned = false
			session.GlobalManager.ClearInactive(req.ID)
		}
		w.WriteHeader(http.StatusOK)
	}))))

	mux.Handle("/api/scratchpad/reload", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		scratchpad.Reload()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
	}))))

	mux.Handle("/api/sessions/pinned", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		type PinnedSessionResponse struct {
			ID            string `json:"id"`
			Host          string `json:"host"`
			Title         string `json:"title"`
			ListenerCount int    `json:"listenerCount"`
		}
		res := make([]PinnedSessionResponse, 0)
		for _, pt := range cfg.PinnedTabs {
			ps := PinnedSessionResponse{ID: pt.ID, Host: pt.Host, Title: pt.Title, ListenerCount: 0}
			if s := session.GlobalManager.Get(pt.ID); s != nil {
				ps.ListenerCount = s.ListenerCount()
			}
			res = append(res, ps)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}))))

	mux.Handle("/api/sessions/attach", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		if s := session.GlobalManager.Get(req.ID); s != nil {
			s.Steal()
		}
		w.WriteHeader(http.StatusOK)
	}))))

	mux.Handle("/api/tabs/rename", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" || req.Title == "" {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		cfg.RenamePinnedTab(req.ID, req.Title)
		w.WriteHeader(http.StatusOK)
	}))))

	mux.Handle("/api/buttons", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(cfg.Buttons)
		case http.MethodPost:
			var btn config.Button
			if err := json.NewDecoder(r.Body).Decode(&btn); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			if btn.ID == "" {
				btn.ID = config.RandString(12, false)
			}
			cfg.AddButton(btn)
			w.WriteHeader(http.StatusOK)
		default:
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		}
	}))))

	mux.Handle("/api/buttons/", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/buttons/")
		switch r.Method {
		case http.MethodPut:
			var btn config.Button
			if err := json.NewDecoder(r.Body).Decode(&btn); err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
			btn.ID = id
			cfg.UpdateButton(btn)
			w.WriteHeader(http.StatusOK)
		case http.MethodDelete:
			cfg.RemoveButton(id)
			w.WriteHeader(http.StatusOK)
		default:
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		}
	}))))

	mux.Handle("/api/buttons/move", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID        string `json:"id"`
			Direction int    `json:"direction"` // -1 for left, 1 for right
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		cfg.MoveButton(req.ID, req.Direction)
		w.WriteHeader(http.StatusOK)
	}))))

	mux.Handle("/api/vars", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

	mux.Handle("/api/fetch", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		urlStr := r.URL.Query().Get("url")
		if urlStr == "" {
			http.Error(w, "Missing url", http.StatusBadRequest)
			return
		}

		req, err := http.NewRequest(r.Method, urlStr, r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		for k, vv := range r.Header {
			if k == "Authorization" || k == "Connection" || k == "Upgrade" || k == "Referer" || k == "Origin" {
				continue
			}
			targetKey := k
			if strings.HasPrefix(strings.ToLower(k), "x-cozyssh-") {
				targetKey = k[10:]
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

	mux.Handle("/api/exec", securityMiddleware(auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Cmdline string `json:"cmdline"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}

		var cmd *os_exec.Cmd
		if os.PathSeparator == '/' {
			cmd = os_exec.Command("bash", "-l", "-c", req.Cmdline)
		} else {
			cmd = os_exec.Command("powershell", "-Command", req.Cmdline)
		}

		var stdoutBuf, stderrBuf bytes.Buffer
		cmd.Stdout = &stdoutBuf
		cmd.Stderr = &stderrBuf
		err := cmd.Run()
		stdout := stdoutBuf.String()
		stderr := stderrBuf.String()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"stdout": string(stdout),
			"stderr": stderr,
			"error":  err,
		})
	}))))

	// 4. Serve embedded frontend
	distFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		log.Fatal("Failed to resolve frontend/dist inside embedded FS")
	}

	fileServer := http.FileServer(http.FS(distFS))

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
	log.Printf("Starting cozyssh on http://%s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
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

	// 3. Check for reverse proxy headers
	headers := []string{"X-Forwarded-Proto", "X-Forwarded-Ssl", "X-Url-Scheme"}
	for _, h := range headers {
		val := strings.ToLower(r.Header.Get(h))
		if val == "https" || val == "on" {
			return true
		}
	}

	return false
}
