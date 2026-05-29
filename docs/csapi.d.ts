// npx dts-bundle-generator --project ./frontend/tsconfig.app.json ./frontend/src/window.d.ts --inline-declare-global -o docs/_csapi.d.ts

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
}
export type Severity = "success" | "info" | "warning" | "error";
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
export interface TerminalHandle {
  sendData: (data: string) => void;
  focus: () => void;
  getSelection: () => string;
  selectAll: () => void;
  clearSelection: () => void;
  clear: () => void;
  reset: () => void;
  reconnect: () => void;
  scrollLines: (amount: number) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  scrollPages: (amount: number) => void;
  findNext: (term: string, searchOptions?: any) => boolean;
  findPrevious: (term: string, searchOptions?: any) => boolean;
  clearSearchDecorations: () => void;
  clearSearchActiveDecoration: () => void;
  getLastCommandOutput: () => string;
  getXterm: () => any | null; // xterm.js Terminal
  /** Set the inputMode on the hidden xterm textarea (e.g. 'none' to suppress system keyboard) */
  setInputMode: (mode: string) => void;
  /**
   * Atomically replace whatever the user has typed at the shell prompt with
   * `newText`, without executing it.
   *
   * Sends: Ctrl+E (go to end of line) → Ctrl+U (kill to beginning) → newText.
   * Only works while the shell is at an interactive prompt (not mid-execution).
   */
  replaceCmdLine: (newText: string) => void;
}
export interface ScratchpadHandle {
  focus: () => void;
}
export interface PaneData {
  id: string;
  sessionId?: string;
  host: string;
  state?: string;
  cloneFrom?: string;
}
export interface TabData {
  id: string;
  title: string;
  panes: PaneData[];
  activePaneId: string;
  isPinned?: boolean;
  isLocked?: boolean;
  showFiles?: boolean;
  type?: "terminal" | "scratchpad";
}
export type TerminalRefMap = Record<string, TerminalHandle | ScratchpadHandle | null>;
export interface Store {
  tabs: TabData[];
  activeTabId: string;
  activePaneId: string;
  hosts: HostData[];
  buttons: ButtonData[];
  vars: Record<string, string>;
  /** Local (browser-only) vars. All names have a "local_" (case-insensitive) prefix. */
  localVars: Record<string, string>;
  shellIntegrations: Record<string, ShellIntegration>;
}

export interface AppletData {
  name: string;
  node: any;
  position: AppletPosition;
  width?: number;
  height?: number;
  zIndex?: number;
}
export type AppletPosition = "widget" | "sidebar" | "dialog";
export interface CsExecResult {
  error: unknown;
  stdout: string;
  stderr: string;
}
export interface DialogApi {
  alert: (message?: string, detail?: string) => Promise<void>;
  confirm: (message?: string, detail?: string) => Promise<boolean>;
  prompt: (
    message?: string,
    defaultValue?: string,
    options?: {
      placeholder?: string;
      validate?: (value: string) => string | undefined;
    },
  ) => Promise<string | null>;
}
declare global {
  interface Window {
    __CS_AUTORUN_DONE__: undefined | number;
    __CS_MODULECACHE__: Record<string, Record<string, unknown>>;
    __CS_VERSION__: string;
    __CS_USE_STORE__: any;
    __CS_PASSTHROUGH_SHORTCUTS__: Set<string>;
    csFocus: (paneId?: string) => void;
    csNotify: (msg: string, severity: Severity) => void;
    csOpen: (
      target: HostData | string | (HostData | string)[],
      options?: {
        name?: string;
      },
    ) => void;
    csClose: (tabOrPaneId?: string) => void;
    csGetTerminal: (paneId?: string) => any | undefined | null;
    csGetTerminalHandle: (paneId?: string) => TerminalHandle | undefined;
    csGetTerminalContents: (lineCount?: number, paneId?: string) => string;
    csGetShellIntegration: (paneId?: string) => ShellIntegration | undefined;
    csSendData: (data: string, paneId?: string) => void;
    csGetAll: () => {
      activeTabId: string | undefined;
      activePaneId: string | undefined;
      terminals: TerminalRefMap;
      shellIntegrations: Record<string, ShellIntegration>;
      tabs: TabData[];
      hosts: HostData[];
      buttons: ButtonData[];
      vars: Record<string, string | undefined>;
      localVars: Record<string, string | undefined>;
    };
    csFetch: (url: string, init?: RequestInit) => Promise<Response>;
    csGetVar(name: string): string | undefined;
    csGetVar(): Record<string, string>;
    csSetVar:
      | ((nameOrVars: string, value: string | undefined) => Promise<void>)
      | ((vars: Record<string, string | undefined>) => Promise<void>);
    csUpdateButton: (btn: ButtonData) => Promise<string>;
    csDeleteButton: (id: string) => Promise<void>;
    csUpdateHost: (btn: HostData) => Promise<void>;
    csDeleteHost: (id: string) => Promise<void>;
    csExec: (cmdline: string) => Promise<CsExecResult>;
    csOpenApplet(
      name: string,
      node: any,
      options?: {
        position?: AppletPosition;
        width?: number;
        height?: number;
      },
    ): void;
    csCloseApplet: (name: string) => void;
    csGetApplet: ((name: string) => AppletData | undefined) | (() => AppletData[]);
    csRefresh: () => Promise<void>;
    csSetTheme: (options: unknown, ...args: unknown[]) => void;
    csAttach: (id: string, host: string, title: string, isLocked?: boolean) => void;
    csAlert: DialogApi["alert"];
    csConfirm: DialogApi["confirm"];
    csPrompt: DialogApi["prompt"];
  }
}

export {};
