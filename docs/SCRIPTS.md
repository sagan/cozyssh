# CozySSH Custom Scripting API

CozySSH allows you to extend its functionality by writing custom scripts (JavaScript or TypeScript). Scripts are executed in the browser environment and have access to powerful `cs*` prefix functions and `cs:*` custom events to interact with the terminal, the backend, and the application state. It's also possible to import some CozySSH frontend bundled ES modules (like `react`) in your custom script.

- [CozySSH Custom Scripting API](#cozyssh-custom-scripting-api)
  - [General Usage](#general-usage)
  - [Available modules](#available-modules)
  - [Available global variables](#available-global-variables)
  - [Available global functions](#available-global-functions)
    - [`csOpenApplet(name: string, node: Node | React.ComponentType, options?: { position?: 'widget' | 'sidebar' | 'dialog', width?: number, height?: number }): void`](#csopenappletname-string-node-node--reactcomponenttype-options--position-widget--sidebar--dialog-width-number-height-number--void)
    - [`csCloseApplet(name: string): void`](#cscloseappletname-string-void)
    - [`csGetApplet(name: string): AppletData | undefined`, `csGetApplet(): AppletData[]`](#csgetappletname-string-appletdata--undefined-csgetapplet-appletdata)
    - [`csGetVar(name: string): string | undefined`, `csGetVar(): Record<string, string>`](#csgetvarname-string-string--undefined-csgetvar-recordstring-string)
    - [`csSetVar(name: string, value: string | undefined): Promise<void>`, `csSetVar(vars: Record<string, string | undefined>): Promise<void>`](#cssetvarname-string-value-string--undefined-promisevoid-cssetvarvars-recordstring-string--undefined-promisevoid)
    - [`csGetTerminal(paneId?: string): Terminal | undefined`](#csgetterminalpaneid-string-terminal--undefined)
    - [`csGetTerminalHandle(paneId?: string): TerminalHandle | undefined`](#csgetterminalhandlepaneid-string-terminalhandle--undefined)
    - [`csGetShellIntegration(paneId?: string): ShellIntegration | undefined`](#csgetshellintegrationpaneid-string-shellintegration--undefined)
    - [`csSendData(data: string, paneId?: string): void`](#cssenddatadata-string-paneid-string-void)
    - [`csGetTerminalContents(lines = 100, paneId?: string) : string`](#csgetterminalcontentslines--100-paneid-string--string)
    - [`csFocus(paneId?: string): void`](#csfocuspaneid-string-void)
    - [`csNotify(msg: string, severity: 'success' | 'info' | 'warning' | 'error' = 'info'): void`](#csnotifymsg-string-severity-success--info--warning--error--info-void)
    - [`csGetAll(): AllObject`](#csgetall-allobject)
    - [`csOpen(target: HostData | string | (HostData | string)[], options?: { name?: string }): void`](#csopentarget-hostdata--string--hostdata--string-options--name-string--void)
    - [`csClose(tabOrPaneId?: string): void`](#csclosetaborpaneid-string-void)
    - [`csFetch(url: string, options?: RequestInit): Promise<Response>`](#csfetchurl-string-options-requestinit-promiseresponse)
    - [`csExec(cmdline: string): Promise<{ error: unknown, stdout: string, stderr: string }>`](#csexeccmdline-string-promise-error-unknown-stdout-string-stderr-string-)
    - [`csRefresh(): Promise<void>`](#csrefresh-promisevoid)
    - [`csSetTheme(options: unknown, ...args: unknown[]): void`](#cssetthemeoptions-unknown-args-unknown-void)
    - [`csUpdateButton(btn: ButtonData): Promise<string>`](#csupdatebuttonbtn-buttondata-promisestring)
    - [`csDeleteButton(id: string): Promise<void>`](#csdeletebuttonid-string-promisevoid)
    - [`csUpdateHost(host: Host): Promise<void>`](#csupdatehosthost-host-promisevoid)
    - [`csDeleteHost(name: string): Promise<void>`](#csdeletehostname-string-promisevoid)
    - [csAlert, csConfirm, csPrompt](#csalert-csconfirm-csprompt)
  - [Client-side Events](#client-side-events)
    - [`cs:terminal-new`](#csterminal-new)
    - [`cs:terminal-change`](#csterminal-change)
    - [`cs:terminal-connected`](#csterminal-connected)
    - [`cs:terminal-disconnected`](#csterminal-disconnected)
    - [`cs:terminal-resize`](#csterminal-resize)
    - [`cs:terminal-data`](#csterminal-data)
    - [`cs:shell-integration`](#csshell-integration)
  - [Example Snippets](#example-snippets)
    - [Display current terminal info](#display-current-terminal-info)
    - [Open a local shell](#open-a-local-shell)
    - [Run command on backend and notify result](#run-command-on-backend-and-notify-result)
    - [Open all servers with a specific tag in split-screen](#open-all-servers-with-a-specific-tag-in-split-screen)
    - [CORS-free API Fetch](#cors-free-api-fetch)
    - [Persistent Variables (Shared State)](#persistent-variables-shared-state)
    - [Custom UI Applet](#custom-ui-applet)
    - [Variable Manager](#variable-manager)
    - [AI Assistant](#ai-assistant)
    - [Cmd History Sidebar Applet](#cmd-history-sidebar-applet)

## General Usage

- **Button Type**: Create or Edit a button and select the type **Run Script**.
- **Payload**: Enter your script in the payload field.
- **TypeScript Support**: The editor supports TypeScript syntax highlighting, and scripts are automatically transpiled on-the-fly using [Sucrase](https://github.com/alangpierce/sucrase).
- **Auto-run**: You can enable **Auto-run on startup** for a script button. These scripts will execute automatically after the application finishes loading all data (hosts, buttons, variables). This is the recommended way to register global event listeners or initialize custom UI applets.
- **Execution**: Scripts are executed as ES modules via dynamic `import()`.
- **Top-level `await`**: Fully supported. You can use `await` directly at the top level of your scripts without wrapping them in an `async` function or IIFE.
- **Awaiting Completion**: The script engine automatically waits for all top-level `await` promises to resolve before finishing execution.
- **Auto-focus**: By default, scripts will re-focus the terminal after execution.
- **Module Exports**: Optionally, the script may export some fields to control the behavior of the scripting engine:
  - `export function run() {}` : the entrypoint of the script. if exported, the `run` function will be executed after the script is imported. It will always be executed each time the button is clicked, even if the script is cached (see `cache` below).
  - `export const cache = true;` : if exported and `true`, the script will be cached when it's first imported. You may want to also export `run` in this case otherwise clicking the button will have no effect after the first time it's imported. The cache is cleared when the browser page is reloaded.
  - `export const noFocus = true;` : if exported and `true`, the script will not focus the terminal after execution.

## Available modules

Use standard ES module import syntax to import modules. For example:

```javascript
import React, { useState } from "react";
```

Available modules that's bundled in CozySSH frontend:

- `react`: https://github.com/facebook/react
- `dompurify`: https://github.com/cure53/DOMPurify
- `marked`: https://github.com/markedjs/marked

You can also import any external module, for example from a CDN url.

## Available global variables

CozySSH sets some global variables in the browser's window object.

- `window.__CS_AUTORUN_DONE__` : `undefined | 0 | 1` - `1` - If all autorun scripts have been executed, unset (undefined) or 0 otherwise. It can be used to determine if the script is executed via auto-run or via clicking the button.
- `window.__CS_MODULECACHE__` : `Record<string, Record<string, any>>` - The module cache of imported scripts. The key is the button internal id.
- `window.__CS_VERSION__` : `string` - The current frontend version of CozySSH. E.g. `0.1.26`.
- `window.__CS_PASSTHROUGH_SHORTCUTS__` : `Set<string>` - The list of key combinations that should be passed through to the terminal if terminal has focus. Each element is a key combination string such as `ctrl+shift+m` (all lowercase, modifiers in `ctrl,alt,shift,meta` order). Some key combinations (like `ctrl+c`, `ctrl+d`, etc.) are pre-added to this set by default.
- `window.__CS_DISABLE_SHORTCUTS__` : `Set<string>` - The list of keyboard shortcuts that should be disabled. The element is in the same format as `__CS_PASSTHROUGH_SHORTCUTS__` element.
- `window.__CS_USE_STORE__` : `typeof useStore` - The zustand store hook function that CozySSH uses to manage state.

## Available global functions

### `csOpenApplet(name: string, node: Node | React.ComponentType, options?: { position?: 'widget' | 'sidebar' | 'dialog', width?: number, height?: number }): void`

Opens a custom UI applet. The applet is essentially a floating widget, a section in the right sidebar, or a MUI Dialog.

- `name`: Unique identifier for the applet. If an applet with the same name exists, it is replaced.
- `node`: A DOM element (e.g. `document.createElement("div")`) or a React Component.
- `options.position`: Decides the initial layout position of the applet. Can be `widget` (floatable, resizable), `sidebar` (docked in a right sidebar), or `dialog` (opens in a centered MUI Dialog). Defaults to `widget` (on mobile devices it defaults to `sidebar`).
- `options.width`, `options.height`: Initial dimensions. For `widget` and `dialog` positions, these set the initial width/height of the container, can be integer (in pixels) or CSS size string (e.g. `700`, `50vw`).

### `csCloseApplet(name: string): void`

Closes the custom UI applet with the matching `name`.

### `csGetApplet(name: string): AppletData | undefined`, `csGetApplet(): AppletData[]`

Returns information about currently open applets.

- `name`: The name of the applet to return the data for. If provided, returns the data for the specific applet. If omitted, returns an array of all open applet objects.

Sample Applet object:

```json
{
  "name": "My Widget",
  "position": "widget",
  "width": 320,
  "height": 250,
  "zIndex": 10000
}
```

### `csGetVar(name: string): string | undefined`, `csGetVar(): Record<string, string>`

Returns the value of a persistent variable stored in the CozySSH configuration.

- `name`: Optional. If provided, returns the value of that specific variable. If omitted, returns an object containing all variables.

### `csSetVar(name: string, value: string | undefined): Promise<void>`, `csSetVar(vars: Record<string, string | undefined>): Promise<void>`

Sets one or more persistent variables. These variables are saved to the backend configuration file (`config.yaml`) and persist across browser RESTARTS and application reloads.

- `name`: The name of the variable to set.
- `value`: The value to set. If set to `undefined` or `null`, the variable will be deleted.
- `vars`: An object containing multiple key-value pairs to set.

Variables which name starts with `local` (case insensitive) are saved only in the current browser localStorage, not synced to the server. All other variables are saved on the server and synced to all browser instances.

### `csGetTerminal(paneId?: string): Terminal | undefined`

Returns the `xterm.js` [Terminal](https://xtermjs.org/docs/api/terminal/classes/terminal/) instance if `paneId` is provided, the active instance otherwise. Returns `undefined` if the specified terminal is not found.

### `csGetTerminalHandle(paneId?: string): TerminalHandle | undefined`

Returns the terminal handle for the specified terminal if `paneId` is provided, the active instance otherwise. Returns `undefined` if the specified terminal is not found.

### `csGetShellIntegration(paneId?: string): ShellIntegration | undefined`

Returns the shell integration state for the specified terminal if `paneId` is provided, the active instance otherwise. Returns `undefined` if the specified terminal is not found.

Sample `ShellIntegration` object:

```json
{
  "cwd": "/root/files",
  "user": "root",
  "hostname": "robot-dev",
  "machineId": "...",
  "isExecuting": false,
  "recentCommands": [
    {
      "commandId": "...",
      "command": "ls -la",
      "exitStatus": 0,
      "timestamp": 1625097600000
    }
  ]
}
```

### `csSendData(data: string, paneId?: string): void`

Sends raw string data to the specified terminal if `paneId` is provided, the active instance otherwise. Useful for automating commands.

### `csGetTerminalContents(lines = 100, paneId?: string) : string`

Returns the contents of the specified terminal buffer as a string.

- `lines`: The number of lines to return. Defaults to 100. If 0 or negative, all lines will be returned.
- `paneId`: The ID of the terminal to return the contents of. If not provided, the currently active terminal is used.

### `csFocus(paneId?: string): void`

Focuses the specified terminal session if `paneId` is provided, the active instance otherwise.

### `csNotify(msg: string, severity: 'success' | 'info' | 'warning' | 'error' = 'info'): void`

Displays a toast notification in the top-right corner. Up to 3 messages can be displayed simultaneously.

- `msg`: The message to display.
- `severity`: The severity of the notification. Can be `'success'`, `'info'`, `'warning'`, or `'error'`. Defaults to `'info'`.

### `csGetAll(): AllObject`

Returns an object containing all the data from the CozySSH application. Sample object:

```json
{
  "activePaneId": "1UshaCrimvV0",
  "activeTabId": "local-1779873498006",
  "terminals": {
    "local-123456": {}
  },
  "shellIntegrations": {
    "local-123456": {
      "cwd": "/root"
    }
  },
  "hosts": [],
  "buttons": [],
  "tabs": [
    {
      "id": "local-123456",
      "panes": [
        {
          "id": "local-123456",
          "host": "local",
          "state": "connected"
        }
      ],
      "activePaneId": "local-123456",
      "title": "local",
      "isPinned": false,
      "isLocked": false
    }
  ],
  "vars": {},
  "localVars": {}
}
```

### `csOpen(target: HostData | string | (HostData | string)[], options?: { name?: string }): void`

Opens a new tab or split-screen tab.

- `target`: The host object, connection string or array of up to 4 host objects or connection strings for split-screen. The connection string is either fixed `local` string (for local shell) or in `[username[:password]@]hostname[:port]` format. E.g., `user@host`. Note we don't recommend putting password in connection string. CozySSH does not log or store password anywhere but custom scripts are stored on server in plain text files. So be careful with any secrets in custom scripts.
- `options.name`: Optional title for the new tab.

### `csClose(tabOrPaneId?: string): void`

Closes a tab or a split-screen pane.

- `tabOrPaneId`: The ID of the tab to close, or the pane to close. If it's a pane ID, it will only close the pane if it is part of a multi-pane tab. If it is omitted or empty, it defaults to the current active pane (which will close the active pane if the current tab has multiple panes, or close the active tab otherwise).

### `csFetch(url: string, options?: RequestInit): Promise<Response>`

Performs an HTTP request via the CozySSH backend proxy to bypass browser CORS restrictions.

- **Restricted Headers**: You can set browser-restricted headers (like `Referer`, `Origin`, `User-Agent`, or `Cookie`) directly in the `{ headers }` fetch option. `csFetch` automatically handles these to ensure they are correctly forwarded to the target.

### `csExec(cmdline: string): Promise<{ error: unknown, stdout: string, stderr: string }>`

Executes a shell command on the CozySSH backend server.

- **Linux/macOS**: Uses `bash -l -c`.
- **Windows**: Uses `pwsh -l -c` (if `pwsh` is present) or `powershell -Command`.

### `csRefresh(): Promise<void>`

Asynchronously refreshes all application data (server list, buttons, system info). Can be awaited.

### `csSetTheme(options: unknown, ...args: unknown[]): void`

Sets the MUI theme for the application. This function accepts the same arguments as MUI `createTheme`, see [Material UI document](https://mui.com/material-ui/customization/theming/).

Sample usage:

```ts
csSetTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#90caf9",
    },
  },
});
```

The default theme:

```json
{
  "cssVariables": true,
  "palette": {
    "mode": "light",
    "primary": { "main": "#1976d2" },
    "background": { "default": "#ffffff", "paper": "#f4f6f8" }
  }
}
```

### `csUpdateButton(btn: ButtonData): Promise<string>`

Adds or updates a button in the configuration (depending on if `btn.id` is set), and returns the added / edited button's ID. If `btn.id` is not provided, CozySSH will automatically generate a unique 12-character ID for you.

Sample usage:

```typescript
const btnId = await csUpdateButton({
  name: "Say Hello",
  type: "send_string",
  payload: "echo 'Hello World!'\n",
  group: "Default",
});
csNotify(`Button created with ID: ${btnId}`);
```

### `csDeleteButton(id: string): Promise<void>`

Deletes a button from the configuration with the matching `id`.

Sample usage:

```typescript
await csDeleteButton("btn-12345");
csNotify("Button deleted");
```

### `csUpdateHost(host: Host): Promise<void>`

Adds or updates a host configuration. If the host's `name` already exists in the configured hosts, it will be updated; otherwise, a new host block will be appended to your SSH config.

Sample usage:

```typescript
await csUpdateHost({
  name: "staging-server",
  hostname: "192.168.1.50",
  user: "ubuntu",
  port: "22",
  tags: ["staging", "web"],
});
csNotify("Host configuration updated");
```

### `csDeleteHost(name: string): Promise<void>`

Deletes a host configuration with the matching `Host my-server` name from your SSH config.

Sample usage:

```typescript
await csDeleteHost("staging-server");
csNotify("Host deleted");
```

### csAlert, csConfirm, csPrompt

- `csAlert: (message?: string, detail?: string) => Promise<void>`
- `csConfirm: (message?: string, detail?: string) => Promise<boolean>`,
- `csPrompt: (message?: string, defaultValue?: string, options?: {placeholder?: string; alidate?: (value: string) => string;}) => Promise<string | null>`

The async (non-blocking) version of DOM `alert, confirm, prompt` functions using MUI Dialog.

---

## Client-side Events

CozySSH dispatches various `cs:*` DOM [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent) events to the `window` object. You can listen for these events in your scripts (especially those with **Auto-run** enabled) to react to application state changes. Event details is put in `CustomEvent.detail`.

### `cs:terminal-new`

Fired when a new terminal is created. At this time, the terminal is not yet connected to the backend, so the WebSocket is not yet opened. It's able for script to block the connection or change connection params using this event handle.

- `detail.terminal`: `Terminal`, the xterm.js Terminal instance.
- `detail.sessionId`: `string`, the session ID.
- `detail.host`: `string`, the host name. `local` for local terminal.
- `detail.is_active_terminal`: `boolean`, whether this is the active terminal.
- `detail.params`: `URLSearchParams`, the connection parameters for the terminal. You can modify it, but don't reassign the `detail.params` variable itself. The parameters (default values):
  - `host`: the host name. `local` for local terminal.
  - `sessionId`: the session ID.
  - `cloneFrom`: optional session ID to clone from.
  - `rows`: optional terminal rows.
  - `cols`: optional terminal columns.
  - `remoteCommand`: optional command to execute on the remote host.
- `detail.promises`: `PromiseLike<unknown>[]`, initial is empty, scripts can add promises to it, CozySSH will wait for them to resolve before establishing the backend connection. E.g.
  ```ts
  // If local shell, delay 1s, then throw an error, CozySSH will abort connecting
  window.addEventListener("cs:terminal-new", (e) => {
    const { detail } = e as CustomEvent<CSEventDetailTerminalNew>;
    if (detail.host !== "local") {
      return;
    }
    detail.promises.push(
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        throw new Error("Cancelled by user");
      })(),
    );
  });
  export const cache = true;
  ```

### `cs:terminal-change`

Fired when the active terminal pane changes.

- `detail.activePaneId`: The ID of the newly activated pane.

### `cs:terminal-connected`

Fired when a terminal successfully connects to the backend.

- `detail.terminal`: The `xterm.js` instance.
- `detail.sessionId`: The session ID.
- `detail.host`: The host name.
- `detail.is_active_terminal`: Whether this is the active terminal.

### `cs:terminal-disconnected`

Fired when a terminal connection is closed.

- `detail.reason`: `'normal' | 'stolen' | 'fatal'`.
- `detail.terminal`, `detail.sessionId`, `detail.host`, `detail.is_active_terminal`.

### `cs:terminal-resize`

Fired when a terminal is resized.

- `detail.cols`, `detail.rows`: New dimensions.
- `detail.terminal`, `detail.sessionId`, `detail.host`, `detail.is_active_terminal`.

### `cs:terminal-data`

Fired when data is received from the backend (excluding history restoration).

- `detail.terminal`, `detail.sessionId`, `detail.host`, `detail.is_active_terminal`.

### `cs:shell-integration`

Fired when any property of the shell integration state (CWD, command status, history) changes.

- `detail.cwd`, `detail.user`, `detail.hostname`, `detail.isExecuting`, `detail.recentCommands`.
- `detail.terminal`, `detail.sessionId`, `detail.host`, `detail.is_active_terminal`.

---

## Example Snippets

### Display current terminal info

```typescript
const term = csGetTerminal();
if (!term) {
  csNotify("No active terminal");
} else {
  csNotify(`Terminal info: ${term.rows} Rows, ${term.cols} Cols`);
}
```

### Open a local shell

```typescript
csOpen("local", { name: "LOCAL" });
```

### Run command on backend and notify result

```typescript
const result = await csExec("whoami");
if (!result.error) {
  csNotify(`Running as: ${result.stdout.trim()}`);
}
```

### Open all servers with a specific tag in split-screen

```typescript
const { hosts } = csGetAll();
const productionHosts = hosts.filter((h) => h.tags?.includes("prod"));
if (productionHosts.length > 0) {
  csOpen(productionHosts.slice(0, 4), { name: "PROD CLUSTER" });
}
```

### CORS-free API Fetch

```typescript
const response = await csFetch("https://api.github.com/repos/sagan/cozyssh");
const data = await response.json();
csNotify(`CozySSH Stars: ${data.stargazers_count}`);
```

### Persistent Variables (Shared State)

Variables set with `csSetVar` are stored on the server and are available to ALL scripts. This is useful for storing API keys, preferences, or sharing data between different widgets.

```typescript
// Set a persistent variable
await csSetVar("MY_THEME", "dark");

// Later, or in another script
const theme = csGetVar("MY_THEME");
csNotify("Current theme: " + theme);

// Bulk updates
await csSetVar({
  KEY_A: "value1",
  KEY_B: "value2",
});
```

### Custom UI Applet

You can create your own floating UI or sidebar using React. This is an example script that opens a widget which displays the current terminal size and updates in real-time as the user resizes the terminal or switches tabs:

```tsx
import React, { useState, useEffect } from "react";

const TerminalSizeApplet = () => {
  // Initialize with the current active terminal size
  const [size, setSize] = useState(() => {
    const term = csGetTerminal();
    return term ? { cols: term.cols, rows: term.rows } : { cols: 0, rows: 0 };
  });

  useEffect(() => {
    // Handler for resize events
    const handleResize = (e) => {
      // Only update if the event comes from the terminal currently in focus
      if (e.detail.is_active_terminal) {
        setSize({ cols: e.detail.cols, rows: e.detail.rows });
      }
    };

    // Handler for when the user switches tabs or panes
    const handleChange = () => {
      const term = csGetTerminal();
      if (term) {
        setSize({ cols: term.cols, rows: term.rows });
      } else {
        setSize({ cols: 0, rows: 0 });
      }
    };

    // Register event listeners
    window.addEventListener("cs:terminal-resize", handleResize);
    window.addEventListener("cs:terminal-change", handleChange);

    // Clean up listeners when applet is closed
    return () => {
      window.removeEventListener("cs:terminal-resize", handleResize);
      window.removeEventListener("cs:terminal-change", handleChange);
    };
  }, []);

  return (
    <div
      style={{
        padding: "24px",
        textAlign: "center",
        background: "#121212",
        color: "#00ff41", // Classic terminal green
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "#888", letterSpacing: "0.1em", marginBottom: "8px" }}>
        ACTIVE TERMINAL
      </div>
      <div style={{ fontSize: "2.8rem", fontWeight: "900", lineHeight: 1 }}>
        {size.cols}
        <span style={{ color: "#444", margin: "0 8px" }}>×</span>
        {size.rows}
      </div>
      <div style={{ marginTop: "12px", fontSize: "0.7rem", color: "#555" }}>COLUMNS × ROWS</div>
    </div>
  );
};

const name = "Terminal Size";

export function run() {
  if (csGetApplet(name)) {
    csCloseApplet(name);
  } else {
    csOpenApplet(name, TerminalSizeApplet, { position: "widget" });
  }
}

export const cache = true;
```

### Variable Manager

This is a utility to manage variables in the CozySSH applet.

```tsx
import React, { useState, useEffect } from "react";

const SettingsApplet = () => {
  const [variables, setVariables] = useState(csGetVar());
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const refresh = () => setVariables(csGetVar());

  const handleAdd = async () => {
    if (!newKey.trim()) {
      return;
    }
    await csSetVar(newKey.trim(), newValue);
    setNewKey("");
    setNewValue("");
    refresh();
    csNotify(`Variable "${newKey}" saved`);
  };

  const handleDelete = async (key) => {
    if (!(await csConfirm(`Delete ${key}?`))) {
      return;
    }
    await csSetVar(key, undefined);
    refresh();
    csNotify(`Variable "${key}" deleted`);
  };

  // Populate the form fields with the selected variable's data
  const handleEdit = (key, value) => {
    setNewKey(key);
    setNewValue(value);
  };

  useEffect(() => {
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <div
      style={{
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      {/* Header Section */}
      <div style={{ borderBottom: "1px solid #333", paddingBottom: "12px" }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#5d00ff" }}>Variable Manager</h3>
        <p style={{ margin: "4px 0 0 0", fontSize: "0.8rem" }}>Persist script data in config.yaml</p>
      </div>

      {/* Add/Edit Variable Form */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          background: "#00000014",
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid #333",
        }}
      >
        <input
          placeholder="Header Name (e.g. THEME)"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          style={{
            border: "1px solid #444",
            padding: "6px 10px",
            borderRadius: "4px",
            fontSize: "0.9rem",
          }}
        />
        <input
          placeholder="Value..."
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          style={{
            border: "1px solid #444",
            padding: "6px 10px",
            borderRadius: "4px",
            fontSize: "0.9rem",
          }}
        />
        <button
          onClick={handleAdd}
          style={{
            background: "#5d00ff",
            color: "#fff",
            border: "none",
            padding: "8px",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
            marginTop: "4px",
          }}
        >
          Save Variable
        </button>
      </div>

      {/* Variable List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {Object.entries(variables).length === 0 ? (
          <div style={{ textAlign: "center", color: "#666", padding: "20px", fontSize: "0.9rem" }}>
            No variables stored.
          </div>
        ) : (
          Object.entries(variables).map(([key, val]) => (
            <div
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#ffffff05",
                padding: "10px",
                borderRadius: "6px",
                border: "1px solid #222",
              }}
            >
              <div style={{ flex: 1, minWidth: 0, paddingRight: "12px" }}>
                <div style={{ fontSize: "0.75rem", color: "#5d00ff", fontWeight: "bold" }}>{key}</div>
                <div
                  style={{
                    fontSize: "0.95rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={val}
                >
                  {val}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={() => handleEdit(key, val)}
                  style={{
                    background: "transparent",
                    color: "#4da6ff",
                    border: "1px solid #4da6ff33",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(key)}
                  style={{
                    background: "transparent",
                    color: "#ff4444",
                    border: "1px solid #ff444433",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const name = "Variable Manager";

export function run() {
  if (csGetApplet(name)) {
    csCloseApplet(name);
  } else {
    csOpenApplet(name, SettingsApplet, { position: "sidebar" });
  }
}

export const cache = true;
```

### AI Assistant

This is an example "AI Assistant" that uses the Gemini API to help you with your terminal. You will need to provide your own API key in the settings.

```tsx
import React, { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * AI Assistant Script for CozySSH
 * Features:
 * - Sidebar Chat Interface
 * - Terminal context integration
 * - Gemini Model Support
 * - Persistent Settings
 * - Stream Responses
 * - Markdown Rendering
 */

const AI_ASSISTANT_NAME = "AI Assistant";

const AIAssistant = () => {
  const [view, setView] = useState("chat"); // 'chat' | 'settings'
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Settings State (Initialized from csGetVar)
  const [provider, setProvider] = useState(() => csGetVar("AI_PROVIDER") || "gemini");
  const [model, setModel] = useState(() => csGetVar("AI_MODEL") || "gemini-3.1-flash-lite-preview");
  const [apiKey, setApiKey] = useState(() => csGetVar("AI_API_KEY") || "");

  const scrollRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleAsk = async (forcePrompt = null) => {
    const userPrompt =
      forcePrompt ||
      input ||
      "Analyze the terminal output, diagnose errors, suggest commands or explain what's happening";

    if (!apiKey) {
      csNotify("Please configure API Key in settings.");
      setView("settings");
      return;
    }

    const terminalOutput = csGetTerminalContents();
    if (!terminalOutput) {
      return;
    }
    const systemPrompt =
      "You are a helpful terminal assistant. You have access to the recent terminal output buffer. Help the user diagnose issues, explain commands, or provide guidance. Keep responses concise and use markdown formatting.";

    const newUserMsg = { role: "user", content: userPrompt };
    setMessages((prev) => [...prev, newUserMsg]);
    setInput("");
    setLoading(true);

    try {
      // Build Gemini history
      const history = messages.map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));

      // Inject terminal context into the current message
      const currentPrompt = `[TERMINAL OUTPUT START]\n${terminalOutput}\n[TERMINAL OUTPUT END]\n\nUser Question: ${userPrompt}`;

      const payload = {
        contents: [...history, { role: "user", parts: [{ text: currentPrompt }] }],
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
      };

      const response = await csFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || "Unknown API error");
      }

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let assistantMessage = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr.trim() === "[DONE]") continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.candidates && data.candidates[0].content?.parts?.[0]?.text) {
                assistantMessage += data.candidates[0].content.parts[0].text;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1].content = assistantMessage;
                  return newMessages;
                });
              }
            } catch (e) {
              // ignore parse errors for partial lines
            }
          }
        }
      }
    } catch (e) {
      csNotify("AI Error: " + e.message);
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Error: " + e.message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleTestAndSave = async () => {
    setLoading(true);
    try {
      // Test the key with a minimal request
      const response = await csFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
        },
      );
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      // Save to persistent storage
      await csSetVar({
        AI_PROVIDER: provider,
        AI_MODEL: model,
        AI_API_KEY: apiKey,
      });
      csNotify("Settings saved!");
      setView("chat");
    } catch (e) {
      csNotify("Test failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const resetSession = () => {
    setMessages([]);
    setInput("");
  };

  // --- Styles ---
  const containerStyle = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#0f0f0f",
    color: "#e0e0e0",
    fontFamily: "system-ui, -apple-system, sans-serif",
  };

  const headerStyle = {
    padding: "12px 16px",
    background: "#1a1a1a",
    borderBottom: "1px solid #333",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  };

  const buttonStyle = {
    background: "linear-gradient(135deg, #6e8efb, #a777e3)",
    color: "#fff",
    border: "none",
    padding: "8px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "600",
  };

  const inputStyle = {
    width: "100%",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: "8px",
    padding: "12px",
    color: "#fff",
    fontSize: "0.9rem",
    outline: "none",
    resize: "none",
  };

  // --- Render Views ---

  if (view === "settings") {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <span style={{ fontWeight: "bold" }}>AI Settings</span>
          <button
            onClick={() => setView("chat")}
            style={{ background: "none", color: "#888", border: "none", cursor: "pointer" }}
          >
            Back
          </button>
        </div>
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ fontSize: "0.8rem", color: "#888", display: "block", marginBottom: "4px" }}>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} style={inputStyle}>
              <option value="gemini">Gemini</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", color: "#888", display: "block", marginBottom: "4px" }}>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", color: "#888", display: "block", marginBottom: "4px" }}>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter API Key"
              style={inputStyle}
            />
          </div>
          <button onClick={handleTestAndSave} disabled={loading} style={buttonStyle}>
            {loading ? "Testing..." : "Test & Save"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: "bold" }}>{AI_ASSISTANT_NAME}</span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={resetSession}
            style={{ background: "none", color: "#888", border: "none", cursor: "pointer", fontSize: "0.8rem" }}
          >
            Reset
          </button>
          <button
            onClick={() => setView("settings")}
            style={{ background: "none", color: "#888", border: "none", cursor: "pointer", fontSize: "0.8rem" }}
          >
            ⚙️
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: "auto", padding: "16px", display: "flex", flexDirection: "column" }}
      >
        {messages.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: "40px", opacity: 0.5 }}>
            <div style={{ fontSize: "2rem" }}>🤖</div>
            <p>How can I help with your terminal today?</p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "90%",
                padding: "10px 14px",
                borderRadius: "12px",
                background: m.role === "user" ? "#3b3b3b" : "#252525",
                marginBottom: "10px",
                fontSize: "0.9rem",
                border: "1px solid #333",
                overflowX: "auto",
              }}
            >
              {m.role === "user" ? (
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              ) : (
                <div
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(m.content)) }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                />
              )}
            </div>
          ))
        )}
        {loading && <div style={{ fontSize: "0.8rem", opacity: 0.5 }}>AI is thinking...</div>}
      </div>

      <div style={{ padding: "16px", background: "#121212", borderTop: "1px solid #333" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          style={{ ...inputStyle, marginBottom: "8px" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleAsk();
            }
          }}
        />
        <button onClick={() => handleAsk()} disabled={loading} style={{ ...buttonStyle, width: "100%" }}>
          Ask
        </button>
      </div>
    </div>
  );
};

export function run() {
  if (csGetApplet(AI_ASSISTANT_NAME)) {
    csCloseApplet(AI_ASSISTANT_NAME);
  } else {
    csOpenApplet(AI_ASSISTANT_NAME, AIAssistant, { position: "sidebar" });
  }
}

export const cache = true;
```

### Cmd History Sidebar Applet

This script creates a sidebar applet that tracks the command history of the active terminal. It allows you to click a command to copy it to the clipboard, or use a "Resend" button to execute it again.

Note: Command History tracking uses OSC 3008 sequence and is only supported in systemd 258+, included in recent version Linux such as Ubuntu 26.04+.

```tsx
import React, { useState, useEffect } from "react";

/**
 * Cmd History Applet for CozySSH
 */
const CmdHistoryApplet = () => {
  // Initialize state with the current terminal's integration data
  const [history, setHistory] = useState(() => {
    return window.csGetShellIntegration?.()?.recentCommands || [];
  });

  useEffect(() => {
    // Listener for shell integration updates (command finished, etc.)
    const handleIntegration = (e) => {
      if (e.detail.is_active_terminal) {
        setHistory(e.detail.shellIntegration?.recentCommands || []);
      }
    };

    // Listener for switching between terminal tabs/panes
    const handleTerminalChange = () => {
      setHistory(window.csGetShellIntegration?.()?.recentCommands || []);
    };

    window.addEventListener("cs:shell-integration", handleIntegration);
    window.addEventListener("cs:terminal-change", handleTerminalChange);

    return () => {
      window.removeEventListener("cs:shell-integration", handleIntegration);
      window.removeEventListener("cs:terminal-change", handleTerminalChange);
    };
  }, []);

  const handleCopy = (cmd) => {
    if (cmd) {
      navigator.clipboard.writeText(cmd);
      csNotify("Command copied to clipboard");
    }
  };

  const handleResend = (e, cmd) => {
    e.stopPropagation(); // Prevent the parent click (copy) from triggering
    if (cmd && window.csSendData) {
      window.csSendData(cmd + "\n");
      window.csFocus?.();
    }
  };

  return (
    <div
      style={{
        padding: "12px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          fontWeight: "bold",
          fontSize: "0.75rem",
          color: "#888",
          letterSpacing: "0.05em",
          borderBottom: "1px solid #eee",
          paddingBottom: "6px",
          marginBottom: "4px",
        }}
      >
        RECENT COMMANDS
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
        {history.length === 0 ? (
          <div
            style={{ textAlign: "center", color: "#999", marginTop: "30px", fontSize: "0.9rem", fontStyle: "italic" }}
          >
            No history detected.
          </div>
        ) : (
          history.map((entry, i) => (
            <div
              key={entry.commandId || i}
              onClick={() => handleCopy(entry.command)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px",
                borderRadius: "8px",
                background: entry.exitStatus === 0 ? "#f0fdf4" : entry.exitStatus !== undefined ? "#fef2f2" : "#f8f9fa",
                border: "1px solid",
                borderColor:
                  entry.exitStatus === 0 ? "#dcfce7" : entry.exitStatus !== undefined ? "#fee2e2" : "#e5e7eb",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#edf2f7")}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background =
                  entry.exitStatus === 0 ? "#f0fdf4" : entry.exitStatus !== undefined ? "#fef2f2" : "#f8f9fa")
              }
            >
              <div style={{ flex: 1, minWidth: 0, marginRight: "8px" }}>
                <div
                  style={{
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    fontSize: "0.85rem",
                    fontWeight: "600",
                    wordBreak: "break-all",
                    color: "#1a202c",
                  }}
                >
                  {entry.command || "(empty)"}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    marginTop: "6px",
                    fontSize: "0.7rem",
                    color: "#718096",
                  }}
                >
                  <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span
                    style={{
                      color: entry.exitStatus === 0 ? "#059669" : "#dc2626",
                      fontWeight: "bold",
                    }}
                  >
                    {entry.exitStatus === 0 ? "✓" : `✗ (${entry.exitStatus})`}
                  </span>
                </div>
              </div>

              <button
                onClick={(e) => handleResend(e, entry.command)}
                style={{
                  background: "#5d00ff",
                  color: "#fff",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.7rem",
                  fontWeight: "bold",
                  flexShrink: 0,
                }}
              >
                Resend
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const APPLET_ID = "CmdHistory";

export function run() {
  if (csGetApplet(APPLET_ID)) {
    csCloseApplet(APPLET_ID);
  } else {
    csOpenApplet(APPLET_ID, CmdHistoryApplet, { position: "sidebar" });
  }
}

export const cache = true;
```
