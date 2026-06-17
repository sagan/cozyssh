import { createTheme, type ThemeOptions } from "@mui/material";
import { z } from "zod";
import type { ButtonData, HostData, LocalShell } from "./api";
import type { ITerminalOptions, Terminal } from "@xterm/xterm";
import { DEFAULT_BUTTON_GROUP, DEFAULT_FONT_SIZE, LOCAL_NAME } from "./constants";
import { Liquid } from "liquidjs";
import { getStore } from "./store";
import { join } from "shlex";

export type Expect<T extends true> = T;
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

export type OpenHostFunction = (
  host: string,
  options?: {
    title?: string;
    target?: string;
    options?: Record<string, string>;
    noUpdateRecent?: boolean;
  },
) => Promise<void>;

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

export type ViewMode = "servers" | "tabs" | "buttons";

export type Severity = "success" | "info" | "warning" | "error";

export type ToastData = {
  msg: string;
  severity: Severity;
};

export type Toast = ToastData & {
  id: number | string;
  key?: string;
};

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
  liquidjs: z.number().int().min(0).max(2).optional(),
  mtime: z.number().int().optional(),
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

/**
 * OSC 133 prompt lifecycle phase:
 * - 'prompt'   — OSC 133;A  (prompt drawing started)
 * - 'input'    — OSC 133;B  (user hit Enter; command text beginning)
 * - 'output'   — OSC 133;C  (command output starting)
 * - 'finished' — OSC 133;D  (command finished, exit code available)
 */
export type PromptPhase = "prompt" | "input" | "output" | "finished";

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
  /** Current OSC 133 prompt lifecycle phase */
  promptPhase?: PromptPhase;
  /** Window title set by OSC 2 (or OSC 0) */
  windowTitle?: string;
  /** Icon/minimized-window title set by OSC 1 (or OSC 0) */
  iconTitle?: string;
  /**
   * Live command line currently being typed at the shell prompt.
   * Updated on every server echo (onWriteParsed) while promptPhase is
   * 'prompt' or 'input'.  Cleared to undefined when the command starts
   * running (133;C) or finishes (133;D).
   *
   * Requires the shell to emit at minimum OSC 133;A (prompt start).
   * When OSC 133;B (prompt end) is also emitted, the value is exact;
   * otherwise a heuristic prompt-strip is used as fallback.
   */
  currentCmdLine?: string;
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

export type CSEventDetailVars = {
  vars: Record<string, string>;
  localVars: Record<string, string>;
};

export const CS_EVENT_TERMINAL_NEW = "cs:terminal-new";
export const CS_EVENT_TERMINAL_CONNECTED = "cs:terminal-connected";
export const CS_EVENT_TERMINAL_DISCONNECTED = "cs:terminal-disconnected";
export const CS_EVENT_TERMINAL_DATA = "cs:terminal-data";
export const CS_EVENT_TERMINAL_RESIZE = "cs:terminal-resize";
export const CS_EVENT_TERMINAL_CHANGE = "cs:terminal-change";
export const CS_EVENT_SHELL_INTEGRATION = "cs:shell-integration";
/**
 * Event when variables change
 */
export const CS_EVENT_VARS = "cs:vars";

export const remoteCommandOptions = [
  "tmux attach || tmux new",
  "tmux attach -or (tmux new)",
  "tmux attach -t cozy_%i || tmux new -s cozy_%i", // Linux / pwsh, tmux or psmux ( https://github.com/psmux/psmux  )
  "tmux attach -t cozy_%i -or (tmux new -s cozy_%i)", // Windows PowerShell 5.1+
] as const;

const getMuiDialogContainer: () => Element = () => {
  // 1. Check if the browser is currently in fullscreen mode
  const isFullscreen = !!document.fullscreenElement;

  // 2. If fullscreen, portal to #main-content so it sits in the Top Layer.
  // Otherwise, fall back to document.body (completely avoiding the MUI bug).
  return isFullscreen ? document.getElementById("main-content")! : document.body;
};

export function defaultThemeOptions({ fontSize = DEFAULT_FONT_SIZE }: { fontSize?: number }): ThemeOptions {
  return {
    typography: {
      fontSize,
    },
    components: {
      MuiMenu: {
        defaultProps: {
          // @todo: not working for dynamic menus
          container: getMuiDialogContainer,
        },
      },
      MuiDialog: {
        defaultProps: {
          container: getMuiDialogContainer,
        },
      },
    },
    cssVariables: true,
    palette: {
      mode: "light",
      primary: { main: "#1976d2" },
      background: { default: "#ffffff", paper: "#f4f6f8" },
    },
  };
}

export const loginTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: { main: "#1976d2" },
    background: { default: "#f4f6f8", paper: "#ffffff" },
  },
});

/**
 * These shortcuts should be handled by the terminal / shell itself.
 */
export const terminalKeyShortcuts = new Set([
  // basic keys
  "tab",
  "ctrl+i", // same as tab
  "shift+tab",
  "backspace",
  "delete",
  "insert",
  "enter",
  "escape",
  "ctrl+[", // same as escape
  "ctrl+]", // telnet quit
  "home",
  "end",
  "pageup",
  "pagedown",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "alt+arrowup",
  "alt+arrowdown",
  "alt+arrowleft",
  "alt+arrowright",
  "ctrl+arrowup",
  "ctrl+arrowdown",
  "ctrl+arrowleft",
  "ctrl+arrowright",
  "shift+arrowup",
  "shift+arrowdown",
  "shift+arrowleft",
  "shift+arrowright",
  "shift+home",
  "shift+end",
  "shift+pageup",
  "shift+pagedown",
  // "shift+insert", // paste. handled by xterm.js

  // TTY / Kernel Signals
  "ctrl+c", // SIGINT (Kill process)
  "ctrl+d", // EOF (End of input / Exit)
  "ctrl+q", // XON (Resume screen output)
  "ctrl+s", // XOFF (Freeze screen output)
  "ctrl+z", // SIGTSTP (Suspend process)
  "ctrl+\\", // SIGQUIT (Quit and core dump)

  // Shell / Readline Shortcuts (Emacs Mode) - Navigation
  "ctrl+a", // Move cursor to beginning of line
  "ctrl+e", // Move cursor to end of line
  "ctrl+b", // Move backward one character
  "ctrl+f", // Move forward one character
  "alt+b", // Move backward one word
  "alt+f", // Move forward one word
  "ctrl+x", // Prefix for chorded commands (e.g., ctrl+x, ctrl+x)

  // Shell / Readline Shortcuts (Emacs Mode) - Editing
  "ctrl+u", // Cut from cursor to beginning of line
  "ctrl+k", // Cut from cursor to end of line
  "ctrl+w", // Cut word before cursor
  "alt+d", // Cut word after cursor
  "ctrl+y", // Paste (yank) previously cut text
  "ctrl+t", // Swap last two characters
  "alt+t", // Swap current word with previous word
  "ctrl+h", // Backspace
  "ctrl+l", // Clear screen and redraw current line
  "ctrl+v", // Quoted Insert
  "ctrl+o", // Execute and display next line
  "ctrl+_", // Undo last change
  "alt+u", // Upper case from cursor to end of word. Note we don't add alt+ l / c since CozySSH itself uses them
  "alt+r", // Readline revert-line

  // Shell / Readline Shortcuts (Emacs Mode) - History & Search
  "ctrl+r", // Reverse history search
  "ctrl+g", // Cancel reverse search / current action
  "ctrl+p", // Fetch previous command (Up)
  "ctrl+n", // Fetch next command (Down)
  "alt+.", // Insert last argument of previous command
]);

/**
 * Keys that doesn't produce any character.
 */
export const nonCharKeys = new Set([
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
  "home",
  "end",
  "backspace",
  "insert",
  "delete",
  "pageup",
  "pagedown",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

export const DefaultXtermOptions: ITerminalOptions = {
  scrollback: 10000,
  allowProposedApi: true,
  cursorBlink: true,
  theme: {
    background: "#ffffff",
    foreground: "#000000",
    cursor: "#000000",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0, 0, 0, 0.2)",
  },
  fontFamily: 'Consolas, "Courier New", monospace',
};

/**
 * Return effective value for a variable:
 * 1. Lookup in localVars (with "local_" prefix)
 * 2. Lookup in vars
 * 3. Return defaultValue
 * @param name variable name
 * @param defaultValue fallback value, default is ""
 */
export function getVar(name: string, defaultValue = ""): string {
  const { vars, localVars } = getStore();
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
 * @param name variable name
 * @param defaultValue fallback value, default is 0. Used if variable not found, or not a valid integer.
 */
export function getIntVar(name: string, defaultValue = 0): number {
  const value = getVar(name);
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
  const searchTokens = tokens.slice(textStartIndex);

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

    if (searchTokens.length > 0) {
      return searchTokens.every((searchText) => matchHost(host, searchText));
    }

    return true;
  });
}

function matchHost(host: HostData, searchText: string): boolean {
  return (
    host.name.toLowerCase().includes(searchText) ||
    host.hostname.toLowerCase().includes(searchText) ||
    !!(host.comment && host.comment.toLowerCase().includes(searchText))
  );
}

export function searchStringAny(input: string, searchText: string): string {
  const matched = searchString(input, searchText);
  if (matched) {
    return matched;
  } else {
    const [searchTextFirstSegment] = cutString(searchText, " ");
    return searchString(input, searchTextFirstSegment);
  }
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

/**
 * If name is "Foo", return "Foo (1)";
 * If name is already "Foo (1)" style, return "Foo (2)".
 */
export function nextName(name: string): string {
  const match = name.match(/^(.*) \((\d+)\)$/);
  if (match) {
    const base = match[1];
    const num = parseInt(match[2], 10);
    return `${base} (${num + 1})`;
  }
  return `${name} (1)`;
}

export function hostTitle(name: string): string {
  const i = name.lastIndexOf("@");
  if (i !== -1) {
    name = name.slice(i + 1);
  }
  return name || "server";
}

/**
 * "user:pass@host" => "user@host"
 */
export function removePassFromHost(host: string): string {
  const i = host.lastIndexOf("@");
  if (i === -1) {
    return host;
  }
  const userpass = host.slice(0, i);
  const j = userpass.indexOf(":");
  if (j === -1) {
    return host;
  }
  return userpass.slice(0, j) + host.slice(i);
}

export function genTabId(name: string): string {
  return `t-${hostTitle(name)}-${generatePassword(12)}`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function genPaneId(_name: string): string {
  return `p-${generatePassword(12)}`;
}

const terminalFontSizes: number[] = [
  4, // %25
  5, // 33%
  7.5, // 50%
  10, // 67%
  11, // 75%
  12, // 80%
  13.5, // 90%
  15, // 100%
  16.5, // 110%
  19, // 125%
  23, // 150%
  26, // 175%
  30, // 200%
  38, // 250%
  45, // 300%
  60, // 400%
  75, // 500%
];

export function prevTerminalFontSize(fontSize: number): number {
  const idx = terminalFontSizes.findIndex((s) => s >= fontSize);
  if (idx === -1) {
    return terminalFontSizes[0];
  }
  return terminalFontSizes[idx - 1];
}

export function nextTerminalFontSize(fontSize: number): number {
  const idx = terminalFontSizes.findIndex((s) => s >= fontSize);
  if (idx === -1) {
    return terminalFontSizes[terminalFontSizes.length - 1];
  }
  return terminalFontSizes[idx + 1];
}

/**
 * Return true if there is any MUI modal open (except async alert / confirm / prompt dialogs).
 */
export function isMuiModalOpen(): boolean {
  return !!document.querySelector(".MuiModal-root:not(#async-modal-dialog)");
}

/**
 * Parse `[username[:password]@]hostname[:port]` to host data.
 * If a field isn't present, set it to undefined.
 */
export function parseHostName(
  name: string,
  defaultUser?: string,
): Pick<HostData, "hostname"> & Partial<Pick<HostData, "user" | "password" | "port">> {
  let hostname = "";
  let user: string | undefined;
  let password: string | undefined;
  let port: string | undefined;

  const i = name.lastIndexOf("@");
  if (i === -1) {
    hostname = name;
  } else {
    hostname = name.slice(i + 1);
    user = name.slice(0, i);
    const j = user.indexOf(":");
    if (j !== -1) {
      password = user.slice(j + 1);
      user = user.slice(0, j);
      try {
        password = decodeURIComponent(password);
      } catch {
        // ignore
      }
    }
    try {
      user = decodeURIComponent(user);
    } catch {
      // ignore
    }
  }
  const j = hostname.lastIndexOf(":");
  if (j !== -1) {
    port = hostname.slice(j + 1);
    hostname = hostname.slice(0, j);
  }
  return {
    user: user || defaultUser,
    password,
    port,
    hostname,
  };
}

/**
 * Return `user@hostname:port` or `hostname:port`. `port` is always present and defaults to `22`.
 * If defaultUser is provided, it always returns`user@hostname:port`
 */
export function getCanonicalHostString(
  host: Pick<HostData, "hostname"> & Partial<Pick<HostData, "user" | "port">>,
  defaultUser?: string,
): string {
  if (host.user || defaultUser) {
    return `${encodeURIComponent((host.user || defaultUser) as string)}@${host.hostname}:${host.port || "22"}`;
  } else {
    return `${host.hostname}:${host.port || "22"}`;
  }
}

function liquidFs(): never {
  throw new Error("File system not implemented");
}

export const liquidEngine = new Liquid({
  // https://liquidjs.com/tutorials/truthy-and-falsy.html
  jsTruthy: true,
  relativeReference: false,
  // https://github.com/harttle/liquidjs/issues/131
  fs: {
    resolve: liquidFs,
    exists: liquidFs,
    existsSync: liquidFs,
    readFile: liquidFs,
    readFileSync: liquidFs,
  },
});

export function getTemplateVariables(templateStr: string): string[] {
  try {
    const template = liquidEngine.parse(templateStr);
    const allVars = liquidEngine.variablesSync(template);

    // Find variables defined inside the template
    const internalVars = new Set<string>();

    const assignRegex = /{%\s*assign\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const captureRegex = /{%\s*capture\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const forRegex = /{%\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in/g;
    const tablerowRegex = /{%\s*tablerow\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in/g;

    let match;
    while ((match = assignRegex.exec(templateStr)) !== null) {
      internalVars.add(match[1]);
    }
    while ((match = captureRegex.exec(templateStr)) !== null) {
      internalVars.add(match[1]);
    }
    while ((match = forRegex.exec(templateStr)) !== null) {
      internalVars.add(match[1]);
    }
    while ((match = tablerowRegex.exec(templateStr)) !== null) {
      internalVars.add(match[1]);
    }

    const excluded = new Set(["vars", "localVars", "shellIntegration"]);

    return allVars.filter((v) => !excluded.has(v) && !internalVars.has(v));
  } catch (e) {
    console.error("Failed to parse liquid template: ", e);
    return [];
  }
}

export async function forceReload(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }
    if (window.caches) {
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        await caches.delete(cacheName);
      }
    }
  }
  window.location.reload();
}

/**
 * Close MUI modal (Dialog / Menu / Popover).
 * If closeAll is true, close all modals. Otherwise, close only the top-most modal.
 * It works by sending Escape key events to the modals.
 * Note: some dialog modals will ignore this event when there are dirty form fields, it's by design.
 */
export async function closeModal(closeAll?: boolean) {
  const modals = document.querySelectorAll(".MuiModal-root");
  if (modals.length > 0) {
    const targetModals = closeAll ? Array.from(modals).reverse() : [modals[modals.length - 1]];

    for (const modal of targetModals) {
      modal.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      if (closeAll) {
        // Yield control to the event loop so MUI can update its stack
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
}

/**
 * Open host (or all hosts of a tag) in a new window.
 * @param hostOrTag - name of the host to open, it can be a tag (e.g. "#work").
 */
export function openHostInNewWindow(hostOrTag: string) {
  const url = `${window.location.origin}/#${encodeURIComponent(hostOrTag)}`;
  if (window.appOpenNewWindow) {
    window.appOpenNewWindow(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/**
 * Validates if a string is a valid hostname (Domain, IPv4, or IPv6).
 * @param hostname The string to validate.
 * @param allowLocalhost If true, single-label names like 'localhost' are considered valid.
 */
export function isValidHostname(hostname: string, allowLocalhost: boolean = true): boolean {
  if (!hostname || hostname.length > 253) {
    return false;
  }

  // 1. Validate IPv4
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  if (ipv4Regex.test(hostname)) {
    return true;
  }

  // 2. Validate IPv6
  // (Optional: Strip URL style brackets if checking hostnames extracted from URLs, e.g. "[::1]")
  const cleanIPv6 = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  const ipv6Regex =
    /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  if (ipv6Regex.test(cleanIPv6)) {
    return true;
  }

  // 3. Validate Domain / DNS Hostname (RFC 1123)
  const labels = hostname.split(".");

  // Reject if it's a single label (like 'localhost') and allowLocalhost is false
  if (labels.length < 2 && !allowLocalhost) {
    return false;
  }

  // Each label must be 1-63 chars, alphanumeric or hyphen, and cannot start/end with a hyphen
  const labelRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

  // The final TLD extension cannot be purely numeric (e.g., 'example.123' is invalid)
  if (labels.length > 1) {
    const tld = labels[labels.length - 1];
    if (/^\d+$/.test(tld)) {
      return false;
    }
  }

  return labels.every((label) => labelRegex.test(label));
}

/**
 * Similar to Go strings.Cut.
 * @param s
 * @param sep
 * @returns
 */
export function cutString(s: string, sep: string): [before: string, after: string, found: boolean] {
  const i = s.indexOf(sep);
  if (i < 0) {
    return [s, "", false];
  }
  return [s.slice(0, i), s.slice(i + sep.length), true];
}

/**
 * Returns the host string for a local shell
 */
export function localShellHost(shell: LocalShell): string {
  return `${LOCAL_NAME}?title=${encodeURIComponent(shell.name)}&exec=1&remoteCommand=${encodeURIComponent(
    join([shell.path, ...(shell.args ?? [])]),
  )}`;
}
