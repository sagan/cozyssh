package common

import (
	"os/user"
)

// Get current OS user name, fallback to "root"
func GetUserName() string {
	u, err := user.Current()
	if err != nil {
		return "root"
	}
	return u.Username
}
