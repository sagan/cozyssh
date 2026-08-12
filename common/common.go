package common

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/user"
	"strings"

	"codeberg.org/sdassow/atomic"
	"github.com/go-http-utils/headers"
)

var (
	// current OS username
	User = (func() string {
		u, err := user.Current()
		if err != nil {
			return "root"
		}
		if os.PathSeparator == '\\' {
			// on Windows it's "WORKSTATION\username" format
			if _, user, found := strings.Cut(u.Username, string(os.PathSeparator)); found {
				return user
			}
		}
		return u.Username
	})()

	IsApp = false // whether running as windows desktop app
)

// Works similar to shell's expansion.
// Expand "~/" to home dir;
// Expand "$VAR" or "${VAR}" to environment variables
func ExpandPath(fspath string) string {
	// 1. Handle home directory expansion (~ or ~/)
	if fspath == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			fspath = home
		}
	} else if strings.HasPrefix(fspath, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			// fspath[1:] keeps the "/" from "~/", resulting in home + "/path"
			fspath = home + fspath[1:]
		}
	}

	// 2. Handle environment variable expansion ($VAR or ${VAR})
	return os.ExpandEnv(fspath)
}

// Atomically writes data to a file with 0600 permission.
// It uses a temporary file and atomic rename to ensure that the file is either fully written or not written at all.
// This prevents data corruption in case of an interruption during the write operation.
func AtomicWriteFile(path string, writeContent func(writer io.Writer) error) error {
	reader, writer := io.Pipe()
	go func() {
		writer.CloseWithError(writeContent(writer))
	}()
	return atomic.WriteFile(path, reader, atomic.FileMode(0600))
}

func AtomicWriteFileContents(path string, data []byte) error {
	return atomic.WriteFile(path, bytes.NewReader(data), atomic.FileMode(0600))
}

func IsSameOrigin(r *http.Request) bool {
	origin := r.Header.Get(headers.Origin)
	return origin == "" || strings.HasSuffix(origin, "://"+r.Host)
}

func ReadStdinLine() string {
	var line string
	_, err := fmt.Scanln(&line)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(line)
}

// Check if path exists and is file (not dir)
func FileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// Return a cryptographically secure random string of format /[a-zA-Z0-9]{length}/ .
// If digigOnly is true, return  /[0-9]{length}/
func RandString(length int, digitOnly bool) string {
	if length <= 0 {
		return ""
	}
	var rand_chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	if digitOnly {
		rand_chars = "0123456789"
	}
	var sb strings.Builder
	// (math.MaxUint8 / len(rand_chars)) results in an integer, e.g., 4
	// The result is directly cast to float64, e.g., 4.0
	// This is multiplied by float64(len(rand_chars))
	var max byte = byte(float64(math.MaxUint8/len(rand_chars)) * float64(len(rand_chars)))
	buf := make([]byte, length)
outer:
	for {
		if _, err := rand.Read(buf); err != nil {
			panic("rand.Read() failed")
		}
		for _, byte := range buf {
			// By taking only the numbers up to a multiple of char space size and discarding others,
			// we expect a uniform distribution of all possible chars.
			if byte < max {
				sb.WriteByte(rand_chars[int(byte)%len(rand_chars)])
			}
			if sb.Len() >= length {
				break outer
			}
		}
	}
	return sb.String()
}

func LookupEnv(env []string, key string) string {
	prefix := key + "="
	for _, e := range env {
		if value, ok := strings.CutPrefix(e, prefix); ok {
			return value
		} else if e == key {
			return ""
		}
	}
	return ""
}
