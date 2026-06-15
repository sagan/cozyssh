package common

import (
	"bytes"
	"fmt"
	"io"
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
