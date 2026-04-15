package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"golang.org/x/crypto/bcrypt"
	"gopkg.in/yaml.v3"
)

type PinnedTab struct {
	ID    string `yaml:"id" json:"id"`
	Host  string `yaml:"host" json:"host"`
	Title string `yaml:"title" json:"title"`
}

type Config struct {
	Addr            string      `yaml:"addr"`
	AppPasswordHash string      `yaml:"app_password_hash"`
	PinnedTabs      []PinnedTab `yaml:"pinned_tabs"`
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

func generateAndSaveConfig(path string) (*Config, error) {
	// Generate random 12-char password
	randBytes := make([]byte, 6)
	if _, err := rand.Read(randBytes); err != nil {
		return nil, err
	}
	password := hex.EncodeToString(randBytes)

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

func (c *Config) RemovePinnedTab(id string) error {
	for i, t := range c.PinnedTabs {
		if t.ID == id {
			c.PinnedTabs = append(c.PinnedTabs[:i], c.PinnedTabs[i+1:]...)
			return c.Save()
		}
	}
	return nil
}
