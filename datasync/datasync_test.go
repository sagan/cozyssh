package datasync

import (
	"cozyssh/config"
	"cozyssh/models"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
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
