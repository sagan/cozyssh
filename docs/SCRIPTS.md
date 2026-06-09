## CozySSH Scripting API

CozySSH allows you to extend its functionality by writing custom scripts (JavaScript or TypeScript). Scripts are executed in the browser environment and have access to powerful `cs*` prefix functions and `cs:*` custom events to interact with the terminal, the backend, and the application state. It's also possible to import some CozySSH frontend bundled ES modules (like `react`) in your script.

- [CozySSH Scripting API](#cozyssh-scripting-api)
- [General Usage](#general-usage)
- [CozySSH Plugins](#cozyssh-plugins)
- [Available modules](#available-modules)
- [Available global variables](#available-global-variables)
- [Available global functions](#available-global-functions)
  - [`csOpenMenu(anchorId: string | HTMLElement, options: string[]): Promise<string | null>`](#csopenmenuanchorid-string--htmlelement-options-string-promisestring--null)
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
  - [`csFocus(tabOrPaneId?: string): void`](#csfocustaborpaneid-string-void)
  - [`csNotify(msg: string, severity: 'success' | 'info' | 'warning' | 'error' = 'info'): void`](#csnotifymsg-string-severity-success--info--warning--error--info-void)
  - [`csGetAll(): AllObject`](#csgetall-allobject)
  - [`csOpen(target: HostData | string | (HostData | string)[], options?: { name?: string }): void`](#csopentarget-hostdata--string--hostdata--string-options--name-string--void)
  - [`csClose(tabOrPaneId?: string): void`](#csclosetaborpaneid-string-void)
  - [`csFetch(url: string, options?: RequestInit): Promise<Response>`](#csfetchurl-string-options-requestinit-promiseresponse)
  - [`csExec(cmdline: string): Promise<{ error: unknown, stdout: string, stderr: string }>`](#csexeccmdline-string-promise-error-unknown-stdout-string-stderr-string-)
  - [`csRefresh(): Promise<void>`](#csrefresh-promisevoid)
  - [`csSetTheme(options: unknown, ...args: unknown[]): void`](#cssetthemeoptions-unknown-args-unknown-void)
  - [`csUpdateButton(btn: ButtonData | ButtonData[]): Promise<void>`](#csupdatebuttonbtn-buttondata--buttondata-promisevoid)
  - [`csDeleteButton(id: string): Promise<void>`](#csdeletebuttonid-string-promisevoid)
  - [`csUpdateHost(host: Host): Promise<void>`](#csupdatehosthost-host-promisevoid)
  - [`csDeleteHost(name: string): Promise<void>`](#csdeletehostname-string-promisevoid)
  - [csAlert, csConfirm, csPrompt and more](#csalert-csconfirm-csprompt-and-more)
- [Client-side Events](#client-side-events)
  - [`cs:terminal-new`](#csterminal-new)
  - [`cs:terminal-change`](#csterminal-change)
  - [`cs:terminal-connected`](#csterminal-connected)
  - [`cs:terminal-disconnected`](#csterminal-disconnected)
  - [`cs:terminal-resize`](#csterminal-resize)
  - [`cs:terminal-data`](#csterminal-data)
  - [`cs:shell-integration`](#csshell-integration)
- [Example Scripts](#example-scripts)
  - [Display current terminal info](#display-current-terminal-info)
  - [Open a local shell](#open-a-local-shell)
  - [Run command on backend and notify result](#run-command-on-backend-and-notify-result)
  - [CORS-free API Fetch](#cors-free-api-fetch)
  - [Custom UI Applet](#custom-ui-applet)
  - [More Examples](#more-examples)

## General Usage

- **Button Type**: Create or Edit a button and select the type **Run Script**.
- **Payload**: Enter your script in the payload field.
- **TypeScript Support**: The editor supports TypeScript syntax highlighting, and scripts are automatically transpiled on-the-fly using [Sucrase](https://github.com/alangpierce/sucrase).
- **Fully Typed**: The scripting API is fully typed. We provide a auto-generated [TypeScript definition](../frontend/csapi.d.ts) file that can be used in script development to provide full-fledged Code Intelligence. See [CozySSH Plugins][] repository for how to write scripts/plugins.
- **Auto-run**: You can enable **Auto-run on startup** for a script button. These scripts will execute automatically after the application finishes loading all data (hosts, buttons, variables). This is the recommended way to register global event listeners or initialize custom UI applets.
- **Execution**: Scripts are executed as ES modules via dynamic `import()`. You can use all ES module features such as top-lebel `await`.
- **Awaiting Completion**: The script engine automatically waits for all top-level `await` promises to resolve before finishing execution.
- **Auto-focus**: By default, scripts will re-focus the terminal after execution.
- **Module Default Export**: Optionally, the script may provide a default export object with the following optional fields to control the behavior of the scripting engine:
  - `run`: `(payload: {button: ButtonData, background?: boolean}) => void | Promise<void>` - The entrypoint of the script. If provided, it will be executed after the script is imported. It will always be executed each time the button is clicked, even if the script is cached (see `cache` below).
  - `cache`: `boolean` - If provided and `true`, the script will be cached when it's first imported. You may want to also provide a `run` function in this case otherwise clicking the script's button will have no effect after the first time it's imported. The cache is cleared when the browser page is reloaded.
  - `noFocus`: `boolean` - If provided and `true`, the script will not focus the terminal after execution.

## CozySSH Plugins

CozySSH maintains a scripts/plugins [repository][CozySSH Plugins] and provides several official plugins. All plugins in the repository can be installed directly from CozySSH frontend. See [CozySSH Plugins][] for details.

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
- `window.__CS_MODULECACHE__` : `Record<string, CsScriptModule>` - The module cache of imported scripts. The key is the button internal id.
- `window.__CS_VERSION__` : `string` - The current frontend version of CozySSH. E.g. `0.1.26`.
- `window.__CS_PASSTHROUGH_SHORTCUTS__` : `Set<string>` - The list of key combinations that should be passed through to the terminal if terminal has focus. Each element is a key combination string such as `ctrl+shift+m` (all lowercase, modifiers in `ctrl,alt,shift,meta` order). Some key combinations (like `ctrl+c`, `ctrl+d`, etc.) are pre-added to this set by default.
- `window.__CS_DISABLE_SHORTCUTS__` : `Set<string>` - The list of keyboard shortcuts that should be disabled. The element is in the same format as `__CS_PASSTHROUGH_SHORTCUTS__` element.
- `window.__CS_USE_STORE__` : `typeof useStore` - The [zustand][] store hook function that CozySSH uses to manage state.
- `window.__CS_TERMINAL_OPTIONS__` : `ITerminalOptions` - Used to set additional xterm.js terminal options. These options are merged with the default options. It uses Proxy so any modification takes effect to all terminals immediately. See xterm.js [ITerminalOptions](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/) for details. The default options can be found in `frontend/src/Terminal.tsx`.
- `window.__CS_LIQUID_ENGINE__` : `Liquid` - The LiquidJs Engine instannce that CozySSH uses for send_string buttons & Terminal Input dialog.

## Available global functions

### `csOpenMenu(anchorId: string | HTMLElement, options: string[]): Promise<string | null>`

Opens a custom context menu. `anchorId` can be an HTML element id, or a DOM element. `options` is a list of strings which will be displayed as menu items. If the returned value `null` then it means the menu was closed without any selection. Otherwise the selected menu item will be returned.

The current button has `button-<id>` as its id where `id` is the internal id of the button, which can be accessed in `run(payload)` argument `payload.button.id`.

Example: display a menu above your button bar button when user clicks it.

```javascript
export default {
  run: async function ({ button }) {
    const options = ["Option 1", "Option 2", "Option 3"];
    const anchorId = "button-" + button.id;
    const selectedOption = await csOpenMenu(anchorId, options);
    csNotify(`User clicks ${selectedOption}`);
  },
};
```

This function does nothing when script is run as autorun script (the promise always resolves to null).

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

### `csFocus(tabOrPaneId?: string): void`

Focuses the specified terminal session if `tabOrPaneId` is provided, the active instance otherwise.

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

- `target`: The host object, connection string or array of up to 4 host objects or connection strings for split-screen. The connection string is either fixed `local` string (for local shell) or in `[username[:password]@]hostname[:port]` format. E.g. `user@host`. Note we don't recommend putting password in connection string. CozySSH does not log or store password anywhere but scripts are stored on server in plain text files. So be careful with any secrets in scripts.
- `options.name`: Optional title for the new tab.

### `csClose(tabOrPaneId?: string): void`

Closes a tab or a split-screen pane.

- `tabOrPaneId`: The ID of the tab to close, or the pane to close. If it's a pane ID, it will only close the pane if it is part of a multi-pane tab. If it is omitted or empty, it defaults to the current active pane (which will close the active pane if the current tab has multiple panes, or close the active tab otherwise).

### `csFetch(url: string, options?: RequestInit): Promise<Response>`

Performs an HTTP request via the CozySSH backend proxy to bypass browser CORS restrictions.

- **Restricted Headers**: You can set browser-restricted headers (like `Referer`, `Origin`, `User-Agent`, or `Cookie`) directly in the `{ headers }` fetch option. `csFetch` automatically handles these to ensure they are correctly forwarded to the target.

### `csExec(cmdline: string): Promise<{ error: unknown, stdout: string, stderr: string }>`

Execute a shell command on the CozySSH backend.

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

### `csUpdateButton(btn: ButtonData | ButtonData[]): Promise<void>`

Adds or updates button(s) based on the provided data (depending on if `btn.id` is set). If `btn.id` is not provided, CozySSH will automatically generate a unique 12-character ID for each button.

Sample usage:

```ts
await csUpdateButton({
  name: "Say Hello",
  type: "send_string",
  payload: "echo 'Hello World!'\n",
  group: "Default",
});
csNotify("Button created");
```

### `csDeleteButton(id: string): Promise<void>`

Deletes a button from the configuration with the matching `id`.

Sample usage:

```ts
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

### csAlert, csConfirm, csPrompt and more

- `csAlert: (message?: string, detail?: string) => Promise<void>`
- `csConfirm: (message?: string, detail?: string, verification?: boolean | string) => Promise<boolean>`,
- `csPrompt: (message?: string, defaultValue?: string, options?: {placeholder?: string; validate?: (value: string) => string; inputType?: string;}) => Promise<string | null>`
- `csPromptPassword(message?: string, defaultValue?: string): Promise<string | null>`
- `csChoose(title: string, message: string, actions: (string | CsChooseAction)[]): Promise<string | null>`

The async (non-blocking) version of DOM `alert, confirm, prompt` functions using MUI Dialog. The additional `csPromptPassword` and `csChoose` can be used to display a password input dialog and a choice dialog, respectively.

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
  export default {
    cache: true,
  };
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

## Example Scripts

### Display current terminal info

```ts
const term = csGetTerminal();
if (!term) {
  csNotify("No active terminal");
} else {
  csNotify(`Terminal info: ${term.rows} Rows, ${term.cols} Cols`);
}
```

### Open a local shell

```ts
csOpen("local", { name: "LOCAL" });
```

### Run command on backend and notify result

```ts
const result = await csExec("whoami");
if (!result.error) {
  csNotify(`Running as: ${result.stdout.trim()}`);
}
```

### CORS-free API Fetch

```ts
const response = await csFetch("https://api.github.com/repos/sagan/cozyssh");
const data = await response.json();
csNotify(`CozySSH Stars: ${data.stargazers_count}`);
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

export default {
  cache: true,
  run() {
    if (csGetApplet(name)) {
      csCloseApplet(name);
    } else {
      csOpenApplet(name, TerminalSizeApplet, { position: "widget" });
    }
  },
};
```

### More Examples

You can find more examples in [CozySSH Plugins][].

[CozySSH Plugins]: https://github.com/sagan/cozyssh-plugins
[zustand]: https://github.com/pmndrs/zustand
