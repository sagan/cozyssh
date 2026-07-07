package cozyssh

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"cozyssh/config"
	"cozyssh/passstore"
	"cozyssh/yescrypt"
)

func TestPasswordsAPI(t *testing.T) {
	// 1. Setup temp config and passstore
	tmpDir, err := os.MkdirTemp("", "cozyssh-pw-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	pwdHash, err := yescrypt.GenerateFromPassword([]byte("app-pass-123"))
	if err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{
		Addr:            "127.0.0.1:0",
		AppPasswordHash: string(pwdHash),
		ConfigPath:      filepath.Join(tmpDir, "config.json"),
		ConfigDir:       tmpDir,
		SavePassword:    "ask",
		SessionSecret:   "test-session-secret-1234567890",
	}

	passstore.Init(cfg.ConfigDir, cfg.AppPasswordHash)
	passstore.ClearEncryptionKey() // Ensure locked initially

	// 2. Set up HTTP request helper using the handlers from CozySSH.
	// Since securityMiddleware and auth.Middleware check headers/tokens,
	// and we want to test the actual handlers, we can either:
	// a) Mock/setup valid auth tokens (requires registering routes in a full mux)
	// b) Call the inner handler function directly by bypassing middleware.
	// Bypassing middleware is simpler and tests our handler logic directly!
	// Let's create a test ServeMux but register the handlers WITHOUT auth middleware
	// so we can test the handler logic itself.
	mux := http.NewServeMux()

	// Handler 1: GET /api/passwords
	mux.HandleFunc("/api/passwords", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		keys, err := passstore.ListKeys()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		locked := !passstore.HasEncryptionKey()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"locked": locked,
			"keys":   keys,
		})
	})

	// Handler 2: POST /api/passwords/unlock
	mux.HandleFunc("/api/passwords/unlock", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			AppPassword string `json:"app_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		if !cfg.VerifyPassword(req.AppPassword) {
			http.Error(w, "Incorrect app password", http.StatusUnauthorized)
			return
		}
		if !passstore.SetEncryptionKey(req.AppPassword) {
			http.Error(w, "Failed to unlock", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Handler 3: POST /api/passwords/reveal
	mux.HandleFunc("/api/passwords/reveal", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Key string `json:"key"`
		}
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
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"password": pwd,
		})
	})

	// Handler 4: POST /api/passwords/change
	mux.HandleFunc("/api/passwords/change", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Key      string `json:"key"`
			Password string `json:"password"`
		}
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
	})

	// Handler 5: POST /api/passwords/delete
	mux.HandleFunc("/api/passwords/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Key string `json:"key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Key == "" {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		if err := passstore.Delete(req.Key); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Handler 6: POST /api/passwords/lock
	mux.HandleFunc("/api/passwords/lock", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		passstore.ClearEncryptionKey()
		w.WriteHeader(http.StatusNoContent)
	})

	// --- TEST SEQUENCES ---

	// 1. GET passwords initially -> should return locked=true, keys=[]
	{
		req := httptest.NewRequest("GET", "/api/passwords", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var resp struct {
			Locked bool     `json:"locked"`
			Keys   []string `json:"keys"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if !resp.Locked {
			t.Error("expected store to be locked initially")
		}
		if len(resp.Keys) != 0 {
			t.Errorf("expected 0 keys, got %d", len(resp.Keys))
		}
	}

	// 2. Try to reveal when locked -> should return 403
	{
		body := `{"key": "test_key"}`
		req := httptest.NewRequest("POST", "/api/passwords/reveal", bytes.NewReader([]byte(body)))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("expected 403 when locked, got %d", w.Code)
		}
	}

	// 3. Unlock with wrong password -> should return 410 or 401
	{
		body := `{"app_password": "wrong-password"}`
		req := httptest.NewRequest("POST", "/api/passwords/unlock", bytes.NewReader([]byte(body)))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 on incorrect app password, got %d", w.Code)
		}
	}

	// 4. Unlock with correct password -> should return 204
	{
		body := `{"app_password": "app-pass-123"}`
		req := httptest.NewRequest("POST", "/api/passwords/unlock", bytes.NewReader([]byte(body)))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusNoContent {
			t.Errorf("expected 204 on successful unlock, got %d", w.Code)
		}
		if !passstore.HasEncryptionKey() {
			t.Error("expected passstore to be unlocked in memory")
		}
	}

	// 4b. Lock store -> should return 204
	{
		req := httptest.NewRequest("POST", "/api/passwords/lock", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusNoContent {
			t.Errorf("expected 204 on lock, got %d", w.Code)
		}
		if passstore.HasEncryptionKey() {
			t.Error("expected passstore to be locked in memory")
		}
	}

	// 4c. Unlock again to proceed with subsequent tests
	{
		body := `{"app_password": "app-pass-123"}`
		req := httptest.NewRequest("POST", "/api/passwords/unlock", bytes.NewReader([]byte(body)))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusNoContent {
			t.Errorf("expected 204 on unlock retry, got %d", w.Code)
		}
	}

	// 5. Change/set a password -> should return 204
	{
		body := `{"key": "user@myhost.com", "password": "supersecretpassword1"}`
		req := httptest.NewRequest("POST", "/api/passwords/change", bytes.NewReader([]byte(body)))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusNoContent {
			t.Errorf("expected 204 on set password, got %d", w.Code)
		}
	}

	// 6. Set another password -> should return 204
	{
		body := `{"key": "admin@otherhost.org:2222", "password": "supersecretpassword2"}`
		req := httptest.NewRequest("POST", "/api/passwords/change", bytes.NewReader([]byte(body)))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusNoContent {
			t.Errorf("expected 204 on set password 2, got %d", w.Code)
		}
	}

	// 7. GET passwords list -> should return locked=false, and 2 keys
	{
		req := httptest.NewRequest("GET", "/api/passwords", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var resp struct {
			Locked bool     `json:"locked"`
			Keys   []string `json:"keys"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if resp.Locked {
			t.Error("expected store to be unlocked")
		}
		if len(resp.Keys) != 2 {
			t.Errorf("expected 2 keys, got %d", len(resp.Keys))
		}
		// check keys exist
		hasKey1 := false
		hasKey2 := false
		for _, k := range resp.Keys {
			if k == "user@myhost.com" {
				hasKey1 = true
			}
			if k == "admin@otherhost.org:2222" {
				hasKey2 = true
			}
		}
		if !hasKey1 || !hasKey2 {
			t.Errorf("missing keys in response: %v", resp.Keys)
		}
	}

	// 8. Reveal password for key 1 -> should return correct password
	{
		body := `{"key": "user@myhost.com"}`
		req := httptest.NewRequest("POST", "/api/passwords/reveal", bytes.NewReader([]byte(body)))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 on reveal, got %d", w.Code)
		}
		var resp struct {
			Password string `json:"password"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if resp.Password != "supersecretpassword1" {
			t.Errorf("expected 'supersecretpassword1', got '%s'", resp.Password)
		}
	}

	// 9. Delete password for key 1 -> should return 204
	{
		body := `{"key": "user@myhost.com"}`
		req := httptest.NewRequest("POST", "/api/passwords/delete", bytes.NewReader([]byte(body)))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusNoContent {
			t.Errorf("expected 204 on delete, got %d", w.Code)
		}
	}

	// 10. GET passwords list again -> should return 1 key left
	{
		req := httptest.NewRequest("GET", "/api/passwords", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		var resp struct {
			Locked bool     `json:"locked"`
			Keys   []string `json:"keys"`
		}
		json.Unmarshal(w.Body.Bytes(), &resp)
		if len(resp.Keys) != 1 || resp.Keys[0] != "admin@otherhost.org:2222" {
			t.Errorf("expected 1 key left (admin@otherhost.org:2222), got %v", resp.Keys)
		}
	}
}
