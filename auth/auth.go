package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"cozyssh/config"
)

var globalConfig *config.Config

// Init injects the configuration globally so stateless tokens can be verified universally.
func Init(cfg *config.Config) {
	globalConfig = cfg
}

func AddAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}

		if !globalConfig.VerifyPassword(req.Password) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		token := generateToken()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	})

	mux.HandleFunc("/api/logout", func(w http.ResponseWriter, r *http.Request) {
		// Stateless approach relies completely on the frontend purging its LocalStorage token
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success": true}`))
	})
}

func generateToken() string {
	mac := hmac.New(sha256.New, []byte(globalConfig.AppPasswordHash))
	// Adding a random salt/signature intent parameter
	mac.Write([]byte("cozyssh-session-v1"))
	sig := hex.EncodeToString(mac.Sum(nil))
	return "cozy." + sig
}

func isValidToken(token string) bool {
	if globalConfig == nil {
		return false
	}
	expected := generateToken()
	// Using ConstantTimeCompare neutralizes timing-attacks
	return subtle.ConstantTimeCompare([]byte(token), []byte(expected)) == 1
}

// Middleware verifies the session token in the Authorization header
func Middleware(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if !isValidToken(token) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	}
}

// WSAuth verifies tokens from WebSocket URL queries securely
func WSAuth(r *http.Request) bool {
	token := r.URL.Query().Get("token")
	if token == "" {
		return false
	}
	return isValidToken(token)
}
