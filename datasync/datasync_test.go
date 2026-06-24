package datasync

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"cozyssh/config"
	"cozyssh/models"
)

func TestTriggerSyncDebounce(t *testing.T) {
	// Speed up the debounce timer for testing
	oldDebounce := syncDebounceTime
	syncDebounceTime = 100 * time.Millisecond
	defer func() {
		syncDebounceTime = oldDebounce
	}()

	var callCount int32
	syncHook = func() {
		atomic.AddInt32(&callCount, 1)
	}
	defer func() {
		syncHook = nil
	}()

	// Trigger multiple times rapidly (within 50ms total)
	for i := 0; i < 5; i++ {
		TriggerSync()
		time.Sleep(5 * time.Millisecond)
	}

	// Wait for the debounce timer (100ms + buffer) to fire
	time.Sleep(250 * time.Millisecond)

	count := atomic.LoadInt32(&callCount)
	if count != 1 {
		t.Errorf("Expected SyncNow to be called exactly 1 time after rapid triggers, got %d", count)
	}

	// Trigger again and wait to verify a subsequent cooldown works
	TriggerSync()
	time.Sleep(250 * time.Millisecond)

	count = atomic.LoadInt32(&callCount)
	if count != 2 {
		t.Errorf("Expected SyncNow to be called 2 times in total, got %d", count)
	}
}

func TestCleanDeletedMaps(t *testing.T) {
	// Setup gCfg
	gCfg = &config.Config{
		ConfigDir: t.TempDir(),
	}

	meta.DeletedButtons = map[string]int64{
		"active_btn":  time.Now().UnixMilli(),
		"old_del_btn": 1000, // Jan 1, 1970
		"new_del_btn": time.Now().UnixMilli(),
	}
	meta.DeletedPages = map[string]int64{
		"old_del_page": 1000,
		"new_del_page": time.Now().UnixMilli(),
	}

	// We make "active_btn" active
	gCfg.Buttons = []*models.ButtonData{
		{Id: "active_btn"},
	}

	cleanDeletedMaps()

	// "active_btn" (because it's active) and "old_del_btn" (because it's older than 30 days) should be removed.
	if _, exists := meta.DeletedButtons["active_btn"]; exists {
		t.Error("expected active_btn to be cleaned from DeletedButtons")
	}
	if _, exists := meta.DeletedButtons["old_del_btn"]; exists {
		t.Error("expected old_del_btn to be cleaned from DeletedButtons")
	}
	if _, exists := meta.DeletedButtons["new_del_btn"]; !exists {
		t.Error("expected new_del_btn to remain in DeletedButtons")
	}

	if _, exists := meta.DeletedPages["old_del_page"]; exists {
		t.Error("expected old_del_page to be cleaned from DeletedPages")
	}
	if _, exists := meta.DeletedPages["new_del_page"]; !exists {
		t.Error("expected new_del_page to remain in DeletedPages")
	}
}

func TestWebdavOldDeletionCleanup(t *testing.T) {
	var deletedFiles []string
	var deletedMu sync.Mutex

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "MKCOL" {
			w.WriteHeader(http.StatusCreated)
			return
		}
		if r.Method == "PROPFIND" {
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(207)
			w.Write([]byte(`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/cozyssh/button_active_100.json</D:href>
  </D:response>
  <D:response>
    <D:href>/cozyssh/button_old_deleted_1000_d.json</D:href>
  </D:response>
  <D:response>
    <D:href>/cozyssh/button_recent_deleted_99999999999999_d.json</D:href>
  </D:response>
</D:multistatus>`))
			return
		}
		if r.Method == "DELETE" {
			deletedMu.Lock()
			deletedFiles = append(deletedFiles, r.URL.Path)
			deletedMu.Unlock()
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	// Configure gCfg for WebDAV using a temporary directory
	tmpDir := t.TempDir()
	gCfg = &config.Config{
		WebdavEnabled: true,
		WebdavUrl:     server.URL,
	}
	gCfg.ConfigDir = tmpDir

	// Reset local metadata
	meta.DeletedButtons = make(map[string]int64)
	meta.DeletedPages = make(map[string]int64)

	err := performSync()
	if err != nil {
		t.Fatalf("unexpected error during performSync: %v", err)
	}

	deletedMu.Lock()
	defer deletedMu.Unlock()

	// We expect exactly "/cozyssh/button_old_deleted_1000_d.json" to be deleted
	if len(deletedFiles) != 1 {
		t.Errorf("expected exactly 1 deleted file, got %d: %v", len(deletedFiles), deletedFiles)
	} else if deletedFiles[0] != "/cozyssh/button_old_deleted_1000_d.json" {
		t.Errorf("expected /cozyssh/button_old_deleted_1000_d.json to be deleted, got %s", deletedFiles[0])
	}
}

func TestWebdavE2EESync(t *testing.T) {
	masterKey := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, masterKey); err != nil {
		t.Fatalf("failed to generate master key: %v", err)
	}
	masterKeyStr := base64.StdEncoding.EncodeToString(masterKey)
	dek, err := deriveDEK(masterKey)
	if err != nil {
		t.Fatalf("failed to derive DEK: %v", err)
	}

	var remoteFilesMap = make(map[string][]byte)
	var mu sync.Mutex

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "MKCOL" {
			w.WriteHeader(http.StatusCreated)
			return
		}
		if r.Method == "PUT" {
			body, err := io.ReadAll(r.Body)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			mu.Lock()
			remoteFilesMap[r.URL.Path] = body
			mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			return
		}
		if r.Method == "PROPFIND" {
			mu.Lock()
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(207)
			w.Write([]byte(`<?xml version="1.0" encoding="utf-8"?>`))
			w.Write([]byte(`<D:multistatus xmlns:D="DAV:">`))
			for k := range remoteFilesMap {
				w.Write([]byte(fmt.Sprintf(`<D:response><D:href>%s</D:href></D:response>`, k)))
			}
			w.Write([]byte(`</D:multistatus>`))
			mu.Unlock()
			return
		}
		if r.Method == "GET" {
			mu.Lock()
			data, ok := remoteFilesMap[r.URL.Path]
			mu.Unlock()
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)
			w.Write(data)
			return
		}
		if r.Method == "DELETE" {
			mu.Lock()
			delete(remoteFilesMap, r.URL.Path)
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	// 1. Initial setup of brand new WebDAV with encryption enabled
	tmpDir := t.TempDir()
	gCfg = &config.Config{
		WebdavEnabled:           true,
		WebdavUrl:               server.URL,
		WebdavEncryptionEnabled: true,
		WebdavMasterKey:         masterKeyStr,
		ConfigDir:               tmpDir,
	}
	loadMetadata()

	// Setup a local button
	btn1 := &models.ButtonData{
		Id:    "btn1",
		Mtime: 1000,
		Name:  "Test Button 1",
	}
	gCfg.Buttons = []*models.ButtonData{btn1}

	// Write encryption flag manually or via WriteEncryptionFlag
	err = WriteEncryptionFlag(gCfg, masterKeyStr)
	if err != nil {
		t.Fatalf("failed to write encryption flag: %v", err)
	}

	// Verify encryption flag was written and is correct
	hasFlag, err := CheckEncryptionFlag(gCfg)
	if err != nil || !hasFlag {
		t.Fatalf("encryption flag check failed: hasFlag=%t, err=%v", hasFlag, err)
	}
	ok, err := VerifyMasterKey(gCfg, masterKeyStr)
	if err != nil || !ok {
		t.Fatalf("master key verification failed: ok=%t, err=%v", ok, err)
	}

	// Run PerformSync
	err = performSync()
	if err != nil {
		t.Fatalf("performSync failed: %v", err)
	}

	// Verify that button was uploaded as button_btn1_1000.bin
	mu.Lock()
	encryptedData, found := remoteFilesMap["/cozyssh/button_btn1_1000.bin"]
	mu.Unlock()
	if !found {
		t.Fatalf("expected button_btn1_1000.bin to be uploaded to remote")
	}

	// Decrypt and verify payload
	decryptedBytes, err := decryptData(encryptedData, dek)
	if err != nil {
		t.Fatalf("failed to decrypt uploaded button data: %v", err)
	}
	var decryptedBtn models.ButtonData
	if err := json.Unmarshal(decryptedBytes, &decryptedBtn); err != nil {
		t.Fatalf("failed to unmarshal decrypted button: %v", err)
	}
	if decryptedBtn.Id != btn1.Id || decryptedBtn.Name != btn1.Name {
		t.Fatalf("decrypted button contents mismatch: got %+v, expected %+v", decryptedBtn, btn1)
	}

	// 2. Test Integrity Check Failure
	// Modify the remote button ciphertext to have a mismatched ID
	badBtn := &models.ButtonData{
		Id:    "mismatched_btn",
		Mtime: 1000,
		Name:  "Tampered Button",
	}
	badPayload, _ := json.Marshal(badBtn)
	badEncrypted, _ := encryptData(badPayload, dek)

	mu.Lock()
	remoteFilesMap["/cozyssh/button_btn1_2000.bin"] = badEncrypted // name says btn1, payload says mismatched_btn
	delete(remoteFilesMap, "/cozyssh/button_btn1_1000.bin")
	mu.Unlock()

	// Clear local buttons to force a download/sync of btn1 from remote
	gCfg.Buttons = nil

	err = performSync()
	if err == nil {
		t.Fatal("expected performSync to fail due to integrity/metadata mismatch (button ID mismatch)")
	}

	// 3. Test Deletion Marker E2EE Sync
	// Restore valid remote state
	validBtn2000 := &models.ButtonData{
		Id:    "btn1",
		Mtime: 2000,
		Name:  "Test Button 1 Updated",
	}
	validPayload, _ := json.Marshal(validBtn2000)
	validEncrypted, _ := encryptData(validPayload, dek)
	mu.Lock()
	remoteFilesMap["/cozyssh/button_btn1_2000.bin"] = validEncrypted
	mu.Unlock()

	// Run sync to pull it locally
	err = performSync()
	if err != nil {
		t.Fatalf("failed to pull valid updated button: %v", err)
	}

	// Delete button locally
	gCfg.Buttons = nil
	delTS := time.Now().UnixMilli()
	metaMu.Lock()
	meta.DeletedButtons["btn1"] = delTS
	metaMu.Unlock()

	// Run sync to push deletion marker
	err = performSync()
	if err != nil {
		t.Fatalf("failed to push deletion: %v", err)
	}

	// Verify deletion marker is encrypted on remote
	mu.Lock()
	filename := fmt.Sprintf("/cozyssh/button_btn1_%d_d.bin", delTS)
	delMarkerData, found := remoteFilesMap[filename]
	mu.Unlock()
	if !found {
		t.Fatalf("expected %s to be uploaded to remote", filename)
	}

	decryptedDelMarker, err := decryptData(delMarkerData, dek)
	if err != nil {
		t.Fatalf("failed to decrypt deletion marker: %v", err)
	}
	var markerPayload struct {
		Id      string `json:"id"`
		Mtime   string `json:"mtime"`
		Deleted bool   `json:"$deleted$"`
	}
	if err := json.Unmarshal(decryptedDelMarker, &markerPayload); err != nil {
		t.Fatalf("failed to unmarshal deletion marker: %v", err)
	}
	if markerPayload.Id != "btn1" || markerPayload.Mtime != fmt.Sprintf("%d", delTS) || !markerPayload.Deleted {
		t.Fatalf("unexpected deletion marker payload: %+v", markerPayload)
	}
}
