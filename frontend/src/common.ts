import { createTheme } from "@mui/material";
import { z } from "zod";
import type { ButtonData, HostData } from "./api";
import type { Terminal } from "@xterm/xterm";
import { DEFAULT_BUTTON_GROUP } from "./constants";

export type Expect<T extends true> = T;
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

export type ContextMenu = {
  mouseX: number;
  mouseY: number;
  targetTabId: string;
};

export type ServiceWorkerStatus =
  | "unknown"
  | "unregistered"
  | "active"
  | "waiting"
  | "installing"
  | "error"
  | "unsupported";

export type ScratchpadSyncState = "offline" | "syncing" | "synced" | "dirty";

export type NewTabDialogViewMode = "servers" | "tabs" | "buttons";

export type Severity = "success" | "info" | "warning" | "error";

export type ToastData = {
  msg: string;
  severity: Severity;
};

export type Toast = ToastData & {
  id: number;
};

export const recentSchema = z.object({
  host: z.string(),
  last_used: z.number(), // unix timestamp in seconds
});

export type Recent = z.infer<typeof recentSchema>;

// Define button schema in client side ts
export const ButtonDataSchema = z.object({
  id: z.string().optional().default(""),
  name: z.string().min(1, "name cannot be empty"),
  type: z.enum(["send_string", "terminal_function", "misc", "open_terminal", "run_script"]),
  payload: z.string(),
  group: z.string().optional().default(DEFAULT_BUTTON_GROUP),
  autorun: z.number().int().min(0).max(1).optional().default(0),
  order: z.number().int().optional().default(0),
  shortcut: z.string().optional().default(""),
});

// check client defined button schema type match with server side button type
export type _checkButtonDataType = Expect<Equal<z.infer<typeof ButtonDataSchema>, ButtonData>>;

export type HostForm = Omit<HostData, "tags"> & { tags: string };

export type Order = "asc" | "desc";

export interface CommandHistoryEntry {
  commandId: string;
  command?: string;
  exitStatus?: number;
  exitSignal?: string;
  timestamp: number;
}

export interface ShellIntegration {
  cwd?: string;
  user?: string;
  hostname?: string;
  machineId?: string;
  bootId?: string;
  pid?: string;
  shellId?: string;
  commandId?: string;
  command?: string;
  exitStatus?: number;
  exitSignal?: string;
  isExecuting?: boolean;
  recentCommands?: CommandHistoryEntry[];
}

export type CSEventDetailActiveGroupChange = {
  group: string;
};

export type CSEventDetailTerminalNew = {
  terminal: Terminal;
  sessionId: string;
  host: string;
  params: URLSearchParams;
  promises: PromiseLike<unknown>[];
  is_active_terminal: boolean;
};

export type CSEventDetailTerminalChange = {
  activePaneId: string;
};

export type CSEventDetailTerminalResize = {
  terminal: Terminal;
  cols: number;
  rows: number;
  sessionId: string;
  host: string;
  is_active_terminal: boolean;
};

export type CSEventDetailTerminalConnected = {
  terminal: Terminal;
  sessionId: string;
  host: string;
  is_active_terminal: boolean;
};

export type CSEventDetailTerminalDisconnected = {
  terminal: Terminal;
  sessionId: string;
  host: string;
  is_active_terminal: boolean;
  reason: "stolen" | "fatal" | "normal";
};

export type CSEventDetailTerminalData = {
  terminal: Terminal;
  sessionId: string;
  host: string;
  is_active_terminal: boolean;
};

export type CSEventDetailShellIntegration = {
  terminal: Terminal;
  sessionId: string;
  host: string;
  is_active_terminal: boolean;
  shellIntegration: ShellIntegration;
};

export const CS_EVENT_SHELL_INTEGRATION = "cs:shell-integration";
export const CS_EVENT_TERMINAL_NEW = "cs:terminal-new";
export const CS_EVENT_TERMINAL_CHANGE = "cs:terminal-change";
export const CS_EVENT_TERMINAL_RESIZE = "cs:terminal-resize";
export const CS_EVENT_TERMINAL_CONNECTED = "cs:terminal-connected";
export const CS_EVENT_TERMINAL_DISCONNECTED = "cs:terminal-disconnected";
export const CS_EVENT_TERMINAL_DATA = "cs:terminal-data";
export const CS_EVENT_ACTIVE_GROUP_CHANGE = "cs:active-group-change";

export const remoteCommandOptions = [
  "tmux attach || tmux new", // Linux / pwsh, tmux or psmux ( https://github.com/psmux/psmux  )
  "tmux attach -or (tmux new)", // Windows PowerShell 5.1+
] as const;

export const defaultTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: { main: "#1976d2" },
    background: { default: "#ffffff", paper: "#f4f6f8" },
  },
});

export const loginTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: { main: "#1976d2" },
    background: { default: "#f4f6f8", paper: "#ffffff" },
  },
});

/**
 * Return effective value for a variable:
 * 1. Lookup in localVars (with "local_" prefix)
 * 2. Lookup in vars
 * 3. Return defaultValue
 * @param vars variable map
 * @param localVars local variable map
 * @param name variable name
 * @param defaultValue fallback value, default is ""
 */
export function getVar(
  vars: Record<string, string | undefined>,
  localVars: Record<string, string | undefined>,
  name: string,
  defaultValue = ""
): string {
  if (localVars["local_" + name]) {
    return localVars["local_" + name]!;
  }
  if (vars[name]) {
    return vars[name]!;
  }
  return defaultValue;
}

/**
 * Return integer variable value:
 * 1. Lookup in localVars (with "local_" prefix)
 * 2. Lookup in vars
 * @param vars variable map
 * @param localVars local variable map
 * @param name variable name
 * @param defaultValue fallback value, default is 0. Used if variable not found, or not a valid integer.
 */
export function getIntVar(
  vars: Record<string, string | undefined>,
  localVars: Record<string, string | undefined>,
  name: string,
  defaultValue = 0
): number {
  const value = getVar(vars, localVars, name);
  if (value === "") {
    return defaultValue;
  }
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a key combination string from a KeyboardEvent
 * @param ev KeyboardEvent
 * @returns key combination string, e.g. "ctrl+alt+shift+meta+a",
 * modifiers are in order, all lowercase.
 */
export function getKeyCombination(ev: KeyboardEvent): string {
  let mods = "";
  if (ev.ctrlKey) mods += "ctrl+";
  if (ev.altKey) mods += "alt+";
  if (ev.shiftKey) mods += "shift+";
  if (ev.metaKey) mods += "meta+";
  mods += ev.key.toLowerCase();
  return mods;
}

/**
 * Generate a cryptographically strong password of format /[a-zA-Z0-9]{length}/
 * @param digitOnly bool. If true, output will be comprised of digit chars ([0-9]) only.
 */
export function generatePassword(length: number, digitOnly?: boolean) {
  if (length <= 0) {
    return "";
  }

  const PWD_CHARS = digitOnly ? "0123456789" : "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const PWD_CHARS_LEN = PWD_CHARS.length;

  // To avoid modulo bias, we only use random numbers that are less than
  // the largest multiple of PWD_CHARS_LEN that fits in the range of a Uint16 value [0, 65535].
  // (0xFFFF + 1) is the total number of possible Uint16 values (65536).
  const MAX_VALID_THRESHOLD = Math.floor((0xffff + 1) / PWD_CHARS_LEN) * PWD_CHARS_LEN;

  let password = "";
  // Buffer for random values to reduce calls to crypto.getRandomValues.
  // A size of length * 2 is a heuristic, generally sufficient for typical password lengths.
  const randomValuesBuffer = new Uint16Array(length * 2);
  let bufferIndex = randomValuesBuffer.length; // Start as if the buffer is exhausted

  while (password.length < length) {
    if (bufferIndex >= randomValuesBuffer.length) {
      crypto.getRandomValues(randomValuesBuffer);
      bufferIndex = 0;
    }

    const randomValue = randomValuesBuffer[bufferIndex++];
    if (randomValue < MAX_VALID_THRESHOLD) {
      password += PWD_CHARS[randomValue % PWD_CHARS_LEN];
    }
  }
  return password;
}

/**
 * Filter hosts by tags and search text.
 * @param hosts - Array of hosts to filter
 * @param filterStr - Filter. Put "#tag" syntax(es) at the beginning to filter by tags. E.g. "#foo #bar git server".
 * @returns Filtered array of hosts.
 */
export function filterHosts(hosts: HostData[], filterStr: string): HostData[] {
  filterStr = filterStr.trim().toLowerCase();
  if (!filterStr) {
    return hosts;
  }

  const tokens = filterStr.split(/\s+/);
  const requiredTags: string[] = [];
  let textStartIndex = 0;

  // Extract tags from the beginning
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("#") && token.length > 1) {
      // Remove the '#' and add to required tags
      requiredTags.push(token.substring(1));
      textStartIndex = i + 1;
    } else {
      // Stop extracting tags as soon as a non-tag word appears
      break;
    }
  }

  // The rest of the string is the search text (case-insensitive)
  const searchText = tokens.slice(textStartIndex).join(" ");

  return hosts.filter((host) => {
    // 1. Tag Filtering
    // If the filter contains tags, the host MUST have all of them
    if (requiredTags.length > 0) {
      if (!host.tags || host.tags.length === 0) {
        return false;
      }

      const hasAllTags = requiredTags.every((tag) => host.tags!.includes(tag));
      if (!hasAllTags) {
        return false;
      }
    }

    // 2. Text Filtering
    // If there is remaining text, it must match name, hostname, or comment
    if (searchText) {
      const matchName = host.name.toLowerCase().includes(searchText);
      const matchHostname = host.hostname.toLowerCase().includes(searchText);
      const matchComment = !!(host.comment && host.comment.toLowerCase().includes(searchText));

      if (!matchName && !matchHostname && !matchComment) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Search needle in input and returns a snippet with the needle highlighted and centered.
 * For example, if it searchs "Liberty" in "Declaration of Independence",
 * it returns "that among these are Life, Liberty and the pursuit of Happiness."
 * @param input - Input string
 * @param needle - Needle to search for
 * @returns Snippet with the needle highlighted and centered
 */
export function searchString(input: string, needle: string): string {
  if (!input || !needle) {
    return "";
  }

  const lowerInput = input.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const matchIndex = lowerInput.indexOf(lowerNeedle);

  // Return empty string if no match is found
  if (matchIndex === -1) {
    return "";
  }

  // Define the number of characters of context to grab around the match
  const contextLength = 40;

  // Calculate initial start and end bounds
  let start = Math.max(0, matchIndex - contextLength);
  let end = Math.min(input.length, matchIndex + needle.length + contextLength);

  // If we aren't at the beginning of the string, snap to the nearest subsequent whitespace
  // to avoid returning a partially truncated word at the start of the snippet.
  if (start > 0) {
    const nextSpace = input.substring(start, matchIndex).indexOf(" ");
    if (nextSpace !== -1) {
      start = start + nextSpace + 1;
    }
  }

  // If we aren't at the end of the string, snap to the nearest preceding whitespace
  // to avoid returning a partially truncated word at the end of the snippet.
  if (end < input.length) {
    const trailingContext = input.substring(matchIndex + needle.length, end);
    const lastSpace = trailingContext.lastIndexOf(" ");
    if (lastSpace !== -1) {
      end = matchIndex + needle.length + lastSpace;
    }
  }

  // Extract the snippet
  const snippet = input.substring(start, end);

  // Replace multi-line breaks, tabs, or consecutive spaces with a single space
  return snippet.replace(/\s+/g, " ").trim();
}

export function base64urlEncode(input: string): string {
  const base64 = btoa(input);
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return base64url;
}

/**
 * 1024 => "1.0 KB"
 */
export function formatSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
