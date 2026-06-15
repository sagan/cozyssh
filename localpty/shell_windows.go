//go:build windows

package localpty

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// getShells returns a list of local shells.
// The first one is the current user's default shell.
// It's guaranteed to return at least one shell.
func getShells() []*LocalShell {
	var shells []*LocalShell

	sysRoot := os.Getenv("SystemRoot")
	if sysRoot == "" {
		sysRoot = `C:\Windows`
	}

	// 1. Modern PowerShell (pwsh.exe) - Check common path & system PATH
	pf := os.Getenv("ProgramFiles")
	if pf == "" {
		pf = `C:\Program Files`
	}
	pwshPath := filepath.Join(pf, "PowerShell", "7", "pwsh.exe")
	if !fileExists(pwshPath) {
		if lookPath, err := exec.LookPath("pwsh"); err == nil {
			pwshPath = lookPath
		}
	}
	if fileExists(pwshPath) {
		shells = append(shells, &LocalShell{
			Name:           "PowerShell 7+",
			Path:           pwshPath,
			Args:           []string{"-NoLogo", "-l"},
			RunCmdlineArgs: []string{"-NoLogo", "-l", "-c"},
		})
	}

	// 2. Legacy Windows PowerShell
	winPS := filepath.Join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	if fileExists(winPS) {
		shells = append(shells, &LocalShell{
			Name:           "Windows PowerShell",
			Path:           winPS,
			Args:           []string{"-NoLogo"},
			RunCmdlineArgs: []string{"-NoLogo", "-Command"},
		})
	}

	// 3. Command Prompt (CMD)
	cmdPath := os.Getenv("COMSPEC")
	if cmdPath == "" {
		cmdPath = filepath.Join(sysRoot, "System32", "cmd.exe")
	}
	if fileExists(cmdPath) {
		shells = append(shells, &LocalShell{
			Name:           "Command Prompt",
			Path:           cmdPath,
			RunCmdlineArgs: []string{"/c"},
		})
	}

	// standard arguments for login shells
	shellArgs := []string{"-l"}
	shellRunCmdlineArgs := []string{"-l", "-c"}

	// 4. Git Bash (via Registry)
	if gitPath, err := getRegistryString(registry.LOCAL_MACHINE, `SOFTWARE\GitForWindows`, "InstallPath"); err == nil {
		bashPath := filepath.Join(gitPath, "bin", "bash.exe")
		if fileExists(bashPath) {
			shells = append(shells, &LocalShell{
				Name:           "Git Bash",
				Path:           bashPath,
				Args:           shellArgs,
				RunCmdlineArgs: shellRunCmdlineArgs,
			})
		}
	}

	// 5. WSL Distributions (via Registry)
	wslPath := filepath.Join(sysRoot, "System32", "wsl.exe")
	if fileExists(wslPath) {
		wslRegPath := `Software\Microsoft\Windows\CurrentVersion\Lxss`
		k, err := registry.OpenKey(registry.CURRENT_USER, wslRegPath, registry.ENUMERATE_SUB_KEYS)
		if err == nil {
			defer k.Close()
			if names, err := k.ReadSubKeyNames(-1); err == nil {
				for _, subKeyName := range names {
					sk, err := registry.OpenKey(registry.CURRENT_USER, wslRegPath+"\\"+subKeyName, registry.QUERY_VALUE)
					if err == nil {
						distName, _, err := sk.GetStringValue("DistributionName")
						sk.Close()
						if err == nil {
							shells = append(shells, &LocalShell{
								Name: distName + " (WSL)",
								Path: wslPath,
								Args: []string{"-d", distName},
							})
						}
					}
				}
			}
		}
	}

	// Sort based on priority: pwsh -> powershell -> cmd -> others (Git Bash / WSL)
	sort.Slice(shells, func(i, j int) bool {
		return getWinPriority(shells[i].Path) < getWinPriority(shells[j].Path)
	})

	if len(shells) == 0 {
		// fallback
		shells = append(shells, &LocalShell{
			Name:           "Windows PowerShell",
			Path:           "powershell",
			Args:           []string{"-NoLogo"},
			RunCmdlineArgs: []string{"-NoLogo", "-Command"},
		})
	}

	return shells
}

func getWinPriority(path string) int {
	base := strings.ToLower(filepath.Base(path))
	switch base {
	case "pwsh.exe":
		return 0
	case "wsl.exe":
		return 1
	case "powershell.exe":
		return 2
	case "cmd.exe":
		return 3
	case "bash.exe": // Git Bash
		return 4
	default:
		return 5
	}
}

func getRegistryString(root registry.Key, path, valueName string) (string, error) {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer k.Close()
	val, _, err := k.GetStringValue(valueName)
	return val, err
}
