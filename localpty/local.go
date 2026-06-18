package localpty

import (
	"os"
	"slices"
	"strings"
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

func Load(configShells []string) {
	localShells := getShells()
	if len(configShells) > 0 {
		var newShells []*LocalShell
		blacklist := map[string]bool{}
		orders := map[string]int{}
		removeAll := false
		for i, configShell := range configShells {
			if configShell == "-*" {
				removeAll = true
				continue
			} else if strings.HasPrefix(configShell, "-") {
				blacklist[strings.TrimSpace(configShell[1:])] = true
			} else if strings.HasPrefix(configShell, "+") {
				if tokens, err := shlex.Split(configShell[1:]); err == nil && len(tokens) > 2 {
					var args []string
					var runCmdlineArgs []string
					if len(tokens) > 2 {
						args, _ = shlex.Split(tokens[2])
					}
					if len(tokens) > 3 {
						runCmdlineArgs, _ = shlex.Split(tokens[3])
					}
					newShells = append(newShells, &LocalShell{
						Name:           tokens[0],
						Path:           tokens[1],
						Args:           args,
						RunCmdlineArgs: runCmdlineArgs,
					})
					orders[tokens[1]] = i + 1
				}
			} else {
				orders[strings.TrimSpace(configShell)] = i + 1
			}
		}
		if !removeAll {
			for _, shell := range localShells {
				if !blacklist[shell.Path] {
					newShells = append(newShells, shell)
				}
			}
		}
		slices.SortStableFunc(newShells, func(a, b *LocalShell) int {
			if orders[a.Path] > 0 && orders[b.Path] == 0 {
				return -1
			} else if orders[a.Path] == 0 && orders[b.Path] > 0 {
				return 1
			} else {
				return orders[a.Path] - orders[b.Path]
			}
		})
		if len(newShells) > 0 {
			localShells = newShells
		} else {
			localShells = []*LocalShell{localShells[0]}
		}
	}
	shells.Store(localShells)
}

func GetShells() []*LocalShell {
	return shells.Load().([]*LocalShell)
}

func Start(initialCmd string, execFlag bool) (*LocalSession, error) {
	var program string
	var args []string

	shells := GetShells()

	if initialCmd == "" {
		program = shells[0].Path
		args = shells[0].Args
	} else if execFlag {
		var err error
		args, err = shlex.Split(initialCmd)
		if err == nil && len(args) > 0 {
			program = args[0]
			args = args[1:]
		} else {
			program = shells[0].Path
			args = append(args, shells[0].RunCmdlineArgs...)
			args = append(args, initialCmd)
		}
	} else {
		program = shells[0].Path
		args = append(args, shells[0].RunCmdlineArgs...)
		args = append(args, initialCmd)
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
