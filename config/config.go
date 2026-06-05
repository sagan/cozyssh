package config

import (
	"cozyssh/common"
	"cozyssh/constants"
	"cozyssh/models"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"golang.org/x/crypto/bcrypt"
	"gopkg.in/yaml.v3"
)

type Config struct {
	Addr                  string               `yaml:"addr"`
	SiteName              string               `yaml:"sitename"`
	AppPasswordHash       string               `yaml:"app_password_hash"`
	SSHDir                string               `yaml:"sshdir"` // openssh config dir, defaults to ~/.ssh
	Buttons               []*models.ButtonData `yaml:"buttons" json:"buttons"`
	ConfigPath            string               `yaml:"-"` // internal use
	ConfigDir             string               `yaml:"-"` // internal use
	Vars                  map[string]string    `yaml:"vars" json:"vars"`
	InsecureIgnoreHostKey bool                 `yaml:"insecure_ignore_host_key"`
	SavePassword          string               `yaml:"save_password"`
	mu                    sync.Mutex
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

	cfg.sortButtons()

	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:8022"
	}
	if cfg.SSHDir == "" {
		home, _ := os.UserHomeDir()
		cfg.SSHDir = filepath.Join(home, ".ssh")
	}
	if cfg.Vars == nil {
		cfg.Vars = make(map[string]string)
	}
	if cfg.SavePassword == "" {
		cfg.SavePassword = "ask"
	}
	cfg.ConfigPath = configPath
	cfg.ConfigDir = configDir

	return &cfg, nil
}

func (c *Config) ApplyConfig() {
	c.mu.Lock()
	defer c.mu.Unlock()
	os.Setenv("COZYSSH_HOME", c.ConfigDir)
	os.Setenv("COZYSSH_SSHDIR", c.SSHDir)
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
	password := RandString(constants.DEFAULT_PASSWORD_LENGTH, false)

	// Hash the password
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Addr:            "127.0.0.1:8022",
		AppPasswordHash: string(hash),
		ConfigPath:      path,
		SavePassword:    "ask",
	}

	err = common.AtomicWriteFile(path, func(writer io.Writer) error {
		return yaml.NewEncoder(writer).Encode(cfg)
	})
	if err != nil {
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
	c.mu.Lock()
	defer c.mu.Unlock()

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	c.AppPasswordHash = string(hash)
	return c.save()
}

func (c *Config) save() error {
	return common.AtomicWriteFile(c.ConfigPath, func(writer io.Writer) error {
		return yaml.NewEncoder(writer).Encode(c)
	})
}

func (c *Config) ResetAppPassword() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	password := RandString(constants.DEFAULT_PASSWORD_LENGTH, false)
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	c.AppPasswordHash = string(hash)
	if err := c.save(); err != nil {
		return "", err
	}
	return password, nil
}

// Merge (insert or update) all btns into existing data.
// If a button with the same ID already exists, it will be updated.
// If a button with a new ID is provided, it will be added.
// If the button has empty Id field, assign a new one (update the slice element with new ID).
// Buttons not present in the input slice will remain in the config.
func (c *Config) UpsertButtons(btns []*models.ButtonData) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	maxOrder := 0
	for _, b := range c.Buttons {
		if b.Order > maxOrder {
			maxOrder = b.Order
		}
	}

	for _, btn := range btns {
		if btn.Id == "" {
			btn.Id = RandString(12, false)
		}
		if btn.Group == "" {
			btn.Group = constants.DEFAULT_BUTTON_GROUP
		}
		if btn.Type == "" {
			btn.Type = constants.DEFAULT_BUTTON_TYPE
		}

		found := false
		for i, b := range c.Buttons {
			if b.Id == btn.Id {
				c.Buttons[i] = btn
				found = true
				if btn.Order > maxOrder {
					maxOrder = btn.Order
				}
				break
			}
		}

		if !found {
			if btn.Order == 0 {
				maxOrder += 10
				btn.Order = maxOrder
			}
			c.Buttons = append(c.Buttons, btn)
		}
	}

	c.sortButtons()
	return c.save()
}

func (c *Config) UpsertButton(btn *models.ButtonData) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if btn.Id == "" {
		btn.Id = RandString(12, false)
	}
	if btn.Group == "" {
		btn.Group = constants.DEFAULT_BUTTON_GROUP
	}
	if btn.Type == "" {
		btn.Type = constants.DEFAULT_BUTTON_TYPE
	}

	for i, b := range c.Buttons {
		if b.Id == btn.Id {
			c.Buttons[i] = btn
			c.sortButtons()
			return c.save()
		}
	}

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
	c.sortButtons()
	return c.save()
}

func (c *Config) RemoveButton(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	for i, b := range c.Buttons {
		if b.Id == id {
			c.Buttons = append(c.Buttons[:i], c.Buttons[i+1:]...)
			return c.save()
		}
	}
	return nil
}

func (c *Config) MoveButton(id string, direction int) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.sortButtons() // Ensure we starts from sorted
	idx := -1
	for i, b := range c.Buttons {
		if b.Id == id {
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
		if b.Id == targetBtn.Id {
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
		c.Buttons = append(c.Buttons[:insertIdx], append([]*models.ButtonData{btnObj}, c.Buttons[insertIdx:]...)...)
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
		if b.Id == id {
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
		c.sortButtons()
	}

	return c.save()
}

func (c *Config) sortButtons() {
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
	c.sortButtons()
	c.ResequenceButtons()
}

func (c *Config) UpdateVars(updates map[string]*string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	for k, v := range updates {
		if v == nil {
			delete(c.Vars, k)
		} else {
			c.Vars[k] = *v
		}
	}

	return c.save()
}

func (c *Config) UpdateSavePassword(value string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.SavePassword = value
	return c.save()
}
