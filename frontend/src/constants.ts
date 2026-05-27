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
export const BROWSER_STORAGE_KEY_TOKEN = "cozy_token";
export const BROWSER_STORAGE_KEY_VARS = "cozy_vars";
export const BROWSER_STORAGE_KEY_TAB_ID = "cozy_tab_id";
export const BROWSER_STORAGE_KEY_SCRATCHPAD_SYNC_STATE = "cozy_scratchpad_sync_state";
export const BROWSER_STORAGE_KEY_SCRATCCHPAD_CACHE = "cozy_scratchpad_cache";

export const LOCAL_VAR_PREFIX = "local_";
export const VAR_CS_SCROLL_LINES = "cs_scroll_lines";
export const VAR_CS_NOAUTOLOAD = "cs_noautoload";
export const VAR_CS_NOAUTORUN = "cs_noautorun";
export const VAR_CS_NOWAKELOCK = "cs_nowakelock";
export const VAR_CS_NOMODTEXTAREA = "cs_nomodtextarea";
export const VAR_CS_NOIMAGE = "cs_noimage";
export const VAR_CS_NOWEBLINKS = "cs_noweblinks";
export const VAR_CS_NOWEBGL = "cs_nowebgl";

export const VAR_NOAUTOLOAD = "noautoload";
export const VAR_NOAUTORUN = "noautorun";

export const BROADCAST_CHANNEL_COZY_TABS = "cozy_tabs";
export const BROADCAST_CHANNEL_MESSAGE_PROBE_PINNED = "probe_pinned";
export const BROADCAST_CHANNEL_MESSAGE_PINNED_PRESENT = "pinned_present";

export const DEFAULT_BUTTON_GROUP = "Default";

export const VIBRATE_PATTERN = 100;
export const COZYSSH_TOKEN_PREFIX = "cozytoken.";
export const WS_PROTOCOL_QUERY_PREFIX = "query.";

export const TERMINAL_FUNCTIONS = [
  { value: "COPY", label: "COPY (Buffer)" },
  { value: "COPY_VISIBLE", label: "COPY (Visible)" },
  { value: "COPY_SELECTION", label: "COPY (Selection)" },
  { value: "COPY_LAST_COMMAND_OUTPUT", label: "COPY (Last Cmd Output)" },
  { value: "PASTE", label: "PASTE (Clipboard)" },
  { value: "INPUT", label: "INPUT (Prompt)" },
  { value: "CLEAR", label: "CLEAR (Screen)" },
  { value: "RESET", label: "RESET (Terminal)" },
  { value: "RECONNECT", label: "RECONNECT (Session)" },
  { value: "CLOSE", label: "CLOSE (Pane)" },
  { value: "CLOSE_TAB", label: "CLOSE (Tab)" },
  { value: "SCROLL_TO_TOP", label: "SCROLL (Top)" },
  { value: "SCROLL_TO_BOTTOM", label: "SCROLL (Bottom)" },
  { value: "SCROLL_UP", label: "SCROLL (Up)" },
  { value: "SCROLL_DOWN", label: "SCROLL (Down)" },
  { value: "SCROLL_PAGE_UP", label: "SCROLL (Page Up)" },
  { value: "SCROLL_PAGE_DOWN", label: "SCROLL (Page Down)" },
  { value: "CLONE_SESSION", label: "CLONE (Session)" },
  { value: "CLONE_SESSION_IN_SAME_TAB", label: "CLONE (Session In Same Tab)" },
  { value: "SEARCH", label: "SEARCH (Buffer)" },
] as const;

export const MISC_FUNCTIONS = [
  { value: "NEXT_BUTTON_GROUP", label: "Next Button Group" },
  { value: "PREV_BUTTON_GROUP", label: "Prev Button Group" },
  { value: "OPEN_SCRATCHPAD", label: "Open Scratchpad" },
] as const;

export const BUILTIN_BUTTONS = [
  ...TERMINAL_FUNCTIONS.map((f) => ({
    id: `builtin-${f.value}`,
    name: f.label,
    type: "terminal_function" as const,
    payload: f.value,
  })),
  ...MISC_FUNCTIONS.map((f) => ({
    id: `builtin-${f.value}`,
    name: f.label,
    type: "misc" as const,
    payload: f.value,
  })),
] as const;

export const DEFAULT_SCROLL_LINES = 3;
