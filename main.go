package main

import (
	"embed"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"cozyssh/auth"
	"cozyssh/config"
	"cozyssh/session"
	"cozyssh/sshmanager"
	"cozyssh/ws"
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
	flag.Parse()

	// 1. Load config and ensure App Password is created
	cfg, err := config.LoadConfig(*configDir)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	log.Printf("CozySSH %s; Config file: %s", version, cfg.ConfigPath)

	auth.Init(cfg)
	ws.SetConfig(cfg)

	// 2. Set up HTTP router
	mux := http.NewServeMux()

	// 3. API Routes setup (to be expanded)
	auth.AddAuthRoutes(mux)

	mux.HandleFunc("/api/ws", ws.HandleTerminal)

	mux.HandleFunc("/api/sysinfo", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hostname, err := os.Hostname()
		if err != nil {
			hostname = "unknown"
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"hostname": hostname, "version": version})
	})))

	mux.HandleFunc("/api/hosts", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/hosts/", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/settings/password", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/tabs/pinned", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cfg.PinnedTabs)
	})))

	mux.HandleFunc("/api/tabs/pin", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/tabs/unpin", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/sessions/pinned", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/sessions/attach", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/tabs/rename", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/buttons", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/buttons/", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	mux.HandleFunc("/api/buttons/move", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))

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
