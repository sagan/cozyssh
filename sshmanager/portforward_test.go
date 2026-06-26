package sshmanager

import (
	"reflect"
	"testing"
)

func TestParseForwardRule(t *testing.T) {
	tests := []struct {
		name    string
		rule    string
		want    *PortForwardRule
		wantErr bool
	}{
		{
			name: "standard port host:hostport",
			rule: "8080 localhost:80",
			want: &PortForwardRule{
				BindAddress: "localhost",
				BindPort:    "8080",
				Host:        "localhost",
				HostPort:    "80",
			},
			wantErr: false,
		},
		{
			name: "bind address specified",
			rule: "127.0.0.1:8080 localhost:80",
			want: &PortForwardRule{
				BindAddress: "127.0.0.1",
				BindPort:    "8080",
				Host:        "localhost",
				HostPort:    "80",
			},
			wantErr: false,
		},
		{
			name: "wildcard bind address",
			rule: "*:8080 google.com:443",
			want: &PortForwardRule{
				BindAddress: "0.0.0.0",
				BindPort:    "8080",
				Host:        "google.com",
				HostPort:    "443",
			},
			wantErr: false,
		},
		{
			name: "empty bind address (colon prefix)",
			rule: ":8080 localhost:80",
			want: &PortForwardRule{
				BindAddress: "localhost",
				BindPort:    "8080",
				Host:        "localhost",
				HostPort:    "80",
			},
			wantErr: false,
		},
		{
			name:    "invalid format",
			rule:    "8080",
			want:    nil,
			wantErr: true,
		},
		{
			name:    "invalid remote",
			rule:    "8080 localhost",
			want:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseForwardRule(tt.rule)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseForwardRule() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ParseForwardRule() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestParseDynamicForwardRule(t *testing.T) {
	tests := []struct {
		name    string
		rule    string
		want    *DynamicForwardRule
		wantErr bool
	}{
		{
			name: "port only",
			rule: "1080",
			want: &DynamicForwardRule{
				BindAddress: "localhost",
				BindPort:    "1080",
			},
			wantErr: false,
		},
		{
			name: "bind address:port",
			rule: "127.0.0.1:1080",
			want: &DynamicForwardRule{
				BindAddress: "127.0.0.1",
				BindPort:    "1080",
			},
			wantErr: false,
		},
		{
			name: "wildcard bind address",
			rule: "*:1080",
			want: &DynamicForwardRule{
				BindAddress: "0.0.0.0",
				BindPort:    "1080",
			},
			wantErr: false,
		},
		{
			name: "empty bind address (colon prefix)",
			rule: ":1080",
			want: &DynamicForwardRule{
				BindAddress: "localhost",
				BindPort:    "1080",
			},
			wantErr: false,
		},
		{
			name:    "empty rule",
			rule:    "",
			want:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseDynamicForwardRule(tt.rule)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseDynamicForwardRule() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ParseDynamicForwardRule() = %v, want %v", got, tt.want)
			}
		})
	}
}
