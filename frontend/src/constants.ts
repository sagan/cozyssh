export const METHOD_GET = "GET";
export const METHOD_PUT = "PUT";
export const METHOD_POST = "POST";
export const METHOD_DELETE = "DELETE";
export const HEADER_AUTHORIZATION = "Authorization";
export const HEADER_AUTHORIZATION_BEARER_PREFIX = "Bearer ";
export const HEADER_CONTENT_TYPE = "Content-Type";
export const HEADER_COOKIE = "Cookie";
export const HEADER_ORIGIN = "Origin";
export const HEADER_REFERER = "Referer";
export const HEADER_USER_AGENT = "User-Agent";
export const HEADER_X_COZYSSH_FETCH_PREFIX = "X-Cozssh-Fetch-";
export const HEADER_X_COZYSSH_URL = "X-Cozyssh-Url";
export const MIME_JSON = "application/json";
export const APP_NAME = "CozySSH";
/**
 * local shell name
 */
export const LOCAL_NAME = "local";

// export const WS_MSG_PREFIX_STATE = "STATE:";
export const BROWSER_STORAGE_KEY_ACTIVE_GROUP = "cozy_active_group";
export const BROWSER_STORAGE_KEY_LOCAL_VARS = "cozy_localvars";
export const BROWSER_STORAGE_KEY_RECENTS = "cozy_recents";
export const BROWSER_STORAGE_KEY_RECENT_BUTTONS = "cozy_recent_buttons";
export const BROWSER_STORAGE_KEY_TOKEN = "cozy_token";
export const BROWSER_STORAGE_KEY_VARS = "cozy_vars";
export const BROWSER_STORAGE_KEY_TAGS_EXPANDED = "cozy_tags_expanded";
export const BROWSER_STORAGE_KEY_FAV_EXPANDED = "cozy_fav_expanded";
export const BROWSER_STORAGE_KEY_ALL_EXPANDED = "cozy_all_expanded";
export const BROWSER_STORAGE_KEY_AUTO_EXPANDED = "cozy_auto_expanded";
export const BROWSER_STORAGE_KEY_SCRATCHPAD_SYNC_STATE = "cozy_scratchpad_sync_state";
export const BROWSER_STORAGE_KEY_SCRATCHPAD_CACHE = "cozy_scratchpad_cache";
export const BROWSER_STORAGE_KEY_EXPANDED_GROUPS = "cozy_expanded_groups";

export const LOCAL_VAR_PREFIX = "local_";
export const VAR_CS_SCROLL_LINES = "cs_scroll_lines";
export const VAR_CS_SCROLL_ITEMS = "cs_scroll_items";
export const VAR_CS_NOAUTOLOAD = "cs_noautoload";
export const VAR_CS_NOAUTORUN = "cs_noautorun";
export const VAR_CS_NOWAKELOCK = "cs_nowakelock";
export const VAR_CS_NOMODTEXTAREA = "cs_nomodtextarea";
export const VAR_CS_NOIMAGE = "cs_noimage";
export const VAR_CS_NOWEBLINKS = "cs_noweblinks";
export const VAR_CS_NOWEBGL = "cs_nowebgl";
export const VAR_CS_NO_SANITIZE_HASH = "cs_no_sanitize_hash";
export const VAR_CS_NO_SELECT_TO_COPY = "cs_no_select_to_copy";
export const VAR_CS_NO_PASTE_ON_CONTEXTMENU = "cs_no_paste_on_contextmenu";
/**
 * Flag to disable terminal ctrl+l (let browser handle it) and remap ctrl+shift+l & ctrl+alt+l to ctrl+l in terminal.
 */
export const VAR_CS_REMAP_CTRL_L = "cs_remap_ctrl_l";
export const VAR_CS_TERMINAL_FONT_SIZE = "cs_terminal_font_size";
export const VAR_CS_FONT_SIZE = "cs_font_size";
export const VAR_CS_VIBRATE_PATTERN = "cs_vibrate_pattern";
/**
 * The keeped toasts number
 */
export const VAR_CS_TOAST_NUMBER = "cs_toast_number";
/**
 * The toast timeout in ms
 */
export const VAR_CS_TOAST_TIMEOUT = "cs_toast_timeout";
export const VAR_CS_SIDEBAR_WIDTH = "cs_sidebar_width";
export const VAR_CS_RECENT_HOSTS = "cs_recent_hosts";
export const VAR_CS_RECENT_BUTTONS = "cs_recent_buttons";
/**
 * The period in ms to consider a terminal is active if any new data arrives in buffer recently.
 * Default is 2000ms (2 seconds)
 */
export const VAR_CS_TERMINAL_ACTIVE_PERIOD = "cs_terminal_active_period";
/**
 * Shell Integration keeped recent commands number for each terminal
 */
export const VAR_CS_TERMINAL_RECENT_COMMANDS = "cs_terminal_recent_commands";

export const VAR_NOAUTOLOAD = "noautoload";
export const VAR_NOAUTORUN = "noautorun";

export const DEFAULT_BUTTON_GROUP = "Default";

export const EVENT_LOCAL_STORAGE_SYNC = "local-storage-sync";

export const DEFAULT_VIBRATE_PATTERN = 100;
export const DEFAULT_TOAST_NUMBER = 3;
export const DEFAULT_TOAST_TIMEOUT = 4000;
export const DEFAULT_SIDEBAR_WIDTH = 260;
export const DEFAULT_RECENT_HOSTS = 5;
export const DEFAULT_RECENT_BUTTONS = 10;
export const DEFAULT_SCROLL_LINES = 3;
export const DEFAULT_TERMINAL_RECENT_COMMANDS = 100;
/**
 * xterm.js default fontSize
 */
export const DEFAULT_TERMINAL_FONT_SIZE = 15;
export const DEFAULT_TERMINAL_ACTIVE_PERIOD = 2000;

export const COZYSSH_TOKEN_PREFIX = "cozytoken.";
export const WS_PROTOCOL_QUERY_PREFIX = "query.";
export const WS_PROTOCOL_IDENTITY_PREFIX = "identity.";
export const WS_PROTOCOL_DUMMY = "dummy";

export const TOAST_KEY_FONT_SIZE = "cs-font-size";
export const TOAST_KEY_PASTE_SSH_CONFIG_BLOCK = "cs-paste-ssh-config-block";
/**
 * WebDAV Sync related toasts
 */
export const TOAST_KEY_SYNC = "cs-sync";
export const TOAST_KEY_TERMINAL = "cs-terminal";
/**
 * Custom Script (run_script button) related toasts
 */
export const TOAST_KEY_SCRIPT = "cs-script";
export const TOAST_KEY_API_SETTINGS = "cs-api-settings";
export const TOAST_KEY_API_FULLDATA = "cs-api-fulldata";
export const TOAST_KEY_COPY_TUNNEL_ENTRYPOINT = "cs-copy-tunnel-entrypoint";
export const TOAST_KEY_COPY = "cs-copy";
export const TOAST_KEY_HOST_NOT_FOUND = "cs-host-not-found";
export const TOAST_KEY_REFRESH = "cs-refresh";

/**
 * Used as a special flag in url hash to indicate the mobile input panel is currently open.
 * When the user opens the panel, pushState a new state with this hash.
 * When the user closes the panel, we intercept the popstate event and hide the panel.
 * This allows the user to use the back gesture to close the panel.
 */
export const HASH_MOBILE_INPUT_PANEL = "$mobile-input-panel$";

export const ID_TERMINAL_SEARCH_INPUT = "terminal-search-input";

export const ID_SIDEBAR_FILTER = "sidebar-filter";

export const ID_NEW_TAB_DIALOG_INPUT = "new-tab-dialog-input";

export const ID_NEW_TAB_DIALOG_CONTENT = "new-tab-dialog-content";

export const ID_NEW_TAB_DIALOG_LIST = "new-tab-dialog-list";

export const ID_INPUT_DIALOG_INPUT = "input-dialog-input";

export const ID_SIDEBAR = "sidebar";

export const ID_SIDEBAR_MAIN = "sidebar-main";

export const CACHE_API_DATA = "api-data-cache";

export const CACHE_MANIFEST = "manifest-cache";

export const DEFAULT_SCROLL_ITEMS = 10;

export const DEFAULT_FONT_SIZE = 14; // MUI default typegraphy fontSize

export const TAG_GROUP_PREFIX = "g-";

export const TAG_ORDER_PREFIX = "o-";

export const TAG_FLAG_PREFIX = "$";

export const TAG_FAV = "fav";

export const TAG_FLAG_SHELL_INTEGRATION = "$shellIntegration";

export const TAG_FLAG_SHELL_INTEGRATION_DISABLED = "$shellIntegration=0";

export const TAG_FLAG_SHELL_INTEGRATION_ENABLED = "$shellIntegration=1";

export const TAG_FLAG_SHELL_INTEGRATION_FORCE_ENABLED = "$shellIntegration=2";

export const LINK_COZYSSH_GITHUB = "https://github.com/sagan/cozyssh";
export const LINK_COZYSSH_DOC_DATA = "https://github.com/sagan/cozyssh/blob/master/docs/DATA.md";
export const LINK_COZYSSH_DOC_SCRIPTS = "https://github.com/sagan/cozyssh/blob/master/docs/SCRIPTS.md";
export const LINK_COZYSSH_DOC_PLUGINS = "https://github.com/sagan/cozyssh-plugins";
export const LINK_COZYSSH_PLUGIN_MANAGER =
  "https://raw.githubusercontent.com/sagan/cozyssh-plugins/refs/heads/master/CsPluginManager.tsx";

export const SETTINGS_TABS = 9;

export const SETTINGS_TAB_IDX_SESSIONS = 0;
export const SETTINGS_TAB_IDX_TUNNELS = 1;
export const SETTINGS_TAB_IDX_PASSWORDS = 2;
export const SETTINGS_TAB_IDX_SETTINGS = 3;
export const SETTINGS_TAB_IDX_SYNC = 4;
export const SETTINGS_TAB_IDX_IMPORT = 5;
export const SETTINGS_TAB_IDX_EXPORT = 6;
export const SETTINGS_TAB_IDX_SHORTCUTS = 7;
export const SETTINGS_TAB_IDX_ABOUT = 8;

/**
 * Hide element from desktop
 */
export const CLASS_HIDE_DESKTOP = "hide-desktop";
/**
 * Hide element from web
 */
export const CLASS_HIDE_WEB = "hide-web";

export const PartialMatchHostKey: unique symbol = Symbol("PartialMatchHost");

export const RECENT_BUTTON_ID_PREFIX_CUSTOM_SHORTCUT = "$custom_shortcut$.";
