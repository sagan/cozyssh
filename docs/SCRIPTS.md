# CozySSH Custom Scripting API

CozySSH allows you to extend its functionality by writing custom scripts (JavaScript or TypeScript). Scripts are executed in the browser environment and have access to powerful `cs*` prefix functions to interact with the terminal, the backend, and the application state.

## General Usage

- **Button Type**: Create or Edit a button and select the type **Run Script**.
- **Payload**: Enter your script in the payload field.
- **TypeScript Support**: The editor supports TypeScript syntax highlighting, and scripts are automatically transpiled on-the-fly using [Sucrase](https://github.com/alangpierce/sucrase).
- **Execution**: Scripts are executed asynchronously via `await eval()`.
- **Top-level `await`**: Standard `eval` does not support top-level `await`. To use `await`, wrap your code in an `async` IIFE (e.g., `(async () => { ... })()`).
- **Awaiting Completion**: If you want the script engine to wait for your asynchronous tasks to finish (e.g., before re-focusing the terminal), your script should return a `Promise` (typically by making the `async` IIFE the last statement).

## Available Functions

### `csGetTerminal(): Terminal | undefined`
Returns the currently active `xterm.js` Terminal instance. Returns `undefined` if no terminal is active.

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

### Hello World Toast
```typescript
csNotify("Hello from CozySSH!");
```

### Open a local shell
```typescript
csOpen("local", { name: "LOCAL" });
```

### Run command on backend and notify result
```typescript
(async () => {
  const result = await csExec("whoami");
  if (!result.error) {
    csNotify(`Running as: ${result.stdout.trim()}`);
  }
})();
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
(async () => {
  const response = await csFetch("https://api.github.com/repos/sagan/cozyssh");
  const data = await response.json();
  csNotify(`CozySSH Stars: ${data.stargazers_count}`);
})();
```
