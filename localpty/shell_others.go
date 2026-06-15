//go:build !windows

package localpty

import (
	"bufio"
	"cozyssh/common"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// getShells returns a list of local shells.
// The first one is the current user's default shell.
// It's guaranteed to return at least one shell.
// It removes duplicates (e.g. /bin/sh and /usr/bin/sh is the same) and other not needed shells (e.g. screen, tmux)
func getShells() []*LocalShell {
	var shells []*LocalShell
	seenCanonicalPaths := make(map[string]bool)
	currentShell := os.Getenv("SHELL")

	args := []string{"-l"}
	runCmdlineArgs := []string{"-l", "-c"}

	// Filter out non-interactive shells, system utilities, and multiplexers
	blocklist := map[string]bool{
		"screen": true,
		"tmux":   true,
		"rbash":  true,
		"dash":   true,
	}

	file, err := os.Open("/etc/shells")
	if err != nil {
		// Bulletproof fallback if /etc/shells is broken or unreadable
		fallbacks := []string{"/bin/zsh", "/bin/bash"}
		for _, p := range fallbacks {
			if common.FileExists(p) {
				shells = append(shells, &LocalShell{
					Name:           capitalize(filepath.Base(p)),
					Path:           p,
					Args:           args,
					RunCmdlineArgs: runCmdlineArgs,
				})
			}
		}
		return shells
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Skip comments and empty lines
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// 1. Resolve symlinks (e.g., converts /bin/bash -> /usr/bin/bash)
		canonicalPath, err := filepath.EvalSymlinks(line)
		if err != nil {
			canonicalPath = line // If resolution fails, fall back to the original string
		}

		baseName := strings.ToLower(filepath.Base(canonicalPath))

		// 2. Drop anything matched in our blocklist
		if blocklist[baseName] {
			continue
		}

		// 3. Drop if the file doesn't actually exist or if it's a duplicate path
		if !common.FileExists(canonicalPath) || seenCanonicalPaths[canonicalPath] {
			continue
		}

		seenCanonicalPaths[canonicalPath] = true
		shells = append(shells, &LocalShell{
			Name:           capitalize(baseName),
			Path:           canonicalPath,
			Args:           args,
			RunCmdlineArgs: runCmdlineArgs,
		})
	}

	// Sort cleanly: Current $SHELL -> Zsh -> Bash -> Fish -> Others
	sort.Slice(shells, func(i, j int) bool {
		return getUnixPriority(shells[i].Path, currentShell) < getUnixPriority(shells[j].Path, currentShell)
	})

	if len(shells) == 0 {
		shells = append(shells, &LocalShell{
			Name:           "sh",
			Path:           "sh",
			Args:           args,
			RunCmdlineArgs: runCmdlineArgs,
		})
	}

	return shells
}

func getUnixPriority(path, currentShell string) int {
	if currentShell != "" && path == currentShell {
		return 0
	}

	base := strings.ToLower(filepath.Base(path))
	switch base {
	case "zsh":
		return 1
	case "bash":
		return 2
	case "fish":
		return 3
	case "sh":
		return 4
	default:
		return 5 // Everything else falls nicely below the common crowd
	}
}

func capitalize(s string) string {
	if len(s) == 0 {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
