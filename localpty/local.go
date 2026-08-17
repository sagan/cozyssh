package localpty

import (
	"cozyssh/common"
	"encoding/json"
	"os"
	"path/filepath"
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
	Name           string   `json:"name"`                     // "Bash", "Zsh", "PowerShell", "CMD"
	Path           string   `json:"path"`                     // "/bin/bash", "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
	Args           []string `json:"args,omitempty"`           // ["-l"]
	RunCmdlineArgs []string `json:"runCmdlineArgs,omitempty"` // ["-l", "-c"]
	// Whether inject custom shell integration script. "" (default = auto), "0" (disable), "1" (enable)
	// Currently this value is sent by frontend back to backend when creating new terminal WebSocket.
	ShellIntegration string `json:"shellIntegration"`
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
			} else if strings.HasPrefix(configShell, "{") {
				var newShell *LocalShell
				if err := json.Unmarshal([]byte(configShell), &newShell); err != nil {
					continue
				}
				newShells = append(newShells, newShell)
				orders[newShell.Name] = i + 1
			} else {
				orders[strings.TrimSpace(configShell)] = i + 1
			}
		}
		if !removeAll {
			for _, shell := range localShells {
				if !blacklist[shell.Name] && !blacklist[shell.Path] {
					newShells = append(newShells, shell)
				}
			}
		}
		slices.SortStableFunc(newShells, func(a, b *LocalShell) int {
			var orderA, orderB int
			if orders[a.Name] > 0 {
				orderA = orders[a.Name]
			} else {
				orderA = orders[a.Path]
			}
			if orders[b.Name] > 0 {
				orderB = orders[b.Name]
			} else {
				orderB = orders[b.Path]
			}
			if orderA > 0 && orderB == 0 {
				return -1
			} else if orderA == 0 && orderB > 0 {
				return 1
			} else {
				return orderA - orderB
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

func Start(initialCmd string, execFlag bool, shellIntegrationFlag string, env []string) (*LocalSession, error) {
	var program string
	var args []string

	shells := GetShells()

	shellName := ""
	isShell := false

	if initialCmd == "" {
		program = shells[0].Path
		args = append(args, shells[0].Args...) // copy to avoid mutating LocalShell.Args
		shellName = strings.TrimSuffix(strings.ToLower(filepath.Base(program)), ".exe")
		isShell = true
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
		if shellIntegrationFlag != "0" {
			shellName, isShell = DetectShell(initialCmd)
		}
	} else {
		program = shells[0].Path
		args = append(args, shells[0].RunCmdlineArgs...)
		args = append(args, initialCmd)
		// in force inject case use shell name extracted from initialCmd even if exec is false
		if shellIntegrationFlag == "2" {
			shellName, _ = DetectShell(initialCmd)
		}
	}

	doInjection := false
	switch shellIntegrationFlag {
	case "2": // force inject
		doInjection = true
	case "", "1": // auto, inject
		doInjection = isShell
	}
	if doInjection {
		// Apply arg-based injection for shells that need it (e.g. powershell, fish).
		args = ApplyShellIntegrationArgs(shellName, args)
	}

	p, err := pty.New()
	if err != nil {
		return nil, err
	}

	cmd := p.Command(program, args...)

	// Set standard xterm env
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	// Inject shell integration env vars for interactive sessions.
	if doInjection {
		if siEnv := GetShellIntegrationEnv(shellName); len(siEnv) > 0 {
			cmd.Env = append(cmd.Env, siEnv...)
		}
	}
	cmd.Env = append(cmd.Env, env...)

	if pwd := common.LookupEnv(env, "PWD"); pwd != "" {
		cmd.Dir = pwd
	} else {
		// Force explicitly working out of home dir
		if home, err := os.UserHomeDir(); err == nil {
			cmd.Dir = home
		}
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
