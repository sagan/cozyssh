package recents

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Recent struct {
	Host     string `json:"host"`
	LastUsed int64  `json:"last_used"`
}

var (
	recents   []Recent
	recentsMu sync.Mutex
	filePath  string
)

func Init(configDir string) error {
	filePath = filepath.Join(configDir, "recents.json")
	return load()
}

func load() error {
	recentsMu.Lock()
	defer recentsMu.Unlock()

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			recents = []Recent{}
			return nil
		}
		return err
	}

	return json.Unmarshal(data, &recents)
}

func Save() error {
	recentsMu.Lock()
	defer recentsMu.Unlock()

	data, err := json.MarshalIndent(recents, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filePath, data, 0600)
}

func Add(host string) {
	if host == "local" || host == "" {
		return
	}

	recentsMu.Lock()
	defer recentsMu.Unlock()

	now := time.Now().Unix()
	found := false
	for i, r := range recents {
		if r.Host == host {
			recents[i].LastUsed = now
			found = true
			break
		}
	}

	if !found {
		recents = append(recents, Recent{Host: host, LastUsed: now})
	}

	// Keep only top 50 recents
	// Sort by last used (newest first)
	// We'll sort before saving or returning for simplicity
}

func Get() []Recent {
	recentsMu.Lock()
	defer recentsMu.Unlock()

	// Return a copy
	res := make([]Recent, len(recents))
	copy(res, recents)
	return res
}
