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
	"cozyssh/constants"
	"cozyssh/models"
	"cozyssh/passstore"

	"github.com/go-http-utils/headers"
)

var globalConfig *config.Config

// Init injects the configuration globally so stateless tokens can be verified universally.
func Init(cfg *config.Config) {
	globalConfig = cfg
}

func AddAuthRoutes(mux *http.ServeMux, getFullData func(r *http.Request) *models.FullData) {
	mux.HandleFunc("/api/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		var req models.LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}

		if !globalConfig.VerifyPassword(req.Password) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		passstore.SetEncryptionKey(req.Password)

		res := &models.LoginResponse{
			Token:    generateToken(),
			Fulldata: getFullData(r),
		}
		w.Header().Set(headers.ContentType, constants.MIME_JSON)
		json.NewEncoder(w).Encode(res)
	})

	mux.HandleFunc("/api/logout", func(w http.ResponseWriter, r *http.Request) {
		passstore.ClearEncryptionKey()
		// Stateless approach relies completely on the frontend purging its LocalStorage token
		w.Header().Set(headers.ContentType, constants.MIME_JSON)
		w.WriteHeader(http.StatusNoContent)
	})
}

func generateToken() string {
	mac := hmac.New(sha256.New, []byte(globalConfig.AppPasswordHash))
	// Adding a random salt/signature intent parameter
	mac.Write([]byte("cozyssh-session-v1"))
	sig := hex.EncodeToString(mac.Sum(nil))
	return constants.COZYSSH_TOKEN_PREFIX + sig
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
		authHeader := r.Header.Get(headers.Authorization)
		if after, ok := strings.CutPrefix(authHeader, constants.HEADER_AUTHORIZATION_BEARER_PREFIX); ok {
			token = after
		} else {
			token = r.URL.Query().Get(constants.VAR_TOKEN)
		}

		if token == "" || !isValidToken(token) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	}
}

// WSAuth verifies tokens from WebSocket URL queries or Sec-WebSocket-Protocol header securely
func WSAuth(r *http.Request) bool {
	token := r.URL.Query().Get(constants.VAR_TOKEN)
	if token == "" {
		// Try Sec-WebSocket-Protocol header hack
		protocols := r.Header.Get(constants.HEADER_SEC_WEBSOCKET_PROTOCOL)
		if protocols != "" {
			parts := strings.SplitSeq(protocols, ",")
			for p := range parts {
				p = strings.TrimSpace(p)
				if strings.HasPrefix(p, constants.COZYSSH_TOKEN_PREFIX) {
					token = p
					break
				}
			}
		}
	}

	if token == "" {
		return false
	}
	return isValidToken(token)
}
