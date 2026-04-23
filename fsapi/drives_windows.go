//go:build windows
package fsapi

import (
	"golang.org/x/sys/windows"
)

func GetAvailableDrives() []FileInfo {
	var drives []FileInfo
	bitmask, err := windows.GetLogicalDrives()
	if err != nil {
		return nil
	}
	for char := 'A'; char <= 'Z'; char++ {
		if bitmask&(1<<uint(char-'A')) != 0 {
			dPath := string(char) + ":\\"
			drives = append(drives, FileInfo{
				Name:    dPath,
				IsDir:   true,
				Size:    0,
				ModTime: "-",
			})
		}
	}
	return drives
}
