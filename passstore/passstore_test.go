package passstore

import (
	"cozyssh/constants"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestPassStore(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "passstore-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	appPassword := "master_secret_123"
	hashBytes, err := bcrypt.GenerateFromPassword([]byte(appPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}

	Init(tempDir, string(hashBytes))

	// Verify initially empty
	if !IsEmpty() {
		t.Errorf("expected store to be empty initially")
	}

	// Setting key with incorrect password should fail
	if SetEncryptionKey("wrong_password") {
		t.Errorf("expected SetEncryptionKey with wrong password to return false")
	}

	// Setting key with correct password should succeed
	if !SetEncryptionKey(appPassword) {
		t.Fatalf("expected SetEncryptionKey with correct password to return true")
	}

	if !HasEncryptionKey() {
		t.Errorf("expected HasEncryptionKey to return true after setting it")
	}

	// Set password for a host
	addr := "root@127.0.0.1:22"
	hostPass := "secret_ssh_pass"

	err = Set(addr, hostPass)
	if err != nil {
		t.Fatalf("failed to set password: %v", err)
	}

	if IsEmpty() {
		t.Errorf("expected store not to be empty after Set")
	}

	if !HasPassword(addr) {
		t.Errorf("expected HasPassword to return true for %s", addr)
	}

	// Retrieve password
	retrieved, err := Get(addr)
	if err != nil {
		t.Fatalf("failed to get password: %v", err)
	}
	if retrieved != hostPass {
		t.Errorf("expected retrieved password %q, got %q", hostPass, retrieved)
	}

	// Clear encryption key and verify Get fails
	ClearEncryptionKey()
	if HasEncryptionKey() {
		t.Errorf("expected HasEncryptionKey to be false after clearing")
	}

	_, err = Get(addr)
	if err != ErrNoKey {
		t.Errorf("expected ErrNoKey after clearing key, got %v", err)
	}

	// Restore key
	if !SetEncryptionKey(appPassword) {
		t.Fatalf("failed to restore encryption key")
	}

	// Test ReencryptWithInMemoryKey
	newAppPassword := "new_secret_456"
	newHashBytes, err := bcrypt.GenerateFromPassword([]byte(newAppPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("failed to generate new bcrypt hash: %v", err)
	}

	err = ReencryptWithInMemoryKey(newAppPassword)
	if err != nil {
		t.Fatalf("ReencryptWithInMemoryKey failed: %v", err)
	}

	// Update hash configuration
	SetAppPasswordHash(string(newHashBytes))

	// Clear and verify new key unlocks it
	ClearEncryptionKey()
	if !SetEncryptionKey(newAppPassword) {
		t.Fatalf("expected SetEncryptionKey with new password to succeed")
	}

	retrieved, err = Get(addr)
	if err != nil {
		t.Fatalf("failed to get password after re-encryption: %v", err)
	}
	if retrieved != hostPass {
		t.Errorf("expected retrieved password %q after re-encryption, got %q", hostPass, retrieved)
	}

	// Test Reencrypt (offline/migration)
	newAppPassword2 := "another_secret_789"
	newHashBytes2, err := bcrypt.GenerateFromPassword([]byte(newAppPassword2), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("failed to generate new bcrypt hash: %v", err)
	}

	// Update hash to old one for verification
	SetAppPasswordHash(string(newHashBytes))

	err = Reencrypt(newAppPassword, newAppPassword2)
	if err != nil {
		t.Fatalf("Reencrypt failed: %v", err)
	}

	SetAppPasswordHash(string(newHashBytes2))
	ClearEncryptionKey()

	if !SetEncryptionKey(newAppPassword2) {
		t.Fatalf("expected SetEncryptionKey with third password to succeed")
	}

	retrieved, err = Get(addr)
	if err != nil {
		t.Fatalf("failed to get password after offline re-encryption: %v", err)
	}
	if retrieved != hostPass {
		t.Errorf("expected retrieved password %q after offline re-encryption, got %q", hostPass, retrieved)
	}

	// Test Delete
	err = Delete(addr)
	if err != nil {
		t.Fatalf("failed to delete password: %v", err)
	}

	if HasPassword(addr) {
		t.Errorf("expected HasPassword to be false after deletion")
	}

	// Test identity passphrase storage
	idKey := constants.IDENTITY_PREFIX + "/home/user/.ssh/id_rsa"
	idPassphrase := "key_passphrase_xyz"
	err = Set(idKey, idPassphrase)
	if err != nil {
		t.Fatalf("failed to set identity passphrase: %v", err)
	}

	if !HasPassword(idKey) {
		t.Errorf("expected HasPassword to return true for identity key %s", idKey)
	}

	retrievedId, err := Get(idKey)
	if err != nil {
		t.Fatalf("failed to get identity passphrase: %v", err)
	}
	if retrievedId != idPassphrase {
		t.Errorf("expected retrieved passphrase %q, got %q", idPassphrase, retrievedId)
	}

	err = Delete(idKey)
	if err != nil {
		t.Fatalf("failed to delete identity passphrase: %v", err)
	}

	if !IsEmpty() {
		t.Errorf("expected store to be empty after deleting only password")
	}
}

func TestIsEmptyWithoutFile(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "passstore-test-empty")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	Init(tempDir, "")

	if !IsEmpty() {
		t.Errorf("IsEmpty should return true if file does not exist")
	}

	path := filepath.Join(tempDir, "passwords.json")
	if err := os.WriteFile(path, []byte(`{}`), 0600); err != nil {
		t.Fatalf("failed to write dummy empty file: %v", err)
	}

	if !IsEmpty() {
		t.Errorf("IsEmpty should return true if passwords map is empty")
	}
}
