package localpty

import (
	"os"
	"sync/atomic"

	"github.com/aymanbagabas/go-pty"
	"github.com/google/shlex"
)

type LocalSession struct {
	Pty    pty.Pty
	cmd    *pty.Cmd
	closed atomic.Bool
}

type LocalShell struct {
	Name           string   `json:"name"`                       // "Bash", "Zsh", "PowerShell", "CMD"
	Path           string   `json:"path"`                       // "/bin/bash", "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
	Args           []string `json:"args,omitempty"`             // ["-l"]
	RunCmdlineArgs []string `json:"run_cmdline_args,omitempty"` // ["-l", "-c"]
}

var (
	shells atomic.Value // Hold []*LocalShell
)

func init() {
	Refresh()
}

func Refresh() {
	shells.Store(getShells())
}

func GetShells() []*LocalShell {
	return shells.Load().([]*LocalShell)
}

func Start(initialCmd string) (*LocalSession, error) {
	var program string
	var args []string

	shells := GetShells()

	if initialCmd != "" {
		var err error
		args, err = shlex.Split(initialCmd)
		if err == nil && len(args) > 0 {
			program = args[0]
			args = args[1:]
		} else {
			program = shells[0].Path
			args = shells[0].RunCmdlineArgs
			args = append(args, initialCmd)
		}
	} else {
		program = shells[0].Path
		args = shells[0].Args
	}

	p, err := pty.New()
	if err != nil {
		return nil, err
	}

	cmd := p.Command(program, args...)

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

// Common helper to verify if an executable exists
func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}
