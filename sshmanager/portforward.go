package sshmanager

import (
	"cozyssh/models"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"
)

// PortForwardRule represents a parsed port forwarding rule following OpenSSH syntax.
// LocalForward:  [bind_address:]port host:hostport
// RemoteForward: [bind_address:]port host:hostport
type PortForwardRule struct {
	BindAddress string // e.g. "localhost", "0.0.0.0", "" (defaults to "localhost")
	BindPort    string // e.g. "8080"
	Host        string // e.g. "remote-host"
	HostPort    string // e.g. "80"
}

// tunnelRegistry tracks active tunnels globally and prevents duplicate port forwarding
// for the same host when multiple sessions are opened.
type tunnelRegistry struct {
	mu sync.Mutex
	// key = canonical SSH host address (user@host:port), value = list of active tunnels
	tunnels map[string][]*activeTunnelEntry
}

type activeTunnelEntry struct {
	info   *models.ActiveTunnel
	closer io.Closer // to stop the tunnel
}

var globalTunnelRegistry = &tunnelRegistry{
	tunnels: make(map[string][]*activeTunnelEntry),
}

// HasTunnels returns true if port forwarding is already set up for this host.
func (r *tunnelRegistry) HasTunnels(hostKey string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	entries, ok := r.tunnels[hostKey]
	return ok && len(entries) > 0
}

// AddTunnel registers a new active tunnel.
func (r *tunnelRegistry) AddTunnel(hostKey string, entry *activeTunnelEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tunnels[hostKey] = append(r.tunnels[hostKey], entry)
}

// RemoveTunnels removes and closes all tunnels for a given host key.
func (r *tunnelRegistry) RemoveTunnels(hostKey string) {
	r.mu.Lock()
	entries := r.tunnels[hostKey]
	delete(r.tunnels, hostKey)
	r.mu.Unlock()

	for _, e := range entries {
		if e.closer != nil {
			e.closer.Close()
		}
	}
}

// GetAllTunnels returns a snapshot of all active tunnels.
func (r *tunnelRegistry) GetAllTunnels() []*models.ActiveTunnel {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result []*models.ActiveTunnel
	for _, entries := range r.tunnels {
		for _, e := range entries {
			result = append(result, e.info)
		}
	}
	return result
}

// ParseForwardRule parses an OpenSSH-style port forwarding rule.
// Accepted formats:
//   - "port host:hostport"            → bind=localhost, port=port, host=host, hostport=hostport
//   - "bind_address:port host:hostport" → bind=bind_address, port=port, host=host, hostport=hostport
//   - "port host:hostport" (with spaces or without)
//
// This follows the same syntax as OpenSSH's LocalForward / RemoteForward directives.
func ParseForwardRule(rule string) (*PortForwardRule, error) {
	rule = strings.TrimSpace(rule)
	if rule == "" {
		return nil, fmt.Errorf("empty forwarding rule")
	}

	// Split into local part and remote part.
	// OpenSSH uses whitespace to separate: "[bind_address:]port host:hostport"
	parts := strings.Fields(rule)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid forwarding rule %q: expected '[bind_address:]port host:hostport'", rule)
	}

	localPart := parts[0]
	remotePart := parts[1]

	// Parse local part: [bind_address:]port
	bindAddr := "localhost"
	bindPort := localPart
	if i := strings.LastIndex(localPart, ":"); i != -1 {
		bindAddr = localPart[:i]
		bindPort = localPart[i+1:]
	}
	// Handle "*" as "0.0.0.0" like OpenSSH
	if bindAddr == "*" {
		bindAddr = "0.0.0.0"
	}
	if bindAddr == "" {
		bindAddr = "localhost"
	}

	// Parse remote part: host:hostport
	remoteHost := ""
	remotePort := ""
	if i := strings.LastIndex(remotePart, ":"); i != -1 {
		remoteHost = remotePart[:i]
		remotePort = remotePart[i+1:]
	} else {
		return nil, fmt.Errorf("invalid forwarding rule %q: remote part must be host:port", rule)
	}

	if bindPort == "" || remotePort == "" || remoteHost == "" {
		return nil, fmt.Errorf("invalid forwarding rule %q: incomplete specification", rule)
	}

	return &PortForwardRule{
		BindAddress: bindAddr,
		BindPort:    bindPort,
		Host:        remoteHost,
		HostPort:    remotePort,
	}, nil
}

// ParseForwardRules parses multiple forwarding rules (one per line, or comma-separated lines).
func ParseForwardRules(rules string) ([]*PortForwardRule, []error) {
	var parsed []*PortForwardRule
	var errs []error
	for line := range strings.SplitSeq(rules, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		rule, err := ParseForwardRule(line)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		parsed = append(parsed, rule)
	}
	return parsed, errs
}

// SetupPortForwarding sets up port forwarding tunnels on the given SSH client.
// It only sets up forwarding if this is the first connection to the host (no tunnels exist yet).
// Errors are logged but not returned as fatal.
// Returns a cleanup function that should be called when the SSH connection is closed.
func SetupPortForwarding(client *ssh.Client, hostName string, hostKey string,
	localForwards string, remoteForwards string) func() {

	if localForwards == "" && remoteForwards == "" {
		return func() {}
	}

	// Only apply port forwarding on the first SSH connection to this host
	if globalTunnelRegistry.HasTunnels(hostKey) {
		log.Printf("[portforward] Tunnels already active for %s, skipping", hostKey)
		return func() {}
	}

	// Parse local forwards
	localRules, localErrs := ParseForwardRules(localForwards)
	for _, err := range localErrs {
		log.Printf("[portforward] Warning: %v", err)
	}

	// Parse remote forwards
	remoteRules, remoteErrs := ParseForwardRules(remoteForwards)
	for _, err := range remoteErrs {
		log.Printf("[portforward] Warning: %v", err)
	}

	// Set up local forwards
	for _, rule := range localRules {
		if err := startLocalForward(client, hostKey, hostName, rule); err != nil {
			log.Printf("[portforward] Failed to set up local forward %s:%s -> %s:%s for %s: %v",
				rule.BindAddress, rule.BindPort, rule.Host, rule.HostPort, hostName, err)
		} else {
			log.Printf("[portforward] Local forward %s:%s -> %s:%s established for %s",
				rule.BindAddress, rule.BindPort, rule.Host, rule.HostPort, hostName)
		}
	}

	// Set up remote forwards
	for _, rule := range remoteRules {
		if err := startRemoteForward(client, hostKey, hostName, rule); err != nil {
			log.Printf("[portforward] Failed to set up remote forward %s:%s -> %s:%s for %s: %v",
				rule.BindAddress, rule.BindPort, rule.Host, rule.HostPort, hostName, err)
		} else {
			log.Printf("[portforward] Remote forward %s:%s -> %s:%s established for %s",
				rule.BindAddress, rule.BindPort, rule.Host, rule.HostPort, hostName)
		}
	}

	return func() {
		globalTunnelRegistry.RemoveTunnels(hostKey)
	}
}

// startLocalForward sets up a local-to-remote port forwarding tunnel.
// Local TCP listener accepts connections and forwards them through the SSH connection
// to the remote host:port.
func startLocalForward(client *ssh.Client, hostKey string, hostName string, rule *PortForwardRule) error {
	listenAddr := net.JoinHostPort(rule.BindAddress, rule.BindPort)
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", listenAddr, err)
	}

	entry := &activeTunnelEntry{
		info: &models.ActiveTunnel{
			Type:       models.TunnelTypeLocal,
			BindAddr:   rule.BindAddress,
			BindPort:   rule.BindPort,
			RemoteHost: rule.Host,
			RemotePort: rule.HostPort,
			HostName:   hostName,
		},
		closer: listener,
	}
	globalTunnelRegistry.AddTunnel(hostKey, entry)

	remoteAddr := net.JoinHostPort(rule.Host, rule.HostPort)
	go func() {
		for {
			localConn, err := listener.Accept()
			if err != nil {
				// Listener was closed, stop accepting
				return
			}
			go func(lc net.Conn) {
				defer lc.Close()
				remoteConn, err := client.Dial("tcp", remoteAddr)
				if err != nil {
					log.Printf("[portforward] Failed to dial remote %s via SSH: %v", remoteAddr, err)
					return
				}
				defer remoteConn.Close()
				go io.Copy(remoteConn, lc)
				io.Copy(lc, remoteConn)
			}(localConn)
		}
	}()

	return nil
}

// startRemoteForward sets up a remote-to-local port forwarding tunnel.
// The SSH server listens on a remote port and forwards connections back through
// the SSH connection to a local host:port.
func startRemoteForward(client *ssh.Client, hostKey string, hostName string, rule *PortForwardRule) error {
	remoteListenAddr := net.JoinHostPort(rule.BindAddress, rule.BindPort)
	listener, err := client.Listen("tcp", remoteListenAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on remote %s: %w", remoteListenAddr, err)
	}

	entry := &activeTunnelEntry{
		info: &models.ActiveTunnel{
			Type:       models.TunnelTypeRemote,
			BindAddr:   rule.BindAddress,
			BindPort:   rule.BindPort,
			RemoteHost: rule.Host,
			RemotePort: rule.HostPort,
			HostName:   hostName,
		},
		closer: listener,
	}
	globalTunnelRegistry.AddTunnel(hostKey, entry)

	localAddr := net.JoinHostPort(rule.Host, rule.HostPort)
	go func() {
		for {
			remoteConn, err := listener.Accept()
			if err != nil {
				// Listener was closed, stop accepting
				return
			}
			go func(rc net.Conn) {
				defer rc.Close()
				localConn, err := net.Dial("tcp", localAddr)
				if err != nil {
					log.Printf("[portforward] Failed to dial local %s: %v", localAddr, err)
					return
				}
				defer localConn.Close()
				go io.Copy(localConn, rc)
				io.Copy(rc, localConn)
			}(remoteConn)
		}
	}()

	return nil
}

// GetActiveTunnels returns all currently active port forwarding tunnels.
func GetActiveTunnels() []*models.ActiveTunnel {
	return globalTunnelRegistry.GetAllTunnels()
}
