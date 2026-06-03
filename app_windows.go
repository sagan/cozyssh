//go:build windows

package cozyssh

import (
	"os"
	"syscall"
)

func readLineRaw() (string, error) {
	var buf [512]byte
	fd := syscall.Handle(os.Stdin.Fd())
	n, err := syscall.Read(fd, buf[:])
	if err != nil {
		return "", err
	}
	return string(buf[:n]), nil
}
