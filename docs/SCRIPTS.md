# CozySSH Custom Scripting API

CozySSH allows you to extend its functionality by writing custom scripts (JavaScript or TypeScript). Scripts are executed in the browser environment and have access to powerful `cs*` prefix functions to interact with the terminal, the backend, and the application state. It's also possible to import some modules (like `react`) in your custom script.

## General Usage

- **Button Type**: Create or Edit a button and select the type **Run Script**.
- **Payload**: Enter your script in the payload field.
- **TypeScript Support**: The editor supports TypeScript syntax highlighting, and scripts are automatically transpiled on-the-fly using [Sucrase](https://github.com/alangpierce/sucrase).
- **Auto-run**: You can enable **Auto-run on startup** for a script button. These scripts will execute automatically when the application loads.
- **Execution**: Scripts are executed as ES modules via dynamic `import()`.
- **Top-level `await`**: Fully supported. You can use `await` directly at the top level of your scripts without wrapping them in an `async` function or IIFE.
- **Awaiting Completion**: The script engine automatically waits for all top-level `await` promises to resolve before finishing execution and re-focusing the terminal.

## Available modules

Use standard ES module import syntax to import modules. For example:

```javascript
import React, { useState } from "react";
```

Available modules:

- `react`

## Available global functions

### `csOpenApplet(name: string, node: Node | React.ComponentType, options?: { position?: 'widget' | 'sidebar' }): void`

Opens a custom UI applet. The applet is essentially a floating widget or a section in the right sidebar.

- `name`: Unique identifier for the applet. If an applet with the same name exists, it is replaced.
- `node`: A DOM element (e.g. `document.createElement('div')`) or a React Component.
- `options.position`: Decides the initial layout position of the applet. Can be `'widget'` (floatable, resizable) or `'sidebar'` (docked in a right sidebar). Defaults to `'widget'`.

### `csCloseApplet(name: string): void`

Closes the custom UI applet with the matching `name`.

### `csGetVar(name: string): string | undefined`, `csGetVar(): Record<string, string>`

Returns the value of a persistent variable stored in the CozySSH configuration.
- `name`: Optional. If provided, returns the value of that specific variable. If omitted, returns an object containing all variables.

### `csSetVar(name: string, value: string | undefined): Promise<void>`, `csSetVar(vars: Record<string, string | undefined>): Promise<void>`

Sets one or more persistent variables. These variables are saved to the backend configuration file (`config.yaml`) and persist across browser RESTARTS and application reloads.

- `name`: The name of the variable to set.
- `value`: The value to set. If set to `undefined` or `null`, the variable will be deleted.
- `vars`: An object containing multiple key-value pairs to set.

### `csGetTerminal(): Terminal | undefined`

Returns the currently active `xterm.js` Terminal instance. Returns `undefined` if no terminal is active.

### `csFocus(): void`

Focuses the currently active terminal session. This is the programmatic equivalent of the `Alt + G` global shortcut.

### `csNotify(msg: string): void`

Displays a toast notification in the top-right corner. Up to 3 messages can be displayed simultaneously.

### `csGetHosts(): Host[]`

Returns the list of all configured server objects. Sample Host object:

```json
{
  "name": "host50",
  "hostname": "192.168.1.50",
  "port": "22",
  "user": "root",
  "proxy_jump": "",
  "tags": [
    "fav"
  ],
  "comment": "",
  "source": "config",
  "is_auto": false,
  "is_favourite": true
},
```

### `csOpen(target: Host | string | (Host | string)[], options?: { name?: string }): void`

Opens a new tab or split-screen tab.
- `target`: A single host object, a connection string (e.g., `user@host`), a special string `"local"` to open a local shell, or an array of up to 4 targets for split-screen.
- `options.name`: Optional title for the new tab.

### `csFetch(url: string, options?: RequestInit): Promise<Response>`

Performs an HTTP request via the CozySSH backend proxy to bypass browser CORS restrictions.
- **Restricted Headers**: You can set browser-restricted headers (like `Referer`, `Origin`, `User-Agent`, or `Cookie`) directly in the `{ headers }` fetch option. `csFetch` automatically handles these to ensure they are correctly forwarded to the target.

### `csExec(cmdline: string): Promise<{ error: any, stdout: string, stderr: string }>`

Executes a shell command on the CozySSH backend server.
- **Linux/macOS**: Uses `bash -l -c`.
- **Windows**: Uses `powershell -Command`.

### `csRefresh(): Promise<void>`

Asynchronously refreshes all application data (server list, buttons, system info). Can be awaited.

---

## Example Snippets

### Display current terminal info

```typescript
const term = csGetTerminal();
if(!term) {
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
const productionHosts = csGetHosts().filter(h => h.tags?.includes('prod'));
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
  "KEY_A": "value1",
  "KEY_B": "value2"
});
```

### Custom UI Applet

You can create your own floating UI or sidebar using React (exposed globally).

```javascript
import React, { useState } from 'react';

const MyWidget = () => {
  const [count, setCount] = useState(0);
  return (
    <div style={{ padding: '20px' }}>
      <h4>Counter Applet</h4>
      <p>Clicked: {count} times</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
      <br/>
      <button onClick={() => csCloseApplet("Counter Widget")} style={{ marginTop: '10px' }}>
        Close
      </button>
    </div>
  );
};

csOpenApplet("Counter Widget", MyWidget, { position: "widget" });
```
