package passstore

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"

	"github.com/awnumar/memguard"
)

var (
	ErrNoKey          = errors.New("encryption key not set")
	ErrDecryptionFail = errors.New("decryption failed; incorrect app password")
)

type PasswordFile struct {
	Salt      string            `json:"salt"`
	Passwords map[string]string `json:"passwords"`
}

var (
	mu                   sync.RWMutex
	encryptionKeyEnclave *memguard.Enclave
	configDir            string
	appPasswordHash      string
)

// Init initializes the passstore with config directory and current app password hash.
func Init(dir string, hash string) {
	mu.Lock()
	defer mu.Unlock()
	configDir = dir
	appPasswordHash = hash
}

// SetAppPasswordHash updates the app password hash in memory.
func SetAppPasswordHash(hash string) {
	mu.Lock()
	defer mu.Unlock()
	appPasswordHash = hash
}

// SetEncryptionKey verifies the app password and derives the AES key.
func SetEncryptionKey(appPassword string) bool {
	mu.Lock()
	defer mu.Unlock()

	if appPasswordHash == "" {
		return false
	}

	// Verify app password
	if err := bcrypt.CompareHashAndPassword([]byte(appPasswordHash), []byte(appPassword)); err != nil {
		return false
	}

	// Derive the key
	salt, err := getOrCreateSalt()
	if err != nil {
		return false
	}

	derived := deriveKey(appPassword, salt)
	encryptionKeyEnclave = memguard.NewBufferFromBytes(derived).Seal()
	return true
}

// HasEncryptionKey returns whether the encryption key is derived and held in memory.
func HasEncryptionKey() bool {
	mu.RLock()
	defer mu.RUnlock()
	return encryptionKeyEnclave != nil
}

// ClearEncryptionKey wipes the key from memory.
func ClearEncryptionKey() {
	mu.Lock()
	defer mu.Unlock()
	if encryptionKeyEnclave != nil {
		if buf, err := encryptionKeyEnclave.Open(); err == nil {
			buf.Destroy()
		}
		encryptionKeyEnclave = nil
	}
}

// HasPassword checks if a password exists for the given address without decrypting it.
func HasPassword(addr string) bool {
	mu.RLock()
	defer mu.RUnlock()

	pf, err := readPasswordFile()
	if err != nil {
		return false
	}
	val, ok := pf.Passwords[addr]
	return ok && val != ""
}

// Get decrypts and returns the password for the given address.
func Get(addr string) (string, error) {
	mu.RLock()
	defer mu.RUnlock()

	if encryptionKeyEnclave == nil {
		return "", ErrNoKey
	}

	pf, err := readPasswordFile()
	if err != nil {
		return "", err
	}

	ciphertext, ok := pf.Passwords[addr]
	if !ok || ciphertext == "" {
		return "", fmt.Errorf("no password saved for address %s", addr)
	}

	keyBuf, err := encryptionKeyEnclave.Open()
	if err != nil {
		return "", err
	}
	defer keyBuf.Destroy()

	plaintext, err := decrypt(ciphertext, keyBuf.Bytes())
	if err != nil {
		return "", ErrDecryptionFail
	}

	return string(plaintext), nil
}

// Set encrypts and saves the password for the given address.
func Set(addr string, password string) error {
	mu.Lock()
	defer mu.Unlock()

	if encryptionKeyEnclave == nil {
		return ErrNoKey
	}

	pf, err := readPasswordFile()
	if err != nil {
		// If read failed (e.g. file doesn't exist), initialize a new structure
		pf = &PasswordFile{
			Passwords: make(map[string]string),
		}
	}

	if pf.Salt == "" {
		salt, err := getOrCreateSalt()
		if err != nil {
			return err
		}
		pf.Salt = base64.StdEncoding.EncodeToString(salt)
	}

	keyBuf, err := encryptionKeyEnclave.Open()
	if err != nil {
		return err
	}
	defer keyBuf.Destroy()

	ciphertext, err := encrypt([]byte(password), keyBuf.Bytes())
	if err != nil {
		return err
	}

	if pf.Passwords == nil {
		pf.Passwords = make(map[string]string)
	}
	pf.Passwords[addr] = ciphertext

	return writePasswordFile(pf)
}

// Delete removes the password for the given address.
func Delete(addr string) error {
	mu.Lock()
	defer mu.Unlock()

	pf, err := readPasswordFile()
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	if pf.Passwords == nil {
		return nil
	}

	if _, ok := pf.Passwords[addr]; !ok {
		return nil
	}

	delete(pf.Passwords, addr)
	return writePasswordFile(pf)
}

// IsEmpty returns whether the password store has no entries or doesn't exist.
func IsEmpty() bool {
	mu.RLock()
	defer mu.RUnlock()

	pf, err := readPasswordFile()
	if err != nil {
		return true
	}
	return len(pf.Passwords) == 0
}

// Reencrypt re-encrypts all stored passwords from an old app password to a one.
func Reencrypt(oldPassword string, newPassword string) error {
	mu.Lock()
	defer mu.Unlock()

	// Verify old app password if hash is present
	if appPasswordHash != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(appPasswordHash), []byte(oldPassword)); err != nil {
			return errors.New("incorrect old app password")
		}
	}

	pf, err := readPasswordFile()
	if err != nil {
		if os.IsNotExist(err) {
			// Nothing to re-encrypt, just set hash if needed
			return nil
		}
		return err
	}

	if len(pf.Passwords) == 0 {
		return nil
	}

	oldSalt, err := base64.StdEncoding.DecodeString(pf.Salt)
	if err != nil || len(oldSalt) == 0 {
		return errors.New("invalid salt in passwords file")
	}

	oldKey := deriveKey(oldPassword, oldSalt)

	// Decrypt all existing passwords
	decrypted := make(map[string]string)
	for addr, ciphertext := range pf.Passwords {
		plaintext, err := decrypt(ciphertext, oldKey)
		if err != nil {
			// Wipe oldKey on error
			for i := range oldKey {
				oldKey[i] = 0
			}
			return fmt.Errorf("failed to decrypt password for %s: %w", addr, err)
		}
		decrypted[addr] = string(plaintext)
	}
	// Wipe oldKey after usage
	for i := range oldKey {
		oldKey[i] = 0
	}

	// Generate new salt and key
	newSalt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, newSalt); err != nil {
		return err
	}
	newKey := deriveKey(newPassword, newSalt)

	// Encrypt with new key
	newPasswords := make(map[string]string)
	for addr, plaintext := range decrypted {
		ciphertext, err := encrypt([]byte(plaintext), newKey)
		if err != nil {
			// Wipe newKey on error
			for i := range newKey {
				newKey[i] = 0
			}
			return err
		}
		newPasswords[addr] = ciphertext
	}

	pf.Salt = base64.StdEncoding.EncodeToString(newSalt)
	pf.Passwords = newPasswords

	err = writePasswordFile(pf)
	if err != nil {
		// Wipe newKey on error
		for i := range newKey {
			newKey[i] = 0
		}
		return err
	}

	// Update active encryption key in memory if it was active
	if encryptionKeyEnclave != nil {
		encryptionKeyEnclave = memguard.NewBufferFromBytes(newKey).Seal()
	} else {
		// Wipe newKey if it's not active
		for i := range newKey {
			newKey[i] = 0
		}
	}

	return nil
}

// ReencryptWithInMemoryKey re-encrypts all stored passwords using the active key in memory.
func ReencryptWithInMemoryKey(newPassword string) error {
	mu.Lock()
	defer mu.Unlock()

	if encryptionKeyEnclave == nil {
		return ErrNoKey
	}

	pf, err := readPasswordFile()
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	if len(pf.Passwords) == 0 {
		return nil
	}

	// Decrypt all existing passwords using active key
	keyBuf, err := encryptionKeyEnclave.Open()
	if err != nil {
		return err
	}
	decrypted := make(map[string]string)
	for addr, ciphertext := range pf.Passwords {
		plaintext, err := decrypt(ciphertext, keyBuf.Bytes())
		if err != nil {
			keyBuf.Destroy()
			return fmt.Errorf("failed to decrypt password for %s: %w", addr, err)
		}
		decrypted[addr] = string(plaintext)
	}
	keyBuf.Destroy()

	// Generate new salt and key
	newSalt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, newSalt); err != nil {
		return err
	}
	newKey := deriveKey(newPassword, newSalt)

	// Encrypt with new key
	newPasswords := make(map[string]string)
	for addr, plaintext := range decrypted {
		ciphertext, err := encrypt([]byte(plaintext), newKey)
		if err != nil {
			// Wipe newKey on error
			for i := range newKey {
				newKey[i] = 0
			}
			return err
		}
		newPasswords[addr] = ciphertext
	}

	pf.Salt = base64.StdEncoding.EncodeToString(newSalt)
	pf.Passwords = newPasswords

	err = writePasswordFile(pf)
	if err != nil {
		// Wipe newKey on error
		for i := range newKey {
			newKey[i] = 0
		}
		return err
	}

	encryptionKeyEnclave = memguard.NewBufferFromBytes(newKey).Seal()
	return nil
}

// Helper methods

func getPasswordsPath() string {
	return filepath.Join(configDir, "passwords.json")
}

func getOrCreateSalt() ([]byte, error) {
	pf, err := readPasswordFile()
	if err == nil && pf.Salt != "" {
		salt, err := base64.StdEncoding.DecodeString(pf.Salt)
		if err == nil && len(salt) > 0 {
			return salt, nil
		}
	}

	// Create new salt
	salt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}

	// Persist the salt immediately so subsequent reads use the same salt.
	pf = &PasswordFile{
		Salt:      base64.StdEncoding.EncodeToString(salt),
		Passwords: make(map[string]string),
	}
	if err := writePasswordFile(pf); err != nil {
		return nil, err
	}

	return salt, nil
}

func readPasswordFile() (*PasswordFile, error) {
	path := getPasswordsPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var pf PasswordFile
	if err := json.Unmarshal(data, &pf); err != nil {
		return nil, err
	}
	return &pf, nil
}

func writePasswordFile(pf *PasswordFile) error {
	path := getPasswordsPath()
	data, err := json.MarshalIndent(pf, "", "  ")
	if err != nil {
		return err
	}
	// Restrict to user-only read/write
	os.MkdirAll(filepath.Dir(path), 0700)
	return os.WriteFile(path, data, 0600)
}

func deriveKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)
}

func padPKCS7(data []byte) []byte {
	blockSize := 64
	padding := blockSize - (len(data) % blockSize)
	padText := make([]byte, padding)
	for i := range padText {
		padText[i] = byte(padding)
	}
	return append(data, padText...)
}

func unpadPKCS7(data []byte) ([]byte, error) {
	blockSize := 64
	length := len(data)
	if length == 0 {
		return nil, errors.New("empty data")
	}
	if length%blockSize != 0 {
		return nil, errors.New("invalid padding: data length is not a multiple of 64")
	}
	padding := int(data[length-1])
	if padding < 1 || padding > blockSize {
		return nil, errors.New("invalid padding size")
	}
	for i := length - padding; i < length; i++ {
		if data[i] != byte(padding) {
			return nil, errors.New("invalid padding bytes")
		}
	}
	return data[:length-padding], nil
}

func encrypt(plaintext []byte, key []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aesgcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	padded := padPKCS7(plaintext)
	ciphertext := aesgcm.Seal(nonce, nonce, padded, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func decrypt(ciphertextStr string, key []byte) ([]byte, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(ciphertextStr)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := aesgcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}
	nonce, actualCiphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesgcm.Open(nil, nonce, actualCiphertext, nil)
	if err != nil {
		return nil, err
	}
	return unpadPKCS7(plaintext)
}
