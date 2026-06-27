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
export const BROWSER_STORAGE_KEY_SCRATCHPAD_SYNC_STATE = "cozy_scratchpad_sync_state";
export const BROWSER_STORAGE_KEY_SCRATCHPAD_CACHE = "cozy_scratchpad_cache";
export const BROWSER_STORAGE_KEY_EXPANDED_GROUPS = "cozyssh_expanded_groups";

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
/**
 * Flag to disable terminal ctrl+l (let browser handle it) and remap ctrl+shift+l & ctrl+alt+l to ctrl+l in terminal.
 */
export const VAR_CS_REMAP_CTRL_L = "cs_remap_ctrl_l";
export const VAR_CS_TERMINAL_FONT_SIZE = "cs_terminal_font_size";
export const VAR_CS_FONT_SIZE = "cs_font_size";

export const VAR_NOAUTOLOAD = "noautoload";
export const VAR_NOAUTORUN = "noautorun";

export const DEFAULT_BUTTON_GROUP = "Default";

export const EVENT_LOCAL_STORAGE_SYNC = "local-storage-sync";

export const VIBRATE_PATTERN = 100;
export const COZYSSH_TOKEN_PREFIX = "cozytoken.";
export const WS_PROTOCOL_QUERY_PREFIX = "query.";
export const WS_PROTOCOL_IDENTITY_PREFIX = "identity.";
export const WS_PROTOCOL_DUMMY = "dummy";

type BuiltinButton = {
  value: string;
  label: string;
  shortcut?: string;
};

export const TERMINAL_FUNCTIONS: BuiltinButton[] = [
  { value: "COPY", label: "COPY (Buffer)" },
  { value: "COPY_VISIBLE", label: "COPY (Visible)" },
  { value: "COPY_SELECTION", label: "COPY (Selection)", shortcut: "ctrl+shift+c" },
  { value: "COPY_CWD", label: "COPY (CWD)" },
  { value: "COPY_CURRENT_CMDLINE", label: "COPY (Current Cmdline)" },
  { value: "COPY_LAST_COMMAND_OUTPUT", label: "COPY (Last Cmd Output)" },
  { value: "PASTE", label: "PASTE (Clipboard)", shortcut: "ctrl+shift+v" },
  { value: "INPUT", label: "INPUT (Prompt)", shortcut: "alt+q" },
  { value: "CLEAR", label: "CLEAR (Screen)" },
  { value: "RESET", label: "RESET (Terminal)" },
  { value: "RECONNECT", label: "RECONNECT (Session)", shortcut: "ctrl+shift+r" },
  { value: "CLOSE", label: "CLOSE (Pane)", shortcut: "alt+w" },
  { value: "CLOSE_TAB", label: "CLOSE (Tab)", shortcut: "alt+shift+w" },
  { value: "SCROLL_TO_TOP", label: "SCROLL (Top)", shortcut: "ctrl+alt+shift+k" },
  { value: "SCROLL_TO_BOTTOM", label: "SCROLL (Bottom)", shortcut: "ctrl+alt+shift+j" },
  { value: "SCROLL_UP", label: "SCROLL (Up)", shortcut: "alt+k" },
  { value: "SCROLL_DOWN", label: "SCROLL (Down)", shortcut: "alt+j" },
  { value: "SCROLL_PAGE_UP", label: "SCROLL (Page Up)", shortcut: "alt+shift+k" },
  { value: "SCROLL_PAGE_DOWN", label: "SCROLL (Page Down)", shortcut: "alt+shift+j" },
  { value: "CLONE_SESSION", label: "CLONE (Session)", shortcut: "alt+c" },
  { value: "CLONE_SESSION_IN_SAME_TAB", label: "CLONE (Session In Same Tab)", shortcut: "alt+shift+c" },
  { value: "SEARCH", label: "SEARCH (Buffer)", shortcut: "ctrl+shift+f" },
  { value: "LOCK_TAB", label: "Lock (Tab)", shortcut: "ctrl+alt+shift+l" },
  { value: "UNLOCK_TAB", label: "Unlock (Tab)", shortcut: "ctrl+alt+shift+l" },
] as const;

export const MISC_FUNCTIONS: BuiltinButton[] = [
  { value: "RESET_FONT_SIZE", label: "Reset Font Size", shortcut: "ctrl+alt+0" },
  { value: "RESET_TERMINAL_FONT_SIZE", label: "Reset Terminal Font Size" },
  { value: "RESET_GLOBAL_FONT_SIZE", label: "Reset Global Font Size" },
  { value: "DECREASE_FONT_SIZE", label: "Decrease Font Size", shortcut: "alt+shift+-" },
  { value: "DECREASE_TERMINAL_FONT_SIZE", label: "Decrease Terminal Font Size", shortcut: "alt+-" },
  { value: "DECREASE_GLOBAL_FONT_SIZE", label: "Decrease Global Font Size" },
  { value: "INCREASE_FONT_SIZE", label: "Increase Font Size", shortcut: "alt+shift++" },
  { value: "INCREASE_TERMINAL_FONT_SIZE", label: "Increase Terminal Font Size", shortcut: "alt++" },
  { value: "INCREASE_GLOBAL_FONT_SIZE", label: "Increase Global Font Size" },
  { value: "CLOSE_OTHER_TABS", label: "Close Other Tabs", shortcut: "ctrl+alt+shift+w" },
  { value: "CLOSE_RIGHT_TABS", label: "Close Tabs to the Right" },
  { value: "TABS_SCROLL_LEFT", label: "Tabs Scroll Left" },
  { value: "TABS_SCROLL_RIGHT", label: "Tabs Scroll Right" },
  { value: "BUTTONS_SCROLL_LEFT", label: "Buttons Scroll Left" },
  { value: "BUTTONS_SCROLL_RIGHT", label: "Buttons Scroll Right" },
  { value: "NEXT_BUTTON_GROUP", label: "Next Button Group", shortcut: "alt+v" },
  { value: "PREV_BUTTON_GROUP", label: "Prev Button Group", shortcut: "alt+shift+v" },
  { value: "OPEN_SCRATCHPAD", label: "Open Scratchpad", shortcut: "alt+s" },
] as const;

export const BUILTIN_BUTTONS = [
  ...TERMINAL_FUNCTIONS.map((f) => ({
    id: `builtin-${f.value}`,
    name: f.label,
    type: "terminal_function" as const,
    payload: f.value,
    shortcut: f.shortcut,
  })),
  ...MISC_FUNCTIONS.map((f) => ({
    id: `builtin-${f.value}`,
    name: f.label,
    type: "misc" as const,
    payload: f.value,
    shortcut: f.shortcut,
  })),
] as const;

export const DEFAULT_SCROLL_LINES = 3;

/**
 * xterm.js default fontSize
 */
export const DEFAULT_TERMINAL_FONT_SIZE = 15;
export const TOAST_KEY_FONT_SIZE = "cs-font-size";

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

export const ID_INPUT_DIALOG_INPUT = "input-dialog-input";

export const CACHE_API_DATA = "api-data-cache";

export const CACHE_MANIFEST = "manifest-cache";

export const DEFAULT_SCROLL_ITEMS = 10;

export const DEFAULT_FONT_SIZE = 14; // MUI default typegraphy fontSize

export const TAG_GROUP_PREFIX = "g-";

export const TAG_ORDER_PREFIX = "o-";

export const TAG_FAV = "fav";
