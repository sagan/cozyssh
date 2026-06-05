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
	DEKNonce     string            `json:"dek_nonce"`     // Nonce used to encrypt the DEK
	Passwords    map[string]string `json:"passwords"`     // Encrypted via the plaintext DEK
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

		encDEK, nonce, err := encryptDEK(dek, kek)
		if err != nil {
			return false
		}

		if pf == nil {
			pf = &PasswordFile{}
		}
		pf.Salt = base64.StdEncoding.EncodeToString(salt)
		pf.EncryptedDEK = encDEK
		pf.DEKNonce = nonce
		if pf.Passwords == nil {
			pf.Passwords = make(map[string]string)
		}

		if err := writePasswordFile(pf); err != nil {
			return false
		}

		// Store DEK in enclave
		encryptionKeyEnclave = memguard.NewBufferFromBytes(dek).Seal()
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

	dek, err := decryptDEK(pf.EncryptedDEK, pf.DEKNonce, kek)
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

	dek, err := decryptDEK(pf.EncryptedDEK, pf.DEKNonce, oldKek)
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

	newEncryptedDEK, newNonce, err := encryptDEK(dek, newKek)
	if err != nil {
		return err
	}

	pf.Salt = base64.StdEncoding.EncodeToString(newSalt)
	pf.EncryptedDEK = newEncryptedDEK
	pf.DEKNonce = newNonce

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

	newEncryptedDEK, newNonce, err := encryptDEK(dekBuf.Bytes(), newKek)
	if err != nil {
		return err
	}

	pf.Salt = base64.StdEncoding.EncodeToString(newSalt)
	pf.EncryptedDEK = newEncryptedDEK
	pf.DEKNonce = newNonce

	return writePasswordFile(pf)
}

// Helper methods

func getPasswordsPath() string {
	return filepath.Join(configDir, "passwords.json")
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
	os.MkdirAll(filepath.Dir(path), 0700)

	return common.AtomicWriteFile(path, func(writer io.Writer) error {
		return json.NewEncoder(writer).Encode(pf)
	})
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

func encryptDEK(dek []byte, kek []byte) (string, string, error) {
	block, err := aes.NewCipher(kek)
	if err != nil {
		return "", "", err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", err
	}
	nonce := make([]byte, aesgcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", "", err
	}
	ciphertext := aesgcm.Seal(nil, nonce, dek, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), base64.StdEncoding.EncodeToString(nonce), nil
}

func decryptDEK(encryptedDEKStr string, nonceStr string, kek []byte) ([]byte, error) {
	encryptedDEK, err := base64.StdEncoding.DecodeString(encryptedDEKStr)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(nonceStr)
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
	if len(nonce) != aesgcm.NonceSize() {
		return nil, errors.New("invalid nonce size")
	}
	dek, err := aesgcm.Open(nil, nonce, encryptedDEK, nil)
	if err != nil {
		return nil, err
	}
	return dek, nil
}
