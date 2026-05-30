package sshmanager

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kevinburke/ssh_config"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"cozyssh/common"
	"cozyssh/config"
	"cozyssh/models"
)

var globalConfig *config.Config

func SetConfig(cfg *config.Config) {
	globalConfig = cfg
}

func getSSHDir() string {
	if globalConfig != nil && globalConfig.SSHDir != "" {
		return globalConfig.SSHDir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".ssh")
}

type PooledClient struct {
	Client        *ssh.Client
	Closers       []io.Closer
	RemoteCommand string
	Mu            sync.Mutex
	Refs          int
}

func (p *PooledClient) AddRef() {
	p.Mu.Lock()
	p.Refs++
	p.Mu.Unlock()
}

func (p *PooledClient) Release() {
	p.Mu.Lock()
	p.Refs--
	if p.Refs <= 0 {
		p.Client.Close()
		for _, c := range p.Closers {
			c.Close()
		}
	}
	p.Mu.Unlock()
}

func getSSHConfigPath() string {
	return filepath.Join(getSSHDir(), "config")
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
	for start > 0 && strings.HasPrefix(strings.TrimSpace(lines[start-1]), "### ") {
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
func SaveHost(oldAlias string, h models.HostData) error {
	lines, err := readConfigLines()
	if err != nil {
		return err
	}

	var block []string
	if h.Comment != "" {
		for _, line := range strings.Split(h.Comment, "\n") {
			block = append(block, fmt.Sprintf("### %s", strings.TrimSpace(line)))
		}
	}
	if len(h.Tags) > 0 {
		var tagStrs []string
		for _, t := range h.Tags {
			tagStrs = append(tagStrs, "#"+t)
		}
		block = append(block, fmt.Sprintf("### %s", strings.Join(tagStrs, " ")))
	}
	block = append(block, fmt.Sprintf("Host %s", h.Name))
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
	if h.ProxyJump != "" {
		block = append(block, fmt.Sprintf("    ProxyJump %s", h.ProxyJump))
	}
	if h.RemoteCommand != "" {
		block = append(block, fmt.Sprintf("    RemoteCommand %s", h.RemoteCommand))
	}
	block = append(block, "")

	if oldAlias != "" && oldAlias != h.Name {
		if start, end := findHostBlock(lines, oldAlias); start != -1 {
			lines = append(lines[:start], lines[end:]...)
		}
	}

	start, end := findHostBlock(lines, h.Name)
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

func DeleteHost(name string) error {
	lines, err := readConfigLines()
	if err != nil {
		return err
	}
	start, end := findHostBlock(lines, name)
	if start != -1 {
		lines = append(lines[:start], lines[end:]...)
		return writeConfigLines(lines)
	}
	return nil
}

// ListHosts reads the standard ~/.ssh/config and ~/.ssh/known_hosts
// and returns a list of configured and auto-discovered servers
func ListHosts() ([]*models.HostData, error) {
	configPath := filepath.Join(getSSHDir(), "config")
	f, err := os.Open(configPath)
	var cfg *ssh_config.Config
	if err == nil {
		cfg, _ = ssh_config.Decode(f)
		f.Close()
	}

	lines, _ := readConfigLines()

	var hosts []*models.HostData
	seenHosts := make(map[string]bool)

	if cfg != nil {
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
				proxyJump, _ := cfg.Get(name, "ProxyJump")
				remoteCommand, _ := cfg.Get(name, "RemoteCommand")

				var tags []string
				var commentParts []string
				start, end := findHostBlock(lines, name)
				if start != -1 {
					for i := start; i < end; i++ {
						line := strings.TrimSpace(lines[i])
						if strings.HasPrefix(line, "### ") {
							content := strings.TrimPrefix(line, "### ")
							fields := strings.Fields(content)
							isTagLine := true
							if len(fields) == 0 {
								isTagLine = false
							}
							for _, f := range fields {
								if !strings.HasPrefix(f, "#") {
									isTagLine = false
									break
								}
							}

							if isTagLine {
								for _, f := range fields {
									tags = append(tags, strings.TrimPrefix(f, "#"))
								}
							} else {
								commentParts = append(commentParts, content)
							}
						}
					}
				}
				comment := strings.Join(commentParts, " ")

				isFav := false
				for _, t := range tags {
					if t == "fav" {
						isFav = true
						break
					}
				}

				hosts = append(hosts, &models.HostData{
					Name:          name,
					HostName:      hostname,
					Port:          port,
					User:          user,
					ProxyJump:     proxyJump,
					RemoteCommand: remoteCommand,
					Tags:          tags,
					Comment:       comment,
					Source:        "config",
					IsAuto:        false,
					IsFavourite:   isFav,
				})
				seenHosts[name] = true
				break // only one name rep per block needed for sidebar
			}
		}
	}

	// Add auto-discovered hosts from known_hosts
	autoHosts, _ := ListKnownHosts()
	for _, ah := range autoHosts {
		if !seenHosts[ah.Name] && !seenHosts[ah.HostName] {
			hosts = append(hosts, ah)
		}
	}

	return hosts, nil
}

// ListKnownHosts reads ~/.ssh/known_hosts and returns plain-name entries
func ListKnownHosts() ([]*models.HostData, error) {
	knownHostsPath := filepath.Join(getSSHDir(), "known_hosts")
	data, err := os.ReadFile(knownHostsPath)
	if err != nil {
		return nil, err
	}

	var hosts []*models.HostData
	lines := strings.SplitSeq(string(data), "\n")
	for line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "|") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		hostPart := fields[0]
		// Handle comma separated hosts/IPs
		parts := strings.SplitSeq(hostPart, ",")
		for p := range parts {
			p = strings.TrimSpace(p)
			if p == "" || strings.Contains(p, "*") || strings.Contains(p, "?") {
				continue
			}

			// Basic heuristic: if it contains ":" it might be [host]:port
			hostname := p
			port := "22"
			if strings.HasPrefix(p, "[") && strings.Contains(p, "]:") {
				idx := strings.LastIndex(p, "]:")
				hostname = p[1:idx]
				port = p[idx+2:]
			}

			// We only want the first plain name we find or handle all?
			// Usually users want to see "root@server"
			// The requirement says "display 'root@server' style title"
			hosts = append(hosts, &models.HostData{
				Name:     "root@" + hostname, // Title style
				HostName: hostname,
				Port:     port,
				User:     "root",
				Source:   "known_hosts",
				IsAuto:   true,
			})
			break // Just take the first name for simplicity, or should it be unique?
		}
	}

	// Deduplicate
	unique := make(map[string]*models.HostData)
	for _, h := range hosts {
		unique[h.HostName] = h
	}

	var res []*models.HostData
	for _, h := range unique {
		res = append(res, h)
	}

	return res, nil
}

type TerminalUI interface {
	Prompt(string) (string, error)
	PromptMasked(string) (string, error)
	Print(string)
}

// DialSSH resolves standard configs and connects via id_ed25519
// It always returns a new independent connection.
func DialSSH(name string, term TerminalUI, rows, cols int, identity string, noPublicKey bool) (
	*PooledClient, *ssh.Session, string, error) {
	client, closers, remoteCommand, err := getSSHClient(name, term, identity, noPublicKey)
	if err != nil {
		return nil, nil, "", err
	}

	pClient := &PooledClient{Client: client, Refs: 1, Closers: closers, RemoteCommand: remoteCommand}

	session, err := client.NewSession()
	if err != nil {
		pClient.Release()
		return nil, nil, "", err
	}

	if err := setupSession(session, rows, cols); err != nil {
		session.Close()
		pClient.Release()
		return nil, nil, "", err
	}

	go startKeepAlive(client)

	return pClient, session, remoteCommand, nil
}

// name: server name, or [username[:password]@]hostname[:port].
// identity: directly set the content of the identity file.
// noPublicKey: skip default public key authentication.
func getSSHClient(name string, term TerminalUI, identity string,
	noPublicKey bool) (*ssh.Client, []io.Closer, string, error) {
	configPath := filepath.Join(getSSHDir(), "config")
	f, err := os.Open(configPath)
	var cfg *ssh_config.Config
	if err == nil {
		cfg, _ = ssh_config.Decode(f)
		f.Close()
	}

	host := name
	port := "22"
	user := common.User
	var password string

	// Handle user:pass@host:port or user@host:port format
	// password may contain special chars, host may contains ":" (ipv6), so we must be careful
	if i := strings.LastIndex(name, "@"); i != -1 {
		userPart := name[:i]
		hostPart := name[i+1:]

		if before, after, found := strings.Cut(userPart, ":"); found {
			user = before
			password = after
		} else {
			user = userPart
		}

		if i := strings.LastIndex(hostPart, ":"); i != -1 {
			host = hostPart[:i]
			port = hostPart[i+1:]
		} else {
			host = hostPart
		}
	} else if i := strings.LastIndex(name, ":"); i != -1 {
		// handle host:port format
		host = name[:i]
		port = name[i+1:]
	}

	if cfg != nil {
		if h, _ := cfg.Get(name, "HostName"); h != "" {
			host = h
		}
		if p, _ := cfg.Get(name, "Port"); p != "" {
			port = p
		}
		if u, _ := cfg.Get(name, "User"); u != "" {
			user = u
		}
	}

	proxyJumpAlias := ""
	identityFile := ""
	remoteCommand := ""
	if cfg != nil {
		identityFile, _ = cfg.Get(name, "IdentityFile")
		proxyJumpAlias, _ = cfg.Get(name, "ProxyJump")
		remoteCommand, _ = cfg.Get(name, "RemoteCommand")
	}

	if noPublicKey {
		identityFile = ""
	} else if identityFile == "" {
		identityFile = filepath.Join(getSSHDir(), "id_ed25519")
		if _, err := os.Stat(identityFile); os.IsNotExist(err) {
			identityFile = filepath.Join(getSSHDir(), "id_rsa")
		}
	} else {
		if len(identityFile) > 2 && identityFile[:2] == "~/" {
			home, _ := os.UserHomeDir()
			identityFile = filepath.Join(home, identityFile[2:])
		}
	}

	var authMethods []ssh.AuthMethod
	if password != "" {
		authMethods = append(authMethods, ssh.Password(password))
	}

	if identity != "" {
		signer, err := ssh.ParsePrivateKey([]byte(identity))
		if err == nil {
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}
	} else if identityFile != "" {
		keyData, err := os.ReadFile(identityFile)
		if err == nil {
			signer, err := ssh.ParsePrivateKey(keyData)
			if err == nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
	}

	authMethods = append(authMethods, ssh.KeyboardInteractive(func(user,
		instruction string, questions []string, echos []bool) ([]string, error) {
		if len(questions) == 0 {
			return nil, nil
		}
		if term == nil {
			return nil, fmt.Errorf("interactive prompt required")
		}
		var answers []string
		for i, q := range questions {
			var ans string
			var err error
			if i < len(echos) && !echos[i] {
				ans, err = term.PromptMasked(q)
			} else {
				ans, err = term.Prompt(q)
			}
			if err != nil {
				return nil, err
			}
			answers = append(answers, ans)
		}
		return answers, nil
	}))

	knownHostsFile := filepath.Join(getSSHDir(), "known_hosts")
	os.MkdirAll(filepath.Dir(knownHostsFile), 0700)
	if _, err := os.Stat(knownHostsFile); os.IsNotExist(err) {
		os.WriteFile(knownHostsFile, []byte(""), 0600)
	}

	khCallback, err := knownhosts.New(knownHostsFile)
	if err != nil {
		if term != nil {
			term.Print(fmt.Sprintf("\r\nknown_hosts error: %v\r\n", err))
		}
		return nil, nil, "", err
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
		ssh.KeyAlgoRSASHA256,
		ssh.KeyAlgoRSASHA512,
		ssh.KeyAlgoRSA,
		ssh.KeyAlgoECDSA256,
		ssh.KeyAlgoECDSA384,
		ssh.KeyAlgoECDSA521,
		// ssh.KeyAlgoDSA,
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
		if globalConfig != nil && globalConfig.InsecureIgnoreHostKey {
			return nil
		}
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
		User:              user,
		Auth:              authMethods,
		HostKeyAlgorithms: hostKeyAlgorithms,
		HostKeyCallback:   hostKeyCallback,
		Timeout:           10 * time.Second,
	}

	addr := fmt.Sprintf("%s:%s", host, port)
	var client *ssh.Client
	var closers []io.Closer

	dialFunc := func(config *ssh.ClientConfig) (*ssh.Client, error) {
		if proxyJumpAlias != "" {
			proxyClient, proxyClosers, _, err := getSSHClient(proxyJumpAlias, term, "", false)
			if err != nil {
				return nil, fmt.Errorf("failed to connect to ProxyJump %s: %w", proxyJumpAlias, err)
			}
			closers = append(closers, proxyClosers...)
			closers = append(closers, proxyClient)

			jumpConn, err := proxyClient.Dial("tcp", addr)
			if err != nil {
				return nil, err
			}

			c, chans, reqs, err := ssh.NewClientConn(jumpConn, addr, config)
			if err != nil {
				return nil, err
			}
			return ssh.NewClient(c, chans, reqs), nil
		}
		return ssh.Dial("tcp", addr, config)
	}

	client, err = dialFunc(sshConfig)
	if err != nil && strings.Contains(err.Error(), "no supported methods remain") && term != nil {
		// Try password fallback
		pass, perr := term.PromptMasked(fmt.Sprintf("%s@%s's password: ", user, host))
		if perr == nil {
			sshConfig.Auth = append(sshConfig.Auth, ssh.Password(pass))
			client, err = dialFunc(sshConfig)
		}
	}

	if err != nil {
		if term != nil {
			term.Print(fmt.Sprintf("\r\nSSH Authentication failed: %v\r\n", err))
		}
		// Close any partial closers we accumulated
		for _, c := range closers {
			c.Close()
		}
		return nil, nil, "", err
	}

	return client, closers, remoteCommand, nil
}

// CloneSSH creates a new terminal session from an existing PooledClient.
func CloneSSH(pClient *PooledClient, rows, cols int) (*ssh.Session, string, error) {
	pClient.AddRef()
	session, err := pClient.Client.NewSession()
	if err != nil {
		pClient.Release()
		return nil, "", err
	}
	if err := setupSession(session, rows, cols); err != nil {
		session.Close()
		pClient.Release()
		return nil, "", err
	}
	return session, pClient.RemoteCommand, nil
}

func setupSession(session *ssh.Session, rows, cols int) error {
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if rows <= 0 {
		rows = 24
	}
	if cols <= 0 {
		cols = 80
	}

	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		return fmt.Errorf("request for pseudo terminal failed: %s", err)
	}
	return nil
}

func ExpandTokens(cmd, host, port, user, name, sessionID string) string {
	r := strings.NewReplacer(
		"%%", "%",
		"%h", host,
		"%p", port,
		"%r", user,
		"%n", name,
		"%i", sessionID,
		"%I", sessionID,
	)

	// %u is local user
	if common.User != "" {
		cmd = strings.ReplaceAll(cmd, "%u", common.User)
	}

	return r.Replace(cmd)
}

func startKeepAlive(client *ssh.Client) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
		if err != nil {
			// If keep-alive fails once, we assume it's dead or dying.
			// The sessions will eventually get read errors and call Release.
			client.Close()
			return
		}
	}
}
