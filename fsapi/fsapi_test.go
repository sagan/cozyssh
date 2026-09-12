package fsapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUploadTracker(t *testing.T) {
	tracker := &uploadTracker{
		uploads: make(map[string]*UploadProgressItem),
	}

	sessionID := "sess-test-1"
	uploadID := "upload-123"
	filename := "testfile.bin"
	total := int64(1024 * 1024) // 1MB

	tracker.Register(sessionID, uploadID, filename, total)

	// Verify registered
	items := tracker.GetBySession(sessionID)
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	item, ok := items[uploadID]
	if !ok {
		t.Fatalf("expected uploadID %s in items", uploadID)
	}
	if item.Written != 0 {
		t.Errorf("expected 0 written, got %d", item.Written)
	}
	if item.Total != total {
		t.Errorf("expected total %d, got %d", total, item.Total)
	}

	// Update bytes
	tracker.Update(uploadID, 256*1024)
	tracker.Update(uploadID, 256*1024)

	items = tracker.GetBySession(sessionID)
	item = items[uploadID]
	if item.Written != 512*1024 {
		t.Errorf("expected 512KB written, got %d", item.Written)
	}

	// Unregister
	tracker.Unregister(uploadID)
	items = tracker.GetBySession(sessionID)
	if len(items) != 0 {
		t.Fatalf("expected 0 items after unregister, got %d", len(items))
	}
}

func TestProgressReader(t *testing.T) {
	content := "Hello, this is a test data stream for upload progress tracking."
	src := strings.NewReader(content)
	ctx := context.Background()

	var totalRead int64
	pr := &progressReader{
		r:   src,
		ctx: ctx,
		onRead: func(n int) {
			totalRead += int64(n)
		},
	}

	buf, err := io.ReadAll(pr)
	if err != nil {
		t.Fatalf("unexpected error reading from progressReader: %v", err)
	}
	if string(buf) != content {
		t.Errorf("expected %q, got %q", content, string(buf))
	}
	if totalRead != int64(len(content)) {
		t.Errorf("expected totalRead %d, got %d", len(content), totalRead)
	}
}

func TestProgressReaderCancellation(t *testing.T) {
	content := strings.Repeat("A", 1024*1024)
	src := strings.NewReader(content)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	pr := &progressReader{
		r:   src,
		ctx: ctx,
		onRead: func(n int) {
		},
	}

	buf := make([]byte, 1024)
	_, err := pr.Read(buf)
	if err != context.Canceled {
		t.Fatalf("expected context.Canceled error, got %v", err)
	}
}

func TestHandleUploadProgress(t *testing.T) {
	sessionID := "sess-progress-test"
	uploadID := "up-abc-456"

	globalUploadTracker.Register(sessionID, uploadID, "sample.txt", 5000)
	defer globalUploadTracker.Unregister(uploadID)
	globalUploadTracker.Update(uploadID, 2500)

	req := httptest.NewRequest(http.MethodGet, "/api/fs/upload/progress?id="+sessionID, nil)
	w := httptest.NewRecorder()

	handleUploadProgress(w, req, sessionID)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	var data struct {
		Uploads map[string]UploadProgressItem `json:"uploads"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		t.Fatalf("failed to decode JSON response: %v", err)
	}

	item, ok := data.Uploads[uploadID]
	if !ok {
		t.Fatalf("expected upload item %s in response", uploadID)
	}
	if item.Written != 2500 || item.Total != 5000 {
		t.Errorf("expected written=2500, total=5000; got written=%d, total=%d", item.Written, item.Total)
	}
}
