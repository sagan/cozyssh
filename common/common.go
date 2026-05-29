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
