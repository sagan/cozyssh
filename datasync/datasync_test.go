package datasync

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"cozyssh/config"
	"cozyssh/models"
	"cozyssh/passstore"
	"cozyssh/yescrypt"
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
		if r.Method == http.MethodDelete {
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
		if r.Method == http.MethodPut {
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
		if r.Method == http.MethodDelete {
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

func TestWebdavUploadSSHDataToggle(t *testing.T) {
	var remoteFilesMap = make(map[string][]byte)
	var mu sync.Mutex

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "MKCOL" {
			w.WriteHeader(http.StatusCreated)
			return
		}
		if r.Method == http.MethodPut {
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
		w.WriteHeader(http.StatusOK)
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	tmpDir := t.TempDir()
	sshDir := filepath.Join(tmpDir, "ssh")
	if err := os.MkdirAll(sshDir, 0755); err != nil {
		t.Fatalf("failed to create ssh dir: %v", err)
	}

	// Create dummy SSH config and known_hosts files
	sshConfigPath := filepath.Join(sshDir, "config")
	knownHostsPath := filepath.Join(sshDir, "known_hosts")
	if err := os.WriteFile(sshConfigPath, []byte("Host test\n  HostName 127.0.0.1"), 0600); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}
	if err := os.WriteFile(knownHostsPath, []byte("127.0.0.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..."), 0600); err != nil {
		t.Fatalf("failed to write known_hosts: %v", err)
	}

	gCfg = &config.Config{
		WebdavEnabled:       true,
		WebdavUrl:           server.URL,
		WebdavUploadSSHData: false, // Default is OFF
		AbsSSHDir:           sshDir,
		ConfigDir:           tmpDir,
	}
	loadMetadata()

	// 1. Sync with WebdavUploadSSHData = false
	err := performSync()
	if err != nil {
		t.Fatalf("performSync failed: %v", err)
	}

	// Verify nothing was uploaded to WebDAV
	mu.Lock()
	uploadedCount := len(remoteFilesMap)
	mu.Unlock()
	if uploadedCount > 0 {
		t.Errorf("expected 0 files to be uploaded when WebdavUploadSSHData is false, got %d files", uploadedCount)
	}

	// 2. Sync with WebdavUploadSSHData = true
	gCfg.WebdavUploadSSHData = true
	err = performSync()
	if err != nil {
		t.Fatalf("performSync failed: %v", err)
	}

	// Verify files were uploaded to WebDAV
	mu.Lock()
	hasConfig := false
	hasKnownHosts := false
	for path := range remoteFilesMap {
		if strings.Contains(path, "sshconfig_") {
			hasConfig = true
		}
		if strings.Contains(path, "knownhosts_") {
			hasKnownHosts = true
		}
	}
	mu.Unlock()

	if !hasConfig {
		t.Errorf("expected sshconfig to be uploaded when WebdavUploadSSHData is true")
	}
	if !hasKnownHosts {
		t.Errorf("expected knownhosts to be uploaded when WebdavUploadSSHData is true")
	}
}

func TestKnownHostsConflictDetection(t *testing.T) {
	tmpDir := t.TempDir()
	sshDir := filepath.Join(tmpDir, "ssh")
	if err := os.MkdirAll(sshDir, 0755); err != nil {
		t.Fatalf("failed to create ssh dir: %v", err)
	}

	// 1. Setup local known_hosts
	localLines := []string{
		"example.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYW1vY2tsb2NhbA==",
		"example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAZWRsb2NhbA==",
	}
	localPath := filepath.Join(sshDir, "known_hosts")
	if err := os.WriteFile(localPath, []byte(strings.Join(localLines, "\n")+"\n"), 0600); err != nil {
		t.Fatalf("failed to write local known_hosts: %v", err)
	}

	// 2. Setup mock cached device known_hosts
	deviceDir := filepath.Join(tmpDir, "devices_sshdata", "mock_device")
	if err := os.MkdirAll(deviceDir, 0755); err != nil {
		t.Fatalf("failed to create device dir: %v", err)
	}
	remoteLines := []string{
		"example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAZWRsb2NhbA==",             // Same
		"example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAZWRyZW1vdGVkaWZmZXJlbnQ=", // Conflict (same type, different data)
		"example.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCsYW1wbGVyZW1vdGVyc2E=", // New (different type)
		"newhost.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAbmV3aG9zdGtleQ==",         // New (new host)
	}
	remotePath := filepath.Join(deviceDir, "known_hosts")
	if err := os.WriteFile(remotePath, []byte(strings.Join(remoteLines, "\n")+"\n"), 0600); err != nil {
		t.Fatalf("failed to write remote known_hosts: %v", err)
	}

	gCfg = &config.Config{
		ConfigDir: tmpDir,
		AbsSSHDir: sshDir,
	}

	// Run ReadDeviceKnownHosts
	entries, err := ReadDeviceKnownHosts("mock_device")
	if err != nil {
		t.Fatalf("ReadDeviceKnownHosts failed: %v", err)
	}

	if len(entries) != 4 {
		t.Fatalf("expected 4 entries, got %d", len(entries))
	}

	// Verify Entry 0: Same
	if entries[0].IsNew || entries[0].IsConflict {
		t.Errorf("entry 0 (same) should not be new or conflict: isNew=%t, isConflict=%t", entries[0].IsNew, entries[0].IsConflict)
	}

	// Verify Entry 1: Conflict
	if entries[1].IsNew || !entries[1].IsConflict {
		t.Errorf("entry 1 (conflict) expected isNew=false, isConflict=true: isNew=%t, isConflict=%t", entries[1].IsNew, entries[1].IsConflict)
	}
	if entries[1].LocalKeyType != "ssh-ed25519" || entries[1].LocalKeyData != "AAAAC3NzaC1lZDI1NTE5AAAAZWRsb2NhbA==" {
		t.Errorf("entry 1 (conflict) local details mismatch: type=%s, data=%s", entries[1].LocalKeyType, entries[1].LocalKeyData)
	}

	// Verify Entry 2: New (different key type)
	if !entries[2].IsNew || entries[2].IsConflict {
		t.Errorf("entry 2 (different type) should be new and not conflict: isNew=%t, isConflict=%t", entries[2].IsNew, entries[2].IsConflict)
	}

	// Verify Entry 3: New (new host)
	if !entries[3].IsNew || entries[3].IsConflict {
		t.Errorf("entry 3 (new host) should be new and not conflict: isNew=%t, isConflict=%t", entries[3].IsNew, entries[3].IsConflict)
	}

	// 3. Test Import without force
	toImport := []string{
		"example.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCsYW1wbGVyZW1vdGVyc2E=", // Should be imported
		"example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAZWRyZW1vdGVkc3luY2RpZmY=", // Conflict, should not be imported
	}
	err = ImportKnownHostsLines("mock_device", toImport, false)
	if err != nil {
		t.Fatalf("ImportKnownHostsLines failed: %v", err)
	}

	importedData, err := os.ReadFile(localPath)
	if err != nil {
		t.Fatalf("failed to read imported local known_hosts: %v", err)
	}
	importedStr := string(importedData)

	if !strings.Contains(importedStr, "example.com ssh-rsa") {
		t.Errorf("expected imported file to contain ssh-rsa key")
	}
	if strings.Contains(importedStr, "ZWRyZW1vdGVkc3luY2RpZmY=") {
		t.Errorf("should not contain conflicting key when force=false")
	}

	// 4. Test Import with force
	err = ImportKnownHostsLines("mock_device", toImport, true)
	if err != nil {
		t.Fatalf("ImportKnownHostsLines with force failed: %v", err)
	}

	importedData2, err := os.ReadFile(localPath)
	if err != nil {
		t.Fatalf("failed to read imported local known_hosts: %v", err)
	}
	importedStr2 := string(importedData2)

	if !strings.Contains(importedStr2, "ZWRyZW1vdGVkc3luY2RpZmY=") {
		t.Errorf("expected imported file to contain conflicting key when force=true")
	}
	if strings.Contains(importedStr2, "ZWRsb2NhbA==") {
		t.Errorf("expected local conflicting key to be overwritten when force=true")
	}
}

func TestImportSSHConfigHosts_WithPassword(t *testing.T) {
	tmpDir := t.TempDir()
	sshDir := filepath.Join(tmpDir, "ssh")
	if err := os.MkdirAll(sshDir, 0755); err != nil {
		t.Fatalf("failed to create ssh dir: %v", err)
	}

	// 1. Setup mock cached device ssh config with CozySshPassword comment
	deviceDir := filepath.Join(tmpDir, "devices_sshdata", "mock_csv_device")
	if err := os.MkdirAll(deviceDir, 0755); err != nil {
		t.Fatalf("failed to create device dir: %v", err)
	}

	configContent := `Host my-csv-host
    HostName 10.0.0.99
    User my-csv-user
    Port 2222
    # CozySshPassword super-secret-password-123
`
	if err := os.WriteFile(filepath.Join(deviceDir, "config"), []byte(configContent), 0600); err != nil {
		t.Fatalf("failed to write mock config: %v", err)
	}

	gCfg = &config.Config{
		ConfigDir: tmpDir,
		AbsSSHDir: sshDir,
	}

	// Setup passstore and unlock it
	pwdHash, err := yescrypt.GenerateFromPassword([]byte("my-app-pass"))
	if err != nil {
		t.Fatalf("failed to generate app password hash: %v", err)
	}
	passstore.Init(tmpDir, string(pwdHash))
	if !passstore.SetEncryptionKey("my-app-pass") {
		t.Fatalf("failed to unlock passstore")
	}

	// Import the host
	err = ImportSSHConfigHosts("mock_csv_device", []string{"my-csv-host"})
	if err != nil {
		t.Fatalf("ImportSSHConfigHosts failed: %v", err)
	}

	// 2. Verify password was saved in passstore under canonical address "my-csv-user@10.0.0.99:2222"
	savedPwd, err := passstore.Get("my-csv-user@10.0.0.99:2222")
	if err != nil {
		t.Fatalf("failed to get saved password from passstore: %v", err)
	}
	if savedPwd != "super-secret-password-123" {
		t.Errorf("expected password 'super-secret-password-123', got '%s'", savedPwd)
	}

	// 3. Verify local config was written and comment is stripped
	localCfgPath := filepath.Join(sshDir, "config")
	localData, err := os.ReadFile(localCfgPath)
	if err != nil {
		t.Fatalf("failed to read local config: %v", err)
	}
	localStr := string(localData)

	if !strings.Contains(localStr, "Host my-csv-host") {
		t.Error("missing Host my-csv-host in local config")
	}
	if !strings.Contains(localStr, "HostName 10.0.0.99") {
		t.Error("missing HostName 10.0.0.99 in local config")
	}
	if strings.Contains(localStr, "CozySshPassword") {
		t.Error("expected CozySshPassword comment to be stripped from local config")
	}
}
