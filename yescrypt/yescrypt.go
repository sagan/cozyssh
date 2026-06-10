package yescrypt

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"

	"github.com/openwall/yescrypt-go"
)

const itoa64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

func encode64(src []byte) []byte {
	dst := make([]byte, 0, (len(src)*8+5)/6)
	for i := 0; i < len(src); {
		value, bits := uint32(0), 0
		for ; bits < 24 && i < len(src); bits += 8 {
			value |= uint32(src[i]) << bits
			i++
		}
		for ; bits > 0; bits -= 6 {
			dst = append(dst, itoa64[value&0x3f])
			value >>= 6
		}
	}
	return dst
}

// GenerateFromPassword acts as bcrypt.GenerateFromPassword.
// It generates the same hash format as Linux /etc/shadow password field
func GenerateFromPassword(password []byte) ([]byte, error) {
	// 1. Generate 16 bytes of random secure salt
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		return nil, err
	}

	// 2. Encode salt to Base64 (Standard Yescrypt/crypt strings use standard or B64 variants)
	saltEncoded := encode64(saltBytes)

	// 3. Define the setting string.
	// Format for standard yescrypt: $y$j$Nrp$salt
	// 'j' represents flags. 9T is the default value of most Linux.
	setting := fmt.Appendf(nil, "$y$j9T$%s", saltEncoded)

	// 4. Compute the full hash string
	hash, err := yescrypt.Hash(password, setting)
	if err != nil {
		return nil, err
	}
	return hash, nil
}

// CompareHashAndPassword acts as bcrypt.CompareHashAndPassword
func CompareHashAndPassword(hashedPassword, password []byte) error {
	// Re-hash the incoming password using the stored hash as the setting configuration
	rehashed, err := yescrypt.Hash(password, hashedPassword)
	if err != nil {
		return err
	}

	// Use subtle.ConstantTimeCompare to avoid timing attack vulnerabilities
	if subtle.ConstantTimeCompare(hashedPassword, rehashed) != 1 {
		return errors.New("crypto/yescrypt: hashed password is not the correct match")
	}

	return nil // Password matches perfectly
}
