package sshmanager

import (
	"context"
	"cozyssh/models"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"

	socks5 "github.com/things-go/go-socks5"
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

// DynamicForwardRule represents a parsed DynamicForward rule following OpenSSH syntax.
// DynamicForward: [bind_address:]port
type DynamicForwardRule struct {
	BindAddress string // e.g. "localhost", "0.0.0.0"
	BindPort    string // e.g. "1080"
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
	result := []*models.ActiveTunnel{}
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

// ParseDynamicForwardRule parses an OpenSSH-style DynamicForward rule.
// Accepted formats:
//   - "port"               → bind=localhost, port=port
//   - "bind_address:port"  → bind=bind_address, port=port
//   - "*:port"             → bind=0.0.0.0, port=port
func ParseDynamicForwardRule(rule string) (*DynamicForwardRule, error) {
	rule = strings.TrimSpace(rule)
	if rule == "" {
		return nil, fmt.Errorf("empty dynamic forwarding rule")
	}

	bindAddr := "localhost"
	bindPort := rule
	if i := strings.LastIndex(rule, ":"); i != -1 {
		bindAddr = rule[:i]
		bindPort = rule[i+1:]
	}
	if bindAddr == "*" {
		bindAddr = "0.0.0.0"
	}
	if bindAddr == "" {
		bindAddr = "localhost"
	}
	if bindPort == "" {
		return nil, fmt.Errorf("invalid dynamic forwarding rule %q: missing port", rule)
	}

	return &DynamicForwardRule{
		BindAddress: bindAddr,
		BindPort:    bindPort,
	}, nil
}

// ParseDynamicForwardRules parses multiple DynamicForward rules (one per line).
func ParseDynamicForwardRules(rules string) ([]*DynamicForwardRule, []error) {
	var parsed []*DynamicForwardRule
	var errs []error
	for line := range strings.SplitSeq(rules, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		rule, err := ParseDynamicForwardRule(line)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		parsed = append(parsed, rule)
	}
	return parsed, errs
}

// sshDialer is a custom socks5 dialer that routes all connections through the SSH client.
type sshDialer struct {
	client *ssh.Client
}

func (d *sshDialer) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	return d.client.Dial(network, addr)
}

// startDynamicForward starts a local SOCKS5 proxy server that tunnels all traffic
// through the SSH connection. This is equivalent to OpenSSH's DynamicForward directive.
func startDynamicForward(client *ssh.Client, hostKey string, hostName string, rule *DynamicForwardRule) error {
	listenAddr := net.JoinHostPort(rule.BindAddress, rule.BindPort)
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s for SOCKS5: %w", listenAddr, err)
	}

	entry := &activeTunnelEntry{
		info: &models.ActiveTunnel{
			Type:     models.TunnelTypeDynamic,
			BindAddr: rule.BindAddress,
			BindPort: rule.BindPort,
			HostName: hostName,
		},
		closer: listener,
	}
	globalTunnelRegistry.AddTunnel(hostKey, entry)

	// Build SOCKS5 server with our custom SSH dialer so all traffic goes through SSH
	srv := socks5.NewServer(
		socks5.WithDial((&sshDialer{client: client}).DialContext),
	)

	go func() {
		// Serve accepts connections until listener is closed
		srv.Serve(listener)
	}()

	return nil
}

// SetupPortForwarding sets up port forwarding tunnels on the given SSH client.
// It only sets up forwarding if this is the first connection to the host (no tunnels exist yet).
// Errors are logged but not returned as fatal.
// Returns a cleanup function that should be called when the SSH connection is closed.
func SetupPortForwarding(client *ssh.Client, hostName string, hostKey string,
	localForwards string, remoteForwards string, dynamicForwards string) func() {

	if localForwards == "" && remoteForwards == "" && dynamicForwards == "" {
		return func() {}
	}

	// Only apply port forwarding on the first SSH connection to this host
	if globalTunnelRegistry.HasTunnels(hostKey) {
		return func() {}
	}

	// Parse local forwards
	localRules, _ := ParseForwardRules(localForwards)

	// Parse remote forwards
	remoteRules, _ := ParseForwardRules(remoteForwards)

	// Parse dynamic forwards
	dynamicRules, _ := ParseDynamicForwardRules(dynamicForwards)

	// Set up local forwards
	for _, rule := range localRules {
		startLocalForward(client, hostKey, hostName, rule)
	}

	// Set up remote forwards
	for _, rule := range remoteRules {
		startRemoteForward(client, hostKey, hostName, rule)
	}

	// Set up dynamic (SOCKS5) forwards
	for _, rule := range dynamicRules {
		startDynamicForward(client, hostKey, hostName, rule)
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
