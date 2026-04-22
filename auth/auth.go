package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

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

func SignDownloadToken(id, path string, expires int64) string {
	mac := hmac.New(sha256.New, []byte(globalConfig.AppPasswordHash))
	fmt.Fprintf(mac, "%s:%s:%d", id, path, expires)
	return hex.EncodeToString(mac.Sum(nil))
}

func VerifyDownloadToken(id, path, expiresStr, sig string) bool {
	if globalConfig == nil {
		return false
	}
	exp, err := strconv.ParseInt(expiresStr, 10, 64)
	if err != nil {
		return false
	}
	if time.Now().Unix() > exp {
		return false
	}
	expected := SignDownloadToken(id, path, exp)
	return subtle.ConstantTimeCompare([]byte(sig), []byte(expected)) == 1
}

func isValidToken(token string) bool {
	if globalConfig == nil {
		return false
	}

	expected := generateToken()
	// Using ConstantTimeCompare neutralizes timing-attacks
	return subtle.ConstantTimeCompare([]byte(token), []byte(expected)) == 1
}

// Middleware verifies the session token in the Authorization header or URL query
func Middleware(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := ""
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		} else {
			token = r.URL.Query().Get("token")
		}

		if token == "" || !isValidToken(token) {
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
