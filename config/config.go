package config

import (
	"crypto/rand"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
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
	AutoRun int    `yaml:"autorun" json:"autorun"`
	Order   int    `yaml:"order" json:"order"`
}

type Config struct {
	Addr            string            `yaml:"addr"`
	SiteName        string            `yaml:"sitename"`
	AppPasswordHash string            `yaml:"app_password_hash"`
	PinnedTabs      []PinnedTab       `yaml:"pinned_tabs"`
	Buttons         []Button          `yaml:"buttons" json:"buttons"`
	ConfigPath      string            `yaml:"-"` // internal use
	ConfigDir       string            `yaml:"-"` // internal use
	Vars            map[string]string `yaml:"vars" json:"vars"`
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

	cfg.SortButtons()

	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:8022"
	}
	if cfg.Vars == nil {
		cfg.Vars = make(map[string]string)
	}
	cfg.ConfigPath = configPath
	cfg.ConfigDir = configDir

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
	fmt.Println("  Welcome to CozySSH!                                ")
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
	f, err := os.OpenFile(c.ConfigPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer f.Close()

	enc := yaml.NewEncoder(f)
	enc.SetIndent(2)
	return enc.Encode(c)
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
	if btn.Order == 0 {
		maxOrder := 0
		for _, b := range c.Buttons {
			if b.Order > maxOrder {
				maxOrder = b.Order
			}
		}
		if len(c.Buttons) == 0 {
			btn.Order = 10
		} else {
			btn.Order = maxOrder + 10
		}
	}
	c.Buttons = append(c.Buttons, btn)
	c.SortButtons()
	return c.Save()
}

func (c *Config) UpdateButton(btn Button) error {
	for i, b := range c.Buttons {
		if b.ID == btn.ID {
			c.Buttons[i] = btn
			c.SortButtons()
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
	c.SortButtons() // Ensure we starts from sorted
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

	// We only care about buttons in the same group as the target button
	group := c.Buttons[idx].Group
	var groupIndices []int
	for i, b := range c.Buttons {
		if b.Group == group {
			groupIndices = append(groupIndices, i)
		}
	}

	posInGroup := -1
	for i, gIdx := range groupIndices {
		if gIdx == idx {
			posInGroup = i
			break
		}
	}

	if posInGroup == -1 {
		return nil
	}

	newPosInGroup := posInGroup + direction
	if newPosInGroup < 0 || newPosInGroup >= len(groupIndices) {
		return nil
	}

	targetIdx := groupIndices[newPosInGroup]
	targetBtn := c.Buttons[targetIdx]

	// Reposition in slice first to reflect visual move
	btnObj := c.Buttons[idx]
	c.Buttons = append(c.Buttons[:idx], c.Buttons[idx+1:]...)

	// Find new index for targetBtn after removal
	finalTargetIdx := -1
	for i, b := range c.Buttons {
		if b.ID == targetBtn.ID {
			finalTargetIdx = i
			break
		}
	}

	insertIdx := finalTargetIdx
	if direction > 0 {
		insertIdx++
	}
	if insertIdx < 0 {
		insertIdx = 0
	}
	if insertIdx >= len(c.Buttons) {
		c.Buttons = append(c.Buttons, btnObj)
	} else {
		c.Buttons = append(c.Buttons[:insertIdx], append([]Button{btnObj}, c.Buttons[insertIdx:]...)...)
	}

	// Update the order of the moved button
	newOrder := targetBtn.Order
	if direction > 0 {
		newOrder++
	} else {
		newOrder--
	}

	// Find the moved button again in the slice
	movedIdx := -1
	for i, b := range c.Buttons {
		if b.ID == id {
			movedIdx = i
			break
		}
	}
	c.Buttons[movedIdx].Order = newOrder

	// Check if we have any duplicate orders now
	hasDuplicates := false
	orderMap := make(map[int]bool)
	for _, b := range c.Buttons {
		if orderMap[b.Order] {
			hasDuplicates = true
			break
		}
		orderMap[b.Order] = true
	}

	if hasDuplicates {
		c.ResequenceButtons()
	} else {
		c.SortButtons()
	}

	return c.Save()
}

func (c *Config) SortButtons() {
	sort.Slice(c.Buttons, func(i, j int) bool {
		if c.Buttons[i].Order != c.Buttons[j].Order {
			return c.Buttons[i].Order < c.Buttons[j].Order
		}
		return c.Buttons[i].Name < c.Buttons[j].Name
	})
}

func (c *Config) ResequenceButtons() {
	for i := range c.Buttons {
		c.Buttons[i].Order = (i + 1) * 10
	}
}

func (c *Config) SortAndResequenceButtons() {
	c.SortButtons()
	c.ResequenceButtons()
}
