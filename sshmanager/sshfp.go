package sshmanager

import (
	"crypto/sha1" //nolint:gosec // SSHFP SHA-1 is specified by RFC 4255
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/miekg/dns"
	"golang.org/x/crypto/ssh"
)

const DEFAULT_DNS = "1.1.1.1:53"

var dnsResolver = DEFAULT_DNS

// Update dnsResolver.
// dnsResolver is the recursive resolver used for all SSHFP lookups.
// It MUST be a validating resolver (e.g. Cloudflare 1.1.1.1 / Google 8.8.8.8)
// so that we can rely on the AD (Authenticated Data) flag from DNSSEC.
// If addr is empty, it fallbacks to 1.1.1.1.
func UpdateDns(addr string) {
	if addr == "" {
		dnsResolver = DEFAULT_DNS
	} else if _, _, err := net.SplitHostPort(addr); err != nil { // addr is host only
		dnsResolver = addr + ":53"
	} else {
		dnsResolver = addr
	}
}

// sshfpAlgorithm maps ssh key-type strings to the SSHFP algorithm numbers
// defined in RFC 4255 / RFC 6594 / RFC 7479.
var sshfpAlgorithm = map[string]uint8{
	ssh.KeyAlgoRSA:       1,
	ssh.KeyAlgoDSA:       2,
	ssh.KeyAlgoECDSA256:  3,
	ssh.KeyAlgoECDSA384:  3,
	ssh.KeyAlgoECDSA521:  3,
	ssh.KeyAlgoED25519:   4,
	ssh.KeyAlgoRSASHA256: 1,
	ssh.KeyAlgoRSASHA512: 1,
}

// SSHFPVerifyResult is the outcome of a SSHFP lookup.
type SSHFPVerifyResult int

const (
	// SSHFPNoRecords means that no SSHFP records were found (or DNSSEC validation
	// failed / AD flag absent). Callers should fall back to normal host-key
	// checking.
	SSHFPNoRecords SSHFPVerifyResult = iota
	// SSHFPMatch means that at least one SSHFP record matched the presented key
	// and the response was DNSSEC-authenticated.
	SSHFPMatch
	// SSHFPMismatch means that SSHFP records were found with DNSSEC authentication
	// but none of them matched the presented key — strong indication of a MITM.
	SSHFPMismatch
)

// querySSHFP performs an authenticated DNS query (AD bit required) for SSHFP
// records of the given hostname and returns the raw SSHFP RRs together with
// whether the response was DNSSEC-authenticated.
//
// The function uses TCP-over-port-53 so that large DNS payloads are not
// silently truncated (SSHFP records can be numerous).
func querySSHFP(hostname string) (records []*dns.SSHFP, authenticated bool, err error) {
	// Ensure FQDN
	fqdn := dns.Fqdn(hostname)

	m := new(dns.Msg)
	m.SetQuestion(fqdn, dns.TypeSSHFP)
	// Request DNSSEC validation from the resolver.
	m.SetEdns0(4096, true) // DO bit
	m.CheckingDisabled = false
	// We want the AD bit set in the response, so request it explicitly.
	m.AuthenticatedData = true

	c := new(dns.Client)
	c.Net = "tcp" // avoid truncation
	c.Timeout = 5 * time.Second

	r, _, err := c.Exchange(m, dnsResolver)
	if err != nil {
		return nil, false, fmt.Errorf("SSHFP DNS query failed: %w", err)
	}
	if r.Rcode != dns.RcodeSuccess {
		return nil, false, fmt.Errorf("SSHFP DNS query returned rcode %d", r.Rcode)
	}

	authenticated = r.AuthenticatedData

	for _, rr := range r.Answer {
		if sshfp, ok := rr.(*dns.SSHFP); ok {
			records = append(records, sshfp)
		}
	}
	return records, authenticated, nil
}

// fingerprintSSHFP computes both the SHA-1 and SHA-256 hex fingerprints of an
// SSH public key in the format expected by SSHFP records (RFC 4255 §3.1).
func fingerprintSSHFP(key ssh.PublicKey) (sha1Hex, sha256Hex string) {
	raw := key.Marshal()
	//nolint:gosec // SHA-1 is mandated by RFC 4255 for SSHFP type 1
	h1 := sha1.Sum(raw)
	sha1Hex = strings.ToLower(hex.EncodeToString(h1[:]))
	h256 := sha256.Sum256(raw)
	sha256Hex = strings.ToLower(hex.EncodeToString(h256[:]))
	return
}

// VerifySSHFP checks whether the presented SSH public key is vouched for by
// DNSSEC-authenticated SSHFP records for the given hostname.
//
// Return values:
//   - SSHFPMatch      — found at least one matching, DNSSEC-authenticated record
//   - SSHFPMismatch   — records exist and are DNSSEC-authenticated but none match
//   - SSHFPNoRecords  — no usable SSHFP records (no records, or not DNSSEC-authenticated)
func VerifySSHFP(hostname string, key ssh.PublicKey) (SSHFPVerifyResult, error) {
	algo, known := sshfpAlgorithm[key.Type()]
	if !known {
		// Unknown key type — cannot verify; treat as no records.
		return SSHFPNoRecords, nil
	}

	sha1Fp, sha256Fp := fingerprintSSHFP(key)

	records, authenticated, err := querySSHFP(hostname)
	if err != nil {
		// DNS resolution failure — be lenient, don't block connection.
		return SSHFPNoRecords, err
	}
	if !authenticated {
		// No DNSSEC — OpenSSH treats this as "no records".
		return SSHFPNoRecords, nil
	}
	if len(records) == 0 {
		return SSHFPNoRecords, nil
	}

	// We have at least one SSHFP record with the AD flag set.
	// Check whether any of them match our key.
	for _, rr := range records {
		if rr.Algorithm != algo {
			continue
		}
		fp := strings.ToLower(rr.FingerPrint)
		switch rr.Type {
		case 1: // SHA-1
			if fp == sha1Fp {
				return SSHFPMatch, nil
			}
		case 2: // SHA-256
			if fp == sha256Fp {
				return SSHFPMatch, nil
			}
		}
	}

	// Records exist for this algorithm but none matched — this is a red flag.
	return SSHFPMismatch, nil
}
