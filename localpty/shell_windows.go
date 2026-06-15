//go:build windows

package localpty

import (
	"cozyssh/common"
	"os"
	"os/exec"
	"path/filepath"
	"slices"

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
	pf := os.Getenv("ProgramFiles")
	if pf == "" {
		pf = `C:\Program Files`
	}

	// Modern PowerShell (pwsh.exe) - Check system PATH & common path
	var pwshPath string
	if path, err := exec.LookPath("pwsh"); err == nil {
		pwshPath = path
	} else if path := filepath.Join(pf, "PowerShell", "7", "pwsh.exe"); common.FileExists(path) {
		pwshPath = path
	}
	if pwshPath != "" {
		shells = append(shells, &LocalShell{
			Name:           "PowerShell 7+",
			Path:           pwshPath,
			Args:           []string{"-NoLogo", "-l"},
			RunCmdlineArgs: []string{"-NoLogo", "-l", "-c"},
		})
	}

	// Legacy Windows PowerShell
	var powershellPath string
	if path, err := exec.LookPath("powershell"); err == nil {
		powershellPath = path
	} else if path := filepath.Join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"); common.FileExists(path) {
		powershellPath = path
	}
	if powershellPath != "" {
		shells = append(shells, &LocalShell{
			Name:           "Windows PowerShell",
			Path:           powershellPath,
			Args:           []string{"-NoLogo"},
			RunCmdlineArgs: []string{"-NoLogo", "-Command"},
		})
	}

	// Command Prompt (CMD)
	var cmdPath string
	if path, err := exec.LookPath("cmd"); err == nil {
		cmdPath = path
	} else if path := filepath.Join(sysRoot, "System32", "cmd.exe"); common.FileExists(path) {
		cmdPath = path
	}
	if cmdPath != "" {
		shells = append(shells, &LocalShell{
			Name:           "Command Prompt",
			Path:           cmdPath,
			RunCmdlineArgs: []string{"/c"},
		})
	}

	// standard arguments for login shells
	shellArgs := []string{"-l"}
	shellRunCmdlineArgs := []string{"-l", "-c"}

	// WSL Distributions (via Registry)
	var wslPath string
	if path, err := exec.LookPath("wsl"); err == nil {
		wslPath = path
	} else if path := filepath.Join(sysRoot, "System32", "wsl.exe"); common.FileExists(path) {
		wslPath = path
	}
	if wslPath != "" {
		wslRegPath := `Software\Microsoft\Windows\CurrentVersion\Lxss`
		k, err := registry.OpenKey(registry.CURRENT_USER, wslRegPath, registry.ENUMERATE_SUB_KEYS)
		if err == nil {
			defer k.Close()
			if names, err := k.ReadSubKeyNames(-1); err == nil {
				for i, subKeyName := range names {
					sk, err := registry.OpenKey(registry.CURRENT_USER, wslRegPath+"\\"+subKeyName, registry.QUERY_VALUE)
					if err == nil {
						distName, _, err := sk.GetStringValue("DistributionName")
						sk.Close()
						if err == nil {
							shell := &LocalShell{
								Name: distName + " (WSL)",
								Path: wslPath,
								Args: []string{"-d", distName},
							}
							if i == 0 && len(shells) > 0 {
								// put the first WSL in shells[1] (alternative shell)
								shells = slices.Insert(shells, 1, shell)
							} else {
								shells = append(shells, shell)
							}
						}
					}
				}
			}
		}
	}

	// Git Bash (via Registry)
	if gitPath, err := getRegistryString(registry.LOCAL_MACHINE, `SOFTWARE\GitForWindows`, "InstallPath"); err == nil {
		if bashPath := filepath.Join(gitPath, "bin", "bash.exe"); common.FileExists(bashPath) {
			shells = append(shells, &LocalShell{
				Name:           "Git Bash",
				Path:           bashPath,
				Args:           shellArgs,
				RunCmdlineArgs: shellRunCmdlineArgs,
			})
		}
	}

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

func getRegistryString(root registry.Key, path, valueName string) (string, error) {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer k.Close()
	val, _, err := k.GetStringValue(valueName)
	return val, err
}
