package localpty

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type LocalSession struct {
	PtyFile *os.File
	Cmd     *exec.Cmd
}

func Start() (*LocalSession, error) {
	// Shell defaults to bash or user's env SHELL on linux.
	// On Windows development, we fallback to powershell.
	shell := os.Getenv("SHELL")
	if shell == "" {
		if os.PathSeparator == '\\' {
			shell = "powershell.exe"
		} else {
			shell = "bash"
		}
	}

	c := exec.Command(shell)

	// Set standard xterm env
	c.Env = append(os.Environ(), "TERM=xterm-256color")
	
	// Force explicitly working out of home dir
	if home, err := os.UserHomeDir(); err == nil {
		c.Dir = home
	}

	ptmx, err := pty.Start(c)
	if err != nil {
		return nil, err
	}

	return &LocalSession{
		PtyFile: ptmx,
		Cmd:     c,
	}, nil
}

func (s *LocalSession) Resize(rows, cols uint16) error {
	return pty.Setsize(s.PtyFile, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
}

func (s *LocalSession) Close() error {
	if s.Cmd != nil && s.Cmd.Process != nil {
		s.Cmd.Process.Kill()
	}
	return s.PtyFile.Close()
}
