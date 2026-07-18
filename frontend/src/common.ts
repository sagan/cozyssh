import { createTheme, type ThemeOptions } from "@mui/material";
import { z } from "zod";
import type { ITerminalOptions, Terminal } from "@xterm/xterm";
import { Liquid } from "liquidjs";
import { join } from "shlex";

import type { ButtonData, HostData, LocalShell } from "./api";
import {
  BROWSER_STORAGE_KEY_TOKEN,
  DEFAULT_BUTTON_GROUP,
  DEFAULT_FONT_SIZE,
  HEADER_AUTHORIZATION,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  HEADER_CONTENT_TYPE,
  LOCAL_NAME,
  MIME_JSON,
  TAG_GROUP_PREFIX,
  TAG_ORDER_PREFIX,
  WS_PROTOCOL_DUMMY,
  WS_PROTOCOL_IDENTITY_PREFIX,
  WS_PROTOCOL_QUERY_PREFIX,
  terminalClientSideParams,
} from "./constants";
import type React from "react";

export type Expect<T extends true> = T;
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

export type ContextMenu = {
  mouseX: number;
  mouseY: number;
  targetTabId: string;
};

export type ServiceWorkerStatus =
  "unknown" | "unregistered" | "active" | "waiting" | "installing" | "error" | "unsupported";

export type ScratchpadSyncState = "offline" | "syncing" | "synced" | "dirty";

export type ViewMode = "servers" | "tabs" | "buttons" | "help" | "tags" | "tunnels";

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
  shortcut_scope: z.number().int().optional(),
  meta: z.record(z.string(), z.string()).optional(),
});

// check client defined button schema type match with server side button type
export type _checkButtonDataType = Expect<Equal<z.infer<typeof ButtonDataSchema>, ButtonData>>;

export type HostForm = Omit<HostData, "tags"> & { tags: string };

export type ButtonForm = Omit<ButtonData, "id" | "mtime"> & Partial<Pick<ButtonData, "id" | "mtime">>;

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
  terminal?: Terminal;
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
  data: string | Uint8Array;
  filters: ((data: string | Uint8Array) => string | Uint8Array)[];
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

// Use userAgentData if available, fallback to userAgent string
export const IS_APPLE =
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  !!navigator.userAgentData?.platform?.toLowerCase().includes("mac") ||
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || "");

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
 * Basic system shortcuts that should be passed to browsers even if terminal has focus
 */
export const systemShortcuts = new Set<string>([
  "ctrl+tab", // switch to next tab
  "ctrl+shift+tab", // switch to previous tab
  // "ctrl+shift+t", // restore last opened tab

  // Conflicted with shell emacs mode
  // "ctrl+w", // close tab
  // "ctrl+t", // new tab

  "f5", // refresh
  "ctrl+f5", // force refresh
  "f11", // fullscreen
  "f12", // DevTools
  "alt+f4", // close window

  // we swap meta (command) and alt (option) in Mac
  IS_APPLE ? "alt+0" : "ctrl+0", // reset zoom level
  IS_APPLE ? "alt+-" : "ctrl+-", // zoom out
  IS_APPLE ? "alt+=" : "ctrl+=", // zoom in
]);

/**
 * CozySSH internal global shortcuts
 */
export const appShortcuts = new Set([
  "alt+`",
  "alt+shift+~",
  "alt+enter",
  "ctrl+alt+shift+r",
  "ctrl+alt+0",
  "ctrl+alt+1",
  "ctrl+alt+2",
  "ctrl+alt+3",
  "ctrl+alt+`",
  "ctrl+alt+g",
  "alt+-",
  "alt+shift+_",
  "alt+=",
  "alt+shift++",
  "alt+c",
  "alt+shift+c",
  "alt+o",
  "alt+p",
  "alt+;",
  "alt+/",
  "alt+a",
  "alt+e",
  "ctrl+shift+p",
  "alt+n",
  "ctrl+alt+n",
  "alt+shift+n",
  "ctrl+alt+shift+n",
  "alt+s",
  "alt+i",
  "alt+shift+i",
  "alt+h",
  "alt+shift+h",
  "alt+l",
  "alt+shift+l",
  "alt+q",
  "alt+w",
  "ctrl+alt+shift+w",
  "ctrl+alt+shift+l",
  "alt+shift+w",
  "alt+g",
  "alt+shift+g",
  "alt+v",
  "ctrl+alt+v",
  "alt+shift+v",
  "ctrl+alt+shift+v",
  "alt+j",
  "alt+shift+j",
  "alt+k",
  "alt+shift+k",
  "ctrl+alt+k",
  "ctrl+alt+j",
  "ctrl+shift+f",
  "ctrl+shift+r",
  "ctrl+shift+c",

  // Dynamic Tab Navigation (Alt + 0-9)
  "alt+0",
  "alt+1",
  "alt+2",
  "alt+3",
  "alt+4",
  "alt+5",
  "alt+6",
  "alt+7",
  "alt+8",
  "alt+9",

  // Dynamic Button Group Triggers (Alt + Shift + 0-9)
  "alt+shift+)",
  "alt+shift+!",
  "alt+shift+@",
  "alt+shift+#",
  "alt+shift+$",
  "alt+shift+%",
  "alt+shift+^",
  "alt+shift+&",
  "alt+shift+*",
  "alt+shift+(",
]);

/**
 * These keystrokes are silently "consumed" by CozySSH.
 */
export const blackholeShortcuts = new Set<string>(["ctrl+alt", "ctrl+alt+shift", "ctrl+shift", "alt", "alt+shift"]);

export const disableShortcuts = new Set<string>();

/**
 * Additional shortcuts that should be handled by the terminal if it has focus
 */
export const passthroughKeyShortcuts = new Set<string>();

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

const codeKeys: Record<string, [string, string]> = {
  Backquote: ["`", "~"],
  Quote: ["'", '"'],
  Comma: [",", "<"],
  Minus: ["-", "_"],
  Period: [".", ">"],
  Slash: ["/", "?"],
  Backslash: ["\\", "|"],
  Digit1: ["1", "!"],
  Digit2: ["2", "@"],
  Digit3: ["3", "#"],
  Digit4: ["4", "$"],
  Digit5: ["5", "%"],
  Digit6: ["6", "^"],
  Digit7: ["7", "&"],
  Digit8: ["8", "*"],
  Digit9: ["9", "("],
  Digit0: ["0", ")"],
};

let macModifierKeyRegex: RegExp | undefined;

/**
 * Modifier mapping for Mac. Editable by custom scripts.
 * Note only `ctrl`, `alt` (option) and `meta` (command) mapping are supported, `shift` is not supported.
 * Format: `<recognized modifier> => <Mac physical key>`.
 * The entries MUST exist in pairs like foo => bar + bar => foo.
 * The behavior is undefined if only foo => bar record but not the reverse one exists in map.
 * The CozySSH shortcut system use PC as standard (e.g. `alt+o`).
 * Since in PC keyboard layout from spacebar to left is `alt`, `meta` (windows), `ctrl`, `fn`
 * and in Mac keyboard layout from spacebar to left is `meta` (command), `alt` (option), `ctrl`, `fn`,
 * we simply swap `meta` and `alt` keys in Mac by default.
 */
export const macModifierSwap: Map<Modifier, Modifier> = createMapProxy(
  [
    ["meta", "alt"],
    ["alt", "meta"],
  ],
  updateMacModifierKeyRegex,
);
updateMacModifierKeyRegex();

function updateMacModifierKeyRegex() {
  if (macModifierSwap.size > 0) {
    macModifierKeyRegex = new RegExp(Array.from(macModifierSwap.keys()).join("|"), "g");
  } else {
    macModifierKeyRegex = undefined;
  }
}

/**
 * Get a key combination string from a KeyboardEvent
 * modifiers are in order, all lowercase.
 * Note for special keys, if shift is hold, the different character will be returned.
 * So if user press "Alt + Shift + 1" it will return "alt+shift+!" since the shift version of "1" is "!".
 * It's a known limitation and may be changed in the future.
 * @param ev KeyboardEvent
 * @returns key combination string, e.g. "ctrl+alt+shift+meta+a".
 */
export function getKeyCombination(ev: KeyboardEvent | React.KeyboardEvent): string {
  let mods = "";
  const suppressKeys = new Set<string>();
  if (isModifier(ev, "ctrl")) {
    suppressKeys.add("control");
    mods += "+ctrl";
  }
  if (isModifier(ev, "alt")) {
    suppressKeys.add("alt");
    mods += "+alt";
  }
  if (ev.shiftKey) {
    suppressKeys.add("shift");
    mods += "+shift";
  }
  if (isModifier(ev, "meta")) {
    suppressKeys.add("meta");
    mods += "+meta";
  }
  let key = ev.key.toLowerCase();
  if (IS_APPLE && macModifierSwap.has(key as Modifier)) {
    key = macModifierSwap.get(key as Modifier)!;
  }
  // In some keyboard layout (like Windows English International layout) some keystrokes perse will produce "Dead" key,
  // e.g. ' since 'e is used to input é. We need to get the actual key.
  if (key === "dead" && codeKeys[ev.code]) {
    key = codeKeys[ev.code][ev.shiftKey ? 1 : 0];
  }
  if (!suppressKeys.has(key)) {
    mods += "+" + key;
  }
  return mods.slice(1);
}

/**
 * Check if the KeyboardEvent has the given modifier (ctrl / alt / meta / shift) in Mac aware way.
 * @param ev KeyboardEvent, React.KeyboardEvent, MouseEvent, or React.MouseEvent
 * @param modifier "ctrl", "meta", "alt", or "shift"
 * @returns true if the event has the given modifier, false otherwise
 */
export function isModifier(
  ev: KeyboardEvent | React.KeyboardEvent | MouseEvent | React.MouseEvent,
  modifier: Modifier,
): boolean {
  if (IS_APPLE && macModifierSwap.has(modifier)) {
    modifier = macModifierSwap.get(modifier)!;
  }
  switch (modifier) {
    case "ctrl":
      return ev.ctrlKey;
    case "shift":
      return ev.shiftKey;
    case "meta":
      return ev.metaKey;
    case "alt":
      return ev.altKey;
    default:
      return assertUnreachable(modifier);
  }
}

export function shortcutLabel(shortcut: string): string {
  if (IS_APPLE && macModifierKeyRegex) {
    return shortcut.replace(macModifierKeyRegex, (match) => {
      match = macModifierSwap.get(match as Modifier) || match;
      switch (match) {
        case "alt":
          return "option";
        case "meta":
          return "command";
        default:
          return match;
      }
    });
  }
  return shortcut;
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

      const hasAllTags = requiredTags.every((tag) => host.tags!.some((t) => t.toLowerCase() === tag));
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

export function filterButtons<T extends Pick<ButtonData, "name" | "type" | "payload">>(
  buttons: readonly T[],
  filterStr: string,
): readonly T[] {
  filterStr = filterStr.trim().toLowerCase();
  if (!filterStr) {
    return buttons;
  }
  const tokens = filterStr.split(/\s+/);
  return buttons.filter((host) => {
    return tokens.every((searchText) => matchButton(host, searchText));
  });
}

function matchButton(btn: Pick<ButtonData, "name" | "type" | "payload">, searchText: string): boolean {
  return (
    btn.name.toLowerCase().includes(searchText) ||
    (!(["run_script", "send_string"] as ButtonData["type"][]).includes(btn.type) &&
      btn.payload.toLowerCase().includes(searchText))
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

export function hostTitle(host: string): string {
  const i = host.lastIndexOf("@");
  if (i !== -1) {
    host = host.slice(i + 1);
  }
  host = cutSuffix(host, ":22")[0];
  return host;
}

/**
 * If name is "Foo (1)", "Foo (2)"..., return "Foo".
 */
export function removeNameNumSuffix(name: string): string {
  const match = name.match(/^(.*) \((\d+)\)$/);
  if (match) {
    return match[1];
  }
  return name;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function genTabId(_name: string): string {
  return `t-${generatePassword(12)}`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function genPaneId(_name: string): string {
  return `p-${generatePassword(12)}`;
}

const terminalFontSizes: number[] = [
  4, // %25
  5, // 33%
  8, // 50%, 7.5
  10, // 67%
  11, // 75%
  12, // 80%
  14, // 90%, 13.5
  15, // 100%
  17, // 110%, 16.5
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
  return terminalFontSizes[Math.max(0, idx - 1)];
}

export function nextTerminalFontSize(fontSize: number): number {
  const idx = terminalFontSizes.findIndex((s) => s >= fontSize);
  if (idx === -1) {
    return terminalFontSizes[terminalFontSizes.length - 1];
  }
  return terminalFontSizes[Math.min(terminalFontSizes.length - 1, idx + 1)];
}

/**
 * Return true if there is any MUI modal open.
 * @param countDialog If true, count async alert / confirm / prompt dialogs as MUI modal.
 */
export function isMuiModalOpen(countDialog = false): boolean {
  return !!document.querySelector(countDialog ? ".MuiModal-root" : ".MuiModal-root:not(#async-modal-dialog)");
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

  // 1. Separate user/password from the host info
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
        /* ignore */
      }
    }
    try {
      user = decodeURIComponent(user);
    } catch {
      /* ignore */
    }
  }

  // 2. Robust Hostname & Port Parsing (IPv4, IPv6, and Domain Names)
  if (hostname.startsWith("[")) {
    // Handle bracketed IPv6 addresses, e.g., "[2001:db8::1]:22" or "[2001:db8::1]"
    const closingBracket = hostname.indexOf("]");
    if (closingBracket !== -1) {
      const remainder = hostname.slice(closingBracket + 1);
      if (remainder.startsWith(":")) {
        port = remainder.slice(1);
      }
      // Extract the raw IPv6 address from inside the brackets
      hostname = hostname.slice(1, closingBracket);
    }
  } else {
    // Handle IPv4, Named Hosts, or Unbracketed IPv6
    const colonCount = (hostname.match(/:/g) || []).length;

    if (colonCount === 1) {
      // Exactly one colon means it's definitely a host:port setup (e.g., "127.0.0.1:80" or "example.com:443")
      const j = hostname.lastIndexOf(":");
      port = hostname.slice(j + 1);
      hostname = hostname.slice(0, j);
    } else if (colonCount > 1) {
      // Multiple colons without brackets mean it's a raw IPv6 address without a port (e.g., "2001:db8::1")
      // Leave hostname as-is; port remains undefined
    }
  }

  return {
    user: user || defaultUser,
    password,
    port,
    hostname,
  };
}

/**
 * Return `hostname`, `user@hostname`, `user@hostname:port` or `hostname:port`, depends on host and arguments:
 * - If defaultUser or host.user is not empty, the result contains user part.
 * - If alwaysHasPort is true or host.port is not "22", the result contains port part.
 */
export function getCanonicalHostString(
  host: Pick<HostData, "hostname"> & Partial<Pick<HostData, "user" | "port">>,
  defaultUser?: string,
  alwaysHasPort?: boolean,
): string {
  let s = "";
  if (host.user || defaultUser) {
    s += `${encodeURIComponent((host.user || defaultUser)!)}@`;
  }
  s += host.hostname;
  if (alwaysHasPort || host.port !== "22") {
    s += `:${host.port || "22"}`;
  }
  return s;
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

    const excluded = new Set(["vars", "localVars", "shellIntegration", "host", "clipboard"]);

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
 * @returns true if at least 1 modal was closed, false otherwise.
 */
export async function closeModal(closeAll?: boolean): Promise<boolean> {
  const modals = document.querySelectorAll(".MuiModal-root");
  if (modals.length === 0) {
    return false;
  }
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
  return true;
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
 * Similar to Go strings.CutPrefix
 */
export function cutPrefix(s: string, prefix: string): [after: string, found: boolean] {
  if (s.startsWith(prefix)) {
    return [s.slice(prefix.length), true];
  }
  return [s, false];
}

export function cutSuffix(s: string, suffix: string): [before: string, found: boolean] {
  if (s.endsWith(suffix)) {
    return [s.slice(0, s.length - suffix.length), true];
  }
  return [s, false];
}

/**
 * Returns the host string for a local shell
 */
export function localShellHost(shell: LocalShell): string {
  return `${LOCAL_NAME}?title=${encodeURIComponent(shell.name)}&exec=1&remoteCommand=${encodeURIComponent(
    join([shell.path, ...(shell.args ?? [])]),
  )}`;
}

export function applyFilters<T>(filters: ((t: T) => T)[], data: T): T {
  for (const filter of filters) {
    data = filter(data);
  }
  return data;
}

export const getHostOrder = (host: HostData): number => {
  if (!host.tags) {
    return Infinity;
  }
  // All frontend state are immutable, so we can safely write derived properties to host
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((host as any)._order !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (host as any)._order;
  }
  for (const tag of host.tags) {
    if (tag.startsWith(TAG_ORDER_PREFIX)) {
      const order = parseInt(tag.substring(2));
      if (!isNaN(order)) {
        Object.defineProperty(host, "_order", { value: order, writable: false, enumerable: false });
        return order;
      }
    }
  }
  Object.defineProperty(host, "_order", { value: Infinity, writable: false, enumerable: false });
  return Infinity;
};

export const getHostGroupPath = (host: HostData): string | null => {
  if (!host.tags) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((host as any)._groupPath !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (host as any)._groupPath;
  }
  for (const tag of host.tags) {
    if (tag.startsWith(TAG_GROUP_PREFIX)) {
      const groupPath = tag.slice(TAG_GROUP_PREFIX.length);
      Object.defineProperty(host, "_groupPath", { value: groupPath, writable: false, enumerable: false });
      return groupPath;
    }
  }
  Object.defineProperty(host, "_groupPath", { value: null, writable: false, enumerable: false });
  return null;
};

export function hostSorterGroup(a: HostData, b: HostData): number {
  const groupA = getHostGroupPath(a);
  const groupB = getHostGroupPath(b);
  if (groupA !== groupB) {
    return (groupA ?? "").localeCompare(groupB ?? "");
  }
  const orderA = getHostOrder(a);
  const orderB = getHostOrder(b);
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  return a.name.localeCompare(b.name);
}

export function hostSorter(a: HostData, b: HostData): number {
  const orderA = getHostOrder(a);
  const orderB = getHostOrder(b);
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  return a.name.localeCompare(b.name);
}

export function getSSHCommand(host: HostData | HostForm, hosts?: HostData[]): string {
  let command = `ssh`;
  if (host.identityFile) {
    command += ` -i "${host.identityFile}"`;
  }
  if (host.proxyJump) {
    const jumpServers = host.proxyJump.split(",").map((name) => {
      name = name.trim();
      const server = hosts ? hosts.find((h) => h.name === name) : undefined;
      if (!server) {
        return name;
      }
      if (server.port !== "22") {
        return `${server.user}@${server.hostname}:${server.port}`;
      }
      return `${server.user}@${server.hostname}`;
    });
    command += ` -J ${jumpServers.join(",")}`;
  }
  if (host.remoteCommand) {
    if (/\b(?:sudo|vim|vi|nano|top|htop|btop|tmux|screen)\b/.test(host.remoteCommand)) {
      command += ` -t`;
    }
    command += ` -o "RemoteCommand=${host.remoteCommand}"`;
  }
  if (host.addressFamily) {
    command += ` -o "AddressFamily=${host.addressFamily}"`;
  }
  if (host.userKnownHostsFile) {
    command += ` -o "UserKnownHostsFile=${host.userKnownHostsFile}"`;
  }
  if (host.strictHostKeyChecking) {
    command += ` -o "StrictHostKeyChecking=${host.strictHostKeyChecking}"`;
  }
  if (host.hostKeyAlgorithms) {
    command += ` -o "HostKeyAlgorithms=${host.hostKeyAlgorithms}"`;
  }
  if (host.sendEnv) {
    command += ` -o "SendEnv=${host.sendEnv}"`;
  }
  if (host.localForward) {
    const forwards = host.localForward
      .split(/[\r\n]+/)
      .map((forward) => forward.trim())
      .filter((forward) => forward && !forward.startsWith("#"))
      .map((forward) => ` -L "${forward.split(/\s+/).join(":")}"`);
    command += forwards.join("");
  }
  if (host.remoteForward) {
    const forwards = host.remoteForward
      .split(/[\r\n]+/)
      .map((forward) => forward.trim())
      .filter((forward) => forward && !forward.startsWith("#"))
      .map((forward) => ` -R "${forward.split(/\s+/).join(":")}"`);
    command += forwards.join("");
  }
  if (host.dynamicForward) {
    const forwards = host.dynamicForward
      .split(/[\r\n]+/)
      .map((forward) => forward.trim())
      .filter((forward) => forward && !forward.startsWith("#"))
      .map((forward) => ` -D "${forward}"`);
    command += forwards.join("");
  }
  if (host.port && host.port !== "22") {
    command += ` -p ${host.port}`;
  }
  if (host.user) {
    command += ` ${host.user}@${host.hostname}`;
  } else {
    command += ` ${host.hostname}`;
  }
  return command;
}

export function getSSHCopyIdCommand(host: HostData | HostForm, defaultIdentity?: string, publicKey?: string): string {
  let command: string;
  if (publicKey) {
    command = "ssh";
  } else {
    command = `ssh-copy-id`;
    if (host.identityFile) {
      command += ` -i "${host.identityFile}"`;
    } else if (defaultIdentity) {
      command += ` -i "${defaultIdentity}"`;
    }
  }
  if (host.port !== "22") {
    command += ` -p ${host.port}`;
  }
  if (host.user) {
    command += ` ${host.user}@${host.hostname}`;
  } else {
    command += ` ${host.hostname}`;
  }
  if (publicKey) {
    command += ` "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qF '${publicKey}' ~/.ssh/authorized_keys || echo '${publicKey}' >> ~/.ssh/authorized_keys"`;
  }
  return command;
}

export function getSSHConfigBlock(host: HostData | HostForm): string {
  let block = "";
  if (host.comment) {
    block += host.comment
      .trim()
      .split("\n")
      .map((c) => "### " + c)
      .join("\n");
    block += "\n";
  }
  if (host.tags) {
    const tags = typeof host.tags === "string" ? host.tags.trim().split(/\s+/).filter(Boolean) : host.tags;
    if (tags.length > 0) {
      block += `### ${tags.map((t) => "#" + t).join(" ")}`;
      block += "\n";
    }
  }
  // In some cases (such as the host is server returned auto host) the host.name is "root@host" format.
  block += `Host ${host.name ? parseHostName(host.name || host.hostname).hostname : host.hostname}\n`;
  block += `    HostName ${host.hostname}\n`;
  if (host.user) {
    block += `    User ${host.user}\n`;
  }
  if (host.port && host.port !== "22") {
    block += `    Port ${host.port}\n`;
  }
  if (host.identityFile) {
    block += `    IdentityFile ${host.identityFile}\n`;
  }
  if (host.proxyJump) {
    block += `    ProxyJump ${host.proxyJump}\n`;
  }
  if (host.remoteCommand) {
    block += `    RemoteCommand ${host.remoteCommand}\n`;
  }
  if (host.addressFamily) {
    block += `    AddressFamily ${host.addressFamily}\n`;
  }
  if (host.userKnownHostsFile) {
    block += `    UserKnownHostsFile ${host.userKnownHostsFile}\n`;
  }
  if (host.strictHostKeyChecking) {
    block += `    StrictHostKeyChecking ${host.strictHostKeyChecking}\n`;
  }
  if (host.hostKeyAlgorithms) {
    block += `    HostKeyAlgorithms ${host.hostKeyAlgorithms}\n`;
  }
  if (host.sendEnv) {
    block += `    SendEnv ${host.sendEnv}\n`;
  }
  if (host.localForward) {
    const forwards = host.localForward
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f && !f.startsWith("#"));
    for (const forward of forwards) {
      block += `    LocalForward ${forward}\n`;
    }
  }
  if (host.remoteForward) {
    const forwards = host.remoteForward
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f && !f.startsWith("#"));
    for (const forward of forwards) {
      block += `    RemoteForward ${forward}\n`;
    }
  }
  if (host.dynamicForward) {
    const forwards = host.dynamicForward
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f && !f.startsWith("#"));
    for (const forward of forwards) {
      block += `    DynamicForward ${forward}\n`;
    }
  }

  if (!block.endsWith("\n")) {
    block += "\n";
  }
  return block;
}

/**
 * Parse a OpenSSH Config Host block to HostData.
 * It throws an exception if text doesn't seem to be a valid Host block.
 */
export function parseSSHConfigBlock(text: string): HostData {
  const lines = text.split(/\r?\n/);
  let name = "";
  let hostname = "";
  let user = "";
  let port = "";
  let identityFile = "";
  let proxyJump = "";
  let remoteCommand = "";
  let addressFamily = "";
  let userKnownHostsFile = "";
  let strictHostKeyChecking = "";
  let hostKeyAlgorithms = "";
  let verifyHostKeydns = "";
  let sendEnv = "";
  const localForwards: string[] = [];
  const remoteForwards: string[] = [];
  const dynamicForwards: string[] = [];

  let comment = "";
  const tags: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("#")) {
      const content = trimmed.replace(/^#+\s*/, "").trim();
      if (!content) continue;
      const words = content.split(/\s+/);
      const commentWords: string[] = [];
      for (const w of words) {
        if (w.startsWith("#") && w.length > 1) {
          tags.push(w.slice(1));
        } else {
          commentWords.push(w);
        }
      }
      if (commentWords.length > 0) {
        if (comment) comment += "\n";
        comment += commentWords.join(" ");
      }
      continue;
    }

    const match = trimmed.match(/^([a-zA-Z0-9_]+)\s*=?\s*(.*)$/);
    if (!match) continue;

    const key = match[1].toLowerCase();
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }

    switch (key) {
      case "host":
        name = val.split(/\s+/)[0];
        break;
      case "hostname":
        hostname = val;
        break;
      case "user":
        user = val;
        break;
      case "port":
        port = val;
        break;
      case "identityfile":
        identityFile = val;
        break;
      case "proxyjump":
        proxyJump = val;
        break;
      case "remotecommand":
        remoteCommand = val;
        break;
      case "addressfamily":
        {
          const v = val.toLowerCase();
          if (v === "any" || v === "inet" || v === "inet6") {
            addressFamily = v;
          }
        }
        break;
      case "userknownhostsfile":
        userKnownHostsFile = val;
        break;
      case "stricthostkeychecking":
        {
          const v = val.toLowerCase();
          if (v === "yes" || v === "no" || v === "ask") {
            strictHostKeyChecking = v;
          }
        }
        break;
      case "hostkeyalgorithms":
        hostKeyAlgorithms = val;
        break;
      case "verifyhostkeydns":
        {
          const v = val.toLowerCase();
          if (v === "yes" || v === "no" || v === "ask") {
            verifyHostKeydns = v;
          }
        }
        break;
      case "sendenv":
        sendEnv = val;
        break;
      case "localforward":
        localForwards.push(val);
        break;
      case "remoteforward":
        remoteForwards.push(val);
        break;
      case "dynamicforward":
        dynamicForwards.push(val);
        break;
    }
  }

  if (!hostname) {
    throw new Error("invalid");
  }

  const parsedData: HostData = {
    hostname,
    user,
    identityFile,
    proxyJump,
    remoteCommand,
    userKnownHostsFile,
    hostKeyAlgorithms,
    sendEnv,
    tags,
    comment,
    name: name || hostname,
    port: port || "22",
    source: "",
    localForward: localForwards.join("\n"),
    remoteForward: remoteForwards.join("\n"),
    dynamicForward: dynamicForwards.join("\n"),
    addressFamily: addressFamily as HostForm["addressFamily"],
    strictHostKeyChecking: strictHostKeyChecking as HostForm["strictHostKeyChecking"],
    verifyHostKeyDns: verifyHostKeydns as HostForm["verifyHostKeyDns"],
  };
  return parsedData;
}

/**
 * Creates a Set proxy that calls a callback whenever the set is mutated.
 * @param cb The callback. It MUST NOT mutate the set.
 */
export function createSetProxy<T>(initialValue: Iterable<T> | null | undefined, cb: (set: Set<T>) => void): Set<T> {
  const mySet = new Set(initialValue);

  // Track whether a microtask has already been scheduled
  let isPending = false;

  const setProxy = new Proxy(mySet, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof value === "function") {
        const mutatingMethods = ["add", "delete", "clear"];

        if (mutatingMethods.includes(prop as string)) {
          // Changed to any[] because clear() takes no args, delete() takes one, etc.
          return function (...args: unknown[]) {
            const result = value.apply(target, args);

            // If a microtask isn't already queued, queue one now
            if (!isPending) {
              isPending = true;

              queueMicrotask(() => {
                isPending = false; // Reset the flag before running the callback
                cb(target);
              });
            }

            // If the method returns the raw target, return the proxy (receiver) instead to preserve chaining
            return result === target ? receiver : result;
          };
        }

        return value.bind(target);
      }

      return value;
    },
  });

  return setProxy;
}

/**
 * Creates a Map proxy that calls a callback whenever the map is mutated.
 * @param cb The callback. It MUST NOT mutate the map.
 */
export function createMapProxy<K, V>(
  initialValue: Iterable<readonly [K, V]> | null | undefined,
  cb: (map: Map<K, V>) => void,
): Map<K, V> {
  const myMap = new Map<K, V>(initialValue);

  // Track whether a microtask has already been scheduled
  let isPending = false;

  const mapProxy = new Proxy(myMap, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop);

      if (typeof value === "function") {
        const mutatingMethods = ["set", "delete", "clear"];

        if (mutatingMethods.includes(prop as string)) {
          return function (...args: unknown[]) {
            const result = value.apply(target, args);

            // If a microtask isn't already queued, queue one now
            if (!isPending) {
              isPending = true;

              queueMicrotask(() => {
                isPending = false; // Reset the flag before running the callback
                cb(target);
              });
            }
            // If the method returns the raw target, return the proxy (receiver) instead to preserve chaining
            return result === target ? receiver : result;
          };
        }

        return value.bind(target);
      }

      return value;
    },
  });

  return mapProxy;
}

/**
 * Returns standard headers (with auth) for API requests.
 */
export function apiReqHeaders(noJson = false): HeadersInit {
  const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN) || "";
  return {
    [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
    ...(!noJson ? { [HEADER_CONTENT_TYPE]: MIME_JSON } : {}),
  };
}

export function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function triggerAuthedUrlDownload(url: string, filename: string) {
  const response = await fetch(url, { headers: apiReqHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to download ${filename}: ${response.statusText}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  triggerDownload(blobUrl, filename);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}

export function triggerDownloadString(contents: string, filename: string) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Returns a label for the host in the format of "[user@]hostname[:port]".
 * The user part is present if the host user is not root or if alwaysIncludeUser is true.
 * The port part is present if the host port is not 22.
 */
export function hostLabel(host: HostData | HostForm, alwaysIncludeUser = false): string {
  const user = host.user || "root";
  return `${alwaysIncludeUser || user !== "root" ? user + "@" : ""}${host.hostname}${
    host.port && host.port !== "22" ? `:` + host.port : ""
  }`;
}

export function sendKeyDown(kc: string, el?: HTMLElement) {
  const altKey = kc.includes("alt");
  const ctrlKey = kc.includes("ctrl");
  const shiftKey = kc.includes("shift");
  const parts = kc.split("+");
  const key = parts[parts.length - 1];
  let code = "";
  if (key.length === 1) {
    if (key >= "0" && key <= "9") {
      code = "Digit" + key;
    } else {
      code = "Key" + key.toUpperCase();
    }
  }
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    bubbles: true,
    cancelable: true,
    altKey,
    ctrlKey,
    shiftKey,
  });
  (el || document.activeElement || document.body).dispatchEvent(event);
}

/**
 * Opens a new terminal in the background by opening a WebSocket connection to the backend.
 * @param host Host string in the format of "[user@]hostname[:port]"
 * @param options Optional record of terminal options
 * @returns Promise<boolean> Resolves to true if the terminal was opened successfully, false otherwise
 */
export async function openBackgroundTerminal(host: string, options?: Record<string, string>): Promise<boolean> {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
  const params = new URLSearchParams({
    host,
    cols: "80",
    rows: "24",
    state: "3",
  });
  let identity: string | undefined;
  if (options) {
    identity = options.identity;
    delete options.identity;
    for (const [key, value] of Object.entries(options)) {
      if (!terminalClientSideParams.has(key)) {
        params.set(key, value);
      }
    }
  }

  const promises: PromiseLike<unknown>[] = [];
  window.dispatchEvent(
    new CustomEvent(CS_EVENT_TERMINAL_NEW, {
      detail: {
        sessionId: "",
        host,
        params,
        promises,
        is_active_terminal: false,
      } satisfies CSEventDetailTerminalNew,
    }),
  );
  try {
    await Promise.all(promises);
  } catch {
    return false;
  }

  const wsUrl = `${protocol}//${location.host}/api/ws`;
  const websocket_protocols: string[] = [WS_PROTOCOL_DUMMY];
  if (token) {
    websocket_protocols.push(token);
  }
  websocket_protocols.push(WS_PROTOCOL_QUERY_PREFIX + base64urlEncode(params.toString()));
  if (identity) {
    websocket_protocols.push(WS_PROTOCOL_IDENTITY_PREFIX + base64urlEncode(identity.toString()));
  }
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, websocket_protocols);
    ws.addEventListener("open", () => {
      ws.close();
      resolve(true);
    });
    ws.addEventListener("error", () => {
      resolve(false);
    });
  });
}

/**
 * Asserts that a value is unreachable (should never happen in correct code).
 * @param x The value to assert. TypeScript will infer the type as never.
 * @throws Error with the value if reached
 */
export function assertUnreachable(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
