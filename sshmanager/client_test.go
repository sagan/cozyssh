package sshmanager

import (
	"cozyssh/common"
	"cozyssh/config"
	"cozyssh/models"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func TestExpandTokens(t *testing.T) {
	tests := []struct {
		name      string
		cmd       string
		host      string
		port      string
		user      string
		hostName  string
		sessionID string
		want      string
	}{
		{
			name:      "Standard tokens replacement",
			cmd:       "echo %h:%p:%r:%n",
			host:      "example.com",
			port:      "2222",
			user:      "alice",
			hostName:  "my-alias",
			sessionID: "p-12345",
			want:      "echo example.com:2222:alice:my-alias",
		},
		{
			name:      "CozySSH session tokens replacement %i and %I",
			cmd:       "tmux attach -t cozy_%i || tmux new -s cozy_%I",
			host:      "example.com",
			port:      "22",
			user:      "root",
			hostName:  "example.com",
			sessionID: "p-abcde12345",
			want:      "tmux attach -t cozy_p-abcde12345 || tmux new -s cozy_p-abcde12345",
		},
		{
			name:      "Escaped percent signs",
			cmd:       "echo %%h %%i",
			host:      "example.com",
			port:      "22",
			user:      "root",
			hostName:  "example.com",
			sessionID: "p-123",
			want:      "echo %h %i",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExpandTokens(tt.cmd, tt.host, tt.port, tt.user, tt.hostName, tt.sessionID)
			if got != tt.want {
				t.Errorf("ExpandTokens() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCopyIDHelpers(t *testing.T) {
	// 1. Test isAuthError
	if !isAuthError(fmt.Errorf("ssh: unable to authenticate")) {
		t.Error("expected true for unable to authenticate")
	}
	if !isAuthError(fmt.Errorf("handshake failed: ...")) {
		t.Error("expected true for handshake failed")
	}
	if isAuthError(fmt.Errorf("connection refused")) {
		t.Error("expected false for connection refused")
	}

	// 2. Test GetIdentityPathForHost
	h := &models.HostData{
		IdentityFile: "~/custom_id",
	}
	expected := common.ExpandPath("~/custom_id")
	got := GetIdentityPathForHost(h)
	if got != expected {
		t.Errorf("GetIdentityPathForHost() = %q, want %q", got, expected)
	}
}

func TestParseGroups(t *testing.T) {
	lines := []string{
		"### #g-group1 #g-group2",
		"",
		"Host server1",
		"    HostName server1.com",
		"### #fav #g-group2 #g-group3",
		"Host server2",
		"    HostName server2.com",
		"### This is a comment about #g-ignored group but should still parse because it starts with ###",
		"### #g-group1",
	}

	got := ParseGroups(lines)
	want := []string{"group1", "group2", "group3", "ignored"}

	if len(got) != len(want) {
		t.Fatalf("ParseGroups() returned %d elements, want %d: %v", len(got), len(want), got)
	}

	for i, v := range got {
		if v != want[i] {
			t.Errorf("ParseGroups()[%d] = %q, want %q", i, v, want[i])
		}
	}
}

func TestCopySSHID_HostKeyMismatchReplacement(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cozyssh-test-sshdir-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Save original config and set mock
	origConfig := globalConfig
	defer func() {
		globalConfig = origConfig
	}()
	globalConfig = &config.Config{
		SSHDir: tempDir,
	}

	// Generate key1 and key2
	key1Str := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJK38f61K+823j4u87l14G2sN2j3v4t5r6e7d8c9b0a1"
	key2Str := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJK38f61K+823j4u87l14G2sN2j3v4t5r6e7d8c9b0a2"

	key1, _, _, _, err := ssh.ParseAuthorizedKey([]byte(key1Str))
	if err != nil {
		t.Fatalf("failed to parse key1: %v", err)
	}
	key2, _, _, _, err := ssh.ParseAuthorizedKey([]byte(key2Str))
	if err != nil {
		t.Fatalf("failed to parse key2: %v", err)
	}

	// Write known_hosts with key1
	knownHostsPath := filepath.Join(tempDir, "known_hosts")
	hostPattern := "192.168.50.1:22"
	initialLine := knownhosts.Line([]string{hostPattern}, key1)
	err = os.WriteFile(knownHostsPath, []byte(initialLine+"\n"), 0600)
	if err != nil {
		t.Fatalf("failed to write initial known_hosts: %v", err)
	}

	// Calculate fingerprints
	fingerprint2 := ssh.FingerprintSHA256(key2)

	// 1. First test: expectedFingerprint is empty. It should return host key verification mismatch error.
	var hkResult HostKeyResult
	cb, _, err := createCopyIDHostKeyCallback("test-server", "192.168.50.1", "22", "", &hkResult)
	if err != nil {
		t.Fatalf("createCopyIDHostKeyCallback failed: %v", err)
	}

	remoteAddr := &net.TCPAddr{IP: net.ParseIP("192.168.50.1"), Port: 22}
	errCheck := cb(hostPattern, remoteAddr, key2)
	if errCheck == nil {
		t.Fatalf("expected mismatch error, got nil")
	}

	var verifyErr *HostKeyVerificationError
	if !errors.As(errCheck, &verifyErr) || !strings.HasPrefix(verifyErr.Reason, "mismatch:") {
		t.Fatalf("expected HostKeyVerificationError with mismatch reason, got: %v", errCheck)
	}

	// 2. Second test: expectedFingerprint matches key2's fingerprint.
	// It should replace key1 with key2, and return nil.
	var hkResult2 HostKeyResult
	cb2, _, err := createCopyIDHostKeyCallback("test-server", "192.168.50.1", "22", fingerprint2, &hkResult2)
	if err != nil {
		t.Fatalf("createCopyIDHostKeyCallback failed: %v", err)
	}

	errCheck2 := cb2(hostPattern, remoteAddr, key2)
	if errCheck2 != nil {
		t.Fatalf("expected nil when expectedFingerprint matches, got: %v", errCheck2)
	}

	// Read known_hosts and verify it contains key2 line, and not key1 line
	content, err := os.ReadFile(knownHostsPath)
	if err != nil {
		t.Fatalf("failed to read known_hosts: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(content)), "\n")
	if len(lines) != 1 {
		t.Errorf("expected 1 line in known_hosts, got %d: %v", len(lines), lines)
	}

	expectedLine := knownhosts.Line([]string{hostPattern, remoteAddr.String()}, key2)
	if strings.TrimSpace(lines[0]) != strings.TrimSpace(expectedLine) {
		t.Errorf("expected known_hosts line to be:\n%s\ngot:\n%s", expectedLine, lines[0])
	}
}

func TestSendEnvOption(t *testing.T) {
	// Test matching function
	tests := []struct {
		name     string
		patterns string
		want     bool
	}{
		{"LANG", "LANG LC_* COLORTERM NO_COLOR", true},
		{"LC_ALL", "LANG LC_* COLORTERM NO_COLOR", true},
		{"LC_CTYPE", "LANG LC_* COLORTERM NO_COLOR", true},
		{"COLORTERM", "LANG LC_* COLORTERM NO_COLOR", true},
		{"NO_COLOR", "LANG LC_* COLORTERM NO_COLOR", true},
		{"PATH", "LANG LC_* COLORTERM NO_COLOR", false},
		{"USER", "LANG LC_* COLORTERM NO_COLOR", false},
	}

	for _, tt := range tests {
		got := matchEnvPatterns(tt.name, tt.patterns)
		if got != tt.want {
			t.Errorf("matchEnvPatterns(%q, %q) = %v, want %v", tt.name, tt.patterns, got, tt.want)
		}
	}
}
