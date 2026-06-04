package sshmanager

import (
	"cozyssh/common"
	"cozyssh/models"
	"fmt"
	"testing"
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
