//go:build !windows

package common

import (
	"os/exec"
)

func PatchCmd(cmd *exec.Cmd) {
}
