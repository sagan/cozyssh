package localpty

import (
	"os"
	"os/exec"

	"github.com/aymanbagabas/go-pty"
)

type LocalSession struct {
	Pty pty.Pty
}

func Start() (*LocalSession, error) {
	// Shell defaults to bash or user's env SHELL on linux.
	// On Windows development, we fallback to powershell.
	shell := os.Getenv("SHELL")
	args := []string{}
	if shell == "" {
		if os.PathSeparator == '\\' {
			shell = "powershell"
		} else {
			shell = "bash"
		}
	}
	shell, _ = exec.LookPath(shell)
	if os.PathSeparator == '/' {
		args = append(args, "-l") // most non-Windows shells has -l flag to set up a login shell
	}

	p, err := pty.New()
	if err != nil {
		return nil, err
	}

	cmd := p.Command(shell, args...)

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
