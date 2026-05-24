//go:build !windows

package fsapi

import (
	"cozyssh/models"
)

func GetAvailableDrives() []*models.FileInfo {
	return nil
}
