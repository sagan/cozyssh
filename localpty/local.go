package localpty

import (
	"os"
	"os/exec"
	"strings"

	"github.com/aymanbagabas/go-pty"
)

type LocalSession struct {
	Pty pty.Pty
}

var (
	DefaultShell                   string // Default system shell full path, e.g. "/bin/bash"
	DefaultShellIsLegacyPowershell bool   // True if default shell is legacy Windows "powershell.exe"
)

func init() {
	DefaultShell = (func() string {
		// Try to use user's default shell
		if shell := os.Getenv("SHELL"); shell != "" {
			if path, err := exec.LookPath(shell); err == nil {
				return path
			}
		}

		// Windows: try common shells
		if os.PathSeparator == '\\' {
			for _, shell := range []string{"pwsh", "powershell"} {
				if path, err := exec.LookPath(shell); err == nil {
					return path
				}
			}
		}

		// Linux/macOS: default to bash
		return "bash"
	})()

	if strings.HasSuffix(DefaultShell, "/powershell.exe") || strings.HasSuffix(DefaultShell, `\powershell.exe`) {
		DefaultShellIsLegacyPowershell = true
	}
}

func Start() (*LocalSession, error) {
	args := []string{}
	if !DefaultShellIsLegacyPowershell {
		args = append(args, "-l") // linux shell / pwsh has -l flag to set up a login shell
	}

	p, err := pty.New()
	if err != nil {
		return nil, err
	}

	cmd := p.Command(DefaultShell, args...)

	// Set standard xterm env
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	// Force explicitly working out of home dir
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}

	if err := cmd.Start(); err != nil {
		p.Close()
		return nil, err
	}

	return &LocalSession{
		Pty: p,
	}, nil
}

func (s *LocalSession) Resize(rows, cols uint16) error {
	return s.Pty.Resize(int(cols), int(rows))
}

func (s *LocalSession) Close() error {
	return s.Pty.Close()
}
