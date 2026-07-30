package localpty

import (
	"path"
	"strings"

	"github.com/google/shlex"
)

// hasWindowsCharacteristics checks if the command line targets a Windows context.
func hasWindowsCharacteristics(cmdline string) bool {
	lowered := strings.ToLower(cmdline)

	// Contains a drive letter specification (e.g., C:\)
	if strings.Contains(lowered, ":\\") {
		return true
	}
	// Contains a Windows executable extension
	if strings.Contains(lowered, ".exe") {
		return true
	}
	// Contains Windows relative path patterns
	if strings.Contains(lowered, ".\\") || strings.Contains(lowered, "..\\") {
		return true
	}
	// Contains Windows shell keywords accompanied by backslashes
	if strings.Contains(lowered, "\\") &&
		(strings.Contains(lowered, "powershell") || strings.Contains(lowered, "pwsh") || strings.Contains(lowered, "cmd")) {
		return true
	}

	return false
}

// preprocessCmdline normalizes Windows path separators so shlex won't swallow them.
func preprocessCmdline(cmdline string) string {
	if !hasWindowsCharacteristics(cmdline) {
		return cmdline
	}

	var result strings.Builder
	runes := []rune(cmdline)
	for i := range runes {
		if runes[i] == '\\' && i+1 < len(runes) {
			next := runes[i+1]
			// Safeguard: Do NOT convert escaped quotes (e.g., \") which are valid in both worlds
			if next == '"' || next == '\'' {
				result.WriteRune('\\')
				continue
			}
			// Treat as a Windows path separator and normalize to forward slash
			result.WriteRune('/')
			continue
		}
		result.WriteRune(runes[i])
	}
	return result.String()
}

// cleanBinaryName normalizes remaining paths, removes extensions, and lowercases the token.
func cleanBinaryName(token string) string {
	normalized := strings.ReplaceAll(token, "\\", "/")
	base := path.Base(normalized)
	base = strings.ToLower(base)
	base = strings.TrimSuffix(base, ".exe")
	return base
}

// DetectShell analyzes an OpenSSH RemoteCommand string to see if it targets a shell.
// Return detected shell name, e.g. "bash", "powershell".
// If it's a Windows cmdline, the ".exe" suffix is removed and the name is converted to lowercase.
// If the command is not a shell, return an empty string and false.
func DetectShell(cmdline string) (string, bool) {
	// Preprocess Windows environments to protect backslashes from being consumed by shlex
	safeCmdline := preprocessCmdline(cmdline)

	tokens, err := shlex.Split(safeCmdline)
	if err != nil || len(tokens) == 0 {
		return "", false
	}

	knownShells := map[string]bool{
		"sh": true, "bash": true, "zsh": true, "ksh": true,
		"csh": true, "tcsh": true, "fish": true, "dash": true,
		"ash": true, "rbash": true,
		"cmd": true, "powershell": true, "pwsh": true,
	}

	i := 0
	for i < len(tokens) {
		token := cleanBinaryName(tokens[i])

		switch token {
		case "sudo", "doas", "pkexec":
			i++
			for i < len(tokens) {
				if strings.HasPrefix(tokens[i], "-") {
					flag := tokens[i]
					i++
					if i < len(tokens) && !strings.Contains(flag, "=") {
						if flag == "-u" || flag == "-g" || flag == "-p" || flag == "-D" || flag == "-C" {
							i++
						}
					}
				} else {
					break
				}
			}

		case "env":
			i++
			for i < len(tokens) {
				if strings.HasPrefix(tokens[i], "-") {
					flag := tokens[i]
					i++
					if i < len(tokens) && !strings.Contains(flag, "=") && (flag == "-u" || flag == "--unset") {
						i++
					}
				} else if strings.Contains(tokens[i], "=") {
					i++
				} else {
					break
				}
			}

		case "docker", "kubectl":
			isDocker := token == "docker"
			i++

			for i < len(tokens) && tokens[i] != "exec" {
				if strings.HasPrefix(tokens[i], "-") {
					flag := tokens[i]
					i++
					if i < len(tokens) && !strings.Contains(flag, "=") {
						if isDocker && (flag == "-H" || flag == "--host" || flag == "-c" || flag == "--context") {
							i++
						} else if !isDocker && (flag == "-n" || flag == "--namespace" || flag == "--context" || flag == "--kubeconfig") {
							i++
						}
					}
				} else {
					break
				}
			}

			if i < len(tokens) && tokens[i] == "exec" {
				i++

				for i < len(tokens) {
					if strings.HasPrefix(tokens[i], "-") {
						flag := tokens[i]
						i++
						if i < len(tokens) && !strings.Contains(flag, "=") {
							if isDocker && (flag == "-u" || flag == "--user" || flag == "-w" || flag == "--workdir" || flag == "-e" || flag == "--env" || flag == "--env-file") {
								i++
							} else if !isDocker && (flag == "-c" || flag == "--container" || flag == "--pod-running-timeout") {
								i++
							}
						}
					} else {
						break
					}
				}

				if isDocker {
					if i < len(tokens) {
						i++
					}
				} else {
					if i < len(tokens) && tokens[i] != "--" {
						i++
					}
					if i < len(tokens) && tokens[i] == "--" {
						i++
					}
				}
				continue
			}
			return "", false

		default:
			if knownShells[token] {
				return token, true
			}
			return "", false
		}
	}

	return "", false
}
