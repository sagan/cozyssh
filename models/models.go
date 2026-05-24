package models

// go run github.com/tkrajina/typescriptify-golang-structs/tscriptify@latest -interface -package=cozyssh/models -target="frontend/src/api.ts" models/models.go
// Generates (overwrite) frontend/src/api.ts

// basic msg for parse json object which has a "type" field
type MsgType struct {
	Type string `json:"type"`
}

type ManifestIcon struct {
	Src   string `json:"src"`
	Sizes string `json:"sizes"`
	Type  string `json:"type"`
}

// We use camelCase style tags everywhere but Manifest is exception since it's PWA manifest.json standard
type Manifest struct {
	Name            string          `json:"name"`
	ShortName       string          `json:"short_name"`
	StartURL        string          `json:"start_url"`
	Display         string          `json:"display"`
	BackgroundColor string          `json:"background_color"`
	ThemeColor      string          `json:"theme_color"`
	Icons           []*ManifestIcon `json:"icons"`
}

type Sysinfo struct {
	Hostname        string `json:"hostname"`
	Version         string `json:"version"`
	InsecureAllowed bool   `json:"insecureAllowed"`
	IsSecure        bool   `json:"isSecure"`
}

type HostData struct {
	Name          string   `json:"name"`
	HostName      string   `json:"hostname"`
	Port          string   `json:"port"`
	User          string   `json:"user"`
	ProxyJump     string   `json:"proxy_jump"`
	RemoteCommand string   `json:"remote_command"`
	Tags          []string `json:"tags"`
	Comment       string   `json:"comment"`
	// "config", "known_hosts", ""
	Source       string `json:"source" ts_type:"\"config\" | \"known_hosts\" | \"\""`
	IdentityFile string `json:"identity_file"`
	// true if from known_hosts and not config
	IsAuto      bool `json:"is_auto,omitempty"`
	IsFavourite bool `json:"is_favourite,omitempty"`
}

type ButtonData struct {
	Id       string `yaml:"id" json:"id"`
	Name     string `yaml:"name" json:"name"`
	Type     string `yaml:"type" json:"type" ts_type:"\"send_string\" | \"terminal_function\" | \"misc\" | \"open_terminal\" | \"run_script\""`
	Payload  string `yaml:"payload" json:"payload"`
	Group    string `yaml:"group" json:"group"`
	AutoRun  int    `yaml:"autorun" json:"autorun"`
	Order    int    `yaml:"order" json:"order"`
	Shortcut string `yaml:"shortcut" json:"shortcut"`
}

type ButtonsMoveRequest struct {
	Id        string `json:"id"`
	Direction int    `json:"direction"` // -1 for left, 1 for right
}

type SessionPinned struct {
	Id            string `json:"id"`
	Host          string `json:"host"`
	Title         string `json:"title"`
	IsLocked      bool   `json:"isLocked"`
	ListenerCount int    `json:"listenerCount"`
}

// POST /api/sessions/attach payload
type SessionsAttachRequest struct {
	Id string `json:"id"`
}

// POST /api/sessions/close payload
type SessionsCloseRequest struct {
	Id string `json:"id"`
}

// POST /api/settings/password payload
type PasswordUpdateRequest struct {
	NewPassword string `json:"new_password"`
}

// POST /api/tabs/pin payload
type TabsPinRequest struct {
	Id    string `json:"id"`
	Host  string `json:"host"`
	Title string `json:"title"`
}

type TabsUnpinRequest struct {
	Id string `json:"id"`
}

type TabsRenameRequest struct {
	Id    string `json:"id"`
	Title string `json:"title"`
}

type TabsLockRequest struct {
	Id    string `json:"id"`
	Host  string `json:"host"`
	Title string `json:"title"`
}

type Recent struct {
	Host     string `json:"host"`
	LastUsed int64  `json:"last_used"` // unix timestamp in seconds
}

// POST /api/recents payload
type RecentUpdateRequest struct {
	Host string `json:"host"`
}

type FullData struct {
	Sysinfo Sysinfo           `json:"sysinfo"`
	Hosts   []*HostData       `json:"hosts"`
	Buttons []*ButtonData     `json:"buttons"`
	Vars    map[string]string `json:"vars"`
	Pinned  []*SessionPinned  `json:"pinned"`
	Recents []*Recent         `json:"recents"`
}

type LoginRequest struct {
	Password string `json:"password"`
}

type LoginResponse struct {
	Fulldata *FullData `json:"fulldata"`
	Token    string    `json:"token"`
}

// POST /api/exec payload
type ExecRequest struct {
	Cmdline string `json:"cmdline"`
}

type ExecResult struct {
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
	Error  error  `json:"error" ts_type:"unknown"`
}

type PreflightResponse struct {
	InsecureAllowed bool `json:"insecureAllowed"`
	IsSecure        bool `json:"isSecure"`
}

type FileInfo struct {
	Name    string `json:"name"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

// /api/fs/list response
type FsList struct {
	Path  string      `json:"path"`
	Files []*FileInfo `json:"files"`
}

type FsToken struct {
	Expires int64  `json:"expires"`
	Sig     string `json:"sig"`
}

// /api/fs/rename
type FileRenameRequest struct {
	NewPath string `json:"newPath"`
}

// /api/fs/mkdir
type FileMkdirRequest struct {
	Name string `json:"name"`
}

type ScratchpadPage struct {
	Id          string `json:"id"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	Locked      bool   `json:"locked"`
	LastUpdated int64  `json:"lastUpdated"`
}

type ScratchpadData struct {
	Pages []*ScratchpadPage `json:"pages"`
}

type ScratchpadSyncMsg struct {
	Type string         `json:"type" ts_type:"\"sync\" | \"force_sync\""`
	Data ScratchpadData `json:"data"`
}

type ScratchpadDeleteMsg struct {
	Type string `json:"type" ts_type:"\"delete\""`
	Id   string `json:"id"`
}

// client => server first msg
type ScratchpadHelloMsg struct {
	Type string `json:"type" ts_type:"\"hello\""`
}

type WsTerminalMessageType string

const (
	WsTerminalMessageTypeHistoryStart WsTerminalMessageType = "historyStart"
	WsTerminalMessageTypeTabState     WsTerminalMessageType = "tabState"
	WsTerminalMessageTypeState        WsTerminalMessageType = "state"
	WsTerminalMessageTypeResize       WsTerminalMessageType = "resize"
)

type WsTerminalMessage struct {
	Type     WsTerminalMessageType `json:"type" ts_type:"\"historyStart\" | \"tabState\" | \"state\""`
	State    string                `json:"state"`
	IsPinned bool                  `json:"isPinned"`
	IsLocked bool                  `json:"isLocked"`
}

type WsResizeMsg struct {
	Type WsTerminalMessageType `json:"type" ts_type:"\"resize\""` // fixed to "resize"
	Cols uint16                `json:"cols"`
	Rows uint16                `json:"rows"`
}

// current it's not converted to TS automatically
const WS_MSG_PREFIX_STATE = "STATE:"
