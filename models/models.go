package models

import (
	"cozyssh/constants"
	"cozyssh/localpty"
	"strconv"
	"strings"
)

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
	WebdavUrl           string `json:"webdavUrl"`
	WebdavUser          string `json:"webdavUser"`
	WebdavPassword      string `json:"webdavPassword"`
	WebdavEnabled       bool   `json:"webdavEnabled"`
	SyncStatus          string `json:"syncStatus" ts_type:"\"idle\" | \"syncing\" | \"error\" | \"success\" | \"disabled\""`
	SyncError           string `json:"syncError"`
	SyncTime            int64  `json:"syncTime"`
	WebdavEncrypted     bool   `json:"webdavEncrypted"`
	MasterKey           string `json:"masterKey,omitempty"`
	WebdavUploadSSHData bool   `json:"webdavUploadSSHData"`
}

type Sysinfo struct {
	Username                 string `json:"username"`
	Sitename                 string `json:"sitename"`
	Version                  string `json:"version"`
	InsecureAllowed          bool   `json:"insecureAllowed,omitempty"`
	IsSecure                 bool   `json:"isSecure,omitempty"`
	SavePassword             string `json:"savePassword" ts_type:"\"ask\" | \"always\" | \"never\""`
	ConfigDir                string `json:"configDir"`
	SSHDir                   string `json:"sshDir"`
	UseKeyring               bool   `json:"useKeyring,omitempty"`
	DefaultIdentityPath      string `json:"defaultIdentityPath"`
	DefaultIdentityPublicKey string `json:"defaultIdentityPublicKey"`
}

type SaveWebdavSettingsRequest struct {
	Url           string `json:"url"`
	User          string `json:"user"`
	Password      string `json:"password"`
	Enabled       bool   `json:"enabled"`
	UseEncryption bool   `json:"useEncryption,omitempty"`
	MasterKey     string `json:"masterKey,omitempty"`
	UploadSSHData bool   `json:"uploadSSHData,omitempty"`
}

type SyncDetectionResult struct {
	BrandNew          bool `json:"brandNew"`
	UploadCount       int  `json:"uploadCount"`
	DownloadCount     int  `json:"downloadCount"`
	DeleteLocalCount  int  `json:"deleteLocalCount"`
	DeleteRemoteCount int  `json:"deleteRemoteCount"`
	Encrypted         bool `json:"encrypted"`
	KeyRequired       bool `json:"keyRequired"`
	KeyInvalid        bool `json:"keyInvalid"`
}

// DeviceSSHData represents another device's SSH data cached locally from WebDAV.
type DeviceSSHData struct {
	DeviceName      string `json:"deviceName"`
	HasSSHConfig    bool   `json:"hasSSHConfig"`
	HasKnownHosts   bool   `json:"hasKnownHosts"`
	SSHConfigMtime  int64  `json:"sshConfigMtime"`  // file mtime encoded in the WebDAV filename
	KnownHostsMtime int64  `json:"knownHostsMtime"` // file mtime encoded in the WebDAV filename
}

// RemoteHostEntry is a parsed host block from another device's ~/.ssh/config,
// compared against the local config to determine its import status.
type RemoteHostEntry struct {
	// All raw directives from the remote config block, keyed by lowercase directive name.
	// The "host" key holds the alias name.
	Host       string            `json:"host"`
	Directives map[string]string `json:"directives" ts_type:"Record<string, string>"`
	// IsNew is true when no local host with this alias exists.
	IsNew bool `json:"isNew"`
	// IsModified is true when a local host with this alias exists but differs.
	IsModified bool `json:"isModified"`
	// LocalDirectives is populated (non-nil) when IsModified is true.
	LocalDirectives map[string]string `json:"localDirectives,omitempty" ts_type:"Record<string, string>"`
}

// RemoteKnownHostEntry is a parsed line from another device's ~/.ssh/known_hosts,
// compared against the local known_hosts to determine its import status.
type RemoteKnownHostEntry struct {
	// Raw line from known_hosts (excluding comment lines and blank lines).
	Line     string `json:"line"`
	Patterns string `json:"patterns"` // first field, comma-separated hostnames/IPs
	KeyType  string `json:"keyType"`  // e.g. "ssh-ed25519", "ecdsa-sha2-nistp256"
	KeyData  string `json:"keyData"`  // base64-encoded key blob
	Comment  string `json:"comment,omitempty"`
	// IsNew is true if none of the patterns exist in local known_hosts.
	IsNew bool `json:"isNew"`
	// IsConflict is true if at least one of the patterns exists locally but with a DIFFERENT key.
	IsConflict   bool   `json:"isConflict"`
	LocalKeyType string `json:"localKeyType,omitempty"` // populated when IsConflict is true
	LocalKeyData string `json:"localKeyData,omitempty"` // populated when IsConflict is true
}

// GET /api/settings/webdav/devices response
type DeviceSSHListResponse struct {
	Devices []*DeviceSSHData `json:"devices"`
}

// GET /api/settings/webdav/devices/{name}/sshconfig response
type DeviceSSHConfigResponse struct {
	DeviceName string             `json:"deviceName"`
	Hosts      []*RemoteHostEntry `json:"hosts"`
}

// GET /api/settings/webdav/devices/{name}/knownhosts response
type DeviceKnownHostsResponse struct {
	DeviceName string                  `json:"deviceName"`
	Entries    []*RemoteKnownHostEntry `json:"entries"`
}

// POST /api/settings/webdav/import/sshconfig
type ImportSSHConfigRequest struct {
	DeviceName string   `json:"deviceName"`
	HostNames  []string `json:"hostNames"` // Host aliases to import
}

// POST /api/settings/webdav/import/knownhosts
type ImportKnownHostsRequest struct {
	DeviceName string   `json:"deviceName"`
	Lines      []string `json:"lines"` // Raw known_hosts lines to import
	Force      bool     `json:"force"` // Required to import conflicting entries
}

type HostData struct {
	Name          string   `json:"name"`
	HostName      string   `json:"hostname"`
	Port          string   `json:"port"`
	User          string   `json:"user"`
	ProxyJump     string   `json:"proxyJump,omitempty"`
	RemoteCommand string   `json:"remoteCommand,omitempty"`
	Tags          []string `json:"tags,omitempty"`
	Comment       string   `json:"comment,omitempty"`
	// "config", "known_hosts", ""
	Source       string `json:"source,omitempty" ts_type:"\"config\" | \"known_hosts\" | \"\""`
	IdentityFile string `json:"identityFile,omitempty"`
	// true if from known_hosts and not config
	IsAuto      bool `json:"isAuto,omitempty"`
	IsFavourite bool `json:"isFavourite,omitempty"`

	AddressFamily         string `json:"addressFamily,omitempty" ts_type:"\"any\" | \"inet\" | \"inet6\" | \"\""`
	UserKnownHostsFile    string `json:"userKnownHostsFile,omitempty"`
	StrictHostKeyChecking string `json:"strictHostKeyChecking,omitempty" ts_type:"\"yes\" | \"no\" | \"ask\" | \"\""`
	HostKeyAlgorithms     string `json:"hostKeyAlgorithms,omitempty"`
	// VerifyHostKeyDNS controls SSHFP DNS verification (yes / no / ask), consistent with OpenSSH.
	VerifyHostKeyDNS string `json:"verifyHostKeyDns,omitempty" ts_type:"\"yes\" | \"no\" | \"ask\" | \"\""`
	// SendEnv specifies environment variables to send to the remote host.
	SendEnv string `json:"sendEnv,omitempty"`

	// Port forwarding (OpenSSH syntax, one rule per line)
	LocalForward   string `json:"localForward,omitempty"`
	RemoteForward  string `json:"remoteForward,omitempty"`
	DynamicForward string `json:"dynamicForward,omitempty"` // SOCKS5 proxy: [bind_address:]port

	// Password storage support
	Password       string `json:"password,omitempty"`
	PasswordExists bool   `json:"passwordExists,omitempty"`
	ClearPassword  bool   `json:"clearPassword,omitempty"`
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
	// 0 - everywhere; 1 - active group only
	ShortcutScope int               `json:"shortcut_scope,omitempty"`
	Meta          map[string]string `json:"meta,omitempty" ts_type:"Record<string, string>"` // custom metadata
}

type ButtonsMoveRequest struct {
	Id        string `json:"id"`
	Direction int    `json:"direction"` // -1 for left, 1 for right
}

type Session struct {
	Id                  string `json:"id"`
	Host                string `json:"host"`
	CanonicalHostString string `json:"canonicalHostString"`
	Title               string `json:"title"`
	IsCustomTitle       bool   `json:"isCustomTitle"`
	IsPinned            bool   `json:"isPinned"`
	IsLocked            bool   `json:"isLocked"`
	IsHidden            bool   `json:"isHidden"`
	ListenerCount       int    `json:"listenerCount"`
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

// POST /api/sessions/pin & /api/sessions/lock payload
type SessionsPinRequest struct {
	Id            string `json:"id"`
	Title         string `json:"title"`
	IsCustomTitle bool   `json:"isCustomTitle,omitempty"`
}

// POST /api/sessions/unpin & /api/sessions/hide payload
type SessionsRequest struct {
	Id string `json:"id"`
}

type SessionsRenameRequest struct {
	Id    string `json:"id"`
	Title string `json:"title"`
}

type Recent struct {
	Host     string `json:"host"`
	LastUsed int64  `json:"last_used"` // unix timestamp in seconds
}

type FullData struct {
	Sysinfo Sysinfo                `json:"sysinfo"`
	Hosts   []*HostData            `json:"hosts"`
	Groups  []string               `json:"groups"`
	Buttons []*ButtonData          `json:"buttons"`
	Vars    map[string]string      `json:"vars"`
	Pinned  []*Session             `json:"pinned"`
	Recents []*Recent              `json:"recents"`
	Shells  []*localpty.LocalShell `json:"shells"`
}

type LoginRequest struct {
	Password string `json:"password"`
	Token    string `json:"token,omitempty"`
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
	ExpectedFingerprint string `json:"expectedFingerprint,omitempty"`
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
	IsPinned bool                  `json:"isPinned"` // pinned session (running in background after browser disconnect)
	IsLocked bool                  `json:"isLocked"` // locked session (prevent accidental close). implied pinned
	IsHidden bool                  `json:"isHidden"` // hidden session running in server's background. implies pinned & locked
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
	AppPassword string `json:"appPassword"`
}

type PasswordsRevealRequest struct {
	Key string `json:"key"`
	// Required for verification (only if useKeyring is disabled).
	AppPassword string `json:"appPassword"`
}

type PasswordsRevealResponse struct {
	Password string `json:"password"`
}

type PasswordsChangeRequest struct {
	Key         string `json:"key"`
	Password    string `json:"password"`
	AppPassword string `json:"appPassword"`
}

type PasswordsDeleteRequest struct {
	Key string `json:"key"`
}

// POST /api/config
type ConfigRequest struct {
	Sitename     string `json:"sitename,omitempty"`
	SavePassword string `json:"savePassword,omitempty" ts_type:"\"ask\" | \"always\" | \"never\""`
	UseKeyring   *bool  `json:"useKeyring,omitempty"`
	AppPassword  string `json:"appPassword,omitempty"`
}

type RevealAppPasswordResponse struct {
	AppPassword string `json:"appPassword"`
}

type AppAuthResponse struct {
	Token      string `json:"token"`
	UseKeyring bool   `json:"useKeyring"`
}

// TunnelType indicates the direction of the tunnel.
type TunnelType string

const (
	TunnelTypeLocal   TunnelType = "local"
	TunnelTypeRemote  TunnelType = "remote"
	TunnelTypeDynamic TunnelType = "dynamic" // SOCKS5 dynamic forward
)

// ActiveTunnel represents a currently running port forwarding tunnel.
type ActiveTunnel struct {
	Type       TunnelType `json:"type" ts_type:"\"local\" | \"remote\" | \"dynamic\""`
	BindAddr   string     `json:"bindAddr"`
	BindPort   string     `json:"bindPort"`
	RemoteHost string     `json:"remoteHost,omitempty"` // empty for dynamic tunnels
	RemotePort string     `json:"remotePort,omitempty"` // empty for dynamic tunnels
	HostName   string     `json:"hostName"`             // the SSH host alias this tunnel belongs to
}

// current it's not converted to TS automatically
const WS_MSG_PREFIX_STATE = "STATE:"

func (h *HostData) GetOrder() int {
	for _, tag := range h.Tags {
		if after, ok := strings.CutPrefix(tag, constants.TAG_ORDER_PREFIX); ok {
			order, err := strconv.Atoi(after)
			if err == nil {
				return order
			}
		}
	}
	return 0
}
