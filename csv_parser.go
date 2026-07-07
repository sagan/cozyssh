package cozyssh

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
)

var knownOpenSSHDirectives = map[string]string{
	"identityfile":          "IdentityFile",
	"proxyjump":             "ProxyJump",
	"remotecommand":         "RemoteCommand",
	"addressfamily":         "AddressFamily",
	"userknownhostsfile":    "UserKnownHostsFile",
	"stricthostkeychecking": "StrictHostKeyChecking",
	"hostkeyalgorithms":     "HostKeyAlgorithms",
	"verifyhostkeydns":      "VerifyHostKeyDNS",
	"sendenv":               "SendEnv",
	"localforward":          "LocalForward",
	"remoteforward":         "RemoteForward",
	"dynamicforward":        "DynamicForward",
}

// ParseCSVToSSHConfig parses a CSV file from the reader and generates an OpenSSH config string.
func ParseCSVToSSHConfig(r io.Reader) (string, error) {
	reader := csv.NewReader(r)
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	header, err := reader.Read()
	if err != nil {
		return "", fmt.Errorf("failed to read CSV header: %w", err)
	}

	// Map headers to indices
	nameIdx := -1
	tagsIdx := -1
	hostIdx := -1
	portIdx := -1
	userIdx := -1
	passIdx := -1
	commentIdx := -1

	// Map column index to OpenSSH directive name
	directiveIndices := make(map[int]string)

	for i, h := range header {
		hLower := strings.ToLower(strings.TrimSpace(h))
		switch hLower {
		case "name", "title", "label":
			nameIdx = i
		case "tag", "tags":
			tagsIdx = i
		case "host", "hostname", "hostname/ip":
			hostIdx = i
		case "port":
			portIdx = i
		case "username", "user":
			userIdx = i
		case "password", "pass":
			passIdx = i
		case "comment", "note":
			commentIdx = i
		default:
			if canonicalName, exists := knownOpenSSHDirectives[hLower]; exists {
				directiveIndices[i] = canonicalName
			}
		}
	}

	if hostIdx == -1 {
		return "", fmt.Errorf("missing required hostname column (Host, Hostname, or Hostname/IP)")
	}

	var sb strings.Builder

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("failed to read CSV row: %w", err)
		}

		// Ensure the record has enough fields
		if len(record) <= hostIdx {
			continue
		}

		hostname := strings.TrimSpace(record[hostIdx])
		if hostname == "" {
			continue // Only the hostname column is required, skip if empty
		}

		name := hostname
		if nameIdx != -1 && nameIdx < len(record) {
			val := strings.TrimSpace(record[nameIdx])
			if val != "" {
				name = val
			}
		}

		var tags []string
		if tagsIdx != -1 && tagsIdx < len(record) {
			val := strings.TrimSpace(record[tagsIdx])
			if val != "" {
				// Split by comma, semicolon, or space
				rawTags := strings.FieldsFunc(val, func(c rune) bool {
					return c == ',' || c == ';' || c == ' '
				})
				for _, t := range rawTags {
					tTrimmed := strings.TrimSpace(t)
					if tTrimmed != "" {
						tags = append(tags, tTrimmed)
					}
				}
			}
		}

		port := ""
		if portIdx != -1 && portIdx < len(record) {
			port = strings.TrimSpace(record[portIdx])
		}

		user := ""
		if userIdx != -1 && userIdx < len(record) {
			user = strings.TrimSpace(record[userIdx])
		}

		password := ""
		if passIdx != -1 && passIdx < len(record) {
			password = strings.TrimSpace(record[passIdx])
		}

		comment := ""
		if commentIdx != -1 && commentIdx < len(record) {
			comment = strings.TrimSpace(record[commentIdx])
		}

		// Write comments
		if comment != "" {
			for _, line := range strings.Split(comment, "\n") {
				sb.WriteString(fmt.Sprintf("### %s\n", strings.TrimSpace(line)))
			}
		}

		// Write tags
		if len(tags) > 0 {
			var tagStrs []string
			for _, t := range tags {
				tagStrs = append(tagStrs, "#"+t)
			}
			sb.WriteString(fmt.Sprintf("### %s\n", strings.Join(tagStrs, " ")))
		}

		// Write Host
		sb.WriteString(fmt.Sprintf("Host %s\n", name))
		sb.WriteString(fmt.Sprintf("    HostName %s\n", hostname))
		if user != "" {
			sb.WriteString(fmt.Sprintf("    User %s\n", user))
		}
		if port != "" {
			sb.WriteString(fmt.Sprintf("    Port %s\n", port))
		}

		// Write any other matched OpenSSH directives
		for idx, dirName := range directiveIndices {
			if idx < len(record) {
				val := strings.TrimSpace(record[idx])
				if val != "" {
					sb.WriteString(fmt.Sprintf("    %s %s\n", dirName, val))
				}
			}
		}

		// Write password if present as a comment
		if password != "" {
			sb.WriteString(fmt.Sprintf("    # CozySshPassword %s\n", password))
		}

		sb.WriteString("\n")
	}

	return sb.String(), nil
}
