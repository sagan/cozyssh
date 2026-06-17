package sshmanager

import (
	"bytes"
	"crypto/sha256"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/kevinburke/ssh_config"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"cozyssh/common"
	"cozyssh/config"
	"cozyssh/constants"
	"cozyssh/models"
	"cozyssh/passstore"
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
	return strings.Split(strings.TrimSpace(string(data)), "\n"), nil
}

func writeConfigLines(lines []string) error {
	path := getSSHConfigPath()
	os.MkdirAll(filepath.Dir(path), 0700)
	return common.AtomicWriteFile(path, func(writer io.Writer) error {
		for _, line := range lines {
			writer.Write([]byte(line))
			writer.Write([]byte{0x0a}) // \n
		}
		writer.Write([]byte{0x0a})
		return nil
	})
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

func getCanonicalAddr(h models.HostData) string {
	user := h.User
	if user == "" {
		user = common.User
	}
	port := h.Port
	if port == "" {
		port = "22"
	}
	return fmt.Sprintf("%s@%s:%s", user, h.HostName, port)
}

// SaveHost replaces an old host block or adds a new one gracefully without destroying file comments
func SaveHost(oldAlias string, h models.HostData) error {
	lines, err := readConfigLines()
	if err != nil {
		return err
	}

	var block []string
	if h.Comment != "" {
		for line := range strings.SplitSeq(h.Comment, "\n") {
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
	if h.AddressFamily != "" {
		block = append(block, fmt.Sprintf("    AddressFamily %s", h.AddressFamily))
	}
	if h.UserKnownHostsFile != "" {
		block = append(block, fmt.Sprintf("    UserKnownHostsFile %s", h.UserKnownHostsFile))
	}
	if h.StrictHostKeyChecking != "" {
		block = append(block, fmt.Sprintf("    StrictHostKeyChecking %s", h.StrictHostKeyChecking))
	}
	if h.HostKeyAlgorithms != "" {
		block = append(block, fmt.Sprintf("    HostKeyAlgorithms %s", h.HostKeyAlgorithms))
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

	newCanonicalAddr := getCanonicalAddr(h)

	// Determine if there is an old password we should migrate/move
	var oldCanonicalAddr string
	if oldAlias != "" {
		allHosts, _ := ListHosts()
		for _, oh := range allHosts {
			if oh.Name == oldAlias {
				oldCanonicalAddr = getCanonicalAddr(*oh)
				break
			}
		}
	}

	// Handle password storage update
	if h.ClearPassword {
		if oldCanonicalAddr != "" {
			passstore.Delete(oldCanonicalAddr)
		}
		passstore.Delete(newCanonicalAddr)
	} else if h.Password != "" {
		if oldCanonicalAddr != "" && oldCanonicalAddr != newCanonicalAddr {
			passstore.Delete(oldCanonicalAddr)
		}
		if err := passstore.Set(newCanonicalAddr, h.Password); err != nil {
			return fmt.Errorf("failed to save password: %w", err)
		}
	} else if oldCanonicalAddr != "" && oldCanonicalAddr != newCanonicalAddr {
		// Host was renamed/modified, and no new password or clear password was specified.
		// Migrate key if it exists and passstore is unlocked.
		if passstore.HasPassword(oldCanonicalAddr) {
			if passstore.HasEncryptionKey() {
				pwd, err := passstore.Get(oldCanonicalAddr)
				if err == nil {
					if err := passstore.Set(newCanonicalAddr, pwd); err == nil {
						passstore.Delete(oldCanonicalAddr)
					}
				}
			}
		}
	}

	if err := writeConfigLines(lines); err != nil {
		return err
	}

	return nil
}

func DeleteHost(name string) error {
	var canonical string
	allHosts, _ := ListHosts()
	for _, oh := range allHosts {
		if oh.Name == name {
			canonical = getCanonicalAddr(*oh)
			break
		}
	}

	lines, err := readConfigLines()
	if err != nil {
		return err
	}
	start, end := findHostBlock(lines, name)
	if start != -1 {
		lines = append(lines[:start], lines[end:]...)
		if err := writeConfigLines(lines); err != nil {
			return err
		}
		if canonical != "" {
			passstore.Delete(canonical)
		}
		return nil
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

	var hosts = []*models.HostData{}
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
				addressFamily, _ := cfg.Get(name, "AddressFamily")
				userKnownHostsFile, _ := cfg.Get(name, "UserKnownHostsFile")
				strictHostKeyChecking, _ := cfg.Get(name, "StrictHostKeyChecking")
				hostKeyAlgorithmsOption, _ := cfg.Get(name, "HostKeyAlgorithms")

				var tags []string
				var commentParts []string
				start, end := findHostBlock(lines, name)
				if start != -1 {
					for i := start; i < end; i++ {
						line := strings.TrimSpace(lines[i])
						if after, ok := strings.CutPrefix(line, "### "); ok {
							content := after
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

				isFav := slices.Contains(tags, "fav")

				u := user
				if u == "" {
					u = common.User
				}
				canonical := fmt.Sprintf("%s@%s:%s", u, hostname, port)

				hosts = append(hosts, &models.HostData{
					Name:                  name,
					HostName:              hostname,
					Port:                  port,
					User:                  user,
					ProxyJump:             proxyJump,
					RemoteCommand:         remoteCommand,
					AddressFamily:         addressFamily,
					UserKnownHostsFile:    userKnownHostsFile,
					StrictHostKeyChecking: strictHostKeyChecking,
					HostKeyAlgorithms:     hostKeyAlgorithmsOption,
					Tags:                  tags,
					Comment:               comment,
					Source:                "config",
					IsAuto:                false,
					IsFavourite:           isFav,
					PasswordExists:        passstore.HasPassword(canonical),
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
				Name:           "root@" + hostname, // Title style
				HostName:       hostname,
				Port:           port,
				User:           "root",
				Source:         "known_hosts",
				IsAuto:         true,
				PasswordExists: passstore.HasPassword(fmt.Sprintf("root@%s:%s", hostname, port)),
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
func DialSSH(name string, term TerminalUI, rows, cols int, identity string, proxyJump string, noPublicKey bool) (
	*PooledClient, *ssh.Session, string, error) {
	client, closers, remoteCommand, err := getSSHClient(name, term, identity, proxyJump, noPublicKey)
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
// $identity: directly set the content of the identity file.
// noPublicKey: skip default public key authentication.
func getSSHClient(name string, term TerminalUI, identity string,
	proxyJump string, noPublicKey bool) (*ssh.Client, []io.Closer, string, error) {
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

		if _u, err := url.PathUnescape(user); err == nil {
			user = _u
		}
		if _p, err := url.PathUnescape(password); err == nil {
			password = _p
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

	identityFile := ""
	remoteCommand := ""
	addressFamily := ""
	if cfg != nil {
		identityFile, _ = cfg.Get(name, "IdentityFile")
		if proxyJump == "" {
			proxyJump, _ = cfg.Get(name, "ProxyJump")
		}
		remoteCommand, _ = cfg.Get(name, "RemoteCommand")
		addressFamily, _ = cfg.Get(name, "AddressFamily")
	}

	dialNetwork := "tcp"
	if strings.ToLower(addressFamily) == "inet" {
		dialNetwork = "tcp4"
	} else if strings.ToLower(addressFamily) == "inet6" {
		dialNetwork = "tcp6"
	}

	if noPublicKey {
		identityFile = ""
	} else if identityFile == "" {
		identityFile = filepath.Join(getSSHDir(), "id_ed25519")
		if _, err := os.Stat(identityFile); os.IsNotExist(err) {
			identityFile = filepath.Join(getSSHDir(), "id_rsa")
		}
	} else {
		identityFile = common.ExpandPath(identityFile)
	}

	canonicalAddr := fmt.Sprintf("%s@%s:%s", user, host, port)

	var authMethods []ssh.AuthMethod
	if password != "" {
		authMethods = append(authMethods, ssh.Password(password))
	} else if passstore.HasPassword(canonicalAddr) {
		pwdCallback := func() (string, error) {
			if !passstore.HasEncryptionKey() {
				if term == nil {
					return "", fmt.Errorf("app password required but terminal is not interactive")
				}
				term.Print("\r\n") // start on a new line
				var appPwd string
				var err error
				for attempts := range 3 {
					appPwd, err = term.PromptMasked("Enter CozySSH app password to unlock saved passwords: ")
					if err != nil {
						return "", err
					}
					if passstore.SetEncryptionKey(appPwd) {
						break
					}
					term.Print("\r\nInvalid app password, please try again.\r\n")
					if attempts == 2 {
						return "", fmt.Errorf("too many invalid app password attempts")
					}
				}
			}
			return passstore.Get(canonicalAddr)
		}
		authMethods = append(authMethods, ssh.PasswordCallback(pwdCallback))
	}

	if identity != "" {
		signer, err := ssh.ParsePrivateKey([]byte(identity))
		if err == nil {
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}
	} else if identityFile != "" {
		keyData, err := os.ReadFile(identityFile)
		if err == nil {
			identityKey := constants.IDENTITY_PREFIX + getIdentityFileID(keyData)
			var signer ssh.Signer
			hasSavedPass := passstore.HasPassword(identityKey)

			if hasSavedPass {
				if !passstore.HasEncryptionKey() && term != nil {
					term.Print("\r\n")
					var appPwd string
					for attempts := 0; attempts < 3; attempts++ {
						appPwd, err = term.PromptMasked("Enter CozySSH app password to unlock saved passwords: ")
						if err != nil {
							break
						}
						if passstore.SetEncryptionKey(appPwd) {
							break
						}
						term.Print("\r\nInvalid app password, please try again.\r\n")
					}
				}
				if passstore.HasEncryptionKey() {
					pwd, errGet := passstore.Get(identityKey)
					if errGet == nil {
						signer, err = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(pwd))
					} else {
						err = errGet
					}
				} else {
					err = passstore.ErrNoKey
				}
			} else {
				signer, err = ssh.ParsePrivateKey(keyData)
			}

			var passphraseErr *ssh.PassphraseMissingError
			shouldPrompt := (err != nil && errors.As(err, &passphraseErr)) || (hasSavedPass && err != nil)
			if shouldPrompt && term != nil {
				pass, perr := term.PromptMasked(fmt.Sprintf("Enter passphrase for key '%s': ", identityFile))
				if perr == nil {
					signer, err = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(pass))
					if err == nil {
						promptOption := "ask"
						if globalConfig != nil && globalConfig.SavePassword != "" {
							promptOption = globalConfig.SavePassword
						}
						switch promptOption {
						case "always":
							saveHostPassword(term, identityKey, pass)
						case "ask":
							term.Print("\r\n") // Start on a new line
							choice, perr2 := term.Prompt("Do you want to save key passphrase to CozySSH (always / yes(y) / no(n) / never) [no]: ")
							if perr2 == nil {
								choice = strings.ToLower(strings.TrimSpace(choice))
								if choice == "" {
									choice = "no"
								}
								switch choice {
								case "always", "always(a)", "a":
									saveHostPassword(term, identityKey, pass)
									if globalConfig != nil {
										globalConfig.UpdateSavePassword("always")
									}
								case "yes", "yes(y)", "y":
									saveHostPassword(term, identityKey, pass)
								case "never", "never(v)", "v":
									if globalConfig != nil {
										globalConfig.UpdateSavePassword("never")
									}
								}
							}
						}
					}
				}
			}

			if err == nil && signer != nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
	}

	var usedStoredPassword bool
	authMethods = append(authMethods, ssh.KeyboardInteractive(func(u,
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

			isPasswordQuestion := i < len(echos) && !echos[i] && (strings.Contains(strings.ToLower(q), "password") || strings.Contains(strings.ToLower(q), "passphrase"))

			if isPasswordQuestion && password == "" && passstore.HasPassword(canonicalAddr) && !usedStoredPassword {
				if !passstore.HasEncryptionKey() {
					term.Print("\r\n")
					var appPwd string
					for attempts := 0; attempts < 3; attempts++ {
						appPwd, err = term.PromptMasked("Enter CozySSH app password to unlock saved passwords: ")
						if err != nil {
							return nil, err
						}
						if passstore.SetEncryptionKey(appPwd) {
							break
						}
						term.Print("\r\nInvalid app password, please try again.\r\n")
						if attempts == 2 {
							return nil, fmt.Errorf("too many invalid app password attempts")
						}
					}
				}
				pwd, err := passstore.Get(canonicalAddr)
				if err == nil {
					ans = pwd
					usedStoredPassword = true
				} else {
					ans, err = term.PromptMasked(q)
				}
			} else if i < len(echos) && !echos[i] {
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

	var khCallback ssh.HostKeyCallback
	var khErr error
	isKnownHostsNull := false

	knownHostsFile := filepath.Join(getSSHDir(), "known_hosts")
	if cfg != nil {
		if ukh, _ := cfg.Get(name, "UserKnownHostsFile"); ukh != "" {
			knownHostsFile = common.ExpandPath(ukh)
		}
	}

	if knownHostsFile == os.DevNull {
		isKnownHostsNull = true
		khCallback = func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			return &knownhosts.KeyError{}
		}
	} else {
		os.MkdirAll(filepath.Dir(knownHostsFile), 0700)
		if _, err := os.Stat(knownHostsFile); os.IsNotExist(err) {
			common.AtomicWriteFileContents(knownHostsFile, []byte(""))
		}
		khCallback, khErr = knownhosts.New(knownHostsFile)
		if khErr != nil {
			if term != nil {
				term.Print(fmt.Sprintf("\r\nknown_hosts error: %v\r\n", khErr))
			}
			return nil, nil, "", khErr
		}
	}

	strictHostKeyChecking := "ask"
	hostKeyAlgorithmsOption := ""
	if cfg != nil {
		if shkc, _ := cfg.Get(name, "StrictHostKeyChecking"); shkc != "" {
			strictHostKeyChecking = strings.ToLower(shkc)
		}
		if hka, _ := cfg.Get(name, "HostKeyAlgorithms"); hka != "" {
			hostKeyAlgorithmsOption = hka
		}
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

	allowedAlgos := resolveHostKeyAlgorithms(hostKeyAlgorithmsOption)

	algoMap := make(map[string]bool)
	var hostKeyAlgorithms []string
	for _, a := range prioritizedAlgos {
		if slices.Contains(allowedAlgos, a) && !algoMap[a] {
			hostKeyAlgorithms = append(hostKeyAlgorithms, a)
			algoMap[a] = true
		}
	}
	for _, a := range allowedAlgos {
		if !algoMap[a] {
			hostKeyAlgorithms = append(hostKeyAlgorithms, a)
			algoMap[a] = true
		}
	}

	hostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		if globalConfig != nil && globalConfig.InsecureIgnoreHostKey {
			return nil
		}
		if strictHostKeyChecking == "no" && isKnownHostsNull {
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
			switch strictHostKeyChecking {
			case "no":
				if !isKnownHostsNull {
					f, e := os.OpenFile(knownHostsFile, os.O_APPEND|os.O_WRONLY, 0600)
					if e == nil {
						line := knownhosts.Line([]string{hostname, remote.String()}, key)
						f.WriteString(line + "\n")
						f.Close()
					}
				}
				return nil
			case "yes":
				msg := fmt.Sprintf("\r\nHost key verification failed for %s: StrictHostKeyChecking is set to yes.\r\n", hostname)
				if term != nil {
					term.Print(msg)
				}
				return fmt.Errorf("Host key verification failed (StrictHostKeyChecking=yes)")
			default:
				// ask
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
					if !isKnownHostsNull {
						f, e := os.OpenFile(knownHostsFile, os.O_APPEND|os.O_WRONLY, 0600)
						if e == nil {
							line := knownhosts.Line([]string{hostname, remote.String()}, key)
							f.WriteString(line + "\n")
							f.Close()
						}
					}
					return nil
				}
				return fmt.Errorf("Host key verification failed.")
			}
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
		if proxyJump != "" {
			proxyClient, proxyClosers, _, err := getSSHClient(proxyJump, term, "", "", false)
			if err != nil {
				return nil, fmt.Errorf("failed to connect to ProxyJump %s: %w", proxyJump, err)
			}
			closers = append(closers, proxyClosers...)
			closers = append(closers, proxyClient)

			jumpConn, err := proxyClient.Dial(dialNetwork, addr)
			if err != nil {
				return nil, err
			}

			c, chans, reqs, err := ssh.NewClientConn(jumpConn, addr, config)
			if err != nil {
				return nil, err
			}
			return ssh.NewClient(c, chans, reqs), nil
		}
		return ssh.Dial(dialNetwork, addr, config)
	}

	client, err = dialFunc(sshConfig)
	if err != nil && strings.Contains(err.Error(), "no supported methods remain") && term != nil {
		// Try password fallback
		pass, perr := term.PromptMasked(fmt.Sprintf("%s@%s's password: ", user, host))
		if perr == nil {
			sshConfig.Auth = []ssh.AuthMethod{
				ssh.Password(pass),
				ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
					answers := make([]string, len(questions))
					for i, q := range questions {
						if !echos[i] && (strings.Contains(strings.ToLower(q), "password") || strings.Contains(strings.ToLower(q), "passphrase")) {
							answers[i] = pass
						}
					}
					return answers, nil
				}),
			}
			client, err = dialFunc(sshConfig)
			if err == nil {
				promptOption := "ask"
				if globalConfig != nil && globalConfig.SavePassword != "" {
					promptOption = globalConfig.SavePassword
				}
				switch promptOption {
				case "always":
					saveHostPassword(term, canonicalAddr, pass)
				case "ask":
					term.Print("\r\n") // Start on a new line
					choice, perr2 := term.Prompt("Do you want to save host password to CozySSH (always / yes(y) / no(n) / never) [no]: ")
					if perr2 == nil {
						choice = strings.ToLower(strings.TrimSpace(choice))
						if choice == "" {
							choice = "no"
						}
						switch choice {
						case "always", "always(a)", "a":
							saveHostPassword(term, canonicalAddr, pass)
							if globalConfig != nil {
								globalConfig.UpdateSavePassword("always")
							}
						case "yes", "yes(y)", "y":
							saveHostPassword(term, canonicalAddr, pass)
						case "never", "never(v)", "v":
							if globalConfig != nil {
								globalConfig.UpdateSavePassword("never")
							}
						}
					}
				}
			}
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

// ExecSSHCommand runs cmdline on the remote host via a new non-PTY SSH channel
// spawned from the given PooledClient. It returns stdout, stderr, and any error
// (including non-zero exit codes wrapped via *ssh.ExitError).
// The PooledClient ref-count is NOT incremented — the caller is responsible for
// ensuring the client stays alive for the duration of the call.
func ExecSSHCommand(pClient *PooledClient, cmdline string) (stdout, stderr string, err error) {
	sess, err := pClient.Client.NewSession()
	if err != nil {
		return "", "", fmt.Errorf("failed to open SSH session: %w", err)
	}
	defer sess.Close()

	var stdoutBuf, stderrBuf bytes.Buffer
	sess.Stdout = &stdoutBuf
	sess.Stderr = &stderrBuf

	err = sess.Run(cmdline)
	return stdoutBuf.String(), stderrBuf.String(), err
}

func saveHostPassword(term TerminalUI, canonicalAddr string, pass string) {
	typeName := "host password"
	displayName := "Host password"
	if strings.HasPrefix(canonicalAddr, constants.IDENTITY_PREFIX) {
		typeName = "key passphrase"
		displayName = "Key passphrase"
	}

	if !passstore.HasEncryptionKey() {
		term.Print(fmt.Sprintf("\r\nThe CozySSH password store is locked. To save this %s, you must unlock it.\r\n", typeName))
		appPwd, err := term.PromptMasked("Enter CozySSH app password: ")
		if err != nil || appPwd == "" {
			term.Print(fmt.Sprintf("\r\nSkipping %s saving.\r\n", typeName))
			return
		}
		if passstore.SetEncryptionKey(appPwd) {
			if err := passstore.Set(canonicalAddr, pass); err != nil {
				term.Print(fmt.Sprintf("\r\nFailed to save %s: %v\r\n", typeName, err))
			} else {
				term.Print(fmt.Sprintf("\r\n%s saved successfully!\r\n", displayName))
			}
		} else {
			term.Print(fmt.Sprintf("\r\nIncorrect app password. Skipping %s saving.\r\n", typeName))
		}
	} else {
		if err := passstore.Set(canonicalAddr, pass); err != nil {
			term.Print(fmt.Sprintf("\r\nFailed to save %s: %v\r\n", typeName, err))
		} else {
			term.Print(fmt.Sprintf("\r\n%s saved successfully!\r\n", displayName))
		}
	}
}

func getIdentityFileID(keyData []byte) string {
	block, _ := pem.Decode(keyData)
	if block != nil {
		if id, ok := block.Headers["id"]; ok && id != "" {
			return id
		}
		if id, ok := block.Headers["ID"]; ok && id != "" {
			return id
		}
	}
	hash := sha256.Sum256(keyData)
	return fmt.Sprintf("%x", hash)
}

func GetIdentityPathForHost(h *models.HostData) string {
	identityFile := h.IdentityFile
	if identityFile == "" {
		sshDir := getSSHDir()
		identityFile = filepath.Join(sshDir, "id_ed25519")
		if _, err := os.Stat(identityFile); os.IsNotExist(err) {
			identityFile = filepath.Join(sshDir, "id_rsa")
		}
	} else {
		identityFile = common.ExpandPath(identityFile)
	}
	return identityFile
}

func getPubKeyContent(identityFile string) (string, error) {
	pubPath := identityFile + ".pub"
	pubBytes, err := os.ReadFile(pubPath)
	if err == nil {
		return strings.TrimSpace(string(pubBytes)), nil
	}

	// Try to derive public key from private key directly
	keyData, err := os.ReadFile(identityFile)
	if err != nil {
		return "", fmt.Errorf("failed to read identity file %s: %w", identityFile, err)
	}

	var signer ssh.Signer
	identityKey := constants.IDENTITY_PREFIX + getIdentityFileID(keyData)
	if passstore.HasPassword(identityKey) && passstore.HasEncryptionKey() {
		pwd, errGet := passstore.Get(identityKey)
		if errGet == nil {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(pwd))
		}
	} else {
		signer, err = ssh.ParsePrivateKey(keyData)
	}

	if err != nil {
		return "", fmt.Errorf("failed to parse private key (if it is encrypted, please save the passphrase or create a .pub file next to it): %w", err)
	}

	pubKey := signer.PublicKey()
	pubKeyBytes := ssh.MarshalAuthorizedKey(pubKey)
	return strings.TrimSpace(string(pubKeyBytes)), nil
}

func tryPubKeyAuth(name string, host *models.HostData, expectedFingerprint string) (bool, *HostKeyVerificationError, error) {
	identityFile := GetIdentityPathForHost(host)
	keyData, err := os.ReadFile(identityFile)
	if err != nil {
		return false, nil, fmt.Errorf("failed to read identity file: %w", err)
	}

	var signer ssh.Signer
	identityKey := constants.IDENTITY_PREFIX + getIdentityFileID(keyData)
	if passstore.HasPassword(identityKey) && passstore.HasEncryptionKey() {
		pwd, errGet := passstore.Get(identityKey)
		if errGet == nil {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(pwd))
		}
	} else {
		signer, err = ssh.ParsePrivateKey(keyData)
	}

	if err != nil {
		return false, nil, err
	}

	authMethods := []ssh.AuthMethod{ssh.PublicKeys(signer)}

	port := host.Port
	if port == "" {
		port = "22"
	}

	var hkResult HostKeyResult
	hkCallback, hkAlgos, err := createCopyIDHostKeyCallback(name, host.HostName, port, expectedFingerprint, &hkResult)
	if err != nil {
		return false, nil, err
	}

	sshConfig := &ssh.ClientConfig{
		User:              host.User,
		Auth:              authMethods,
		HostKeyAlgorithms: hkAlgos,
		HostKeyCallback:   hkCallback,
		Timeout:           5 * time.Second,
	}
	if host.User == "" {
		sshConfig.User = common.User
	}
	addr := fmt.Sprintf("%s:%s", host.HostName, port)

	dialNetwork := "tcp"
	if strings.ToLower(host.AddressFamily) == "inet" {
		dialNetwork = "tcp4"
	} else if strings.ToLower(host.AddressFamily) == "inet6" {
		dialNetwork = "tcp6"
	}

	var client *ssh.Client
	if host.ProxyJump != "" {
		proxyClient, proxyClosers, _, err := getSSHClient(host.ProxyJump, nil, "", "", false)
		if err != nil {
			return false, nil, fmt.Errorf("failed to connect to ProxyJump %s: %w", host.ProxyJump, err)
		}
		defer func() {
			for _, c := range proxyClosers {
				c.Close()
			}
			proxyClient.Close()
		}()
		jumpConn, err := proxyClient.Dial(dialNetwork, addr)
		if err != nil {
			if hkResult.Err != nil {
				return false, hkResult.Err, nil
			}
			return false, nil, err
		}
		c, chans, reqs, err := ssh.NewClientConn(jumpConn, addr, sshConfig)
		if err != nil {
			if hkResult.Err != nil {
				return false, hkResult.Err, nil
			}
			return false, nil, err
		}
		client = ssh.NewClient(c, chans, reqs)
	} else {
		var dialErr error
		client, dialErr = ssh.Dial(dialNetwork, addr, sshConfig)
		if dialErr != nil {
			if hkResult.Err != nil {
				return false, hkResult.Err, nil
			}
			return false, nil, dialErr
		}
	}

	client.Close()
	return true, nil, nil
}

func executeCopyIDWithPassword(name string, host *models.HostData, password string, cmd string, expectedFingerprint string) (*HostKeyVerificationError, error) {
	kbAuth := ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
		answers := make([]string, len(questions))
		for i, q := range questions {
			if !echos[i] && (strings.Contains(strings.ToLower(q), "password") || strings.Contains(strings.ToLower(q), "passphrase")) {
				answers[i] = password
			}
		}
		return answers, nil
	})

	authMethods := []ssh.AuthMethod{
		ssh.Password(password),
		kbAuth,
	}

	port := host.Port
	if port == "" {
		port = "22"
	}

	var hkResult HostKeyResult
	hkCallback, hkAlgos, err := createCopyIDHostKeyCallback(name, host.HostName, port, expectedFingerprint, &hkResult)
	if err != nil {
		return nil, err
	}

	sshConfig := &ssh.ClientConfig{
		User:              host.User,
		Auth:              authMethods,
		HostKeyAlgorithms: hkAlgos,
		HostKeyCallback:   hkCallback,
		Timeout:           5 * time.Second,
	}
	if host.User == "" {
		sshConfig.User = common.User
	}
	addr := fmt.Sprintf("%s:%s", host.HostName, port)

	dialNetwork := "tcp"
	if strings.ToLower(host.AddressFamily) == "inet" {
		dialNetwork = "tcp4"
	} else if strings.ToLower(host.AddressFamily) == "inet6" {
		dialNetwork = "tcp6"
	}

	var client *ssh.Client
	var closers []io.Closer

	if host.ProxyJump != "" {
		proxyClient, proxyClosers, _, err := getSSHClient(host.ProxyJump, nil, "", "", false)
		if err != nil {
			return nil, fmt.Errorf("failed to connect to ProxyJump %s: %w", host.ProxyJump, err)
		}
		closers = append(closers, proxyClosers...)
		closers = append(closers, proxyClient)

		jumpConn, err := proxyClient.Dial(dialNetwork, addr)
		if err != nil {
			for _, c := range closers {
				c.Close()
			}
			if hkResult.Err != nil {
				return hkResult.Err, nil
			}
			return nil, err
		}
		closers = append(closers, jumpConn)

		c, chans, reqs, err := ssh.NewClientConn(jumpConn, addr, sshConfig)
		if err != nil {
			for _, c := range closers {
				c.Close()
			}
			if hkResult.Err != nil {
				return hkResult.Err, nil
			}
			return nil, err
		}
		client = ssh.NewClient(c, chans, reqs)
	} else {
		client, err = ssh.Dial(dialNetwork, addr, sshConfig)
		if err != nil {
			if hkResult.Err != nil {
				return hkResult.Err, nil
			}
			return nil, err
		}
	}
	defer func() {
		client.Close()
		for _, c := range closers {
			c.Close()
		}
	}()

	session, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()

	var stdoutBuf, stderrBuf bytes.Buffer
	session.Stdout = &stdoutBuf
	session.Stderr = &stderrBuf

	if err := session.Run(cmd); err != nil {
		return nil, fmt.Errorf("failed to execute remote command: %w, stderr: %s", err, stderrBuf.String())
	}

	stdout := strings.TrimSpace(stdoutBuf.String())
	if !strings.Contains(stdout, "KEY_ADDED") && !strings.Contains(stdout, "KEY_ALREADY_EXISTS") {
		return nil, fmt.Errorf("unexpected command output: %s, stderr: %s", stdout, stderrBuf.String())
	}
	return nil, nil
}

func isAuthError(err error) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "authenticate") || strings.Contains(errStr, "auth") || strings.Contains(errStr, "handshake failed")
}

// CopySSHID attempts to copy the host's public key to the remote authorized_keys file.
func CopySSHID(name string, password string, expectedFingerprint string) (*models.CopyIDResponse, error) {
	// 1. Find the host configuration
	hosts, err := ListHosts()
	if err != nil {
		return nil, fmt.Errorf("failed to list hosts: %w", err)
	}

	var host *models.HostData
	for _, h := range hosts {
		if h.Name == name {
			host = h
			break
		}
	}

	if host == nil {
		host = &models.HostData{
			Name:     name,
			HostName: name,
			Port:     "22",
			Source:   "",
		}
		if i := strings.LastIndex(name, "@"); i != -1 {
			hostPart := name[i+1:]
			userPart, _, _ := strings.Cut(name[:i], ":")
			if _u, err := url.PathUnescape(userPart); err == nil {
				userPart = _u
			}
			host.User = userPart
			if idx := strings.LastIndex(hostPart, ":"); idx != -1 {
				host.HostName = hostPart[:idx]
				host.Port = hostPart[idx+1:]
			} else {
				host.HostName = hostPart
			}
		} else if idx := strings.LastIndex(name, ":"); idx != -1 {
			host.HostName = name[:idx]
			host.Port = name[idx+1:]
		}
	}

	if host.User == "" {
		host.User = common.User
	}
	if host.Port == "" {
		host.Port = "22"
	}

	// 2. Resolve identity file and read public key content
	identityFile := GetIdentityPathForHost(host)
	pubKeyContent, err := getPubKeyContent(identityFile)
	if err != nil {
		return nil, fmt.Errorf("failed to get public key content: %w", err)
	}

	// 3. Try to connect using the identity file first.
	success, hkErr, err := tryPubKeyAuth(name, host, expectedFingerprint)
	if hkErr != nil {
		return &models.CopyIDResponse{
			Status:      "need_hostkey_confirm",
			Message:     hkErr.Reason,
			Fingerprint: hkErr.Fingerprint,
		}, nil
	}
	if err == nil && success {
		return &models.CopyIDResponse{
			Status: "success",
			Message: fmt.Sprintf(`Identity file already exists on remote host %s@%s:%s (connection succeeded using public key).`,
				host.User, host.HostName, host.Port),
		}, nil
	}

	if err != nil && !isAuthError(err) {
		return nil, fmt.Errorf("network connection failed: %w", err)
	}

	// 4. Identity file auth failed or was not set up.
	activePassword := password
	if activePassword == "" {
		canonicalAddr := fmt.Sprintf("%s@%s:%s", host.User, host.HostName, host.Port)
		if passstore.HasPassword(canonicalAddr) {
			if passstore.HasEncryptionKey() {
				pwd, errGet := passstore.Get(canonicalAddr)
				if errGet == nil {
					activePassword = pwd
				}
			} else {
				return &models.CopyIDResponse{
					Status:  "need_app_password",
					Message: "CozySSH password store is locked. Please enter your CozySSH app password to unlock it:",
				}, nil
			}
		}
	}

	if activePassword == "" {
		return &models.CopyIDResponse{
			Status:  "need_password",
			Message: fmt.Sprintf("Authentication failed. Please enter password for %s@%s", host.User, host.HostName),
		}, nil
	}

	parts := strings.Fields(pubKeyContent)
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid public key format in derived public key")
	}
	keyPart := parts[1]

	targetPath := ".ssh/authorized_keys"
	cmd := fmt.Sprintf(`sh -c 'TARGET="%s"; DIR=$(dirname "$TARGET"); umask 077; mkdir -p "$DIR"; if ! grep -qF "%s" "$TARGET" 2>/dev/null; then echo "%s" >> "$TARGET"; echo "KEY_ADDED"; else echo "KEY_ALREADY_EXISTS"; fi'`, targetPath, keyPart, pubKeyContent)

	hkErr, err = executeCopyIDWithPassword(name, host, activePassword, cmd, expectedFingerprint)
	if hkErr != nil {
		return &models.CopyIDResponse{
			Status:      "need_hostkey_confirm",
			Message:     hkErr.Reason,
			Fingerprint: hkErr.Fingerprint,
		}, nil
	}
	if err != nil {
		if isAuthError(err) {
			return &models.CopyIDResponse{
				Status:  "need_password",
				Message: "Password authentication failed. Please enter the password again.",
			}, nil
		}
		return nil, fmt.Errorf("failed to copy SSH key using password: %w", err)
	}

	return &models.CopyIDResponse{
		Status: "success",
		Message: fmt.Sprintf(`Public key successfully added to authorized_keys of remote %s@%s:%s.`,
			host.User, host.HostName, host.Port),
	}, nil
}

func resolveHostKeyAlgorithms(option string) []string {
	defaults := []string{
		ssh.KeyAlgoED25519,
		ssh.KeyAlgoRSASHA256,
		ssh.KeyAlgoRSASHA512,
		ssh.KeyAlgoECDSA256,
		ssh.KeyAlgoECDSA384,
		ssh.KeyAlgoECDSA521,
	}

	if option == "" {
		return defaults
	}

	var algos []string
	rawList := option
	if strings.HasPrefix(option, "+") || strings.HasPrefix(option, "-") || strings.HasPrefix(option, "^") {
		rawList = option[1:]
	}
	for _, part := range strings.Split(rawList, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			algos = append(algos, trimmed)
		}
	}

	if strings.HasPrefix(option, "+") {
		res := append([]string{}, defaults...)
		for _, a := range algos {
			if !slices.Contains(res, a) {
				res = append(res, a)
			}
		}
		return res
	} else if strings.HasPrefix(option, "-") {
		var res []string
		for _, d := range defaults {
			if !slices.Contains(algos, d) {
				res = append(res, d)
			}
		}
		return res
	} else if strings.HasPrefix(option, "^") {
		res := append([]string{}, algos...)
		for _, d := range defaults {
			if !slices.Contains(res, d) {
				res = append(res, d)
			}
		}
		return res
	} else {
		return algos
	}
}

type HostKeyVerificationError struct {
	Fingerprint string
	Reason      string // "mismatch:..." or "unknown:..."
	Hostname    string
	RemoteAddr  string
	KeyType     string
}

func (e *HostKeyVerificationError) Error() string {
	return fmt.Sprintf("host key verification failed: %s (%s)", e.Reason, e.Fingerprint)
}

type HostKeyResult struct {
	Err *HostKeyVerificationError
}

func createCopyIDHostKeyCallback(name string, hostStr string, portStr string, expectedFingerprint string, result *HostKeyResult) (ssh.HostKeyCallback, []string, error) {
	configPath := filepath.Join(getSSHDir(), "config")
	f, err := os.Open(configPath)
	var cfg *ssh_config.Config
	if err == nil {
		cfg, _ = ssh_config.Decode(f)
		f.Close()
	}

	knownHostsFile := filepath.Join(getSSHDir(), "known_hosts")
	if cfg != nil {
		if ukh, _ := cfg.Get(name, "UserKnownHostsFile"); ukh != "" {
			knownHostsFile = common.ExpandPath(ukh)
		}
	}

	isKnownHostsNull := knownHostsFile == os.DevNull
	var khCallback ssh.HostKeyCallback
	var khErr error

	if !isKnownHostsNull {
		os.MkdirAll(filepath.Dir(knownHostsFile), 0700)
		if _, err := os.Stat(knownHostsFile); os.IsNotExist(err) {
			common.AtomicWriteFileContents(knownHostsFile, []byte(""))
		}
		khCallback, khErr = knownhosts.New(knownHostsFile)
		if khErr != nil {
			return nil, nil, khErr
		}
	} else {
		khCallback = func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			return &knownhosts.KeyError{}
		}
	}

	strictHostKeyChecking := "ask"
	hostKeyAlgorithmsOption := ""
	if cfg != nil {
		if shkc, _ := cfg.Get(name, "StrictHostKeyChecking"); shkc != "" {
			strictHostKeyChecking = strings.ToLower(shkc)
		}
		if hka, _ := cfg.Get(name, "HostKeyAlgorithms"); hka != "" {
			hostKeyAlgorithmsOption = hka
		}
	}

	probeAddr := fmt.Sprintf("%s:%s", hostStr, portStr)
	dummyKey, _, _, _, _ := ssh.ParseAuthorizedKey([]byte("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))
	dummyNetAddr := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 22}

	var prioritizedAlgos []string
	if khCallback != nil {
		probeErr := khCallback(probeAddr, dummyNetAddr, dummyKey)
		var keyErr *knownhosts.KeyError
		if errors.As(probeErr, &keyErr) && len(keyErr.Want) > 0 {
			for _, w := range keyErr.Want {
				prioritizedAlgos = append(prioritizedAlgos, w.Key.Type())
			}
		}
	}

	allowedAlgos := resolveHostKeyAlgorithms(hostKeyAlgorithmsOption)
	algoMap := make(map[string]bool)
	var hostKeyAlgorithms []string
	for _, a := range prioritizedAlgos {
		if slices.Contains(allowedAlgos, a) && !algoMap[a] {
			hostKeyAlgorithms = append(hostKeyAlgorithms, a)
			algoMap[a] = true
		}
	}
	for _, a := range allowedAlgos {
		if !algoMap[a] {
			hostKeyAlgorithms = append(hostKeyAlgorithms, a)
			algoMap[a] = true
		}
	}

	cb := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		if globalConfig != nil && globalConfig.InsecureIgnoreHostKey {
			return nil
		}
		if strictHostKeyChecking == "no" && isKnownHostsNull {
			return nil
		}

		fingerprint := ssh.FingerprintSHA256(key)

		// User confirmed this host fingerprint from the frontend
		if expectedFingerprint != "" && expectedFingerprint == fingerprint {
			if khCallback != nil && !isKnownHostsNull {
				errCheck := khCallback(hostname, remote, key)
				var keyErr *knownhosts.KeyError
				if errors.As(errCheck, &keyErr) && len(keyErr.Want) == 0 {
					f, e := os.OpenFile(knownHostsFile, os.O_APPEND|os.O_WRONLY, 0600)
					if e == nil {
						line := knownhosts.Line([]string{hostname, remote.String()}, key)
						f.WriteString(line + "\n")
						f.Close()
					}
				}
			}
			return nil
		}

		if khCallback == nil {
			return nil
		}

		errCheck := khCallback(hostname, remote, key)
		if errCheck == nil {
			return nil
		}

		var keyErr *knownhosts.KeyError
		if errors.As(errCheck, &keyErr) {
			if len(keyErr.Want) > 0 {
				result.Err = &HostKeyVerificationError{
					Fingerprint: fingerprint,
					Reason:      "mismatch: server host key doesn't match with known_hosts record",
					Hostname:    hostname,
					RemoteAddr:  remote.String(),
					KeyType:     key.Type(),
				}
				return result.Err
			} else {
				if strictHostKeyChecking == "no" {
					if !isKnownHostsNull {
						f, e := os.OpenFile(knownHostsFile, os.O_APPEND|os.O_WRONLY, 0600)
						if e == nil {
							line := knownhosts.Line([]string{hostname, remote.String()}, key)
							f.WriteString(line + "\n")
							f.Close()
						}
					}
					return nil
				}
				result.Err = &HostKeyVerificationError{
					Fingerprint: fingerprint,
					Reason:      "unknown: server host key doesn't exist in known_hosts",
					Hostname:    hostname,
					RemoteAddr:  remote.String(),
					KeyType:     key.Type(),
				}
				return result.Err
			}
		}
		return errCheck
	}

	return cb, hostKeyAlgorithms, nil
}
