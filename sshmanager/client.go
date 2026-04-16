package sshmanager

import (
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kevinburke/ssh_config"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type HostConfig struct {
	Alias        string   `json:"alias"`
	HostName     string   `json:"hostname"`
	User         string   `json:"user"`
	Port         string   `json:"port"`
	IdentityFile string   `json:"identity_file"`
	Tags         []string `json:"tags"`
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
	hostIdx := -1
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(trimmed), "host ") {
			fields := strings.Fields(trimmed)
			if len(fields) >= 2 && fields[1] == targetAlias {
				hostIdx = i
				break
			}
		}
	}
	if hostIdx == -1 {
		return -1, -1
	}

	start := hostIdx
	if start > 0 && strings.HasPrefix(strings.TrimSpace(lines[start-1]), "### ") {
		start = start - 1
	}

	end := hostIdx + 1
	for ; end < len(lines); end++ {
		trimmed := strings.TrimSpace(lines[end])
		if strings.HasPrefix(strings.ToLower(trimmed), "host ") || strings.HasPrefix(trimmed, "### ") {
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

	var block []string
	if len(h.Tags) > 0 {
		var tagStrs []string
		for _, t := range h.Tags {
			tagStrs = append(tagStrs, "#"+t)
		}
		block = append(block, fmt.Sprintf("### %s", strings.Join(tagStrs, " ")))
	}
	block = append(block, fmt.Sprintf("Host %s", h.Alias))
	block = append(block, fmt.Sprintf("    HostName %s", h.HostName))
	if h.User != "" {
		block = append(block, fmt.Sprintf("    User %s", h.User))
	}
	if h.Port != "" {
		block = append(block, fmt.Sprintf("    Port %s", h.Port))
	}
	if h.IdentityFile != "" {
		block = append(block, fmt.Sprintf("    IdentityFile %s", h.IdentityFile))
	}
	block = append(block, "")

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
	Name     string   `json:"name"`
	HostName string   `json:"hostname"`
	Port     string   `json:"port"`
	User     string   `json:"user"`
	Tags     []string `json:"tags"`
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

	lines, _ := readConfigLines()

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

			var tags []string
			start, _ := findHostBlock(lines, name)
			if start != -1 && strings.HasPrefix(strings.TrimSpace(lines[start]), "### ") {
				fields := strings.Fields(strings.TrimSpace(lines[start]))
				for _, f := range fields {
					if strings.HasPrefix(f, "#") && f != "###" {
						tags = append(tags, strings.TrimPrefix(f, "#"))
					}
				}
			}

			hosts = append(hosts, HostInfo{
				Name:     name,
				HostName: hostname,
				Port:     port,
				User:     user,
				Tags:     tags,
			})
			break // only one alias rep per block needed for sidebar
		}
	}
	return hosts, nil
}

type TerminalUI interface {
	Prompt(string) (string, error)
	Print(string)
}

// DialSSH resolves standard configs and connects via id_ed25519
func DialSSH(alias string, term TerminalUI) (*ssh.Client, *ssh.Session, error) {
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

	knownHostsFile := filepath.Join(home, ".ssh", "known_hosts")
	os.MkdirAll(filepath.Dir(knownHostsFile), 0700)
	if _, err := os.Stat(knownHostsFile); os.IsNotExist(err) {
		os.WriteFile(knownHostsFile, []byte(""), 0600)
	}

	khCallback, err := knownhosts.New(knownHostsFile)
	if err != nil {
		if term != nil {
			term.Print(fmt.Sprintf("\r\nknown_hosts error: %v\r\n", err))
		}
		return nil, nil, err
	}

	probeAddr := fmt.Sprintf("%s:%s", host, port)
	dummyKey, _, _, _, _ := ssh.ParseAuthorizedKey([]byte("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))
	dummyNetAddr := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 22}
	
	probeErr := khCallback(probeAddr, dummyNetAddr, dummyKey)
	var keyErr *knownhosts.KeyError
	var prioritizedAlgos []string
	
	if errors.As(probeErr, &keyErr) && len(keyErr.Want) > 0 {
		for _, w := range keyErr.Want {
			prioritizedAlgos = append(prioritizedAlgos, w.Key.Type())
		}
	}
	
	defaultAlgos := []string{
		ssh.KeyAlgoED25519,
		ssh.KeyAlgoECDSA256,
		ssh.KeyAlgoECDSA384,
		ssh.KeyAlgoECDSA521,
		"rsa-sha2-512",
		"rsa-sha2-256",
		ssh.KeyAlgoRSA,
		ssh.KeyAlgoDSA,
	}
	
	algoMap := make(map[string]bool)
	var hostKeyAlgorithms []string
	for _, a := range append(prioritizedAlgos, defaultAlgos...) {
		if !algoMap[a] {
			hostKeyAlgorithms = append(hostKeyAlgorithms, a)
			algoMap[a] = true
		}
	}

	hostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		var keyErr2 *knownhosts.KeyError
		err = khCallback(hostname, remote, key)
		if err == nil {
			return nil
		}

		if errors.As(err, &keyErr2) && len(keyErr2.Want) > 0 {
			// Mismatch
			msg := fmt.Sprintf("\r\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\nIT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!\r\nSomeone could be eavesdropping on you right now (man-in-the-middle attack)!\r\nIt is also possible that a host key has just been changed.\r\nThe fingerprint for the %s key sent by the remote host is\r\n%s.\r\nHost key verification failed.\r\n", key.Type(), ssh.FingerprintSHA256(key))
			if term != nil {
				term.Print(msg)
			} else {
				fmt.Print(msg)
			}
			return err
		} else if errors.As(err, &keyErr) && len(keyErr.Want) == 0 {
			// Unknown host
			fingerprint := ssh.FingerprintSHA256(key)
			prompt := fmt.Sprintf("\r\nThe authenticity of host '%s (%s)' can't be established.\r\n%s key fingerprint is %s.\r\nAre you sure you want to continue connecting (yes/no)? ", hostname, remote.String(), key.Type(), fingerprint)

			if term == nil {
				return fmt.Errorf("host key unknown, interactive prompt required but not available")
			}
			
			resp, e := term.Prompt(prompt)
			if e != nil {
				return e
			}
			resp = strings.ToLower(strings.TrimSpace(resp))
			if resp == "yes" || resp == "y" {
				f, e := os.OpenFile(knownHostsFile, os.O_APPEND|os.O_WRONLY, 0600)
				if e == nil {
					line := knownhosts.Line([]string{hostname, remote.String()}, key)
					f.WriteString(line + "\n")
					f.Close()
				}
				return nil
			}
			return fmt.Errorf("Host key verification failed.")
		}

		return err
	}

	sshConfig := &ssh.ClientConfig{
		User: user,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
			ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				if len(questions) == 0 {
					return nil, nil
				}
				if term == nil {
					return nil, fmt.Errorf("interactive prompt required")
				}
				var answers []string
				for _, q := range questions {
					ans, err := term.Prompt(q)
					if err != nil {
						return nil, err
					}
					answers = append(answers, strings.TrimSpace(ans))
				}
				return answers, nil
			}),
		},
		HostKeyAlgorithms: hostKeyAlgorithms,
		HostKeyCallback:   hostKeyCallback,
	}

	addr := fmt.Sprintf("%s:%s", host, port)
	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		if term != nil {
			term.Print(fmt.Sprintf("\r\nSSH Authentication failed: %v\r\n", err))
		}
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

	go startKeepAlive(client)

	return client, session, nil
}

func startKeepAlive(client *ssh.Client) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	failedCount := 0
	for range ticker.C {
		_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
		if err != nil {
			failedCount++
			if failedCount >= 3 {
				log.Printf("SSH keep-alive failed %d times for %s, closing connection", failedCount, client.RemoteAddr())
				client.Close()
				return
			}
		} else {
			failedCount = 0
		}
	}
}
