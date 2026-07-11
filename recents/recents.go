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

func save() error {
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
	save()
}

func Get() []*models.Recent {
	recentsMu.Lock()
	defer recentsMu.Unlock()

	// Return a copy
	res := make([]*models.Recent, len(recents))
	for i, recent := range recents {
		recentCopy := *recent
		res[i] = &recentCopy
	}
	return res
}

// Delete removes the entry with the given host from recents.
// Returns true if an entry was found and removed.
func Delete(host string) bool {
	recentsMu.Lock()
	defer recentsMu.Unlock()

	for i, r := range recents {
		if r.Host == host {
			recents = append(recents[:i], recents[i+1:]...)
			save()
			return true
		}
	}
	return false
}
