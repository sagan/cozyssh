package localpty

import (
	"testing"
)

func TestDetectShell(t *testing.T) {
	tests := []struct {
		name         string
		cmdline      string
		wantShell    string
		wantDetected bool
	}{
		// Linux/Unix Shells
		{
			name:         "Basic bash with flag",
			cmdline:      "bash -l",
			wantShell:    "bash",
			wantDetected: true,
		},
		{
			name:         "Absolute path UNIX shell",
			cmdline:      "/bin/zsh",
			wantShell:    "zsh",
			wantDetected: true,
		},

		// Windows Shells & Edge Cases
		{
			name:         "Windows powershell short name",
			cmdline:      "powershell -NoProfile -ExecutionPolicy Bypass",
			wantShell:    "powershell",
			wantDetected: true,
		},
		{
			name:         "Windows pwsh with .exe extension",
			cmdline:      "pwsh.exe -Command Write-Host 'Hello'",
			wantShell:    "pwsh",
			wantDetected: true,
		},
		{
			name:         "Windows cmd with mixed casing",
			cmdline:      "Cmd.Exe /c dir",
			wantShell:    "cmd",
			wantDetected: true,
		},
		{
			name:         "Windows absolute path with backslashes",
			cmdline:      `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
			wantShell:    "powershell",
			wantDetected: true,
		},

		// Wrappers calling Windows Shells
		{
			name:         "Docker exec starting PowerShell",
			cmdline:      "docker exec -it windows-container powershell.exe",
			wantShell:    "powershell",
			wantDetected: true,
		},
		{
			name:         "Kubectl exec starting cmd on Windows node",
			cmdline:      "kubectl exec -it pod-name -- cmd.exe",
			wantShell:    "cmd",
			wantDetected: true,
		},
		{
			name:         "Sudo executing modern pwsh",
			cmdline:      "sudo pwsh -c 'Get-Process'",
			wantShell:    "pwsh",
			wantDetected: true,
		},

		// False Positive Safeguards
		{
			name:         "False Positive: Windows path to a non-shell app containing a shell name",
			cmdline:      `C:\Program Files\PowerShell\NotAShell\app.exe`,
			wantShell:    "",
			wantDetected: false,
		},
		{
			name:         "False Positive: Container named powershell executing a script",
			cmdline:      "docker exec -it powershell python script.py",
			wantShell:    "",
			wantDetected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotShell, gotDetected := DetectShell(tt.cmdline)
			if gotDetected != tt.wantDetected {
				t.Errorf("DetectShell() gotDetected = %v, want %v for cmdline: %q", gotDetected, tt.wantDetected, tt.cmdline)
			}
			if gotShell != tt.wantShell {
				t.Errorf("DetectShell() gotShell = %v, want %v for cmdline: %q", gotShell, tt.wantShell, tt.cmdline)
			}
		})
	}
}
