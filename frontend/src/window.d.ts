import type { ITerminalOptions, Terminal } from "@xterm/xterm";

import type { ButtonData, HostData, Session, ActiveTunnel } from "./api";
import type {
  CS_EVENT_SHELL_INTEGRATION,
  CS_EVENT_TERMINAL_CHANGE,
  CS_EVENT_TERMINAL_CONNECTED,
  CS_EVENT_TERMINAL_DATA,
  CS_EVENT_TERMINAL_DISCONNECTED,
  CS_EVENT_TERMINAL_NEW,
  CS_EVENT_TERMINAL_RESIZE,
  CS_EVENT_VARS,
  CSEventDetailActiveGroupChange,
  CSEventDetailShellIntegration,
  CSEventDetailTerminalConnected,
  CSEventDetailTerminalData,
  CSEventDetailTerminalDisconnected,
  CSEventDetailTerminalNew,
  CSEventDetailTerminalResize,
  CSEventDetailVars,
  Severity,
} from "./common";
import type { CsExecResult } from "./pluginAPI";
import type { TerminalRefMap, TabData, UseStore, CsScriptModule } from "./store";
import type { AppletData } from "./AppletWrapper";
import type { ShellIntegration, TerminalHandle } from "./Terminal";
import type { Liquid } from "liquidjs";

declare global {
  interface CsChooseAction {
    value: string; // The unique value returned when clicked (e.g., 'discard')
    label?: string; // The text displayed on the button (e.g., 'Save as Draft'), default to id
    variant?: "primary" | "secondary" | "error" | "warning"; // Optional styling hint
  }
  interface CsRunScriptPayload {
    /**
     * The script button object
     */
    button: Pick<ButtonData, "id" | "type" | "name" | "payload">;
    /**
     * If true, the script is executed in the backgrund (without user explicitly clicking the button)
     */
    background?: boolean;
    /**
     * Defines the trigger way of the script button
     * - 0 / undefined : normal / default;
     * - 1 : Alt + Mouse Click
     * - 2 : Shift + Mouse Click
     * - 3 : Ctrl + Mouse Click
     */
    alternativeMode?: number;
  }
  /**
   * The optional default export type of custom script
   */
  interface CsScript {
    /**
     * The entrypoint of the script. If set, it will be executed after the script is imported.
     * It will always be executed each time the button is clicked, even if the script is cached (see `cache`)
     */
    run?: (payload: CsRunScriptPayload) => void | Promise<void>;
    /**
     * Optional cleanup function for the script. If set, it will be executed when the script is unloaded.
     */
    unload?: () => void | Promise<void>;
    /**
     * If `true`, the script engine will not focus the terminal after executing the script.
     */
    noFocus?: boolean;
    /**
     * If `true`, the script will be cached and reused.
     * You may want to also provide a `run` function in this case otherwise clicking the script's button will have
     * no effect after the first time it's imported. The cache is cleared when the browser page is reloaded.
     */
    cache?: boolean;
  }

  /**
   * `1` - If all autorun scripts have been executed, unset (undefined) or `0` otherwise.
   * It can be used to determine if the script is executed via auto-run or via clicking the button.
   */
  var __CS_AUTORUN_DONE__: undefined | number;
  /**
   * The module cache of imported scripts. The key is the button internal id.
   */
  var __CS_MODULECACHE__: Record<string, CsScriptModule>;
  /**
   * The current frontend version of CozySSH. E.g. `0.1.26`.
   */
  var __CS_VERSION__: string;
  /**
   * The zustand store hook of the frontend.
   */
  var __CS_USE_STORE__: UseStore;
  /**
   * The additional list of key combinations that should be passed through to the terminal if terminal has focus.
   * Each element is a key combination string such as `ctrl+shift+m`
   * (all lowercase, modifiers in `ctrl,alt,shift,meta` order).
   */
  var __CS_PASSTHROUGH_SHORTCUTS__: Set<string>;
  /**
   * The list of CozySSH shortcut key combinations that should be disabled.
   * The element is in the same format as `__CS_PASSTHROUGH_SHORTCUTS__` element.
   * For shortcut in this list it will directly return in keyboard event handle.
   */
  var __CS_DISABLE_SHORTCUTS__: Set<string>;
  /**
   * The list of shortcut key combinations that are silently "consumed" by CozySSH.
   * The difference between it and `__CS_DISABLE_SHORTCUTS__` is that for shortcut in this list
   * it will execute `e.preventDefault()` before returning in keyboard event handle.
   * Some key combinations (like `alt`, `alt+shift`, etc.) are pre-added to this set by default.
   */
  var __CS_BLACKHOLE_SHORTCUTS__: Set<string>;
  /**
   * If 1, disable terminal ctrl+l (let browser handle it) and remap ctrl+shift+l & ctrl+alt+l to ctrl+l in terminal.
   */
  var __CS_REMAP_CTRL_L__: undefined | number;
  /**
   * Used to set additional xterm.js terminal options. These options are merged with the default options.
   * It uses Proxy so any modification takes effect to all terminals immediately.
   */
  var __CS_TERMINAL_OPTIONS__: ITerminalOptions;
  /**
   * The LiquidJs Engine instannce that CozySSH uses for send_string buttons & Terminal Input dialog.
   */
  var __CS_LIQUID_ENGINE__: Liquid;
  /**
   * The button data of the script that is currently being executed.
   * Note script is executed in async manner. If multiple scripts are executed at the same time,
   * this variable can hold any of them or undefined. It's guaranteed that it will be set to
   * undefined when no script is running.
   * It's recommended to use the `selfBtn` argument of `run(selfBtn)` in the plugin API instead.
   */
  var __CS_RUNNING_SCRIPT__: Pick<ButtonData, "id" | "name" | "type" | "payload"> | undefined;
  /**
   * `0` - CozySSH is running as web app
   * `1` - CozySSH is running as Windows Desktop app (webview2)
   */
  var __CS_ENV__: number;
  /**
   * Global font size. Default is 14 (MUI default).
   * It uses Object.defineProperty so the modification takes effect immediately.
   */
  var __CS_FONT_SIZE__: number;
  /**
   * Global shortcut button map.
   */
  var __CS_SHORTCUT_BUTTONS__: Record<string, ButtonData>;
  /**
   * Toast keys that are muted. Keys can be prefixes ending with '-'.
   * For example, 'A-' matches 'A-1', 'A-2', etc.
   */
  var __CS_TOAST_KEY_MUTE_SET__: Set<string>;
  /**
   * Focus the terminal with the given pane id.
   * @param tabOrPaneId defaults to active terminal pane id.
   */
  function csFocus(tabOrPaneId?: string): void;
  /**
   * Display a toast notification.
   * @param severity defaults to "info".
   * @param key optional toast key, if provided, it will override the previous notification of same key
   */
  function csNotify(msg: string, severity?: Severity, key?: string): void;
  /**
   * Open a host or a set of hosts.
   * @param hosts The host object, connection string or array of up to 4 host objects or connection strings
   * for split-screen. The connection string is either fixed `local` string (for local shell) or in
   * `[username[:password]@]hostname[:port]` format. E.g. `user@host`.
   * Note we don't recommend putting password in connection string.
   * CozySSH does not log or store password anywhere but custom scripts are stored on server in plain text files.
   * So be careful with any secrets in custom scripts.
   * It's possible to append a optional query string in connection string, e.g `user@host?remoteCommand=bash`,
   * to set some optional session scope parameters. Available parameters:
   *   - `id`: Manually set the pane id of the opened terminal. If it's set and the same id pane already exists,
   *           it will switch to the target terminal instead of opening a new one.
   *           It isn't used if you provide multiple hosts.
   *   - `remoteCommand`: Command to run on remote host.
   *   - `cols`: Initial columns of the terminal.
   *   - `rows`: Initial rows of the terminal.
   *   - `noPublicKey`: If `1`, public key authentication will be disabled
   *   - `identity`: Manually set the identity (ssh private key) file path (on backend)
   *                 or contents that will be used for authentication in this session.
   * @param options.title Optional title for the new tab.
   * @param options.target Optional target tab id. The target tab must currently contains less than 4 panes.
   *                       Special values:
   *                       - `_blank` : open in new tab (default)
   *                       - `_self` : open in active tab
   * @returns Returns the opened tab id
   */
  function csOpen(
    hosts: HostData | string | (HostData | string)[],
    options?: { title?: string; target?: string },
  ): string | Promise<string>;
  /**
   * Close a tab or pane.
   * @param tabOrPaneId defaults to active pane id. If it's a tab id, it will close the tab.
   */
  function csClose(tabOrPaneId?: string): void;
  /**
   * Get the terminal with the given pane id.
   * @param paneId defaults to active terminal pane id.
   * @returns The xterm.js Terminal instance, or null or undefined if it doesn't exist.
   */
  function csGetTerminal(paneId?: string): Terminal | undefined | null;
  /**
   * Get the terminal handle with the given pane id.
   * @param paneId defaults to active terminal pane id.
   * @returns The terminal handle with the given pane id, or undefined if it doesn't exist.
   */
  function csGetTerminalHandle(paneId?: string): TerminalHandle | undefined;
  /**
   * Get the last `lineCount` lines of terminal contents with the given pane id.
   * @param lineCount The number of lines to retrieve, defaults to 100.
   * @param paneId defaults to active terminal pane id.
   */
  function csGetTerminalContents(lineCount?: number, paneId?: string): string;
  /**
   * Get the shell integration with the given pane id.
   * @param paneId defaults to active terminal pane id.
   */
  function csGetShellIntegration(paneId?: string): ShellIntegration | undefined;
  /**
   * Run a script button directly
   */
  function csRunScript(payload: CsRunScriptPayload): Promise<void>;
  /**
   * Send input data to the terminal with the given pane id.
   * @param data Data to send. If string, it will first be converted to \r line breaks and encoded as UTF-8.
   *             If BufferSource or Blob, it will be sent as is.
   * @param paneId defaults to active terminal pane id.
   */
  function csSendData(data: string | BufferSource | Blob, paneId?: string): void;
  /**
   * Get all state of CozySSH.
   */
  function csGetAll(): {
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
  /**
   * Get all sessions.
   * @param pinnedOnly Whether to only get sessions whose `isPinned` or `isLocked` property is true.
   */
  function csGetSessions(pinnedOnly?: boolean): Promise<Session[]>;
  /**
   * Get all active tunnels.
   */
  function csGetTunnels(): Promise<ActiveTunnel[]>;
  /**
   * Performs an HTTP request via the CozySSH backend proxy to bypass browser CORS restrictions.
   * @param init the fetch `RequestInit` object, with an additional optional `key` property.
   * @param init.key Optional key to uniquify the request. If not provided, it will be generated to a random value.
   * The key will be appended to the request url sent to backend. It's intended to be used to control
   * the browser cache behavior, since the backend just ignores it.
   */
  function csFetch(url: string, init?: RequestInit & { key?: string }): Promise<Response>;
  /**
   * Get the value of a variable.
   */
  function csGetVar(name: string): string | undefined;
  /**
   * Get the values of all variables.
   */
  function csGetVar(): Record<string, string>;
  /**
   * Set the value of a variable.
   * @param name The name of the variable. If it starts with "local_" (case insensitive),
   * it will be stored in current browser local storage, otherwise it will be synced to backend and other browsers.
   * @param value The value of the variable. Use `undefined` to delete the variable.
   */
  function csSetVar(name: string, value: string | undefined): Promise<void>;
  /**
   * Set the values of all variables.
   */
  function csSetVar(vars: Record<string, string | undefined>): Promise<void>;
  /**
   * Update a button or a set of buttons.
   */
  function csUpdateButton(btn: ButtonData | ButtonData[]): Promise<void>;
  /**
   * Delete a button.
   */
  function csDeleteButton(id: string): Promise<void>;
  /**
   * Update a host.
   */
  function csUpdateHost(host: HostData | HostData[]): Promise<void>;
  /**
   * Delete a host.
   */
  function csDeleteHost(name: string): Promise<void>;
  /**
   * Execute a shell command on the CozySSH backend.
   */
  function csExec(cmdline: string): Promise<CsExecResult>;
  /**
   * Execute a shell command in the context of a specific terminal pane.
   *
   * For SSH terminals, the command is run over a new background SSH channel
   * opened from the existing connection — it is invisible to the visible
   * terminal and does not disturb the interactive session.
   *
   * For local-shell terminals (and when no matching pane is found), the
   * behaviour is identical to {@link csExec}.
   *
   * @param cmdline The command line to execute on the remote (or local) host.
   * @param paneId  The pane whose SSH connection to reuse.
   *                Defaults to the currently active pane.
   */
  function csExecInTerminal(cmdline: string, paneId?: string): Promise<CsExecResult>;
  /**
   * Open a custom UI applet.
   * @param name The name of the applet. If an applet with the same name already exists, it will be replaced.
   * @param node The React component to render as the applet's UI.
   * @param options optional options
   * @param options.position The initial layout position of the applet. Can be `widget` (floatable, resizable),
   * `sidebar` (docked in a right sidebar), or `dialog` (opens in a centered MUI Dialog).
   * Defaults to `widget` (on mobile devices it defaults to `sidebar`)
   * @param options.width Initial width for applet of `widget` and `dialog` position.
   * Can be integer (in pixels) or CSS size string (e.g. `700`, `50vw`)
   * @param options.height Initial height for applet of `widget` and `dialog` position.
   * Can be integer (in pixels) or CSS size string (e.g. `500`, `40vh`)
   */
  function csOpenApplet(
    name: string,
    node: Node | React.ComponentType,
    options?: Partial<Omit<AppletData, "name" | "node">>,
  ): void;
  /**
   * Open a menu.
   * @param anchorId The id or the element itself to open the menu from. A button in button bar has `button-<id>` id
   *                where `<id>` is the button id which can be fetched from `run(selfBtn)` argument.
   * @param options The options to display in the menu.
   * @returns The selected option, or null if the menu was closed without selecting an option.
   */
  function csOpenMenu(anchorId: string | HTMLElement, options: string[]): Promise<string | null>;
  /**
   * Close a custom UI applet.
   */
  function csCloseApplet(name: string): void;
  /**
   * Get a custom UI applet.
   * @param name The name of the applet.
   */
  function csGetApplet(name: string): AppletData | undefined;
  /**
   * Get all custom UI applets.
   */
  function csGetApplet(): AppletData[];
  /**
   * Refresh the data from backend.
   */
  function csRefresh(options?: { sync?: number; refresh?: number }): Promise<void>;
  /**
   * Set the theme of the application. It accepts the same arguments as MUI `createTheme`,
   * see [Material UI document](https://mui.com/material-ui/customization/theming/).
   */
  function csSetTheme(options: unknown, ...args: unknown[]): void;
  /**
   * Attach a new terminal to an existing tab.
   * @returns Returns the opened tab id
   */
  function csAttach(id: string, host: string, title: string, isLocked?: boolean): Promise<string>;
  /**
   * Display an async alert dialog.
   * The behavior is the same as `window.alert` except it's non-blocking.
   */
  function csAlert(message?: string, detail?: string): Promise<void>;
  /**
   * Display an async confirm dialog.
   * The behavior is the same as `window.confirm` except it's non-blocking.
   * @param message The message to display in the dialog.
   * @param detail The detail to display in the dialog.
   * @param verification Set to `true` or a verification string.
   * If `undefined`, the user can simply click the OK button or press ENTER to confirm.
   * If `true`, the user must check the checkbox before confirm.
   * If a string, the user must type the verification string before confirm.
   */
  function csConfirm(message?: string, detail?: string, verification?: boolean | string): Promise<boolean>;
  /**
   * Display an async prompt dialog.
   * The behavior is the same as `window.prompt` except it's non-blocking.
   * @param options.options Set to render text input as a select dropdown that
   * the user can only choose from the list of pre-defied values.
   */
  function csPrompt(
    message?: string,
    defaultValue?: string,
    options?: {
      placeholder?: string;
      options?: (string | CsChooseAction)[];
      validate?: (value: string) => string | undefined;
    },
  ): Promise<string | null>;
  /**
   * Similar to csPrompt but diplay input box as password type
   */
  function csPromptPassword(message?: string, defaultValue?: string): Promise<string | null>;
  /**
   * Display an async choose dialog.
   */
  function csChoose(title: string, message: string, actions: (string | CsChooseAction)[]): Promise<string | null>;
  /**
   * Set the sidebar filter value
   */
  function csSetSidebarFilter(filter: string): void;
  interface WindowEventMap {
    [CS_EVENT_TERMINAL_NEW]: CustomEvent<CSEventDetailTerminalNew>;
    [CS_EVENT_TERMINAL_CONNECTED]: CustomEvent<CSEventDetailTerminalConnected>;
    [CS_EVENT_TERMINAL_DISCONNECTED]: CustomEvent<CSEventDetailTerminalDisconnected>;
    [CS_EVENT_TERMINAL_DATA]: CustomEvent<CSEventDetailTerminalData>;
    [CS_EVENT_TERMINAL_RESIZE]: CustomEvent<CSEventDetailTerminalResize>;
    [CS_EVENT_TERMINAL_CHANGE]: CustomEvent<CSEventDetailActiveGroupChange>;
    [CS_EVENT_SHELL_INTEGRATION]: CustomEvent<CSEventDetailShellIntegration>;
    [CS_EVENT_VARS]: CustomEvent<CSEventDetailVars>;
  }

  // Window Desktop app bindings. All are unset (undefined) in web app
  var appOpenNewWindow: ((targetURL: string) => Promise<void>) | undefined;
  var appToggleFullscreen: (() => Promise<void>) | undefined;
  /**
   * Get auth token (only valid for desktop app).
   */
  var appAuth: (() => Promise<string>) | undefined;
  /**
   * Open url in system default browser (only valid for desktop app).
   */
  var appOpenUrl: ((url: string) => Promise<void>) | undefined;
}

export {};
