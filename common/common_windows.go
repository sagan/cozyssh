//go:build windows

package common

import (
	"os/exec"
	"syscall"
)

// Tell Windows to hide the console window for this child process.
// So cmd won't display terminal splash screen even if `-H=windowsgui` ldflags is used.
func PatchCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
}
