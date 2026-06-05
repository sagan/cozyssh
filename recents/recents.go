package recents

import (
	"cozyssh/common"
	"cozyssh/constants"
	"cozyssh/models"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	recents   []*models.Recent
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
			recents = []*models.Recent{}
			return nil
		}
		return err
	}

	return json.Unmarshal(data, &recents)
}

func Save() error {
	recentsMu.Lock()
	defer recentsMu.Unlock()

	return common.AtomicWriteFile(filePath, func(w io.Writer) error {
		return json.NewEncoder(w).Encode(recents)
	})
}

func Add(host string) {
	if host == constants.LOCAL_NAME || host == "" {
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
		recents = append(recents, &models.Recent{Host: host, LastUsed: now})
	}

	// Keep only top 50 recents
	// Sort by last used (newest first)
	// We'll sort before saving or returning for simplicity
}

func Get() []*models.Recent {
	recentsMu.Lock()
	defer recentsMu.Unlock()

	// Return a copy
	res := make([]*models.Recent, len(recents))
	copy(res, recents)
	return res
}
