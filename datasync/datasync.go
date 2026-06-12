package datasync

import (
	"bytes"
	"encoding/json"
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
)

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
	filename  string
	itemType  string // "button" or "scratchpad"
	id        string
	timestamp int64
	isDeleted bool
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
	davUrl := strings.TrimRight(cfg.WebdavUrl, "/") + "/cozyssh"
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

func listRemoteFiles(cfg *config.Config) ([]remoteFileInfo, error) {
	davUrl := strings.TrimRight(cfg.WebdavUrl, "/") + "/cozyssh/"
	resp, err := makeRequest("PROPFIND", davUrl, nil, cfg)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != 207 {
		return nil, fmt.Errorf("PROPFIND returned status %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	matches := hrefRegex.FindAllStringSubmatch(string(bodyBytes), -1)
	var files []remoteFileInfo
	for _, m := range matches {
		rawHref := m[1]
		decodedHref, err := url.PathUnescape(rawHref)
		if err != nil {
			decodedHref = rawHref
		}
		filename := path.Base(decodedHref)
		if !strings.HasSuffix(filename, ".json") {
			continue
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
		} else {
			continue
		}

		nameWithoutExt := rawName[:len(rawName)-len(".json")]
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
			filename:  filename,
			itemType:  itemType,
			id:        id,
			timestamp: timestamp,
			isDeleted: isDeleted,
		})
	}

	return files, nil
}

func performSync() error {
	if err := ensureWebdavDir(gCfg); err != nil {
		return fmt.Errorf("failed to ensure WebDAV directory: %w", err)
	}

	cleanDeletedMaps()

	remoteFiles, err := listRemoteFiles(gCfg)
	if err != nil {
		return fmt.Errorf("failed to list WebDAV files: %w", err)
	}

	var remoteFilesToDelete []string
	nowMs := time.Now().UnixMilli()
	maxAgeMs := (30 * 24 * time.Hour).Milliseconds()

	remoteButtons := make(map[string][]remoteFileInfo)
	remotePages := make(map[string][]remoteFileInfo)
	var remoteVars []remoteFileInfo
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
			remoteVars = append(remoteVars, f)
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

	davBaseUrl := strings.TrimRight(gCfg.WebdavUrl, "/") + "/cozyssh/"

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
				filename := fmt.Sprintf("button_%s_%d.json", id, localTS)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader(data), gCfg)
				if err != nil {
					return err
				}
				resp.Body.Close()
			} else if localDeleted {
				filename := fmt.Sprintf("button_%s_%d_d.json", id, localTS)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader([]byte("{}")), gCfg)
				if err != nil {
					return err
				}
				resp.Body.Close()
			}
		} else if remoteTS > localTS {
			if remoteActive {
				resp, err := makeRequest("GET", davBaseUrl+remoteWinner.filename, nil, gCfg)
				if err != nil {
					return err
				}
				var b models.ButtonData
				err = json.NewDecoder(resp.Body).Decode(&b)
				resp.Body.Close()
				if err == nil {
					buttonsToUpsert = append(buttonsToUpsert, &b)
				}
			} else if remoteDeleted {
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
				filename := fmt.Sprintf("scratchpad_%s_%d.json", id, localTS)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader(data), gCfg)
				if err != nil {
					return err
				}
				resp.Body.Close()
			} else if localDeleted {
				filename := fmt.Sprintf("scratchpad_%s_%d_d.json", id, localTS)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader([]byte("{}")), gCfg)
				if err != nil {
					return err
				}
				resp.Body.Close()
			}
		} else if remoteTS > localTS {
			if remoteActive {
				resp, err := makeRequest("GET", davBaseUrl+remoteWinner.filename, nil, gCfg)
				if err != nil {
					return err
				}
				var p models.ScratchpadPage
				err = json.NewDecoder(resp.Body).Decode(&p)
				resp.Body.Close()
				if err == nil {
					pagesToUpsert = append(pagesToUpsert, &p)
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
		localTS := gCfg.VarsMtime
		var remoteTS int64 = -1
		var remoteWinner remoteFileInfo
		for _, rf := range remoteVars {
			if rf.timestamp > remoteTS {
				remoteTS = rf.timestamp
				remoteWinner = rf
			}
			remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
		}

		if localTS > remoteTS {
			if localTS > 0 {
				var varsWrap struct {
					Mtime int64             `json:"mtime"`
					Vars  map[string]string `json:"vars"`
				}
				varsWrap.Mtime = localTS
				varsWrap.Vars = gCfg.GetVars()
				data, err := json.Marshal(varsWrap)
				if err != nil {
					return err
				}
				filename := fmt.Sprintf("vars_%d.json", localTS)
				resp, err := makeRequest("PUT", davBaseUrl+filename, bytes.NewReader(data), gCfg)
				if err != nil {
					return err
				}
				resp.Body.Close()
			}
		} else if remoteTS > localTS {
			resp, err := makeRequest("GET", davBaseUrl+remoteWinner.filename, nil, gCfg)
			if err != nil {
				return err
			}
			var varsWrap struct {
				Mtime int64             `json:"mtime"`
				Vars  map[string]string `json:"vars"`
			}
			err = json.NewDecoder(resp.Body).Decode(&varsWrap)
			resp.Body.Close()
			if err == nil {
				if err := gCfg.SetVars(varsWrap.Vars, varsWrap.Mtime); err != nil {
					log.Printf("sync set vars err: %v", err)
				}
			}
			remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
		} else {
			if remoteTS >= 0 {
				remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
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

func DetectChanges(urlVal, userVal, passwordVal string) (*models.SyncDetectionResult, error) {
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

	remoteFiles, err := listRemoteFiles(tempCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to list WebDAV files: %w", err)
	}

	if len(remoteFiles) == 0 {
		return &models.SyncDetectionResult{
			BrandNew: true,
		}, nil
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
	var remoteVars []remoteFileInfo
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
			remoteVars = append(remoteVars, f)
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

	{
		localTS := gCfg.VarsMtime
		var remoteTS int64 = -1
		var remoteWinner remoteFileInfo
		for _, rf := range remoteVars {
			if rf.timestamp > remoteTS {
				remoteTS = rf.timestamp
				remoteWinner = rf
			}
			remoteFilesToDelete = append(remoteFilesToDelete, rf.filename)
		}

		if localTS > remoteTS {
			if localTS > 0 {
				uploadCount++
			}
		} else if remoteTS > localTS {
			downloadCount++
			remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
		} else {
			if remoteTS >= 0 {
				remoteFilesToDelete = removeFromStringSlice(remoteFilesToDelete, remoteWinner.filename)
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
	}, nil
}
