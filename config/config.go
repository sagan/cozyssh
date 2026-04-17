package config

import (
	"crypto/rand"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gopkg.in/yaml.v3"
)

type PinnedTab struct {
	ID    string `yaml:"id" json:"id"`
	Host  string `yaml:"host" json:"host"`
	Title string `yaml:"title" json:"title"`
}

type Button struct {
	ID      string `yaml:"id" json:"id"`
	Name    string `yaml:"name" json:"name"`
	Type    string `yaml:"type" json:"type"`
	Payload string `yaml:"payload" json:"payload"`
	Group   string `yaml:"group" json:"group"`
}

type Config struct {
	Addr            string      `yaml:"addr"`
	AppPasswordHash string      `yaml:"app_password_hash"`
	PinnedTabs      []PinnedTab `yaml:"pinned_tabs"`
	Buttons         []Button    `yaml:"buttons" json:"buttons"`
	ConfigPath      string      `yaml:"-"` // internal use
}

func LoadConfig(customDir string) (*Config, error) {
	configDir := customDir
	if configDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("could not find user home dir: %w", err)
		}
		configDir = filepath.Join(home, ".config", "cozyssh")
	}

	if err := os.MkdirAll(configDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create config dir: %w", err)
	}

	configPath := filepath.Join(configDir, "config.yaml")

	var cfg Config
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Generate new config
			log.Println("No config found, generating initial app password...")
			return generateAndSaveConfig(configPath)
		}
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:8022"
	}
	cfg.ConfigPath = configPath

	return &cfg, nil
}

// Return a cryptographically secure random string of format /[a-zA-Z0-9]{length}/ .
// If digigOnly is true, return  /[0-9]{length}/
func RandString(length int, digitOnly bool) string {
	if length <= 0 {
		return ""
	}
	var rand_chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	if digitOnly {
		rand_chars = "0123456789"
	}
	var sb strings.Builder
	// (math.MaxUint8 / len(rand_chars)) results in an integer, e.g., 4
	// The result is directly cast to float64, e.g., 4.0
	// This is multiplied by float64(len(rand_chars))
	var max byte = byte(float64(math.MaxUint8/len(rand_chars)) * float64(len(rand_chars)))
	buf := make([]byte, length)
outer:
	for {
		if _, err := rand.Read(buf); err != nil {
			panic("rand.Read() failed")
		}
		for _, byte := range buf {
			// By taking only the numbers up to a multiple of char space size and discarding others,
			// we expect a uniform distribution of all possible chars.
			if byte < max {
				sb.WriteByte(rand_chars[int(byte)%len(rand_chars)])
			}
			if sb.Len() >= length {
				break outer
			}
		}
	}
	return sb.String()
}

func generateAndSaveConfig(path string) (*Config, error) {
	password := RandString(22, false)

	// Hash the password
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Addr:            "127.0.0.1:8022",
		AppPasswordHash: string(hash),
		ConfigPath:      path,
	}

	data, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, err
	}

	// Restrict file permissions
	if err := os.WriteFile(path, data, 0600); err != nil {
		return nil, err
	}

	// Print password to console
	fmt.Println("=====================================================")
	fmt.Println("  Welcome to Cozyssh!                                ")
	fmt.Println("  A new app password has been generated for you:     ")
	fmt.Printf("  ->  %s  <-                                     \n", password)
	fmt.Println("  Store this safely or you'll have to delete your config to reset it.")
	fmt.Println("=====================================================")

	return cfg, nil
}

func (c *Config) VerifyPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(c.AppPasswordHash), []byte(password))
	return err == nil
}

func (c *Config) ChangeAppPassword(newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	c.AppPasswordHash = string(hash)
	return c.Save()
}

func (c *Config) Save() error {
	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	return os.WriteFile(c.ConfigPath, data, 0600)
}

func (c *Config) ResetAppPassword() (string, error) {
	password := RandString(22, false)
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	c.AppPasswordHash = string(hash)
	if err := c.Save(); err != nil {
		return "", err
	}
	return password, nil
}

func (c *Config) AddPinnedTab(tab PinnedTab) error {
	for i, t := range c.PinnedTabs {
		if t.ID == tab.ID {
			c.PinnedTabs[i] = tab
			return c.Save()
		}
	}
	c.PinnedTabs = append(c.PinnedTabs, tab)
	return c.Save()
}

func (c *Config) RenamePinnedTab(id string, title string) error {
	for i, t := range c.PinnedTabs {
		if t.ID == id {
			c.PinnedTabs[i].Title = title
			return c.Save()
		}
	}
	return nil
}

func (c *Config) RemovePinnedTab(id string) error {
	for i, t := range c.PinnedTabs {
		if t.ID == id {
			c.PinnedTabs = append(c.PinnedTabs[:i], c.PinnedTabs[i+1:]...)
			return c.Save()
		}
	}
	return nil
}

func (c *Config) AddButton(btn Button) error {
	c.Buttons = append(c.Buttons, btn)
	return c.Save()
}

func (c *Config) UpdateButton(btn Button) error {
	for i, b := range c.Buttons {
		if b.ID == btn.ID {
			c.Buttons[i] = btn
			return c.Save()
		}
	}
	return nil
}

func (c *Config) RemoveButton(id string) error {
	for i, b := range c.Buttons {
		if b.ID == id {
			c.Buttons = append(c.Buttons[:i], c.Buttons[i+1:]...)
			return c.Save()
		}
	}
	return nil
}

func (c *Config) MoveButton(id string, direction int) error {
	idx := -1
	for i, b := range c.Buttons {
		if b.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return nil
	}
	newIdx := idx + direction
	if newIdx < 0 || newIdx >= len(c.Buttons) {
		return nil
	}
	c.Buttons[idx], c.Buttons[newIdx] = c.Buttons[newIdx], c.Buttons[idx]
	return c.Save()
}
