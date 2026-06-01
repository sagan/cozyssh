package common

import (
	"os"
	"os/user"
	"strings"
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
