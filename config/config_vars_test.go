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

	if cfg.VarsMtime == 0 {
		t.Error("Expected VarsMtime to be set on migration, got 0")
	}

	// Verify vars.json exists and has correct content
	varsPath := filepath.Join(tempDir, "vars.json")
	data, err := os.ReadFile(varsPath)
	if err != nil {
		t.Fatalf("Failed to read vars.json: %v", err)
	}

	var varsWrap struct {
		Mtime int64             `json:"mtime"`
		Vars  map[string]string `json:"vars"`
	}
	if err := json.Unmarshal(data, &varsWrap); err != nil {
		t.Fatalf("Failed to parse vars.json: %v", err)
	}

	if varsWrap.Vars["key1"] != "val1" {
		t.Errorf("Expected key1=val1, got %v", varsWrap.Vars)
	}
	if varsWrap.Mtime != cfg.VarsMtime {
		t.Errorf("Expected mtime %d, got %d", cfg.VarsMtime, varsWrap.Mtime)
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
	if cfg2.VarsMtime != cfg.VarsMtime {
		t.Errorf("Expected loaded mtime %d, got %d", cfg.VarsMtime, cfg2.VarsMtime)
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

	if cfg.VarsMtime == 0 {
		t.Error("Expected VarsMtime to be non-zero after update")
	}

	// Test deletion
	updates = map[string]*string{
		"key1": nil,
	}
	t1 := cfg.VarsMtime
	time.Sleep(2 * time.Millisecond) // Ensure timestamp changes

	err = cfg.UpdateVars(updates)
	if err != nil {
		t.Fatalf("UpdateVars deletion failed: %v", err)
	}

	if _, exists := cfg.Vars["key1"]; exists {
		t.Error("Expected key1 to be deleted")
	}

	if cfg.VarsMtime <= t1 {
		t.Errorf("Expected VarsMtime to increase, t1=%d, current=%d", t1, cfg.VarsMtime)
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
	var newMtime int64 = 999888777

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
