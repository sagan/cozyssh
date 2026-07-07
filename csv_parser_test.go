package cozyssh

import (
	"strings"
	"testing"
)

func TestParseCSVToSSHConfig_Success(t *testing.T) {
	csvData := `Title,Hostname,Port,User,Pass,Comment,Tags,ProxyJump,IdentityFile
Server A,10.0.0.1,22,root,secret1,My comment,prod web,10.0.0.254,~/.ssh/id_rsa
Server B,10.0.0.2,,dbuser,,Another note,db;backup,,
,10.0.0.3,2222,admin,secret3,,,10.0.0.254,
`

	result, err := ParseCSVToSSHConfig(strings.NewReader(csvData))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify Server A
	if !strings.Contains(result, "Host Server A") {
		t.Error("missing 'Host Server A'")
	}
	if !strings.Contains(result, "HostName 10.0.0.1") {
		t.Error("missing 'HostName 10.0.0.1'")
	}
	if !strings.Contains(result, "User root") {
		t.Error("missing 'User root'")
	}
	if !strings.Contains(result, "Port 22") {
		t.Error("missing 'Port 22'")
	}
	if !strings.Contains(result, "### My comment") {
		t.Error("missing comment for Server A")
	}
	if !strings.Contains(result, "### #prod #web") {
		t.Error("missing tags comment for Server A")
	}
	if !strings.Contains(result, "ProxyJump 10.0.0.254") {
		t.Error("missing ProxyJump directive for Server A")
	}
	if !strings.Contains(result, "IdentityFile ~/.ssh/id_rsa") {
		t.Error("missing IdentityFile directive for Server A")
	}
	if !strings.Contains(result, "# CozySshPassword secret1") {
		t.Error("missing password comment for Server A")
	}

	// Verify Server B
	if !strings.Contains(result, "Host Server B") {
		t.Error("missing 'Host Server B'")
	}
	if !strings.Contains(result, "HostName 10.0.0.2") {
		t.Error("missing 'HostName 10.0.0.2'")
	}
	if !strings.Contains(result, "User dbuser") {
		t.Error("missing 'User dbuser'")
	}
	if strings.Contains(result, "Port ") && strings.Contains(result, "Host Server B\n    HostName 10.0.0.2\n    User dbuser\n    Port") {
		t.Error("expected no Port directive for Server B since it was empty")
	}
	if !strings.Contains(result, "### #db #backup") {
		t.Error("missing tags comment for Server B")
	}

	// Verify anonymous row defaults to hostname as Host alias
	if !strings.Contains(result, "Host 10.0.0.3") {
		t.Error("missing 'Host 10.0.0.3' fallback alias")
	}
}

func TestParseCSVToSSHConfig_AlternativeHeaders(t *testing.T) {
	csvData := `name,hostname/ip,username,password,note,tag
Server C,10.0.0.4,admin2,secret4,Note C,fav
`

	result, err := ParseCSVToSSHConfig(strings.NewReader(csvData))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(result, "Host Server C") {
		t.Error("missing 'Host Server C'")
	}
	if !strings.Contains(result, "HostName 10.0.0.4") {
		t.Error("missing 'HostName 10.0.0.4'")
	}
	if !strings.Contains(result, "User admin2") {
		t.Error("missing 'User admin2'")
	}
	if !strings.Contains(result, "# CozySshPassword secret4") {
		t.Error("missing password comment")
	}
	if !strings.Contains(result, "### Note C") {
		t.Error("missing comment Note C")
	}
	if !strings.Contains(result, "### #fav") {
		t.Error("missing tag #fav")
	}
}

func TestParseCSVToSSHConfig_MissingHostColumn(t *testing.T) {
	csvData := `Title,Port,User
Server A,22,root
`

	_, err := ParseCSVToSSHConfig(strings.NewReader(csvData))
	if err == nil {
		t.Error("expected error due to missing required hostname column")
	}
	if !strings.Contains(err.Error(), "missing required hostname column") {
		t.Errorf("expected error message to complain about hostname, got: %v", err)
	}
}

func TestParseCSVToSSHConfig_SkipEmptyHostnameRows(t *testing.T) {
	csvData := `Title,Hostname,Port
Server A,,22
Server B,10.0.0.2,22
`

	result, err := ParseCSVToSSHConfig(strings.NewReader(csvData))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if strings.Contains(result, "Host Server A") {
		t.Error("expected Server A to be skipped because hostname was empty")
	}
	if !strings.Contains(result, "Host Server B") {
		t.Error("expected Server B to be present")
	}
}
