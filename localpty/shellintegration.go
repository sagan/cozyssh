package localpty

import (
	"bytes"
	"cozyssh/resources"
	rand "crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

var (
	shellIntegrationDir      string
	shellIntegrationDirOnce  sync.Once
	shellIntegrationDirMutex sync.Mutex
	shellIntegrationDirErr   error // error creating dir, won't try again
)

// ShellIntegrationDir extracts the embedded shell integration scripts
// to a temporary directory on disk. The extraction is performed only once.
// Returns the path to the directory, or empty string on failure.
func ShellIntegrationDir(autoCreate bool) string {
	shellIntegrationDirMutex.Lock()
	defer shellIntegrationDirMutex.Unlock()

	if !autoCreate {
		return shellIntegrationDir
	}

	if shellIntegrationDirErr != nil {
		return ""
	}
	if shellIntegrationDir != "" {
		if stat, err := os.Stat(shellIntegrationDir); err == nil && stat.IsDir() {
			return shellIntegrationDir
		}
		os.RemoveAll(shellIntegrationDir)
		shellIntegrationDir = ""
	}

	// Create a temp directory for our scripts
	dir, err := os.MkdirTemp("", "cozyssh-shell-integration-*")
	if err != nil {
		log.Printf("shellintegration: failed to create temp dir: %v", err)
		shellIntegrationDirErr = err
		return ""
	}

	// Walk and extract all files from the embedded scripts directory
	err = fs.WalkDir(resources.Scripts, "scripts", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Compute destination path: strip leading "scripts/" prefix
		rel, err := filepath.Rel("scripts", path)
		if err != nil {
			return err
		}
		dest := filepath.Join(dir, rel)

		if d.IsDir() {
			return os.MkdirAll(dest, 0755)
		}

		data, err := resources.Scripts.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(dest, data, 0644)
	})

	if err != nil {
		log.Printf("shellintegration: failed to extract scripts: %v", err)
		// Clean up the partially-created directory
		_ = os.RemoveAll(dir)
		shellIntegrationDirErr = err
		return ""
	}

	shellIntegrationDir = dir
	log.Printf("shellintegration: scripts extracted to %s", dir)
	return shellIntegrationDir
}

// GetShellIntegrationEnv returns a slice of environment variables (in "KEY=VALUE" format)
// that trigger automatic shell integration injection for the given shell executable.
//
// The approach mirrors VS Code's shell integration injection:
//
//   - bash: Set BASH_ENV to the bash script path and VSCODE_INJECTION=1.
//     Bash sources $BASH_ENV automatically on every non-interactive invocation,
//     and the script also handles the interactive case via $VSCODE_INJECTION.
//
//   - zsh:  Set ZDOTDIR to the scripts dir (which contains .zshenv that chains
//     into the integration rc) and USER_ZDOTDIR to the user's original ZDOTDIR.
//
//   - fish: Set VSCODE_FISH_INJECT_SCRIPT to the fish script path.
//     Fish's config.fish should source it when $TERM_PROGRAM is "vscode";
//     we also set TERM_PROGRAM so the guard passes.
//
//   - PowerShell / pwsh: The caller must prepend extra arguments instead of env
//     vars, so this function returns nil for PowerShell shells.  The args are
//     injected separately in Start().
func GetShellIntegrationEnv(shellName string) []string {
	dir := ShellIntegrationDir(true)
	if dir == "" {
		return nil
	}

	switch shellName {
	case "bash":
		return []string{
			"VSCODE_INJECTION=1",
			"VSCODE_SHELL_LOGIN=1",
			"TERM_PROGRAM=vscode",
		}

	case "zsh":
		// Zsh reads .zshenv from $ZDOTDIR on start. We place zsh scripts in
		// the extracted dir and set ZDOTDIR so zsh picks them up automatically.
		// USER_ZDOTDIR tells the integration script where the user's original
		// dotfiles live (default: $HOME).
		userZdotdir := os.Getenv("ZDOTDIR")
		if userZdotdir == "" {
			if home, err := os.UserHomeDir(); err == nil {
				userZdotdir = home
			}
		}
		return []string{
			"VSCODE_INJECTION=1",
			"TERM_PROGRAM=vscode",
			"USER_ZDOTDIR=" + userZdotdir,
			"ZDOTDIR=" + filepath.ToSlash(dir),
		}

	case "fish":
		// Fish's integration script checks for $TERM_PROGRAM == "vscode".
		// We set it and let fish source the script via --init-command in GetShellIntegrationArgs.
		return []string{
			"TERM_PROGRAM=vscode",
		}
	}

	return nil
}

// ApplyShellIntegrationArgs modifies args in-place (or replaces them) to inject
// shell integration for shells that require argument-based injection.
// It returns the (possibly new) args slice.
// For all other shells this is a no-op and returns args unchanged.
func ApplyShellIntegrationArgs(shellName string, args []string) []string {
	dir := ShellIntegrationDir(true)
	if dir == "" {
		return args
	}

	switch shellName {
	case "pwsh", "powershell":
		scriptPath := filepath.Join(dir, "shellIntegration.ps1")
		// Build a clean arg list: keep -NoLogo if present, then add -NoExit
		// and -Command to source the script. -l is incompatible with -Command,
		// so we drop it.
		var newArgs []string
		for _, a := range args {
			switch strings.ToLower(a) {
			case "-nologo":
				newArgs = append(newArgs, a)
				// drop "-l" (login shell) and any -Command / -c variants
			}
		}
		newArgs = append(newArgs, "-NoExit", "-Command", ". '"+scriptPath+"'")
		return newArgs

	case "fish":
		scriptPath := filepath.ToSlash(filepath.Join(dir, "shellIntegration.fish"))
		// Fish supports --init-command to run code after config is loaded but before the prompt.
		return append(args, "--init-command", "source "+scriptPath)

	case "bash":
		if i := slices.Index(args, "-l"); i != -1 {
			args = slices.Delete(args, i, i+1)
		}
		scriptPath := filepath.ToSlash(filepath.Join(dir, "shellIntegration-bash.sh"))
		// If --init-file is set /etc/bash.bashrc & ~/.bashrc won't be executed by bash.
		// However the VS Code shellIntegration-bash.sh will execute them instead.
		args = slices.Insert(args, 0, "--init-file", scriptPath)
		return args
	}

	return args
}

type RemotePayload struct {
	Default string // Full-featured shell integration for bash, zsh, fish...
	Bash    string // Dedicated Bash payload
	Zsh     string // Dedicated Zsh payload
	Ash     string // Basic feature shell integration for BusyBox ash (OpenWrt / Alpine)
}

var (
	remotePayload     RemotePayload
	remotePayloadOnce sync.Once
)

// GetRemoteShellIntegrationPayload returns a self-contained shell snippet
// that detects whether the remote shell is Zsh or Bash, decodes the embedded
// script from base64, and evaluates it in memory without writing files to disk.
func GetRemoteShellIntegrationPayload(shellIntegration string) string {
	remotePayloadOnce.Do(func() {
		bashBytes, err1 := resources.Scripts.ReadFile("scripts/shellIntegration-bash.sh")
		zshBytes, err2 := resources.Scripts.ReadFile("scripts/shellIntegration-rc.zsh")
		ashBytes, err3 := resources.Scripts.ReadFile("scripts/shellIntegration-ash.sh")
		if err1 != nil || err2 != nil || err3 != nil {
			log.Printf("shellintegration: error reading embedded scripts: %v, %v, %v", err1, err2, err3)
			return
		}

		// Normalize line endings to Unix LF (\n)
		bashBytes = bytes.ReplaceAll(bashBytes, []byte("\r\n"), []byte("\n"))
		zshBytes = bytes.ReplaceAll(zshBytes, []byte("\r\n"), []byte("\n"))
		ashBytes = bytes.ReplaceAll(ashBytes, []byte("\r\n"), []byte("\n"))

		// Strip comment lines and empty lines
		bashBytes = stripScriptComments(bashBytes)
		zshBytes = stripScriptComments(zshBytes)
		ashBytes = stripScriptComments(ashBytes)

		// IMPORTANT: Keep Bash/Zsh base64 as single contiguous strings (NO line splitting).
		// This prevents Readline 6.2 (CentOS 7) from processing hundreds of lines interactively.
		bashB64 := base64.StdEncoding.EncodeToString(bashBytes)
		zshB64 := base64.StdEncoding.EncodeToString(zshBytes)

		// BusyBox ash still needs line wrapping due to its small line-input buffer.
		ashB64 := splitBase64Lines(base64.StdEncoding.EncodeToString(ashBytes))

		// set +o history broke shell integration on CentOS 7 because CentOS 7 doesn't have HISTCONTROL env set
		// Dedicated Bash payload (guarded & output-suppressed)
		remotePayload.Bash = `{ if [ -n "$BASH_VERSION" ]; then eval "$(base64 -d 2>/dev/null <<'__COZYSSH_BASH__'` + "\n" +
			bashB64 + "\n" +
			"__COZYSSH_BASH__" + "\n" +
			`)"; history -d -1 2>/dev/null; fi; } >/dev/null 2>&1`

		// Dedicated Zsh payload (guarded & output-suppressed)
		remotePayload.Zsh = `{ if [ -n "$ZSH_VERSION" ]; then eval "$(base64 -d 2>/dev/null <<'__COZYSSH_ZSH__'` + "\n" +
			zshB64 + "\n" +
			"__COZYSSH_ZSH__" + "\n" +
			`)"; history -d -1 2>/dev/null; fi; } >/dev/null 2>&1`

		// Combined fallback payload (for auto-detection)
		remotePayload.Default = `{ if [ -n "$ZSH_VERSION" ]; then eval "$(base64 -d 2>/dev/null <<'__COZYSSH_ZSH__'` + "\n" +
			zshB64 + "\n" +
			"__COZYSSH_ZSH__" + "\n" +
			`)"; history -d -1 2>/dev/null; elif [ -n "$BASH_VERSION" ]; then eval "$(base64 -d 2>/dev/null <<'__COZYSSH_BASH__'` + "\n" +
			bashB64 + "\n" +
			"__COZYSSH_BASH__" + "\n" +
			`)"; history -d -1 2>/dev/null; fi; } >/dev/null 2>&1`

		// BusyBox ash payload
		remotePayload.Ash = `eval "$(base64 -d 2>/dev/null <<'__COZYSSH_ASH__'` + "\n" +
			ashB64 + "\n" +
			"__COZYSSH_ASH__" + "\n" +
			`)" >/dev/null 2>&1`
	})

	switch shellIntegration {
	case "bash":
		return remotePayload.Bash
	case "zsh":
		return remotePayload.Zsh
	case "ash":
		return remotePayload.Ash
	default:
		return remotePayload.Default
	}
}

// splitBase64Lines wraps a base64 string at 76 characters per line.
// This keeps each line well within the interactive shell input-buffer limits
// of minimal systems (busybox ash, OpenWrt sh, etc.) when the data is
// delivered via a heredoc.
func splitBase64Lines(s string) string {
	const lineLen = 76
	var sb strings.Builder
	for len(s) > lineLen {
		sb.WriteString(s[:lineLen])
		sb.WriteByte('\n')
		s = s[lineLen:]
	}
	sb.WriteString(s)
	return sb.String()
}

// stripScriptComments removes full-line comments (lines whose first non-whitespace character is #),
// leading/trailing whitespace (indentation), and empty lines from shell script bytes before base64
// encoding to minimize payload size while keeping script logic identical.
func stripScriptComments(content []byte) []byte {
	lines := bytes.Split(content, []byte("\n"))
	var filtered [][]byte
	for _, line := range lines {
		trimmed := bytes.TrimSpace(line)
		if len(trimmed) == 0 || bytes.HasPrefix(trimmed, []byte("#")) {
			continue
		}
		filtered = append(filtered, trimmed)
	}
	return bytes.Join(filtered, []byte("\n"))
}

// InjectRemoteShellIntegration writes the shell integration payload to stdin
// and returns a wrapped stdout that discards all output until the end-of-injection
// marker is seen, then resumes normal pass-through.
//
// The marker echo command is intentionally split into two variable-concatenation
// parts so that the full marker string does NOT appear as a contiguous literal
// in the echoed command text.  This guarantees the filter only ever sees the
// marker ONCE — in the actual shell output — regardless of whether PTY echo
// is enabled.
func InjectRemoteShellIntegration(stdin io.Writer, stdout io.Reader, shellIntegration string) io.Reader {
	payload := GetRemoteShellIntegrationPayload(shellIntegration)
	if payload == "" {
		return stdout
	}

	// Generate a unique marker that is extremely unlikely to appear in normal output.
	marker := fmt.Sprintf("__cozyssh_%x__", randomMarker())

	// Build an echo command whose TEXT does not contain the full marker.
	// e.g. marker = "__cozyssh_deadbeef12345678__"
	//      prefix = "__cozyssh_"   (constant, always 10 chars)
	//      suffix = "deadbeef12345678__"
	// Echoed command:  __csmk='__cozyssh_'; echo "${__csmk}deadbeef12345678__"
	// Echoed command does NOT contain "__cozyssh_deadbeef12345678__" as a substring.
	// Shell output:    __cozyssh_deadbeef12345678__   ← only occurrence the filter sees.
	const markerPrefix = "__cozyssh_"
	markerSuffix := marker[len(markerPrefix):]
	echoCmd := fmt.Sprintf(`__csmk='%s';echo "${__csmk}%s"`, markerPrefix, markerSuffix)

	// Wrap stdout BEFORE writing to stdin so no bytes are missed.
	filtered := newMarkerFilter(stdout, marker)

	_, _ = io.WriteString(stdin, payload+"; "+echoCmd+"\n")

	return filtered
}

// randomMarker returns a random 64-bit value for use in the injection marker.
func randomMarker() uint64 {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// Fallback to a time-based value if crypto/rand fails.
		return uint64(time.Now().UnixNano())
	}
	return binary.BigEndian.Uint64(b[:])
}

// markerFilter is an io.Reader wrapper that discards all bytes from the
// underlying reader until the marker string appears, then passes all
// subsequent bytes through unchanged.
//
// Because the echo command is split (see InjectRemoteShellIntegration), the
// full marker never appears in the PTY-echoed command text, so it is seen
// exactly once — as the stdout of the echo command.  The filter is therefore
// a straightforward single-scan with no multi-occurrence handling.
type markerFilter struct {
	r       io.Reader
	marker  []byte
	found   bool
	pending []byte
}

func newMarkerFilter(r io.Reader, marker string) *markerFilter {
	return &markerFilter{r: r, marker: []byte(marker)}
}

func (f *markerFilter) Read(p []byte) (int, error) {
	// Fast path: marker already found — pure pass-through.
	if f.found {
		if len(f.pending) > 0 {
			n := copy(p, f.pending)
			f.pending = f.pending[n:]
			return n, nil
		}
		return f.r.Read(p)
	}

	// Scan the stream until the marker appears.
	buf := make([]byte, len(p))
	for {
		n, err := f.r.Read(buf)
		if n > 0 {
			// Accumulate so a marker split across two Read calls is still found.
			f.pending = append(f.pending, buf[:n]...)

			if idx := bytes.Index(f.pending, f.marker); idx != -1 {
				f.found = true
				// Everything after the marker is real terminal output.
				after := f.pending[idx+len(f.marker):]
				// Strip the \r\n that the shell appended after the echo output.
				after = bytes.TrimLeft(after, "\r\n")
				f.pending = append([]byte(nil), after...)

				if len(f.pending) > 0 {
					nr := copy(p, f.pending)
					f.pending = f.pending[nr:]
					return nr, err
				}
				if err != nil {
					return 0, err
				}
				return f.r.Read(p)
			}

			// Not found yet.  Keep only the last (markerLen-1) bytes so a marker
			// that spans two consecutive Read calls is still detected.
			keep := len(f.marker) - 1
			if len(f.pending) > keep {
				f.pending = f.pending[len(f.pending)-keep:]
			}
		}
		if err != nil {
			// Stream ended before marker appeared — unblock the terminal.
			f.found = true
			return 0, err
		}
	}
}
