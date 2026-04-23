//go:build !windows
package fsapi

func GetAvailableDrives() []FileInfo {
	return nil
}
