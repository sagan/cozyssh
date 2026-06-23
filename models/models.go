package models

import "cozyssh/localpty"

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
	HandleLinks     string          `json:"handle_links,omitempty"`
	Icons           []*ManifestIcon `json:"icons"`
}

type WebdavStatus struct {
	WebdavUrl     string `json:"webdavUrl"`
	WebdavUser    string `json:"webdavUser"`
	WebdavEnabled bool   `json:"webdavEnabled"`
	SyncStatus    string `json:"syncStatus" ts_type:"\"idle\" | \"syncing\" | \"error\" | \"success\" | \"disabled\""`
	SyncError     string `json:"syncError"`
	SyncTime      int64  `json:"syncTime"`
}

type Sysinfo struct {
	Hostname        string `json:"hostname"`
	Version         string `json:"version"`
	InsecureAllowed bool   `json:"insecureAllowed"`
	IsSecure        bool   `json:"isSecure"`
	SavePassword    string `json:"savePassword" ts_type:"\"ask\" | \"always\" | \"never\""`
}

type SaveWebdavSettingsRequest struct {
	Url      string `json:"url"`
	User     string `json:"user"`
	Password string `json:"password"`
	Enabled  bool   `json:"enabled"`
}

type SyncDetectionResult struct {
	BrandNew          bool `json:"brandNew"`
	UploadCount       int  `json:"uploadCount"`
	DownloadCount     int  `json:"downloadCount"`
	DeleteLocalCount  int  `json:"deleteLocalCount"`
	DeleteRemoteCount int  `json:"deleteRemoteCount"`
}

type HostData struct {
	Name          string   `json:"name"`
	HostName      string   `json:"hostname"`
	Port          string   `json:"port"`
	User          string   `json:"user"`
	ProxyJump     string   `json:"proxy_jump,omitempty"`
	RemoteCommand string   `json:"remote_command,omitempty"`
	Tags          []string `json:"tags,omitempty"`
	Comment       string   `json:"comment,omitempty"`
	// "config", "known_hosts", ""
	Source       string `json:"source,omitempty" ts_type:"\"config\" | \"known_hosts\" | \"\""`
	IdentityFile string `json:"identity_file,omitempty"`
	// true if from known_hosts and not config
	IsAuto      bool `json:"is_auto,omitempty"`
	IsFavourite bool `json:"is_favourite,omitempty"`

	AddressFamily         string `json:"address_family,omitempty" ts_type:"\"any\" | \"inet\" | \"inet6\" | \"\""`
	UserKnownHostsFile    string `json:"user_known_hosts_file,omitempty"`
	StrictHostKeyChecking string `json:"strict_host_key_checking,omitempty" ts_type:"\"yes\" | \"no\" | \"ask\" | \"\""`
	HostKeyAlgorithms     string `json:"host_key_algorithms,omitempty"`

	// Port forwarding (OpenSSH syntax, one rule per line)
	LocalForward  string `json:"local_forward,omitempty"`
	RemoteForward string `json:"remote_forward,omitempty"`

	// Password storage support
	Password       string `json:"password,omitempty"`
	PasswordExists bool   `json:"password_exists,omitempty"`
	ClearPassword  bool   `json:"clear_password,omitempty"`
}

type ButtonData struct {
	Id       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type" ts_type:"\"send_string\" | \"terminal_function\" | \"misc\" | \"open_terminal\" | \"run_script\""`
	Payload  string `json:"payload"`
	Group    string `json:"group"`
	AutoRun  int    `json:"autorun"`
	Order    int    `json:"order"`
	Shortcut string `json:"shortcut"`
	LiquidJS int    `json:"liquidjs,omitempty"`
	Mtime    int64  `json:"mtime,omitempty"` // button modified unix timestamp in milliseconds
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
	Force       bool   `json:"force"`
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
	Sysinfo Sysinfo                `json:"sysinfo"`
	Hosts   []*HostData            `json:"hosts"`
	Groups  []string               `json:"groups,omitempty"`
	Buttons []*ButtonData          `json:"buttons"`
	Vars    map[string]string      `json:"vars"`
	Pinned  []*SessionPinned       `json:"pinned"`
	Recents []*Recent              `json:"recents"`
	Shells  []*localpty.LocalShell `json:"shells"`
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

// POST /api/exec_in_terminal payload
type ExecInTerminalRequest struct {
	Cmdline string `json:"cmdline"`
	PaneId  string `json:"paneId,omitempty"`
}

type CopyIDRequest struct {
	Name                string `json:"name"`
	Password            string `json:"password,omitempty"`
	ExpectedFingerprint string `json:"expected_fingerprint,omitempty"`
}

type CopyIDResponse struct {
	Status      string `json:"status" ts_type:"\"success\" | \"need_password\" | \"need_app_password\" | \"need_hostkey_confirm\" | \"error\""`
	Message     string `json:"message"`
	Fingerprint string `json:"fingerprint,omitempty"`
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
	Locked      bool   `json:"locked,omitempty"`
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
	State    string                `json:"state" ts_type:"\"stolen\" | \"disconnected\" | \"connected\" | \"connecting\" | \"exited\" | \"\""`
	IsPinned bool                  `json:"isPinned"`
	IsLocked bool                  `json:"isLocked"`
}

type WsResizeMsg struct {
	Type WsTerminalMessageType `json:"type" ts_type:"\"resize\""` // fixed to "resize"
	Cols uint16                `json:"cols"`
	Rows uint16                `json:"rows"`
}

type PasswordsResponse struct {
	Locked bool     `json:"locked"`
	Keys   []string `json:"keys"`
}

type PasswordsUnlockRequest struct {
	AppPassword string `json:"app_password"`
}

type PasswordsRevealRequest struct {
	Key string `json:"key"`
}

type PasswordsRevealResponse struct {
	Password string `json:"password"`
}

type PasswordsChangeRequest struct {
	Key      string `json:"key"`
	Password string `json:"password"`
}

type PasswordsDeleteRequest struct {
	Key string `json:"key"`
}

// POST /api/config
type ConfigRequest struct {
	SavePassword string `json:"save_password" ts_type:"\"ask\" | \"always\" | \"never\""`
}

// TunnelType indicates the direction of the tunnel.
type TunnelType string

const (
	TunnelTypeLocal  TunnelType = "local"
	TunnelTypeRemote TunnelType = "remote"
)

// ActiveTunnel represents a currently running port forwarding tunnel.
type ActiveTunnel struct {
	Type       TunnelType `json:"type" ts_type:"\"local\" | \"remote\""`
	BindAddr   string     `json:"bindAddr"`
	BindPort   string     `json:"bindPort"`
	RemoteHost string     `json:"remoteHost"`
	RemotePort string     `json:"remotePort"`
	HostName   string     `json:"hostName"` // the SSH host alias this tunnel belongs to
}

// current it's not converted to TS automatically
const WS_MSG_PREFIX_STATE = "STATE:"
