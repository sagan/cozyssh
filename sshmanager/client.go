package sshmanager

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kevinburke/ssh_config"
	"golang.org/x/crypto/ssh"
)

type HostConfig struct {
	Alias        string `json:"alias"`
	HostName     string `json:"hostname"`
	User         string `json:"user"`
	Port         string `json:"port"`
	IdentityFile string `json:"identity_file"`
}

func getSSHConfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".ssh", "config")
}

func readConfigLines() ([]string, error) {
	path := getSSHConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	return strings.Split(string(data), "\n"), nil
}

func writeConfigLines(lines []string) error {
	path := getSSHConfigPath()
	os.MkdirAll(filepath.Dir(path), 0700)
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0600)
}

func findHostBlock(lines []string, targetAlias string) (int, int) {
	start := -1
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(trimmed), "host ") {
			fields := strings.Fields(trimmed)
			if len(fields) >= 2 && fields[1] == targetAlias {
				start = i
				break
			}
		}
	}
	if start == -1 {
		return -1, -1
	}
	end := start + 1
	for ; end < len(lines); end++ {
		trimmed := strings.TrimSpace(lines[end])
		if strings.HasPrefix(strings.ToLower(trimmed), "host ") {
			break
		}
	}
	return start, end
}

// SaveHost replaces an old host block or adds a new one gracefully without destroying file comments
func SaveHost(oldAlias string, h HostConfig) error {
	lines, err := readConfigLines()
	if err != nil {
		return err
	}

	block := []string{
		fmt.Sprintf("Host %s", h.Alias),
		fmt.Sprintf("    HostName %s", h.HostName),
	}
	if h.User != "" {
		block = append(block, fmt.Sprintf("    User %s", h.User))
	}
	if h.Port != "" {
		block = append(block, fmt.Sprintf("    Port %s", h.Port))
	}
	if h.IdentityFile != "" {
		block = append(block, fmt.Sprintf("    IdentityFile %s", h.IdentityFile))
	}

	if oldAlias != "" && oldAlias != h.Alias {
		if start, end := findHostBlock(lines, oldAlias); start != -1 {
			lines = append(lines[:start], lines[end:]...)
		}
	}

	start, end := findHostBlock(lines, h.Alias)
	if start != -1 {
		lines = append(lines[:start], append(block, lines[end:]...)...)
	} else {
		if len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) != "" {
			lines = append(lines, "")
		}
		lines = append(lines, block...)
	}

	return writeConfigLines(lines)
}

func DeleteHost(alias string) error {
	lines, err := readConfigLines()
	if err != nil {
		return err
	}
	start, end := findHostBlock(lines, alias)
	if start != -1 {
		lines = append(lines[:start], lines[end:]...)
		return writeConfigLines(lines)
	}
	return nil
}

type HostInfo struct {
	Name     string `json:"name"`
	HostName string `json:"hostname"`
	Port     string `json:"port"`
	User     string `json:"user"`
}

// ListHosts reads the standard ~/.ssh/config and returns a list of configured aliases
func ListHosts() ([]HostInfo, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	configPath := filepath.Join(home, ".ssh", "config")
	f, err := os.Open(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []HostInfo{}, nil
		}
		return nil, err
	}
	defer f.Close()

	cfg, err := ssh_config.Decode(f)
	if err != nil {
		return nil, err
	}

	var hosts []HostInfo
	for _, host := range cfg.Hosts {
		for _, pattern := range host.Patterns {
			name := pattern.String()
			if name == "*" || name == "" {
				continue
			}

			hostname, _ := cfg.Get(name, "HostName")
			if hostname == "" {
				hostname = name
			}
			port, _ := cfg.Get(name, "Port")
			if port == "" {
				port = "22"
			}
			user, _ := cfg.Get(name, "User")

			hosts = append(hosts, HostInfo{
				Name:     name,
				HostName: hostname,
				Port:     port,
				User:     user,
			})
			break // only one alias rep per block needed for sidebar
		}
	}
	return hosts, nil
}

// DialSSH resolves standard configs and connects via id_ed25519
func DialSSH(alias string) (*ssh.Client, *ssh.Session, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, nil, err
	}

	configPath := filepath.Join(home, ".ssh", "config")
	f, err := os.Open(configPath)
	var cfg *ssh_config.Config
	if err == nil {
		cfg, _ = ssh_config.Decode(f)
		f.Close()
	}

	host := alias
	port := "22"
	user := os.Getenv("USER")
	if user == "" {
		user = "root"
	}

	if cfg != nil {
		if h, _ := cfg.Get(alias, "HostName"); h != "" {
			host = h
		}
		if p, _ := cfg.Get(alias, "Port"); p != "" {
			port = p
		}
		if u, _ := cfg.Get(alias, "User"); u != "" {
			user = u
		}
	}

	identityFile := ""
	if cfg != nil {
		identityFile, _ = cfg.Get(alias, "IdentityFile")
	}

	if identityFile == "" || identityFile == "~/.ssh/identity" {
		identityFile = filepath.Join(home, ".ssh", "id_ed25519")
		if _, err := os.Stat(identityFile); os.IsNotExist(err) {
			identityFile = filepath.Join(home, ".ssh", "id_rsa")
		}
	} else {
		if len(identityFile) > 2 && identityFile[:2] == "~/" {
			identityFile = filepath.Join(home, identityFile[2:])
		}
	}

	keyDir, err := os.ReadFile(identityFile)
	if err != nil {
		return nil, nil, fmt.Errorf("unable to read private key %s: %w", identityFile, err)
	}

	signer, err := ssh.ParsePrivateKey(keyDir)
	if err != nil {
		return nil, nil, fmt.Errorf("unable to parse private key: %w", err)
	}

	sshConfig := &ssh.ClientConfig{
		User: user,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	addr := fmt.Sprintf("%s:%s", host, port)
	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		return nil, nil, err
	}

	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, nil, err
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		session.Close()
		client.Close()
		return nil, nil, fmt.Errorf("request for pseudo terminal failed: %s", err)
	}

	return client, session, nil
}
