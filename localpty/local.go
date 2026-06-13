package localpty

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/aymanbagabas/go-pty"
)

type LocalSession struct {
	Pty    pty.Pty
	cmd    *pty.Cmd
	closed atomic.Bool
}

var (
	DefaultShell                    string // Default system shell full path, e.g. "/bin/bash"
	DefaultShellArguments           []string
	DefaultShellRunCmdlineArguments []string
)

func init() {
	DefaultShell = (func() string {
		// Try to use user's default shell
		if shell := os.Getenv("SHELL"); shell != "" {
			if path, err := exec.LookPath(shell); err == nil {
				return path
			}
		}

		var shells []string
		// try common shells
		if os.PathSeparator == '\\' {
			shells = []string{"pwsh", "powershell", "cmd"}
		} else {
			shells = []string{"zsh", "bash", "sh"}
		}
		for _, shell := range shells {
			if path, err := exec.LookPath(shell); err == nil {
				return path
			}
		}
		return "sh"
	})()

	shellBasename := strings.TrimSuffix(strings.ToLower(filepath.Base(DefaultShell)), ".exe")
	switch shellBasename {
	case "pwsh":
		DefaultShellRunCmdlineArguments = []string{"-NoLogo", "-l", "-c"}
		DefaultShellArguments = []string{"-NoLogo", "-l"}
	case "powershell":
		DefaultShellRunCmdlineArguments = []string{"-NoLogo", "-Command"}
	case "cmd":
		DefaultShellRunCmdlineArguments = []string{"/c"}
	default:
		DefaultShellRunCmdlineArguments = []string{"-l", "-c"}
		DefaultShellArguments = []string{"-l"}
	}
}

func Start(initialCmd string) (*LocalSession, error) {
	args := []string{}

	if initialCmd != "" {
		args = append(args, DefaultShellRunCmdlineArguments...)
		args = append(args, initialCmd)
	} else {
		args = append(args, DefaultShellArguments...)
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

	ls := &LocalSession{
		Pty: p,
		cmd: cmd,
	}
	go func() {
		cmd.Wait()
		ls.Close()
	}()

	return ls, nil
}

func (s *LocalSession) Resize(rows, cols uint16) error {
	return s.Pty.Resize(int(cols), int(rows))
}

func (s *LocalSession) Close() error {
	if ok := s.closed.CompareAndSwap(false, true); ok {
		err := s.Pty.Close()
		if s.cmd != nil && s.cmd.Process != nil {
			_ = s.cmd.Process.Kill()
		}
		return err
	}
	return nil
}
