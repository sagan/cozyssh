/* Do not change, this code is generated from Golang structs */


export interface MsgType {
    type: string;
}
export interface ManifestIcon {
    src: string;
    sizes: string;
    type: string;
}
export interface Manifest {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    background_color: string;
    theme_color: string;
    handle_links?: string;
    icons: ManifestIcon[];
}
export interface WebdavStatus {
    webdavUrl: string;
    webdavUser: string;
    webdavPassword: string;
    webdavEnabled: boolean;
    syncStatus: "idle" | "syncing" | "error" | "success" | "disabled";
    syncError: string;
    syncTime: number;
    webdavEncrypted: boolean;
    masterKey?: string;
    webdavUploadSSHData: boolean;
}
export interface Sysinfo {
    username?: string;
    sitename?: string;
    version?: string;
    insecureAllowed?: boolean;
    isSecure?: boolean;
    savePassword?: "ask" | "always" | "never";
    configDir?: string;
    sshDir?: string;
    defaultIdentityPath?: string;
    defaultIdentityPublicKey?: string;
}
export interface SaveWebdavSettingsRequest {
    url: string;
    user: string;
    password: string;
    enabled: boolean;
    useEncryption?: boolean;
    masterKey?: string;
    uploadSSHData?: boolean;
}
export interface SyncDetectionResult {
    brandNew: boolean;
    uploadCount: number;
    downloadCount: number;
    deleteLocalCount: number;
    deleteRemoteCount: number;
    encrypted: boolean;
    keyRequired: boolean;
    keyInvalid: boolean;
}
export interface DeviceSSHData {
    deviceName: string;
    hasSSHConfig: boolean;
    hasKnownHosts: boolean;
    sshConfigMtime: number;
    knownHostsMtime: number;
}
export interface RemoteHostEntry {
    host: string;
    directives: Record<string, string>;
    isNew: boolean;
    isModified: boolean;
    localDirectives?: Record<string, string>;
}
export interface RemoteKnownHostEntry {
    line: string;
    patterns: string;
    keyType: string;
    keyData: string;
    comment?: string;
    isNew: boolean;
    isConflict: boolean;
    localKeyType?: string;
    localKeyData?: string;
}
export interface DeviceSSHListResponse {
    devices: DeviceSSHData[];
}
export interface DeviceSSHConfigResponse {
    deviceName: string;
    hosts: RemoteHostEntry[];
}
export interface DeviceKnownHostsResponse {
    deviceName: string;
    entries: RemoteKnownHostEntry[];
}
export interface ImportSSHConfigRequest {
    deviceName: string;
    hostNames: string[];
}
export interface ImportKnownHostsRequest {
    deviceName: string;
    lines: string[];
    force: boolean;
}
export interface HostData {
    name: string;
    hostname: string;
    port: string;
    user: string;
    proxyJump?: string;
    remoteCommand?: string;
    tags?: string[];
    comment?: string;
    source?: "config" | "known_hosts" | "";
    identityFile?: string;
    isAuto?: boolean;
    isFavourite?: boolean;
    addressFamily?: "any" | "inet" | "inet6" | "";
    userKnownHostsFile?: string;
    strictHostKeyChecking?: "yes" | "no" | "ask" | "";
    hostKeyAlgorithms?: string;
    verifyHostKeyDns?: "yes" | "no" | "ask" | "";
    sendEnv?: string;
    localForward?: string;
    remoteForward?: string;
    dynamicForward?: string;
    password?: string;
    passwordExists?: boolean;
    clearPassword?: boolean;
}
export interface ButtonData {
    id: string;
    name: string;
    type: "send_string" | "terminal_function" | "misc" | "open_terminal" | "run_script";
    payload: string;
    group: string;
    autorun: number;
    order: number;
    shortcut: string;
    liquidjs?: number;
    mtime?: number;
    shortcut_scope?: number;
    meta?: Record<string, string>;
}
export interface ButtonsMoveRequest {
    id: string;
    direction: number;
}
export interface Session {
    id: string;
    host: string;
    title: string;
    isPinned: boolean;
    isLocked: boolean;
    isHidden: boolean;
    listenerCount: number;
}
export interface SessionsAttachRequest {
    id: string;
}
export interface SessionsCloseRequest {
    id: string;
}
export interface PasswordUpdateRequest {
    new_password: string;
    force: boolean;
}
export interface SessionsPinRequest {
    id: string;
    host: string;
    title: string;
}
export interface SessionsUnpinRequest {
    id: string;
}
export interface SessionsRenameRequest {
    id: string;
    title: string;
}
export interface SessionsLockRequest {
    id: string;
    host: string;
    title: string;
}
export interface SessionsHideRequest {
    id: string;
}
export interface Recent {
    host: string;
    last_used: number;
}
export interface RecentUpdateRequest {
    host: string;
}
export interface LocalShell {
    name: string;
    path: string;
    args?: string[];
    run_cmdline_args?: string[];
}
export interface FullData {
    sysinfo: Sysinfo;
    hosts: HostData[];
    groups: string[];
    buttons: ButtonData[];
    vars: {[key: string]: string};
    pinned: Session[];
    recents: Recent[];
    shells: LocalShell[];
}
export interface LoginRequest {
    password: string;
}
export interface LoginResponse {
    fulldata?: FullData;
    token: string;
}
export interface ExecRequest {
    cmdline: string;
}
export interface ExecResult {
    stdout: string;
    stderr: string;
    error: unknown;
}
export interface ExecInTerminalRequest {
    cmdline: string;
    paneId?: string;
}
export interface CopyIDRequest {
    name: string;
    password?: string;
    expectedFingerprint?: string;
}
export interface CopyIDResponse {
    status: "success" | "need_password" | "need_app_password" | "need_hostkey_confirm" | "error";
    message: string;
    fingerprint?: string;
}
export interface PreflightResponse {
    insecureAllowed: boolean;
    isSecure: boolean;
}
export interface FileInfo {
    name: string;
    isDir: boolean;
    size: number;
    modTime: string;
}
export interface FsList {
    path: string;
    files: FileInfo[];
}
export interface FsToken {
    expires: number;
    sig: string;
}
export interface FileRenameRequest {
    newPath: string;
}
export interface FileMkdirRequest {
    name: string;
}
export interface ScratchpadPage {
    id: string;
    title: string;
    content: string;
    locked?: boolean;
    lastUpdated: number;
}
export interface ScratchpadData {
    pages: ScratchpadPage[];
}
export interface ScratchpadSyncMsg {
    type: "sync" | "force_sync";
    data: ScratchpadData;
}
export interface ScratchpadDeleteMsg {
    type: "delete";
    id: string;
}
export interface ScratchpadHelloMsg {
    type: "hello";
}
export interface WsTerminalMessage {
    type: "historyStart" | "tabState" | "state";
    state: "stolen" | "disconnected" | "connected" | "connecting" | "exited" | "";
    isPinned: boolean;
    isLocked: boolean;
    isHidden: boolean;
}
export interface WsResizeMsg {
    type: "resize";
    cols: number;
    rows: number;
}
export interface PasswordsResponse {
    locked: boolean;
    keys: string[];
}
export interface PasswordsUnlockRequest {
    app_password: string;
}
export interface PasswordsRevealRequest {
    key: string;
}
export interface PasswordsRevealResponse {
    password: string;
}
export interface PasswordsChangeRequest {
    key: string;
    password: string;
}
export interface PasswordsDeleteRequest {
    key: string;
}
export interface ConfigRequest {
    sitename?: string;
    savePassword?: "ask" | "always" | "never";
}
export interface ActiveTunnel {
    type: "local" | "remote" | "dynamic";
    bindAddr: string;
    bindPort: string;
    remoteHost?: string;
    remotePort?: string;
    hostName: string;
}