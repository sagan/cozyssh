package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadVarsMigration(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cozyssh-config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Case 1: Migrate existing vars in Config struct when vars.json doesn't exist
	cfg := &Config{
		ConfigDir: tempDir,
		Vars: map[string]string{
			"key1": "val1",
		},
	}

	err = cfg.loadVars()
	if err != nil {
		t.Fatalf("loadVars failed: %v", err)
	}

	if len(cfg.VarsMtime) == 0 {
		t.Error("Expected VarsMtime to be set on migration, got empty map")
	}

	// Verify vars.json exists and has correct content
	varsPath := filepath.Join(tempDir, "vars.json")
	data, err := os.ReadFile(varsPath)
	if err != nil {
		t.Fatalf("Failed to read vars.json: %v", err)
	}

	var varsWrap struct {
		Mtime map[string]int64  `json:"mtime"`
		Vars  map[string]string `json:"vars"`
	}
	if err := json.Unmarshal(data, &varsWrap); err != nil {
		t.Fatalf("Failed to parse vars.json: %v", err)
	}

	if varsWrap.Vars["key1"] != "val1" {
		t.Errorf("Expected key1=val1, got %v", varsWrap.Vars)
	}
	if varsWrap.Mtime["key1"] != cfg.VarsMtime["key1"] {
		t.Errorf("Expected mtime %d, got %d", cfg.VarsMtime["key1"], varsWrap.Mtime["key1"])
	}

	// Case 2: Load existing vars.json
	cfg2 := &Config{
		ConfigDir: tempDir,
	}
	err = cfg2.loadVars()
	if err != nil {
		t.Fatalf("loadVars failed: %v", err)
	}

	if cfg2.Vars["key1"] != "val1" {
		t.Errorf("Expected loaded key1=val1, got %v", cfg2.Vars)
	}
	if cfg2.VarsMtime["key1"] != cfg.VarsMtime["key1"] {
		t.Errorf("Expected loaded mtime %d, got %d", cfg.VarsMtime["key1"], cfg2.VarsMtime["key1"])
	}
}

func TestLoadVarsOldIntMtimeMigration(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cozyssh-config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create old vars.json with integer mtime
	varsPath := filepath.Join(tempDir, "vars.json")
	oldContent := `{
		"mtime": 17000000,
		"vars": {
			"key1": "val1",
			"key2": "val2"
		}
	}`
	if err := os.WriteFile(varsPath, []byte(oldContent), 0600); err != nil {
		t.Fatalf("Failed to write old vars.json: %v", err)
	}

	cfg := &Config{
		ConfigDir: tempDir,
	}
	if err := cfg.loadVars(); err != nil {
		t.Fatalf("loadVars failed: %v", err)
	}

	if cfg.VarsMtime["key1"] != 17000000 || cfg.VarsMtime["key2"] != 17000000 {
		t.Errorf("Expected migrated mtimes to be 17000000, got: %v", cfg.VarsMtime)
	}
}

func TestUpdateVars(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cozyssh-config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &Config{
		ConfigDir: tempDir,
		Vars:      make(map[string]string),
	}

	// Set up Callback
	callbackCalled := false
	OnVarsUpdate = func() {
		callbackCalled = true
	}
	defer func() { OnVarsUpdate = nil }()

	val1 := "newval"
	updates := map[string]*string{
		"key1": &val1,
	}

	err = cfg.UpdateVars(updates)
	if err != nil {
		t.Fatalf("UpdateVars failed: %v", err)
	}

	if !callbackCalled {
		t.Error("Expected OnVarsUpdate callback to be called")
	}

	if cfg.Vars["key1"] != "newval" {
		t.Errorf("Expected key1=newval, got %s", cfg.Vars["key1"])
	}

	if len(cfg.VarsMtime) == 0 {
		t.Error("Expected VarsMtime to be non-empty after update")
	}

	// Test deletion
	updates = map[string]*string{
		"key1": nil,
	}
	t1 := cfg.VarsMtime["key1"]
	time.Sleep(2 * time.Millisecond) // Ensure timestamp changes

	err = cfg.UpdateVars(updates)
	if err != nil {
		t.Fatalf("UpdateVars deletion failed: %v", err)
	}

	if _, exists := cfg.Vars["key1"]; exists {
		t.Error("Expected key1 to be deleted")
	}

	if cfg.VarsMtime["key1"] <= t1 {
		t.Errorf("Expected VarsMtime for key1 to increase, t1=%d, current=%d", t1, cfg.VarsMtime["key1"])
	}
}

func TestSetVarsAndGetVars(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cozyssh-config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &Config{
		ConfigDir: tempDir,
	}

	newVars := map[string]string{
		"k1": "v1",
		"k2": "v2",
	}
	newMtime := map[string]int64{
		"k1": 999888777,
		"k2": 999888778,
	}

	err = cfg.SetVars(newVars, newMtime)
	if err != nil {
		t.Fatalf("SetVars failed: %v", err)
	}

	copied := cfg.GetVars()
	if copied["k1"] != "v1" || copied["k2"] != "v2" || len(copied) != 2 {
		t.Errorf("GetVars returned incorrect map: %v", copied)
	}

	// Verify we returned a copy, not the original map reference
	copied["k1"] = "mutated"
	if cfg.Vars["k1"] != "v1" {
		t.Error("GetVars returned a reference to the internal map instead of a copy")
	}
}

func TestUpdateVarsOldMarkerCleanup(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cozyssh-config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &Config{
		ConfigDir: tempDir,
		Vars: map[string]string{
			"activeKey": "activeVal",
		},
		VarsMtime: map[string]int64{
			"activeKey": 17000000,
			"oldDeletedKey": 100, // Very old, should be cleaned up
			"recentDeletedKey": time.Now().UnixMilli() - 1000, // Recent, should remain
		},
	}

	// Save and trigger cleanup via UpdateVars (empty update map just to trigger flow)
	err = cfg.UpdateVars(map[string]*string{})
	if err != nil {
		t.Fatalf("UpdateVars failed: %v", err)
	}

	if _, exists := cfg.VarsMtime["oldDeletedKey"]; exists {
		t.Error("Expected oldDeletedKey to be cleaned up from VarsMtime")
	}
	if _, exists := cfg.VarsMtime["recentDeletedKey"]; !exists {
		t.Error("Expected recentDeletedKey to remain in VarsMtime")
	}
	if _, exists := cfg.VarsMtime["activeKey"]; !exists {
		t.Error("Expected activeKey to remain in VarsMtime")
	}
}

