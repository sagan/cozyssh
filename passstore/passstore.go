package passstore

import (
	"cozyssh/common"
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

	"github.com/awnumar/memguard"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrNoKey          = errors.New("encryption key not set")
	ErrDecryptionFail = errors.New("decryption failed; incorrect app password")
)

type PasswordFile struct {
	Salt         string            `json:"salt"`          // Used to derive KEK via Argon2
	EncryptedDEK string            `json:"encrypted_dek"` // The auto-generated key, encrypted by KEK
	Passwords    map[string]string `json:"passwords"`     // Encrypted via the plaintext DEK
}

var (
	mu                   sync.RWMutex
	encryptionKeyEnclave *memguard.Enclave
	passwordFile         string
	appPasswordHash      string
)

// Init initializes the passstore with config directory and current app password hash.
func Init(dir string, hash string) {
	mu.Lock()
	defer mu.Unlock()
	passwordFile = filepath.Join(dir, "passwords.json")
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

	pf, err := readPasswordFile()
	if err != nil || pf.EncryptedDEK == "" {
		// Either file doesn't exist, is invalid, or has no encrypted DEK.
		// We generate a new DEK and a new salt.
		salt := make([]byte, 16)
		if _, err := io.ReadFull(rand.Reader, salt); err != nil {
			return false
		}

		dek := make([]byte, 32)
		if _, err := io.ReadFull(rand.Reader, dek); err != nil {
			return false
		}

		kek := deriveKey(appPassword, salt)
		defer func() {
			for i := range kek {
				kek[i] = 0
			}
		}()

		encDEK, err := encryptDEK(dek, kek)
		if err != nil {
			return false
		}

		if pf == nil {
			pf = &PasswordFile{}
		}
		pf.Salt = base64.StdEncoding.EncodeToString(salt)
		pf.EncryptedDEK = encDEK
		if pf.Passwords == nil {
			pf.Passwords = make(map[string]string)
		}

		if err := writePasswordFile(pf); err != nil {
			return false
		}

		// Store DEK in enclave
		encryptionKeyEnclave = memguard.NewBufferFromBytes(dek).Seal()
		for i := range dek {
			dek[i] = 0
		}
		return true
	}

	// If file exists and has EncryptedDEK
	salt, err := base64.StdEncoding.DecodeString(pf.Salt)
	if err != nil || len(salt) == 0 {
		return false
	}

	kek := deriveKey(appPassword, salt)
	defer func() {
		for i := range kek {
			kek[i] = 0
		}
	}()

	dek, err := decryptDEK(pf.EncryptedDEK, kek)
	if err != nil {
		return false
	}
	defer func() {
		for i := range dek {
			dek[i] = 0
		}
	}()

	encryptionKeyEnclave = memguard.NewBufferFromBytes(dek).Seal()
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

	dekBuf, err := encryptionKeyEnclave.Open()
	if err != nil {
		return "", err
	}
	defer dekBuf.Destroy()

	plaintext, err := decrypt(ciphertext, dekBuf.Bytes())
	if err != nil {
		return "", ErrDecryptionFail
	}

	result := string(plaintext)
	// zero plaintext
	for i := range plaintext {
		plaintext[i] = 0
	}
	return result, nil
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
		return err
	}

	dekBuf, err := encryptionKeyEnclave.Open()
	if err != nil {
		return err
	}
	defer dekBuf.Destroy()

	ciphertext, err := encrypt([]byte(password), dekBuf.Bytes())
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

// ListKeys returns a list of all password keys.
func ListKeys() ([]string, error) {
	mu.RLock()
	defer mu.RUnlock()

	pf, err := readPasswordFile()
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}

	keys := make([]string, 0, len(pf.Passwords))
	for k := range pf.Passwords {
		keys = append(keys, k)
	}
	return keys, nil
}

func DeletePasswordFile(force bool) error {
	mu.Lock()
	defer mu.Unlock()
	if !force {
		pf, err := readPasswordFile()
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if len(pf.Passwords) > 0 {
			return errors.New("passwords file is not empty")
		}
	}
	return os.Remove(passwordFile)
}

// Reencrypt re-encrypts all stored passwords from an old app password to a new one.
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

	if pf.EncryptedDEK == "" {
		return nil
	}

	oldSalt, err := base64.StdEncoding.DecodeString(pf.Salt)
	if err != nil || len(oldSalt) == 0 {
		return errors.New("invalid salt in passwords file")
	}

	oldKek := deriveKey(oldPassword, oldSalt)
	defer func() {
		for i := range oldKek {
			oldKek[i] = 0
		}
	}()

	dek, err := decryptDEK(pf.EncryptedDEK, oldKek)
	if err != nil {
		return fmt.Errorf("failed to decrypt DEK: %w", err)
	}
	defer func() {
		for i := range dek {
			dek[i] = 0
		}
	}()

	// Generate new salt and key
	newSalt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, newSalt); err != nil {
		return err
	}
	newKek := deriveKey(newPassword, newSalt)
	defer func() {
		for i := range newKek {
			newKek[i] = 0
		}
	}()

	newEncryptedDEK, err := encryptDEK(dek, newKek)
	if err != nil {
		return err
	}

	pf.Salt = base64.StdEncoding.EncodeToString(newSalt)
	pf.EncryptedDEK = newEncryptedDEK

	return writePasswordFile(pf)
}

// ReencryptWithInMemoryKey re-encrypts the DEK using the active key in memory and the new app password.
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

	dekBuf, err := encryptionKeyEnclave.Open()
	if err != nil {
		return err
	}
	defer dekBuf.Destroy()

	// Generate new salt
	newSalt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, newSalt); err != nil {
		return err
	}
	newKek := deriveKey(newPassword, newSalt)
	defer func() {
		for i := range newKek {
			newKek[i] = 0
		}
	}()

	newEncryptedDEK, err := encryptDEK(dekBuf.Bytes(), newKek)
	if err != nil {
		return err
	}

	pf.Salt = base64.StdEncoding.EncodeToString(newSalt)
	pf.EncryptedDEK = newEncryptedDEK

	return writePasswordFile(pf)
}

// Helper methods

func readPasswordFile() (*PasswordFile, error) {
	data, err := os.ReadFile(passwordFile)
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
	os.MkdirAll(filepath.Dir(passwordFile), 0700)

	return common.AtomicWriteFile(passwordFile, func(writer io.Writer) error {
		return json.NewEncoder(writer).Encode(pf)
	})
}

func deriveKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)
}

// Pad the data (password) to at least 64 bytes to prevent leaking its length.
// The padding scheme is similar to TLS 1.3: <original text> + marker (0x1) + <zero padding bytes>
func pad(data []byte) []byte {
	L := len(data)
	if L < 63 {
		res := make([]byte, 64)
		copy(res, data)
		res[L] = 0x01
		return res
	}
	res := make([]byte, L+1)
	copy(res, data)
	res[L] = 0x01
	return res
}

func unpad(data []byte) ([]byte, error) {
	L := len(data)
	if L == 0 {
		return nil, errors.New("empty data")
	}
	i := L - 1
	for i >= 0 && data[i] == 0x00 {
		i--
	}
	if i < 0 {
		return nil, errors.New("invalid padding: no marker found")
	}
	if data[i] != 0x01 {
		return nil, errors.New("invalid padding: marker is not 0x01")
	}
	return data[:i], nil
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
	padded := pad(plaintext)
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
	return unpad(plaintext)
}

func encryptDEK(dek []byte, kek []byte) (string, error) {
	block, err := aes.NewCipher(kek)
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
	ciphertext := aesgcm.Seal(nonce, nonce, dek, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func decryptDEK(encryptedDEKStr string, kek []byte) ([]byte, error) {
	encryptedDEK, err := base64.StdEncoding.DecodeString(encryptedDEKStr)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(kek)
	if err != nil {
		return nil, err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := aesgcm.NonceSize()
	if len(encryptedDEK) < nonceSize {
		return nil, errors.New("encrypted DEK too short")
	}
	nonce, actualCiphertext := encryptedDEK[:nonceSize], encryptedDEK[nonceSize:]
	dek, err := aesgcm.Open(nil, nonce, actualCiphertext, nil)
	if err != nil {
		return nil, err
	}
	return dek, nil
}
