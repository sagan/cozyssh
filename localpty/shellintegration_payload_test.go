package localpty

import (
	"strings"
	"testing"
)

func TestSplitBase64Lines_MaxLineLen(t *testing.T) {
	input := strings.Repeat("A", 500)
	result := splitBase64LinesChunked(input, 76)
	for i, line := range strings.Split(result, "\n") {
		if len(line) > 76 {
			t.Errorf("line %d has length %d (>76): %q", i, len(line), line)
		}
	}
}

func TestStripScriptComments(t *testing.T) {
	input := []byte("# Comment line 1\n  # Indented comment line 2\n\n\texport FOO=1 # inline comment\n\n   echo hello\n")
	got := string(stripScriptComments(input))
	expected := "export FOO=1 # inline comment\necho hello"
	if got != expected {
		t.Errorf("stripScriptComments failed:\ngot:\n%q\nexpected:\n%q", got, expected)
	}
}

func TestPayload_UsesHeredoc(t *testing.T) {
	payload := GetRemoteShellIntegrationPayload("", false)
	if payload == "" {
		t.Skip("no embedded scripts available")
	}
	if !strings.Contains(payload, "<<'__COZYSSH_BASH__'") {
		t.Error("payload should use heredoc for bash script")
	}
	if !strings.Contains(payload, "<<'__COZYSSH_ZSH__'") {
		t.Error("payload should use heredoc for zsh script")
	}
	if strings.Contains(payload, "printf '%s'") {
		t.Error("payload must not use printf with huge base64 argument")
	}
	if !strings.Contains(payload, "} >/dev/null 2>&1") && !strings.Contains(payload, "} 2>/dev/null") {
		t.Error("payload should wrap eval in block with stderr redirected")
	}
	for i, line := range strings.Split(payload, "\n") {
		if len(line) > 200 {
			t.Errorf("line %d is suspiciously long (%d chars)", i, len(line))
		}
	}
}
