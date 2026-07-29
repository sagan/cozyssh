package config

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"cozyssh/common"
	"cozyssh/constants"
	"cozyssh/keyring"
	"cozyssh/models"
	"cozyssh/passstore"
	"cozyssh/yescrypt"
)

var (
	OnButtonDelete func(id string, timestamp int64)
	OnButtonUpdate func()
	OnVarsUpdate   func()
)

type Config struct {
	Addr                  string               `json:"addr,omitempty"`
	Sitename              string               `json:"sitename,omitempty"`
	AppPasswordHash       string               `json:"app_password_hash,omitempty"`
	SSHDir                string               `json:"sshdir,omitempty"` // openssh config dir, defaults to ~/.ssh
	Buttons               []*models.ButtonData `json:"-,omitempty"`      // Moved to buttons.json
	ConfigPath            string               `json:"-,omitempty"`      // internal use. The absolute path of <config-dir>/config.json
	ConfigDir             string               `json:"-,omitempty"`      // internal use. The absolute path of config dir
	Vars                  map[string]string    `json:"-,omitempty"`      // Moved to vars.json
	VarsMtime             map[string]int64     `json:"-,omitempty"`      // Last modified timestamp of vars
	InsecureIgnoreHostKey bool                 `json:"insecure_ignore_host_key,omitempty"`
	SavePassword          string               `json:"save_password,omitempty" ts_type:"\"ask\" | \"always\" | \"never\""`
	SessionSecret         string               `json:"session_secret,omitempty"`
	Dns                   string               `json:"dns,omitempty"`
	// Custom local shells. Each item could be any of:
	//   - "-*" : Exclude all auto-discovered local shells
	//   - "-<shell>" : Exclude a shell from auto-discovered shells. `<shell>` is the shell name (e.g. "bash") or full path (e.g. "/bin/bash") to exclude
	//   - "{}" : Define a new shell by providing a LocalShell type json object.
	//   - "<shell>" : Define the orders of auto-discovered shells (according to their appearance order). `<shell>` is the shell name or full path.
	Shells []string `json:"shells,omitempty"`
	// WebDAV Settings
	WebdavUrl               string `json:"webdav_url,omitempty"`
	WebdavUser              string `json:"webdav_user,omitempty"`
	WebdavPassword          string `json:"webdav_password,omitempty"`
	WebdavEnabled           bool   `json:"webdav_enabled,omitempty"`
	WebdavEncryptionEnabled bool   `json:"webdav_encryption_enabled,omitempty"`
	WebdavMasterKey         string `json:"webdav_master_key,omitempty"`
	WebdavUploadSSHData     bool   `json:"webdav_upload_ssh_data,omitempty"`
	UseKeyring              bool   `json:"use_keyring,omitempty"`
	AbsSSHDir               string `json:"-,omitempty"`
	mu                      sync.Mutex
}

func LoadConfig(configDir string) (*Config, error) {
	configPath := filepath.Join(configDir, constants.CONFIG_FILE)

	var cfg Config
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Generate new config
			log.Println("No config found, generating initial app password...")
			cfgPtr, err := generateAndSaveConfig(configDir, configPath)
			if err != nil {
				return nil, err
			}
			cfgPtr.ConfigPath = configPath
			cfgPtr.ConfigDir = configDir
			if err := cfgPtr.loadButtons(); err != nil {
				return nil, fmt.Errorf("failed to load buttons: %w", err)
			}
			if err := cfgPtr.loadVars(); err != nil {
				return nil, fmt.Errorf("failed to load vars: %w", err)
			}
			return cfgPtr, nil
		}
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	cfg.sortButtons()

	cfg.ConfigPath = configPath
	cfg.ConfigDir = configDir

	if err := cfg.loadButtons(); err != nil {
		return nil, fmt.Errorf("failed to load buttons: %w", err)
	}
	if err := cfg.loadVars(); err != nil {
		return nil, fmt.Errorf("failed to load vars: %w", err)
	}

	cfg.sortButtons()

	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:8022"
	}
	if cfg.SSHDir == "" {
		home, _ := os.UserHomeDir()
		cfg.AbsSSHDir = filepath.Join(home, ".ssh")
	} else if filepath.IsAbs(cfg.SSHDir) {
		cfg.AbsSSHDir = filepath.Clean(cfg.SSHDir)
	} else {
		cfg.AbsSSHDir = filepath.Join(cfg.ConfigDir, cfg.SSHDir)
	}
	if cfg.Vars == nil {
		cfg.Vars = make(map[string]string)
	}
	if cfg.VarsMtime == nil {
		cfg.VarsMtime = make(map[string]int64)
	}
	if cfg.SavePassword == "" {
		cfg.SavePassword = "ask"
	}

	if cfg.SessionSecret == "" {
		cfg.SessionSecret = common.RandString(32, false)
		if err := cfg.save(); err != nil {
			return nil, fmt.Errorf("failed to save config: %w", err)
		}
	}

	return &cfg, nil
}

func generateAndSaveConfig(configDir, configPath string) (*Config, error) {
	password := common.RandString(constants.DEFAULT_PASSWORD_LENGTH, false)

	// Hash the password
	hash, err := yescrypt.GenerateFromPassword([]byte(password))
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Addr:            "127.0.0.1:8022",
		AppPasswordHash: string(hash),
		ConfigDir:       configDir,
		ConfigPath:      configPath,
		SavePassword:    "ask",
		SessionSecret:   common.RandString(32, false),
	}

	if common.IsApp {
		err = keyring.SetAppPassword(configDir, password)
		if err == nil {
			fmt.Fprintf(os.Stderr, "The initial app password has been saved in system keyring\n")
			cfg.UseKeyring = true
		} else {
			fmt.Fprintf(os.Stderr, "Can't save app password to system keyring: %v\n", err)
		}
	}

	err = common.AtomicWriteFile(configPath, func(writer io.Writer) error {
		enc := json.NewEncoder(writer)
		enc.SetIndent("", "  ")
		return enc.Encode(cfg)
	})
	if err != nil {
		return nil, err
	}

	if !cfg.UseKeyring {
		if common.IsApp {
			// Desktop (windowsgui) mode: no terminal available, write to a file.
			pwdFile := filepath.Join(filepath.Dir(configPath), constants.INITIAL_PASSWORD_FILE)
			if err := common.AtomicWriteFileContents(pwdFile, []byte(password)); err != nil {
				log.Printf("WARNING: could not write %s: %v", constants.INITIAL_PASSWORD_FILE, err)
			}
		} else {
			// CLI mode: print to stderr as usual.
			fmt.Fprintf(os.Stderr, "\n=====================================================\n")
			fmt.Fprintf(os.Stderr, "  Welcome to CozySSH!                                \n")
			fmt.Fprintf(os.Stderr, "  A new app password has been generated for you:     \n")
			fmt.Fprintf(os.Stderr, "  ->  %s  <-                                     \n", password)
			fmt.Fprintf(os.Stderr, "  Store this safely. If you forget the password, you can reset it by running cozyssh with -do-reset-password flag.\n")
			fmt.Fprintf(os.Stderr, "=====================================================\n")
		}
	}

	return cfg, nil
}

// Check if system keyring currently stores the correct app password
func (c *Config) IsKeyringPasswordOk() bool {
	password, _ := keyring.GetAppPassword(c.ConfigDir)
	return c.VerifyPassword(password)
}

func (c *Config) VerifyPassword(password string) bool {
	err := yescrypt.CompareHashAndPassword([]byte(c.AppPasswordHash), []byte(password))
	return err == nil
}

func (c *Config) ChangeAppPassword(newPassword string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	hash, err := yescrypt.GenerateFromPassword([]byte(newPassword))
	if err != nil {
		return err
	}
	c.AppPasswordHash = string(hash)
	return c.save()
}

func (c *Config) save() error {
	return common.AtomicWriteFile(c.ConfigPath, func(writer io.Writer) error {
		enc := json.NewEncoder(writer)
		enc.SetIndent("", "  ")
		return enc.Encode(c)
	})
}

func (c *Config) saveButtons() error {
	buttonsPath := filepath.Join(c.ConfigDir, "buttons.json")
	var btnWrap struct {
		Buttons []*models.ButtonData `json:"buttons"`
	}
	btnWrap.Buttons = c.Buttons
	return common.AtomicWriteFile(buttonsPath, func(writer io.Writer) error {
		return json.NewEncoder(writer).Encode(btnWrap)
	})
}

func (c *Config) loadButtons() error {
	buttonsPath := filepath.Join(c.ConfigDir, "buttons.json")
	data, err := os.ReadFile(buttonsPath)
	if err != nil {
		if os.IsNotExist(err) {
			c.Buttons = []*models.ButtonData{}
			return c.saveButtons()
		}
		return err
	}
	var btnWrap struct {
		Buttons []*models.ButtonData `json:"buttons"`
	}
	if err := json.Unmarshal(data, &btnWrap); err != nil {
		return err
	}
	c.Buttons = btnWrap.Buttons
	if c.Buttons == nil {
		c.Buttons = []*models.ButtonData{}
	}
	return nil
}

func (c *Config) saveVars() error {
	varsPath := filepath.Join(c.ConfigDir, "vars.json")
	var varsWrap struct {
		Mtime map[string]int64  `json:"mtime"`
		Vars  map[string]string `json:"vars"`
	}
	varsWrap.Mtime = c.VarsMtime
	varsWrap.Vars = c.Vars
	return common.AtomicWriteFile(varsPath, func(writer io.Writer) error {
		return json.NewEncoder(writer).Encode(varsWrap)
	})
}

func (c *Config) loadVars() error {
	varsPath := filepath.Join(c.ConfigDir, "vars.json")
	data, err := os.ReadFile(varsPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Migrate from config.yaml if any exist, otherwise initialize empty
			if c.Vars == nil {
				c.Vars = make(map[string]string)
			}
			c.VarsMtime = make(map[string]int64)
			now := time.Now().UnixMilli()
			for k := range c.Vars {
				c.VarsMtime[k] = now
			}
			return c.saveVars()
		}
		return err
	}
	var raw struct {
		Mtime json.RawMessage   `json:"mtime"`
		Vars  map[string]string `json:"vars"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	c.Vars = raw.Vars
	if c.Vars == nil {
		c.Vars = make(map[string]string)
	}
	c.VarsMtime = make(map[string]int64)
	if len(raw.Mtime) > 0 {
		var mtimeMap map[string]int64
		if err := json.Unmarshal(raw.Mtime, &mtimeMap); err == nil {
			c.VarsMtime = mtimeMap
		} else {
			var mtimeVal int64
			if err := json.Unmarshal(raw.Mtime, &mtimeVal); err == nil {
				for k := range c.Vars {
					c.VarsMtime[k] = mtimeVal
				}
			}
		}
	}
	return nil
}

func (c *Config) SetVars(vars map[string]string, mtime map[string]int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.Vars = vars
	c.VarsMtime = mtime
	return c.saveVars()
}

func (c *Config) GetVarsMtime() map[string]int64 {
	c.mu.Lock()
	defer c.mu.Unlock()

	copied := make(map[string]int64, len(c.VarsMtime))
	maps.Copy(copied, c.VarsMtime)
	return copied
}

func (c *Config) GetVars() map[string]string {
	c.mu.Lock()
	defer c.mu.Unlock()

	copied := make(map[string]string, len(c.Vars))
	maps.Copy(copied, c.Vars)
	return copied
}

func (c *Config) GetButtons() []*models.ButtonData {
	c.mu.Lock()
	defer c.mu.Unlock()
	copied := make([]*models.ButtonData, len(c.Buttons))
	for i, b := range c.Buttons {
		copiedBtn := *b
		copied[i] = &copiedBtn
	}
	return copied
}

func (c *Config) ResetSessionSecret() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.SessionSecret = common.RandString(32, false)
	return c.save()
}

func (c *Config) ResetAppPassword() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	password := common.RandString(constants.DEFAULT_PASSWORD_LENGTH, false)
	hash, err := yescrypt.GenerateFromPassword([]byte(password))
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
// Mtime is used to determine if the button should be updated. If Mtime is 0, it will be set to the current time.
// If Mtime is greater than the Mtime of the button in the config, it will be updated.
// If Mtime is less than the Mtime of the button in the config, it will be ignored.
// If force is true, the button will be updated regardless of the Mtime.
func (c *Config) UpsertButtons(btns []*models.ButtonData, force bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	maxOrder := 0
	for _, b := range c.Buttons {
		if b.Order > maxOrder {
			maxOrder = b.Order
		}
	}

	now := time.Now().UnixMilli()
main:
	for _, btn := range btns {
		if btn.Mtime == 0 {
			btn.Mtime = now
		}
		if strings.HasPrefix(btn.Id, constants.ID_DELETE_PREFIX) {
			// delete button
			id := btn.Id[len(constants.ID_DELETE_PREFIX):]
			c.Buttons = slices.DeleteFunc(c.Buttons, func(b *models.ButtonData) bool {
				if b.Id == id && (force || btn.Mtime >= b.Mtime) {
					if OnButtonDelete != nil {
						OnButtonDelete(id, btn.Mtime)
					}
					return true
				}
				return false
			})
			continue
		}
		if btn.Id == "" {
			btn.Id = common.RandString(12, false)
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
				if !force && btn.Mtime < b.Mtime {
					continue main
				}
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
	if err := c.saveButtons(); err != nil {
		return err
	}
	if OnButtonUpdate != nil {
		OnButtonUpdate()
	}
	return nil
}

func (c *Config) UpsertButton(btn *models.ButtonData) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if btn.Id == "" {
		btn.Id = common.RandString(12, false)
	}
	if btn.Group == "" {
		btn.Group = constants.DEFAULT_BUTTON_GROUP
	}
	if btn.Type == "" {
		btn.Type = constants.DEFAULT_BUTTON_TYPE
	}
	if btn.Mtime == 0 {
		btn.Mtime = time.Now().UnixMilli()
	}

	for i, b := range c.Buttons {
		if b.Id == btn.Id {
			c.Buttons[i] = btn
			c.sortButtons()
			if err := c.saveButtons(); err != nil {
				return err
			}
			if OnButtonUpdate != nil {
				OnButtonUpdate()
			}
			return nil
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
	if err := c.saveButtons(); err != nil {
		return err
	}
	if OnButtonUpdate != nil {
		OnButtonUpdate()
	}
	return nil
}

func (c *Config) RemoveButton(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	for i, b := range c.Buttons {
		if b.Id == id {
			c.Buttons = append(c.Buttons[:i], c.Buttons[i+1:]...)
			if err := c.saveButtons(); err != nil {
				return err
			}
			if OnButtonDelete != nil {
				OnButtonDelete(id, time.Now().UnixMilli())
			}
			if OnButtonUpdate != nil {
				OnButtonUpdate()
			}
			return nil
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
	c.Buttons[movedIdx].Mtime = time.Now().UnixMilli()

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

	if err := c.saveButtons(); err != nil {
		return err
	}
	if OnButtonUpdate != nil {
		OnButtonUpdate()
	}
	return nil
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
	now := time.Now().UnixMilli()
	for i := range c.Buttons {
		c.Buttons[i].Order = (i + 1) * 10
		c.Buttons[i].Mtime = now
	}
}

func (c *Config) SortAndResequenceButtons() {
	c.sortButtons()
	c.ResequenceButtons()
}

func (c *Config) UpdateVars(updates map[string]*string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now().UnixMilli()
	if c.VarsMtime == nil {
		c.VarsMtime = make(map[string]int64)
	}

	for k, v := range updates {
		if v == nil {
			delete(c.Vars, k)
		} else {
			c.Vars[k] = *v
		}
		c.VarsMtime[k] = now
	}

	// Clean up old deletion markers from c.VarsMtime
	maxAgeMs := (30 * 24 * time.Hour).Milliseconds()
	for k, ts := range c.VarsMtime {
		if _, exists := c.Vars[k]; !exists {
			if (now - ts) > maxAgeMs {
				delete(c.VarsMtime, k)
			}
		}
	}

	if err := c.saveVars(); err != nil {
		return err
	}

	if OnVarsUpdate != nil {
		OnVarsUpdate()
	}
	return nil
}

func (c *Config) UpdateConfig(req *models.ConfigRequest) (err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if req.SavePassword != "" {
		if req.SavePassword != "always" && req.SavePassword != "never" && req.SavePassword != "ask" {
			return fmt.Errorf("invalid save_password option: must be always, never, or ask")
		}
		c.SavePassword = req.SavePassword
	}
	if req.Sitename != "" {
		c.Sitename = req.Sitename
	}
	if req.UseKeyring != nil && c.UseKeyring != *req.UseKeyring {
		if req.AppPassword != "" && !c.VerifyPassword(req.AppPassword) {
			err = fmt.Errorf("app password is incorrect")
		} else if *req.UseKeyring {
			// checking if keyring already saves the app password
			password, _ := keyring.GetAppPassword(c.ConfigDir)
			if !c.VerifyPassword(password) {
				if req.AppPassword == "" {
					err = fmt.Errorf("app password is required to enable keyring")
				} else {
					err = keyring.SetAppPassword(c.ConfigDir, req.AppPassword)
				}
			}
		} else {
			err = keyring.SetAppPassword(c.ConfigDir, "")
			if req.AppPassword != "" {
				passstore.ClearEncryptionKey()
			}
		}
		if err != nil {
			return fmt.Errorf("failed to update useKeyring to %t: %w (app password provided: %t)",
				*req.UseKeyring, err, req.AppPassword != "")
		}
		c.UseKeyring = *req.UseKeyring
	}
	return c.save()
}

func (c *Config) UpdateSavePassword(value string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.SavePassword = value
	return c.save()
}

func (c *Config) UpdateWebdavSettings(urlVal, userVal, passwordVal string, enabledVal bool, encEnabledVal bool, masterKeyVal string, uploadSSHDataVal bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.WebdavUrl = urlVal
	c.WebdavUser = userVal
	if urlVal == "" && userVal == "" && passwordVal == "" {
		c.WebdavPassword = ""
		c.WebdavEncryptionEnabled = false
		c.WebdavMasterKey = ""
		c.WebdavUploadSSHData = false
	} else {
		if passwordVal != "" {
			c.WebdavPassword = passwordVal
		}
		c.WebdavEncryptionEnabled = encEnabledVal
		c.WebdavMasterKey = masterKeyVal
		c.WebdavUploadSSHData = uploadSSHDataVal
	}
	c.WebdavEnabled = enabledVal

	return c.save()
}
