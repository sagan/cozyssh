package datasync

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"maps"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"cozyssh/common"
	"cozyssh/config"
	"cozyssh/constants"
	"cozyssh/models"
	"cozyssh/scratchpad"

	"filippo.io/xaes256gcm"
	"golang.org/x/crypto/hkdf"
)

const ROOT_DIR = "cozyssh"
const FLAG_FILE = "encryption.flag"
const FLAG_PLAINTEXT = "CZSSH_E2EE_OK"

var (
	syncDebounceTime       = 10 * time.Second
	deleteMarkerFileMaxAge = 30 * 24 * time.Hour

	gCfg     *config.Config
	meta     syncMetadata
	metaMu   sync.Mutex
	syncMu   sync.Mutex
	statusMu sync.Mutex

	// Sync Status Variables
	syncStatus = "idle"
	syncError  = ""
	syncTime   int64

	syncTimer   *time.Timer
	syncTimerMu sync.Mutex
	syncHook    func()
	hrefRegex   = regexp.MustCompile(`(?i)<[A-Za-z0-9:]*href>([^<]+)</[A-Za-z0-9:]*href>`)
)

type syncMetadata struct {
	DeletedButtons map[string]int64 `json:"deleted_buttons"`
	DeletedPages   map[string]int64 `json:"deleted_pages"`
}

type remoteFileInfo struct {
	filename    string
	itemType    string // "button" or "scratchpad"
	id          string
	timestamp   int64
	isDeleted   bool
	isEncrypted bool
}

func Init(cfg *config.Config) {
	gCfg = cfg
	loadMetadata()

	// Register callbacks
	config.OnButtonDelete = OnButtonDelete
	config.OnButtonUpdate = TriggerSync
	config.OnVarsUpdate = TriggerSync
	scratchpad.OnPageDelete = OnPageDelete
	scratchpad.OnPageUpdate = TriggerSync

	// Trigger initial sync
	if gCfg.WebdavEnabled {
		TriggerSync()
	}

	// Periodic sync loop (5 minutes)
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			if gCfg.WebdavEnabled {
				Sync(false)
			}
		}
	}()
}

func TriggerSync() {
	syncTimerMu.Lock()
	defer syncTimerMu.Unlock()

	if syncTimer != nil {
		syncTimer.Stop()
	}
	syncTimer = time.AfterFunc(syncDebounceTime, func() {
		Sync(false)
	})
}

// Sync data to/from WebDAV. It returns with an error immediately if sync is already in process,
// unless force is true, in which case it will wait for the current sync to complete and then do another sync.
func Sync(force bool) error {
	if syncHook != nil {
		syncHook()
	}
	if force {
		syncMu.Lock()
	} else {
		if !syncMu.TryLock() {
			return fmt.Errorf("sync already in progress")
		}
	}
	defer syncMu.Unlock()

	if gCfg == nil || !gCfg.WebdavEnabled || gCfg.WebdavUrl == "" {
		return nil
	}

	setStatus("syncing", "")

	err := performSync()
	if err != nil {
		setStatus("error", err.Error())
		return err
	}

	setStatus("success", "")
	return nil
}

func setStatus(status, errMsg string) {
	statusMu.Lock()
	defer statusMu.Unlock()
	syncStatus = status
	syncError = errMsg
	syncTime = time.Now().UnixMilli()
}

func GetStatus() (string, string, int64) {
	if gCfg == nil || !gCfg.WebdavEnabled {
		return "disabled", "", 0
	}
	statusMu.Lock()
	defer statusMu.Unlock()
	return syncStatus, syncError, syncTime
}

func loadMetadata() {
	meta.DeletedButtons = make(map[string]int64)
	meta.DeletedPages = make(map[string]int64)
	if gCfg == nil {
		return
	}
	path := filepath.Join(gCfg.ConfigDir, constants.SYNC_METADATA_FILE)
	data, err := os.ReadFile(path)
	if err == nil {
		json.Unmarshal(data, &meta)
	}
	if meta.DeletedButtons == nil {
		meta.DeletedButtons = make(map[string]int64)
	}
	if meta.DeletedPages == nil {
		meta.DeletedPages = make(map[string]int64)
	}
}

func saveMetadata() {
	if gCfg == nil {
		return
	}
	path := filepath.Join(gCfg.ConfigDir, constants.SYNC_METADATA_FILE)
	common.AtomicWriteFile(path, func(writer io.Writer) error {
		return json.NewEncoder(writer).Encode(meta)
	})
}

func OnButtonDelete(id string, timestamp int64) {
	metaMu.Lock()
	meta.DeletedButtons[id] = timestamp
	saveMetadata()
	metaMu.Unlock()
}

func OnPageDelete(id string, timestamp int64) {
	metaMu.Lock()
	meta.DeletedPages[id] = timestamp
	saveMetadata()
	metaMu.Unlock()
}

func cleanDeletedMaps() {
	metaMu.Lock()
	defer metaMu.Unlock()

	changed := false
	nowMs := time.Now().UnixMilli()
	maxAgeMs := deleteMarkerFileMaxAge.Milliseconds()

	// Clean active buttons from deleted list, and also clean old deletions (>30 days)
	activeBtns := make(map[string]bool)
	for _, b := range gCfg.GetButtons() {
		activeBtns[b.Id] = true
	}
	for id, ts := range meta.DeletedButtons {
		if activeBtns[id] || (nowMs-ts) > maxAgeMs {
			delete(meta.DeletedButtons, id)
			changed = true
		}
	}

	// Clean active pages from deleted list, and also clean old deletions (>30 days)
	activePages := make(map[string]bool)
	for _, p := range scratchpad.GetPages() {
		activePages[p.Id] = true
	}
	for id, ts := range meta.DeletedPages {
		if activePages[id] || (nowMs-ts) > maxAgeMs {
			delete(meta.DeletedPages, id)
			changed = true
		}
	}

	if changed {
		saveMetadata()
	}
}

func makeRequest(method, urlStr string, body io.Reader, cfg *config.Config) (*http.Response, error) {
	req, err := http.NewRequest(method, urlStr, body)
	if err != nil {
		return nil, err
	}
	if cfg.WebdavUser != "" || cfg.WebdavPassword != "" {
		req.SetBasicAuth(cfg.WebdavUser, cfg.WebdavPassword)
	}
	if method == "PROPFIND" {
		req.Header.Set("Depth", "1")
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	return client.Do(req)
}

func ensureWebdavDir(cfg *config.Config) error {
	davUrl := strings.TrimRight(cfg.WebdavUrl, "/") + "/" + ROOT_DIR
	resp, err := makeRequest("MKCOL", davUrl, nil, cfg)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusMethodNotAllowed && resp.StatusCode != http.StatusConflict {
		return fmt.Errorf("MKCOL returned status %d", resp.StatusCode)
	}
	return nil
}

func listRemoteFiles(cfg *config.Config) ([]remoteFileInfo, bool, error) {
	davUrl := strings.TrimRight(cfg.WebdavUrl, "/") + "/" + ROOT_DIR + "/"
	resp, err := makeRequest("PROPFIND", davUrl, nil, cfg)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != 207 {
		return nil, false, fmt.Errorf("PROPFIND returned status %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, false, err
	}

	matches := hrefRegex.FindAllStringSubmatch(string(bodyBytes), -1)
	var files []remoteFileInfo
	isEncrypted := cfg.WebdavEncryptionEnabled
	var hasEncryptionFlag bool
	for _, m := range matches {
		rawHref := m[1]
		decodedHref, err := url.PathUnescape(rawHref)
		if err != nil {
			decodedHref = rawHref
		}
		filename := path.Base(decodedHref)
		if filename == FLAG_FILE {
			hasEncryptionFlag = true
			continue
		}

		// SSH files use .txt (plaintext) or .bin (encrypted), others use .json/.bin
		isSshFile := strings.HasPrefix(filename, "sshconfig_") || strings.HasPrefix(filename, "knownhosts_")
		var suffix string
		if isSshFile {
			if isEncrypted && strings.HasSuffix(filename, ".bin") {
				suffix = ".bin"
			} else if !isEncrypted && strings.HasSuffix(filename, ".txt") {
				suffix = ".txt"
			} else {
				continue
			}
		} else {
			if isEncrypted && strings.HasSuffix(filename, ".bin") {
				suffix = ".bin"
			} else if !isEncrypted && strings.HasSuffix(filename, ".json") {
				suffix = ".json"
			} else {
				continue
			}
		}

		var itemType string
		var rawName string
		if strings.HasPrefix(filename, "button_") {
			itemType = "button"
			rawName = filename[len("button_"):]
		} else if strings.HasPrefix(filename, "scratchpad_") {
			itemType = "scratchpad"
			rawName = filename[len("scratchpad_"):]
		} else if strings.HasPrefix(filename, "vars_") {
			itemType = "vars"
			rawName = filename[len("vars_"):]
		} else if strings.HasPrefix(filename, "config_") {
			itemType = "vars"
			rawName = filename[len("config_"):]
		} else if strings.HasPrefix(filename, "sshconfig_") {
			itemType = "sshconfig"
			rawName = filename[len("sshconfig_"):]
		} else if strings.HasPrefix(filename, "knownhosts_") {
			itemType = "knownhosts"
			rawName = filename[len("knownhosts_"):]
		} else {
			continue
		}

		nameWithoutExt := rawName[:len(rawName)-len(suffix)]
		isDeleted := false
		if strings.HasSuffix(nameWithoutExt, "_d") {
			isDeleted = true
			nameWithoutExt = nameWithoutExt[:len(nameWithoutExt)-2]
		}

		var id string
		var timestamp int64
		if itemType == "vars" {
			id = "global"
			ts, err := strconv.ParseInt(nameWithoutExt, 10, 64)
			if err != nil {
				continue
			}
			timestamp = ts
		} else if itemType == "sshconfig" || itemType == "knownhosts" {
			// Format: <device-name>_<timestamp>
			// device-name itself may contain underscores, so we split on last underscore
			lastUnderscore := strings.LastIndex(nameWithoutExt, "_")
			if lastUnderscore == -1 {
				continue
			}
			id = nameWithoutExt[:lastUnderscore] // device name
			tsStr := nameWithoutExt[lastUnderscore+1:]
			ts, err := strconv.ParseInt(tsStr, 10, 64)
			if err != nil {
				continue
			}
			timestamp = ts
		} else {
			lastUnderscore := strings.LastIndex(nameWithoutExt, "_")
			if lastUnderscore == -1 {
				continue
			}
			id = nameWithoutExt[:lastUnderscore]
			tsStr := nameWithoutExt[lastUnderscore+1:]
			ts, err := strconv.ParseInt(tsStr, 10, 64)
			if err != nil {
				continue
			}
			timestamp = ts
		}

		files = append(files, remoteFileInfo{
			filename:    filename,
			itemType:    itemType,
			id:          id,
			timestamp:   timestamp,
			isDeleted:   isDeleted,
			isEncrypted: isEncrypted,
		})
	}

	return files, hasEncryptionFlag, nil
}

func performSync() error {
	if err := ensureWebdavDir(gCfg); err != nil {
		return fmt.Errorf("failed to ensure WebDAV directory: %w", err)
	}

	var dek []byte
	if gCfg.WebdavEncryptionEnabled {
		if gCfg.WebdavMasterKey == "" {
			return fmt.Errorf("webdav master key is missing")
		}
		masterKey, err := base64.StdEncoding.DecodeString(gCfg.WebdavMasterKey)
		if err != nil || len(masterKey) != 32 {
			return fmt.Errorf("invalid webdav master key")
		}
		dek, err = deriveDEK(masterKey)
		if err != nil {
			return fmt.Errorf("failed to derive DEK: %w", err)
		}
	}

	cleanDeletedMaps()

	remoteFiles, _, err := listRemoteFiles(gCfg)
	if err != nil {
		return fmt.Errorf("failed to list WebDAV files: %w", err)
	}

	var remoteFilesToDelete []string
	nowMs := time.Now().UnixMilli()
	maxAgeMs := (30 * 24 * time.Hour).Milliseconds()

	remoteButtons := make(map[string][]remoteFileInfo)
	remotePages := make(map[string][]remoteFileInfo)
	var remoteVarsFiles []remoteFileInfo
	for _, f := range remoteFiles {
		if f.isDeleted && (nowMs-f.timestamp) > maxAgeMs {
			remoteFilesToDelete = append(remoteFilesToDelete, f.filename)
			continue
		}
		switch f.itemType {
		case "button":
			remoteButtons[f.id] = append(remoteButtons[f.id], f)
		case "scratchpad":
			remotePages[f.id] = append(remotePages[f.id], f)
		case "vars":
			remoteVarsFiles = append(remoteVarsFiles, f)
		}
	}

	localButtons := make(map[string]*models.ButtonData)
	for _, b := range gCfg.GetButtons() {
		localButtons[b.Id] = b
	}

	localPages := make(map[string]*models.ScratchpadPage)
	for _, p := range scratchpad.GetPages() {
		localPages[p.Id] = p
	}

	metaMu.Lock()
	deletedButtons := make(map[string]int64)
	for k, v := range meta.DeletedButtons {
		deletedButtons[k] = v
	}
	deletedPages := make(map[string]int64)
	maps.Copy(deletedPages, meta.DeletedPages)
	metaMu.Unlock()

	var buttonsToUpsert []*models.ButtonData
	var pagesToUpsert []*models.ScratchpadPage

	davBaseUrl := strings.TrimRight(gCfg.WebdavUrl, "/") + "/" + ROOT_DIR + "/"

	// Sync Buttons
	buttonIDs := make(map[string]bool)
	for id := range localButtons {
		buttonIDs[id] = true
	}
	for id := range deletedButtons {
		buttonIDs[id] = true
	}
	for id := range remoteButtons {
		buttonIDs[id] = true
	}

	for id := range buttonIDs {
		var localTS int64 = -1
		localActive := false
		localDeleted := false
		if b, ok := localButtons[id]; ok {
			localTS = b.Mtime
			localActive = true
		} else if ts, ok := deletedButtons[id]; ok {
			localTS = ts
			localDeleted = true
		}

		var remoteTS int64 = -1
		remoteActive := false
		remoteDeleted := false
		var remoteWinner remoteFileInfo
		if rFiles, ok := remoteButtons[id]; ok {
			for _, rf := range rFiles {
				if rf.timestamp > remoteTS {
					remoteTS = rf.timestamp
					remoteActive = !rf.isDeleted
					remoteDeleted = rf.isDeleted
					remoteWinner = rf
				}
				remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
			}
		}

		if localTS > remoteTS {
			if localActive {
				b := localButtons[id]
				data, err := json.Marshal(b)
				if err != nil {
					return err
				}
				var ext string = ".json"
				if gCfg.WebdavEncryptionEnabled {
					ext = ".bin"
					data, err = encryptData(data, dek)
					if err != nil {
						return err
					}
				}
				filename := fmt.Sprintf("button_%s_%d%s", id, localTS, ext)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader(data), gCfg)
				if err != nil {
					return err
				}
				resp.Body.Close()
			} else if localDeleted {
				var ext string = ".json"
				var data []byte = []byte("{}")
				if gCfg.WebdavEncryptionEnabled {
					ext = ".bin"
					payload := map[string]interface{}{
						"id":        id,
						"mtime":     strconv.FormatInt(localTS, 10),
						"$deleted$": true,
					}
					payloadBytes, err := json.Marshal(payload)
					if err != nil {
						return err
					}
					data, err = encryptData(payloadBytes, dek)
					if err != nil {
						return err
					}
				}
				filename := fmt.Sprintf("button_%s_%d_d%s", id, localTS, ext)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader(data), gCfg)
				if err != nil {
					return err
				}
				resp.Body.Close()
			}
		} else if remoteTS > localTS {
			if remoteActive {
				b, err := downloadAndDecryptButton(remoteWinner.filename, remoteWinner.isEncrypted, id, remoteTS, dek)
				if err != nil {
					return err
				}
				if b != nil {
					buttonsToUpsert = append(buttonsToUpsert, b)
				}
			} else if remoteDeleted {
				if remoteWinner.isEncrypted {
					resp, err := makeRequest("GET", davBaseUrl+remoteWinner.filename, nil, gCfg)
					if err != nil {
						return err
					}
					defer resp.Body.Close()
					if resp.StatusCode != http.StatusOK {
						return fmt.Errorf("GET returned status %d", resp.StatusCode)
					}
					bodyBytes, err := io.ReadAll(resp.Body)
					if err != nil {
						return err
					}
					decrypted, err := decryptData(bodyBytes, dek)
					if err != nil {
						return fmt.Errorf("failed to decrypt deletion marker: %w", err)
					}
					var marker struct {
						Id      string      `json:"id"`
						Mtime   interface{} `json:"mtime"`
						Deleted bool        `json:"$deleted$"`
					}
					if err := json.Unmarshal(decrypted, &marker); err != nil {
						return fmt.Errorf("failed to unmarshal deletion marker: %w", err)
					}
					var mtimeVal int64
					switch v := marker.Mtime.(type) {
					case float64:
						mtimeVal = int64(v)
					case int64:
						mtimeVal = v
					case string:
						mtimeVal, _ = strconv.ParseInt(v, 10, 64)
					}
					if marker.Id != id || mtimeVal != remoteWinner.timestamp || !marker.Deleted {
						return fmt.Errorf("decrypted deletion marker mismatch: got id=%s mtime=%d deleted=%t, expected id=%s timestamp=%d", marker.Id, mtimeVal, marker.Deleted, id, remoteWinner.timestamp)
					}
				}

				buttonsToUpsert = append(buttonsToUpsert, &models.ButtonData{
					Id:    constants.ID_DELETE_PREFIX + id,
					Mtime: remoteTS,
				})
				metaMu.Lock()
				meta.DeletedButtons[id] = remoteTS
				saveMetadata()
				metaMu.Unlock()
			}
			remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
		} else {
			if remoteTS >= 0 {
				remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
			}
		}
	}

	// Sync Scratchpad Pages
	pageIDs := make(map[string]bool)
	for id := range localPages {
		pageIDs[id] = true
	}
	for id := range deletedPages {
		pageIDs[id] = true
	}
	for id := range remotePages {
		pageIDs[id] = true
	}

	for id := range pageIDs {
		var localTS int64 = -1
		localActive := false
		localDeleted := false
		if p, ok := localPages[id]; ok {
			localTS = p.LastUpdated
			localActive = true
		} else if ts, ok := deletedPages[id]; ok {
			localTS = ts
			localDeleted = true
		}

		var remoteTS int64 = -1
		remoteActive := false
		remoteDeleted := false
		var remoteWinner remoteFileInfo
		if rFiles, ok := remotePages[id]; ok {
			for _, rf := range rFiles {
				if rf.timestamp > remoteTS {
					remoteTS = rf.timestamp
					remoteActive = !rf.isDeleted
					remoteDeleted = rf.isDeleted
					remoteWinner = rf
				}
				remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
			}
		}

		if localTS > remoteTS {
			if localActive {
				p := localPages[id]
				data, err := json.Marshal(p)
				if err != nil {
					return err
				}
				var ext string = ".json"
				if gCfg.WebdavEncryptionEnabled {
					ext = ".bin"
					data, err = encryptData(data, dek)
					if err != nil {
						return err
					}
				}
				filename := fmt.Sprintf("scratchpad_%s_%d%s", id, localTS, ext)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader(data), gCfg)
				if err != nil {
					return err
				}
				resp.Body.Close()
			} else if localDeleted {
				var ext string = ".json"
				var data []byte = []byte("{}")
				if gCfg.WebdavEncryptionEnabled {
					ext = ".bin"
					data, err = encryptData([]byte("{}"), dek)
					if err != nil {
						return err
					}
				}
				filename := fmt.Sprintf("scratchpad_%s_%d_d%s", id, localTS, ext)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader(data), gCfg)
				if err != nil {
					return err
				}
				resp.Body.Close()
			}
		} else if remoteTS > localTS {
			if remoteActive {
				p, err := downloadAndDecryptPage(remoteWinner.filename, remoteWinner.isEncrypted, dek)
				if err != nil {
					return err
				}
				if p != nil {
					pagesToUpsert = append(pagesToUpsert, p)
				}
			} else if remoteDeleted {
				pagesToUpsert = append(pagesToUpsert, &models.ScratchpadPage{
					Id:          constants.ID_DELETE_PREFIX + id,
					LastUpdated: remoteTS,
				})
				metaMu.Lock()
				meta.DeletedPages[id] = remoteTS
				saveMetadata()
				metaMu.Unlock()
			}
			remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
		} else {
			if remoteTS >= 0 {
				remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
			}
		}
	}

	// Sync Vars
	{
		localVars := gCfg.GetVars()
		localMtime := gCfg.GetVarsMtime()

		var remoteVars map[string]string
		var remoteMtime map[string]int64
		var remoteWinner remoteFileInfo
		remoteWinnerLoaded := false

		var remoteTS int64 = -1
		for _, rf := range remoteVarsFiles {
			if rf.timestamp > remoteTS {
				remoteTS = rf.timestamp
				remoteWinner = rf
			}
		}

		if remoteTS > 0 {
			resp, err := makeRequest("GET", davBaseUrl+remoteWinner.filename, nil, gCfg)
			if err == nil {
				defer resp.Body.Close()
				bodyBytes, readErr := io.ReadAll(resp.Body)
				if readErr == nil {
					if remoteWinner.isEncrypted {
						var err error
						bodyBytes, err = decryptData(bodyBytes, dek)
						if err != nil {
							log.Printf("sync decrypt vars err: %v", err)
							bodyBytes = nil
						}
					}
					if bodyBytes != nil {
						var raw struct {
							Mtime json.RawMessage   `json:"mtime"`
							Vars  map[string]string `json:"vars"`
						}
						if json.Unmarshal(bodyBytes, &raw) == nil {
							remoteVars = raw.Vars
							remoteMtime = make(map[string]int64)
							if len(raw.Mtime) > 0 {
								var mtimeMap map[string]int64
								if json.Unmarshal(raw.Mtime, &mtimeMap) == nil {
									remoteMtime = mtimeMap
								} else {
									var mtimeVal int64
									if json.Unmarshal(raw.Mtime, &mtimeVal) == nil {
										for k := range remoteVars {
											remoteMtime[k] = mtimeVal
										}
									}
								}
							}
							remoteWinnerLoaded = true
						}
					}
				}
			}
		}

		if remoteVars == nil {
			remoteVars = make(map[string]string)
		}
		if remoteMtime == nil {
			remoteMtime = make(map[string]int64)
		}

		// Merge local and remote
		mergedVars := make(map[string]string)
		mergedMtime := make(map[string]int64)

		allKeys := make(map[string]bool)
		for k := range localMtime {
			allKeys[k] = true
		}
		for k := range remoteMtime {
			allKeys[k] = true
		}

		for k := range allKeys {
			lTS := localMtime[k]
			rTS := remoteMtime[k]

			if rTS > lTS {
				mergedMtime[k] = rTS
				if val, exists := remoteVars[k]; exists {
					mergedVars[k] = val
				}
			} else {
				mergedMtime[k] = lTS
				if val, exists := localVars[k]; exists {
					mergedVars[k] = val
				}
			}
		}

		// Clean up old deletion markers from mergedMtime
		now := time.Now().UnixMilli()
		maxAgeMs := (30 * 24 * time.Hour).Milliseconds()
		for k, ts := range mergedMtime {
			if _, exists := mergedVars[k]; !exists {
				if (now - ts) > maxAgeMs {
					delete(mergedMtime, k)
				}
			}
		}

		// Update local vars if local is different from merged
		localDiffers := false
		if len(localVars) != len(mergedVars) || len(localMtime) != len(mergedMtime) {
			localDiffers = true
		} else {
			for k, v := range mergedVars {
				if lv, ok := localVars[k]; !ok || lv != v {
					localDiffers = true
					break
				}
			}
			if !localDiffers {
				for k, ts := range mergedMtime {
					if lts, ok := localMtime[k]; !ok || lts != ts {
						localDiffers = true
						break
					}
				}
			}
		}

		if localDiffers {
			if err := gCfg.SetVars(mergedVars, mergedMtime); err != nil {
				log.Printf("sync set vars err: %v", err)
			}
		}

		// Check if merged is different from remote winner, and upload if needed
		remoteDiffers := false
		if !remoteWinnerLoaded {
			if len(mergedMtime) > 0 {
				remoteDiffers = true
			}
		} else {
			if len(remoteVars) != len(mergedVars) || len(remoteMtime) != len(mergedMtime) {
				remoteDiffers = true
			} else {
				for k, v := range mergedVars {
					if rv, ok := remoteVars[k]; !ok || rv != v {
						remoteDiffers = true
						break
					}
				}
				if !remoteDiffers {
					for k, ts := range mergedMtime {
						if rts, ok := remoteMtime[k]; !ok || rts != ts {
							remoteDiffers = true
							break
						}
					}
				}
			}
		}

		if remoteDiffers {
			var maxTS int64 = -1
			for _, ts := range mergedMtime {
				if ts > maxTS {
					maxTS = ts
				}
			}
			if maxTS <= 0 {
				maxTS = now
			}

			var varsWrap struct {
				Mtime map[string]int64  `json:"mtime"`
				Vars  map[string]string `json:"vars"`
			}
			varsWrap.Mtime = mergedMtime
			varsWrap.Vars = mergedVars

			data, err := json.Marshal(varsWrap)
			if err != nil {
				return err
			}

			var ext string = ".json"
			if gCfg.WebdavEncryptionEnabled {
				ext = ".bin"
				data, err = encryptData(data, dek)
				if err != nil {
					return err
				}
			}

			filename := fmt.Sprintf("config_%d%s", maxTS, ext)
			resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader(data), gCfg)
			if err != nil {
				return err
			}
			resp.Body.Close()

			for _, rf := range remoteVarsFiles {
				remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
			}
		} else {
			for _, rf := range remoteVarsFiles {
				if !remoteWinnerLoaded || rf.filename != remoteWinner.filename {
					remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
				}
			}
		}
	}

	if len(buttonsToUpsert) > 0 {
		err := gCfg.UpsertButtons(buttonsToUpsert, true)
		if err != nil {
			log.Printf("sync upsert buttons err: %v", err)
		}
	}

	if len(pagesToUpsert) > 0 {
		scratchpad.UpsertPages(pagesToUpsert, true)
		scratchpad.Reload()
	}

	for _, f := range remoteFilesToDelete {
		resp, err := makeRequest("DELETE", davBaseUrl+f, nil, gCfg)
		if err == nil {
			resp.Body.Close()
		}
	}

	// Sync SSH data
	if err := syncSSHData(remoteFiles, davBaseUrl, dek); err != nil {
		log.Printf("ssh data sync err: %v", err)
	}

	return nil
}

func removeFromStringSlice(slice []string, val string) []string {
	var result []string
	for _, item := range slice {
		if item != val {
			result = append(result, item)
		}
	}
	return result
}

// getDeviceName returns the device name used in WebDAV SSH filenames.
func getDeviceName(cfg *config.Config) string {
	if cfg.Sitename != "" {
		return cfg.Sitename
	}
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		return "unknown"
	}
	return hostname
}

// syncSSHData uploads own SSH files and downloads other devices' SSH files.
func syncSSHData(remoteFiles []remoteFileInfo, davBaseUrl string, dek []byte) error {
	deviceName := getDeviceName(gCfg)
	ext := ".txt"
	if gCfg.WebdavEncryptionEnabled {
		ext = ".bin"
	}

	// --- Upload own SSH files if mtime changed ---
	sshFiles := map[string]string{
		"sshconfig":  filepath.Join(gCfg.AbsSSHDir, "config"),
		"knownhosts": filepath.Join(gCfg.AbsSSHDir, "known_hosts"),
	}

	// Find our own remote files grouped by type
	ownRemote := map[string][]remoteFileInfo{}
	otherRemote := map[string]map[string]remoteFileInfo{} // type -> deviceName -> best file
	for _, rf := range remoteFiles {
		if rf.itemType != "sshconfig" && rf.itemType != "knownhosts" {
			continue
		}
		if rf.id == deviceName {
			ownRemote[rf.itemType] = append(ownRemote[rf.itemType], rf)
		} else {
			if otherRemote[rf.itemType] == nil {
				otherRemote[rf.itemType] = map[string]remoteFileInfo{}
			}
			if existing, ok := otherRemote[rf.itemType][rf.id]; !ok || rf.timestamp > existing.timestamp {
				otherRemote[rf.itemType][rf.id] = rf
			}
		}
	}

	if gCfg.WebdavUploadSSHData {
		for itemType, localPath := range sshFiles {
			info, err := os.Stat(localPath)
			if err != nil {
				continue // file doesn't exist, skip
			}
			localMtime := info.ModTime().UnixMilli()

			// Find the highest own timestamp on remote
			var remoteMtime int64 = -1
			var ownFiles []remoteFileInfo
			for _, rf := range ownRemote[itemType] {
				ownFiles = append(ownFiles, rf)
				if rf.timestamp > remoteMtime {
					remoteMtime = rf.timestamp
				}
			}

			if localMtime != remoteMtime {
				// Need to upload
				data, err := os.ReadFile(localPath)
				if err != nil {
					log.Printf("syncSSHData: read %s: %v", localPath, err)
					continue
				}
				uploadData := data
				if gCfg.WebdavEncryptionEnabled {
					uploadData, err = encryptData(data, dek)
					if err != nil {
						log.Printf("syncSSHData: encrypt %s: %v", localPath, err)
						continue
					}
				}
				filename := fmt.Sprintf("%s_%s_%d%s", itemType, deviceName, localMtime, ext)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader(uploadData), gCfg)
				if err != nil {
					log.Printf("syncSSHData: upload %s: %v", filename, err)
					continue
				}
				resp.Body.Close()

				// Delete old own-device files for this type
				for _, rf := range ownFiles {
					if rf.filename != filename {
						r, err := makeRequest("DELETE", davBaseUrl+rf.filename, nil, gCfg)
						if err == nil {
							r.Body.Close()
						}
					}
				}
			}
		}
	}

	// --- Download other devices' latest SSH files to local cache ---
	cacheBase := filepath.Join(gCfg.ConfigDir, "devices_sshdata")
	allOtherDevices := map[string]bool{}
	for _, byDevice := range otherRemote {
		for dev := range byDevice {
			allOtherDevices[dev] = true
		}
	}

	for dev := range allOtherDevices {
		devDir := filepath.Join(cacheBase, dev)
		if err := os.MkdirAll(devDir, 0700); err != nil {
			continue
		}
		for itemType, localFilename := range map[string]string{"sshconfig": "config", "knownhosts": "known_hosts"} {
			rf, ok := otherRemote[itemType][dev]
			if !ok {
				continue
			}
			localPath := filepath.Join(devDir, localFilename)
			// Check if cached file already matches this timestamp
			cached, err := os.Stat(localPath)
			if err == nil && cached.ModTime().UnixMilli() == rf.timestamp {
				continue // already up-to-date
			}
			// Download
			resp, err := makeRequest("GET", davBaseUrl+rf.filename, nil, gCfg)
			if err != nil {
				log.Printf("syncSSHData: download %s: %v", rf.filename, err)
				continue
			}
			body, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil || resp.StatusCode != http.StatusOK {
				continue
			}
			if rf.isEncrypted {
				body, err = decryptData(body, dek)
				if err != nil {
					log.Printf("syncSSHData: decrypt %s: %v", rf.filename, err)
					continue
				}
			}
			if err := common.AtomicWriteFileContents(localPath, body); err != nil {
				log.Printf("syncSSHData: write cache %s: %v", localPath, err)
				continue
			}
			// Set mtime on cached file to match the remote timestamp
			ts := time.UnixMilli(rf.timestamp)
			os.Chtimes(localPath, ts, ts)
		}
	}
	return nil
}

// ListDeviceSSHData returns metadata about other devices' SSH data cached locally.
func ListDeviceSSHData() ([]*models.DeviceSSHData, error) {
	if gCfg == nil {
		return nil, fmt.Errorf("config not initialized")
	}
	cacheBase := filepath.Join(gCfg.ConfigDir, "devices_sshdata")
	entries, err := os.ReadDir(cacheBase)
	if err != nil {
		if os.IsNotExist(err) {
			return []*models.DeviceSSHData{}, nil
		}
		return nil, err
	}
	var result []*models.DeviceSSHData
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dev := &models.DeviceSSHData{DeviceName: e.Name()}
		cfgInfo, err := os.Stat(filepath.Join(cacheBase, e.Name(), "config"))
		if err == nil {
			dev.HasSSHConfig = true
			dev.SSHConfigMtime = cfgInfo.ModTime().UnixMilli()
		}
		khInfo, err := os.Stat(filepath.Join(cacheBase, e.Name(), "known_hosts"))
		if err == nil {
			dev.HasKnownHosts = true
			dev.KnownHostsMtime = khInfo.ModTime().UnixMilli()
		}
		if dev.HasSSHConfig || dev.HasKnownHosts {
			result = append(result, dev)
		}
	}
	return result, nil
}

// ReadDeviceSSHConfig reads and parses another device's cached SSH config,
// comparing against local hosts to classify each entry as new/modified/same.
func ReadDeviceSSHConfig(deviceName string, localHosts []*models.HostData) ([]*models.RemoteHostEntry, error) {
	if gCfg == nil {
		return nil, fmt.Errorf("config not initialized")
	}
	cfgPath := filepath.Join(gCfg.ConfigDir, "devices_sshdata", deviceName, "config")
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return nil, err
	}

	// Build local host map (alias -> directives)
	localMap := map[string]map[string]string{}
	for _, h := range localHosts {
		if h.Source != "config" {
			continue
		}
		d := hostDataToDirectives(h)
		localMap[h.Name] = d
	}

	// Parse remote config into blocks
	return parseSSHConfigToEntries(string(data), localMap), nil
}

func hostDataToDirectives(h *models.HostData) map[string]string {
	d := map[string]string{
		"hostname": h.HostName,
		"port":     h.Port,
	}
	if h.User != "" {
		d["user"] = h.User
	}
	if h.IdentityFile != "" {
		d["identityfile"] = h.IdentityFile
	}
	if h.ProxyJump != "" {
		d["proxyjump"] = h.ProxyJump
	}
	if h.RemoteCommand != "" {
		d["remotecommand"] = h.RemoteCommand
	}
	if h.AddressFamily != "" {
		d["addressfamily"] = h.AddressFamily
	}
	if h.UserKnownHostsFile != "" {
		d["userknownhostsfile"] = h.UserKnownHostsFile
	}
	if h.StrictHostKeyChecking != "" {
		d["stricthostkeychecking"] = h.StrictHostKeyChecking
	}
	if h.HostKeyAlgorithms != "" {
		d["hostkeyalgorithms"] = h.HostKeyAlgorithms
	}
	if h.VerifyHostKeyDNS != "" {
		d["verifyhostkeydns"] = h.VerifyHostKeyDNS
	}
	if h.SendEnv != "" {
		d["sendenv"] = h.SendEnv
	}
	if h.LocalForward != "" {
		d["localforward"] = h.LocalForward
	}
	if h.RemoteForward != "" {
		d["remoteforward"] = h.RemoteForward
	}
	if h.DynamicForward != "" {
		d["dynamicforward"] = h.DynamicForward
	}
	return d
}

func parseSSHConfigToEntries(content string, localMap map[string]map[string]string) []*models.RemoteHostEntry {
	var entries []*models.RemoteHostEntry
	var currentHost string
	currentDirectives := map[string]string{}

	flush := func() {
		if currentHost == "" || currentHost == "*" {
			return
		}
		entry := &models.RemoteHostEntry{
			Host:       currentHost,
			Directives: currentDirectives,
		}
		if local, ok := localMap[currentHost]; ok {
			if !directivesEqual(currentDirectives, local) {
				entry.IsModified = true
				entry.LocalDirectives = local
			}
		} else {
			entry.IsNew = true
		}
		entries = append(entries, entry)
	}

	for line := range strings.SplitSeq(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "host ") {
			flush()
			currentHost = strings.TrimSpace(line[5:])
			currentDirectives = map[string]string{}
		} else if currentHost != "" {
			parts := strings.SplitN(line, " ", 2)
			if len(parts) == 2 {
				currentDirectives[strings.ToLower(parts[0])] = strings.TrimSpace(parts[1])
			}
		}
	}
	flush()
	return entries
}

func directivesEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if bv, ok := b[k]; !ok || bv != v {
			return false
		}
	}
	return true
}

// ReadDeviceKnownHosts reads and parses another device's cached known_hosts,
// comparing against local known_hosts to classify conflicts.
func ReadDeviceKnownHosts(deviceName string) ([]*models.RemoteKnownHostEntry, error) {
	if gCfg == nil {
		return nil, fmt.Errorf("config not initialized")
	}
	remotePath := filepath.Join(gCfg.ConfigDir, "devices_sshdata", deviceName, "known_hosts")
	remoteData, err := os.ReadFile(remotePath)
	if err != nil {
		return nil, err
	}

	// Parse local known_hosts into map: patterns -> (keyType, keyData)
	localKH := map[string][2]string{} // pattern -> [keyType, keyData]
	localPath := filepath.Join(gCfg.AbsSSHDir, "known_hosts")
	if localData, err := os.ReadFile(localPath); err == nil {
		for _, line := range strings.Split(string(localData), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "|") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 3 {
				continue
			}
			for _, pat := range strings.Split(fields[0], ",") {
				localKH[strings.TrimSpace(pat)] = [2]string{fields[1], fields[2]}
			}
		}
	}

	var entries []*models.RemoteKnownHostEntry
	for _, line := range strings.Split(string(remoteData), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "|") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		patterns := fields[0]
		keyType := fields[1]
		keyData := fields[2]
		comment := ""
		if len(fields) > 3 {
			comment = strings.Join(fields[3:], " ")
		}

		entry := &models.RemoteKnownHostEntry{
			Line:     line,
			Patterns: patterns,
			KeyType:  keyType,
			KeyData:  keyData,
			Comment:  comment,
		}

		// Check against local
		isNew := true
		for _, pat := range strings.Split(patterns, ",") {
			pat = strings.TrimSpace(pat)
			if local, ok := localKH[pat]; ok {
				isNew = false
				if local[1] != keyData {
					entry.IsConflict = true
					entry.LocalKeyType = local[0]
					entry.LocalKeyData = local[1]
				}
				break
			}
		}
		entry.IsNew = isNew
		entries = append(entries, entry)
	}
	return entries, nil
}

// ImportSSHConfigHosts appends selected host blocks from a device's cached config into local ~/.ssh/config.
func ImportSSHConfigHosts(deviceName string, hostNames []string) error {
	if gCfg == nil {
		return fmt.Errorf("config not initialized")
	}
	cfgPath := filepath.Join(gCfg.ConfigDir, "devices_sshdata", deviceName, "config")
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return err
	}
	wanted := map[string]bool{}
	for _, n := range hostNames {
		wanted[n] = true
	}

	// Extract raw blocks for wanted hosts
	blocks := extractSSHConfigBlocks(string(data), wanted)
	if len(blocks) == 0 {
		return nil
	}

	localCfgPath := filepath.Join(gCfg.AbsSSHDir, "config")
	existing, _ := os.ReadFile(localCfgPath)
	combined := strings.TrimRight(string(existing), "\n") + "\n\n" + strings.Join(blocks, "\n\n") + "\n"

	return common.AtomicWriteFileContents(localCfgPath, []byte(combined))
}

func extractSSHConfigBlocks(content string, wanted map[string]bool) []string {
	var blocks []string
	var currentLines []string
	var currentHost string

	flush := func() {
		if currentHost != "" && wanted[currentHost] && len(currentLines) > 0 {
			blocks = append(blocks, strings.TrimRight(strings.Join(currentLines, "\n"), "\n"))
		}
		currentLines = nil
		currentHost = ""
	}

	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "host ") && !strings.HasPrefix(lower, "hostname") {
			flush()
			currentHost = strings.TrimSpace(trimmed[5:])
			currentLines = []string{line}
		} else if currentHost != "" {
			currentLines = append(currentLines, line)
		}
	}
	flush()
	return blocks
}

// ImportKnownHostsLines appends selected lines to local ~/.ssh/known_hosts.
// Conflicting entries are only imported if force=true, in which case the old line is replaced.
func ImportKnownHostsLines(deviceName string, lines []string, force bool) error {
	if gCfg == nil {
		return fmt.Errorf("config not initialized")
	}
	localPath := filepath.Join(gCfg.AbsSSHDir, "known_hosts")
	localData, _ := os.ReadFile(localPath)

	// Build existing local map
	localKH := map[string]string{} // pattern -> full line
	localLines := strings.Split(string(localData), "\n")
	for i, line := range localLines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "|") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		for _, pat := range strings.Split(fields[0], ",") {
			localKH[strings.TrimSpace(pat)] = fmt.Sprintf("%d", i)
		}
	}

	// Process each line to import
	for _, importLine := range lines {
		importLine = strings.TrimSpace(importLine)
		if importLine == "" {
			continue
		}
		fields := strings.Fields(importLine)
		if len(fields) < 3 {
			continue
		}
		importKeyData := fields[2]
		isConflict := false
		for _, pat := range strings.Split(fields[0], ",") {
			pat = strings.TrimSpace(pat)
			if idxStr, ok := localKH[pat]; ok {
				idx, _ := strconv.Atoi(idxStr)
				existingFields := strings.Fields(localLines[idx])
				if len(existingFields) >= 3 && existingFields[2] != importKeyData {
					isConflict = true
					if force {
						localLines[idx] = importLine
					}
				}
				break
			}
		}
		if !isConflict {
			localLines = append(localLines, importLine)
		}
	}

	result := strings.Join(localLines, "\n")
	if !strings.HasSuffix(result, "\n") {
		result += "\n"
	}
	return common.AtomicWriteFileContents(localPath, []byte(result))
}

func DetectChanges(urlVal, userVal, passwordVal, masterKeyVal string) (*models.SyncDetectionResult, error) {
	if gCfg == nil {
		return nil, fmt.Errorf("config not initialized")
	}

	tempCfg := &config.Config{
		WebdavUrl:      urlVal,
		WebdavUser:     userVal,
		WebdavPassword: passwordVal,
		ConfigDir:      gCfg.ConfigDir,
	}
	if tempCfg.WebdavPassword == "" {
		tempCfg.WebdavPassword = gCfg.WebdavPassword
	}

	if err := ensureWebdavDir(tempCfg); err != nil {
		return nil, fmt.Errorf("failed to connect or create folder on WebDAV: %w", err)
	}

	remoteFiles, hasFlag, err := listRemoteFiles(tempCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to list WebDAV files: %w", err)
	}

	if len(remoteFiles) == 0 && !hasFlag {
		return &models.SyncDetectionResult{
			BrandNew: true,
		}, nil
	}

	// Determine which master key to use:
	mKeyStr := masterKeyVal
	if mKeyStr == "" {
		mKeyStr = gCfg.WebdavMasterKey
	}

	var dek []byte
	if hasFlag {
		if mKeyStr == "" {
			return &models.SyncDetectionResult{
				Encrypted:   true,
				KeyRequired: true,
			}, nil
		}

		masterKey, err := base64.StdEncoding.DecodeString(mKeyStr)
		if err != nil || len(masterKey) != 32 {
			return &models.SyncDetectionResult{
				Encrypted:  true,
				KeyInvalid: true,
			}, nil
		}

		dek, err = deriveDEK(masterKey)
		if err != nil {
			return &models.SyncDetectionResult{
				Encrypted:  true,
				KeyInvalid: true,
			}, nil
		}

		// Verify the DEK using the encryption flag
		ok, err := VerifyMasterKey(tempCfg, mKeyStr)
		if err != nil || !ok {
			return &models.SyncDetectionResult{
				Encrypted:  true,
				KeyInvalid: true,
			}, nil
		}
	}

	var uploadCount int
	var downloadCount int
	var deleteLocalCount int
	var deleteRemoteCount int

	var remoteFilesToDelete []string
	nowMs := time.Now().UnixMilli()
	maxAgeMs := (30 * 24 * time.Hour).Milliseconds()

	remoteButtons := make(map[string][]remoteFileInfo)
	remotePages := make(map[string][]remoteFileInfo)
	var remoteVarsFiles []remoteFileInfo
	for _, f := range remoteFiles {
		if f.isDeleted && (nowMs-f.timestamp) > maxAgeMs {
			remoteFilesToDelete = append(remoteFilesToDelete, f.filename)
			continue
		}
		switch f.itemType {
		case "button":
			remoteButtons[f.id] = append(remoteButtons[f.id], f)
		case "scratchpad":
			remotePages[f.id] = append(remotePages[f.id], f)
		case "vars":
			remoteVarsFiles = append(remoteVarsFiles, f)
		}
	}

	localButtons := make(map[string]*models.ButtonData)
	for _, b := range gCfg.GetButtons() {
		localButtons[b.Id] = b
	}

	localPages := make(map[string]*models.ScratchpadPage)
	for _, p := range scratchpad.GetPages() {
		localPages[p.Id] = p
	}

	metaMu.Lock()
	deletedButtons := make(map[string]int64)
	for k, v := range meta.DeletedButtons {
		deletedButtons[k] = v
	}
	deletedPages := make(map[string]int64)
	maps.Copy(deletedPages, meta.DeletedPages)
	metaMu.Unlock()

	buttonIDs := make(map[string]bool)
	for id := range localButtons {
		buttonIDs[id] = true
	}
	for id := range deletedButtons {
		buttonIDs[id] = true
	}
	for id := range remoteButtons {
		buttonIDs[id] = true
	}

	for id := range buttonIDs {
		var localTS int64 = -1
		if b, ok := localButtons[id]; ok {
			localTS = b.Mtime
		} else if ts, ok := deletedButtons[id]; ok {
			localTS = ts
		}

		var remoteTS int64 = -1
		remoteActive := false
		remoteDeleted := false
		var remoteWinner remoteFileInfo
		if rFiles, ok := remoteButtons[id]; ok {
			for _, rf := range rFiles {
				if rf.timestamp > remoteTS {
					remoteTS = rf.timestamp
					remoteActive = !rf.isDeleted
					remoteDeleted = rf.isDeleted
					remoteWinner = rf
				}
				remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
			}
		}

		if localTS > remoteTS {
			uploadCount++
		} else if remoteTS > localTS {
			if remoteActive {
				downloadCount++
			} else if remoteDeleted {
				deleteLocalCount++
			}
			remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
		} else {
			if remoteTS >= 0 {
				remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
			}
		}
	}

	pageIDs := make(map[string]bool)
	for id := range localPages {
		pageIDs[id] = true
	}
	for id := range deletedPages {
		pageIDs[id] = true
	}
	for id := range remotePages {
		pageIDs[id] = true
	}

	for id := range pageIDs {
		var localTS int64 = -1
		if p, ok := localPages[id]; ok {
			localTS = p.LastUpdated
		} else if ts, ok := deletedPages[id]; ok {
			localTS = ts
		}

		var remoteTS int64 = -1
		remoteActive := false
		remoteDeleted := false
		var remoteWinner remoteFileInfo
		if rFiles, ok := remotePages[id]; ok {
			for _, rf := range rFiles {
				if rf.timestamp > remoteTS {
					remoteTS = rf.timestamp
					remoteActive = !rf.isDeleted
					remoteDeleted = rf.isDeleted
					remoteWinner = rf
				}
				remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
			}
		}

		if localTS > remoteTS {
			uploadCount++
		} else if remoteTS > localTS {
			if remoteActive {
				downloadCount++
			} else if remoteDeleted {
				deleteLocalCount++
			}
			remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
		} else {
			if remoteTS >= 0 {
				remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
			}
		}
	}

	// Detect Changes for Vars
	{
		localVars := gCfg.GetVars()
		localMtime := gCfg.GetVarsMtime()

		var remoteVars map[string]string
		var remoteMtime map[string]int64
		var remoteWinner remoteFileInfo
		remoteWinnerLoaded := false

		var remoteTS int64 = -1
		for _, rf := range remoteVarsFiles {
			if rf.timestamp > remoteTS {
				remoteTS = rf.timestamp
				remoteWinner = rf
			}
		}

		if remoteTS > 0 {
			resp, err := makeRequest("GET", tempCfg.WebdavUrl+"/"+ROOT_DIR+"/"+remoteWinner.filename, nil, tempCfg)
			if err == nil {
				defer resp.Body.Close()
				bodyBytes, readErr := io.ReadAll(resp.Body)
				if readErr == nil {
					if remoteWinner.isEncrypted {
						var err error
						bodyBytes, err = decryptData(bodyBytes, dek)
						if err != nil {
							log.Printf("detect decrypt vars err: %v", err)
							bodyBytes = nil
						}
					}
					if bodyBytes != nil {
						var raw struct {
							Mtime json.RawMessage   `json:"mtime"`
							Vars  map[string]string `json:"vars"`
						}
						if json.Unmarshal(bodyBytes, &raw) == nil {
							remoteVars = raw.Vars
							remoteMtime = make(map[string]int64)
							if len(raw.Mtime) > 0 {
								var mtimeMap map[string]int64
								if json.Unmarshal(raw.Mtime, &mtimeMap) == nil {
									remoteMtime = mtimeMap
								} else {
									var mtimeVal int64
									if json.Unmarshal(raw.Mtime, &mtimeVal) == nil {
										for k := range remoteVars {
											remoteMtime[k] = mtimeVal
										}
									}
								}
							}
							remoteWinnerLoaded = true
						}
					}
				}
			}
		}

		if remoteVars == nil {
			remoteVars = make(map[string]string)
		}
		if remoteMtime == nil {
			remoteMtime = make(map[string]int64)
		}

		// Merge local and remote
		mergedVars := make(map[string]string)
		mergedMtime := make(map[string]int64)

		allKeys := make(map[string]bool)
		for k := range localMtime {
			allKeys[k] = true
		}
		for k := range remoteMtime {
			allKeys[k] = true
		}

		for k := range allKeys {
			lTS := localMtime[k]
			rTS := remoteMtime[k]

			if rTS > lTS {
				mergedMtime[k] = rTS
				if val, exists := remoteVars[k]; exists {
					mergedVars[k] = val
				}
			} else {
				mergedMtime[k] = lTS
				if val, exists := localVars[k]; exists {
					mergedVars[k] = val
				}
			}
		}

		// Clean up old deletion markers from mergedMtime
		now := time.Now().UnixMilli()
		maxAgeMs := (30 * 24 * time.Hour).Milliseconds()
		for k, ts := range mergedMtime {
			if _, exists := mergedVars[k]; !exists {
				if (now - ts) > maxAgeMs {
					delete(mergedMtime, k)
				}
			}
		}

		// Check if local differs from merged (download count)
		localDiffers := false
		if len(localVars) != len(mergedVars) || len(localMtime) != len(mergedMtime) {
			localDiffers = true
		} else {
			for k, v := range mergedVars {
				if lv, ok := localVars[k]; !ok || lv != v {
					localDiffers = true
					break
				}
			}
			if !localDiffers {
				for k, ts := range mergedMtime {
					if lts, ok := localMtime[k]; !ok || lts != ts {
						localDiffers = true
						break
					}
				}
			}
		}

		if localDiffers {
			downloadCount++
		}

		// Check if remote differs from merged (upload count)
		remoteDiffers := false
		if !remoteWinnerLoaded {
			if len(mergedMtime) > 0 {
				remoteDiffers = true
			}
		} else {
			if len(remoteVars) != len(mergedVars) || len(remoteMtime) != len(mergedMtime) {
				remoteDiffers = true
			} else {
				for k, v := range mergedVars {
					if rv, ok := remoteVars[k]; !ok || rv != v {
						remoteDiffers = true
						break
					}
				}
				if !remoteDiffers {
					for k, ts := range mergedMtime {
						if rts, ok := remoteMtime[k]; !ok || rts != ts {
							remoteDiffers = true
							break
						}
					}
				}
			}
		}

		if remoteDiffers {
			uploadCount++
			for _, rf := range remoteVarsFiles {
				remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
			}
		} else {
			for _, rf := range remoteVarsFiles {
				if !remoteWinnerLoaded || rf.filename != remoteWinner.filename {
					remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
				}
			}
		}
	}

	deleteRemoteCount = len(remoteFilesToDelete)

	return &models.SyncDetectionResult{
		BrandNew:          false,
		UploadCount:       uploadCount,
		DownloadCount:     downloadCount,
		DeleteLocalCount:  deleteLocalCount,
		DeleteRemoteCount: deleteRemoteCount,
		Encrypted:         hasFlag,
	}, nil
}

func deriveDEK(masterKey []byte) ([]byte, error) {
	kdf := hkdf.New(sha256.New, masterKey, nil, []byte("data"))
	dek := make([]byte, 32)
	if _, err := io.ReadFull(kdf, dek); err != nil {
		return nil, err
	}
	return dek, nil
}

func encryptData(plaintext []byte, dek []byte) ([]byte, error) {
	aead, err := xaes256gcm.NewWithManualNonces(dek)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, xaes256gcm.NonceSize) // 24 bytes
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	ciphertext := aead.Seal(nil, nonce, plaintext, nil)

	var buf bytes.Buffer
	buf.Write([]byte("CZSSH\x00\x00\x00"))
	buf.Write(nonce)
	buf.Write(ciphertext)
	return buf.Bytes(), nil
}

func decryptData(data []byte, dek []byte) ([]byte, error) {
	magic := []byte("CZSSH\x00\x00\x00")
	if len(data) < len(magic)+xaes256gcm.NonceSize {
		return nil, errors.New("data too short")
	}
	if !bytes.Equal(data[:len(magic)], magic) {
		return nil, errors.New("invalid magic number")
	}
	nonceOffset := len(magic)
	ciphertextOffset := nonceOffset + xaes256gcm.NonceSize

	nonce := data[nonceOffset:ciphertextOffset]
	ciphertext := data[ciphertextOffset:]

	aead, err := xaes256gcm.NewWithManualNonces(dek)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, nonce, ciphertext, nil)
}

func EnsureWebdavDir(cfg *config.Config) error {
	return ensureWebdavDir(cfg)
}

func CheckEncryptionFlag(cfg *config.Config) (bool, error) {
	davUrl := strings.TrimRight(cfg.WebdavUrl, "/") + "/" + ROOT_DIR + "/" + FLAG_FILE
	resp, err := makeRequest("GET", davUrl, nil, cfg)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return true, nil
	}
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	return false, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
}

func VerifyMasterKey(cfg *config.Config, masterKeyStr string) (bool, error) {
	masterKey, err := base64.StdEncoding.DecodeString(masterKeyStr)
	if err != nil || len(masterKey) != 32 {
		return false, fmt.Errorf("invalid master key length or encoding")
	}

	dek, err := deriveDEK(masterKey)
	if err != nil {
		return false, err
	}

	davUrl := strings.TrimRight(cfg.WebdavUrl, "/") + "/" + ROOT_DIR + "/" + FLAG_FILE
	resp, err := makeRequest("GET", davUrl, nil, cfg)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("failed to fetch encryption flag: status %d", resp.StatusCode)
	}

	flagData, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, err
	}

	decrypted, err := decryptData(flagData, dek)
	if err != nil {
		return false, nil // Decryption failure means incorrect key
	}

	return string(decrypted) == FLAG_PLAINTEXT, nil
}

func WriteEncryptionFlag(cfg *config.Config, masterKeyStr string) error {
	masterKey, err := base64.StdEncoding.DecodeString(masterKeyStr)
	if err != nil || len(masterKey) != 32 {
		return fmt.Errorf("invalid master key length or encoding")
	}

	dek, err := deriveDEK(masterKey)
	if err != nil {
		return err
	}

	encrypted, err := encryptData([]byte(FLAG_PLAINTEXT), dek)
	if err != nil {
		return err
	}

	davUrl := strings.TrimRight(cfg.WebdavUrl, "/") + "/" + ROOT_DIR + "/" + FLAG_FILE
	resp, err := makeRequest("PUT", davUrl, bytes.NewReader(encrypted), cfg)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("failed to write encryption flag: status %d", resp.StatusCode)
	}

	return nil
}

func downloadAndDecryptButton(filename string, isEncrypted bool, id string, timestamp int64, dek []byte) (*models.ButtonData, error) {
	davBaseUrl := strings.TrimRight(gCfg.WebdavUrl, "/") + "/" + ROOT_DIR + "/"
	resp, err := makeRequest("GET", davBaseUrl+filename, nil, gCfg)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET returned status %d", resp.StatusCode)
	}
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if isEncrypted {
		decrypted, err := decryptData(bodyBytes, dek)
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt button: %w", err)
		}
		var b models.ButtonData
		if err := json.Unmarshal(decrypted, &b); err != nil {
			return nil, err
		}
		if b.Id != id || b.Mtime != timestamp {
			return nil, fmt.Errorf("decrypted button metadata mismatch: got id=%s mtime=%d, expected id=%s timestamp=%d", b.Id, b.Mtime, id, timestamp)
		}
		return &b, nil
	} else {
		var b models.ButtonData
		if err := json.Unmarshal(bodyBytes, &b); err != nil {
			log.Printf("failed to unmarshal remote button %s: %v", filename, err)
			return nil, nil
		}
		return &b, nil
	}
}

func downloadAndDecryptPage(filename string, isEncrypted bool, dek []byte) (*models.ScratchpadPage, error) {
	davBaseUrl := strings.TrimRight(gCfg.WebdavUrl, "/") + "/" + ROOT_DIR + "/"
	resp, err := makeRequest("GET", davBaseUrl+filename, nil, gCfg)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET returned status %d", resp.StatusCode)
	}
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if isEncrypted {
		decrypted, err := decryptData(bodyBytes, dek)
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt scratchpad: %w", err)
		}
		var p models.ScratchpadPage
		if err := json.Unmarshal(decrypted, &p); err != nil {
			return nil, err
		}
		return &p, nil
	} else {
		var p models.ScratchpadPage
		if err := json.Unmarshal(bodyBytes, &p); err != nil {
			log.Printf("failed to unmarshal remote scratchpad %s: %v", filename, err)
			return nil, nil
		}
		return &p, nil
	}
}
