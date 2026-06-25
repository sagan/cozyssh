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
}
export interface Sysinfo {
    hostname: string;
    version: string;
    insecureAllowed: boolean;
    isSecure: boolean;
    savePassword: "ask" | "always" | "never";
}
export interface SaveWebdavSettingsRequest {
    url: string;
    user: string;
    password: string;
    enabled: boolean;
    useEncryption?: boolean;
    masterKey?: string;
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
export interface HostData {
    name: string;
    hostname: string;
    port: string;
    user: string;
    proxy_jump?: string;
    remote_command?: string;
    tags?: string[];
    comment?: string;
    source?: "config" | "known_hosts" | "";
    identity_file?: string;
    is_auto?: boolean;
    is_favourite?: boolean;
    address_family?: "any" | "inet" | "inet6" | "";
    user_known_hosts_file?: string;
    strict_host_key_checking?: "yes" | "no" | "ask" | "";
    host_key_algorithms?: string;
    local_forward?: string;
    remote_forward?: string;
    password?: string;
    password_exists?: boolean;
    clear_password?: boolean;
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
}
export interface ButtonsMoveRequest {
    id: string;
    direction: number;
}
export interface SessionPinned {
    id: string;
    host: string;
    title: string;
    isLocked: boolean;
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
export interface TabsPinRequest {
    id: string;
    host: string;
    title: string;
}
export interface TabsUnpinRequest {
    id: string;
}
export interface TabsRenameRequest {
    id: string;
    title: string;
}
export interface TabsLockRequest {
    id: string;
    host: string;
    title: string;
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
    pinned: SessionPinned[];
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
    expected_fingerprint?: string;
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
    save_password: "ask" | "always" | "never";
}
export interface ActiveTunnel {
    type: "local" | "remote";
    bindAddr: string;
    bindPort: string;
    remoteHost: string;
    remotePort: string;
    hostName: string;
}