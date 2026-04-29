# CozySSH Custom Scripting API

CozySSH allows you to extend its functionality by writing custom scripts (JavaScript or TypeScript). Scripts are executed in the browser environment and have access to powerful `cs*` prefix functions and `cs:*` custom events to interact with the terminal, the backend, and the application state. It's also possible to import some modules (like `react`) in your custom script.

- [CozySSH Custom Scripting API](#cozyssh-custom-scripting-api)
  - [General Usage](#general-usage)
  - [Available modules](#available-modules)
  - [Available global functions](#available-global-functions)
    - [`csOpenApplet(name: string, node: Node | React.ComponentType, options?: { position?: 'widget' | 'sidebar', width?: number, height?: number }): void`](#csopenappletname-string-node-node--reactcomponenttype-options--position-widget--sidebar-width-number-height-number--void)
    - [`csCloseApplet(name: string): void`](#cscloseappletname-string-void)
    - [`csGetApplet(name?: string): AppletData | AppletData[]`](#csgetappletname-string-appletdata--appletdata)
    - [`csGetVar(name: string): string | undefined`, `csGetVar(): Record<string, string>`](#csgetvarname-string-string--undefined-csgetvar-recordstring-string)
    - [`csSetVar(name: string, value: string | undefined): Promise<void>`, `csSetVar(vars: Record<string, string | undefined>): Promise<void>`](#cssetvarname-string-value-string--undefined-promisevoid-cssetvarvars-recordstring-string--undefined-promisevoid)
    - [`csGetTerminal(): Terminal | undefined`](#csgetterminal-terminal--undefined)
    - [`csGetTerminalContents(lines = 100) : string`](#csgetterminalcontentslines--100--string)
    - [`csFocus(): void`](#csfocus-void)
    - [`csNotify(msg: string): void`](#csnotifymsg-string-void)
    - [`csGetHosts(): Host[]`](#csgethosts-host)
    - [`csOpen(target: Host | string | (Host | string)[], options?: { name?: string }): void`](#csopentarget-host--string--host--string-options--name-string--void)
    - [`csFetch(url: string, options?: RequestInit): Promise<Response>`](#csfetchurl-string-options-requestinit-promiseresponse)
    - [`csExec(cmdline: string): Promise<{ error: any, stdout: string, stderr: string }>`](#csexeccmdline-string-promise-error-any-stdout-string-stderr-string-)
    - [`csRefresh(): Promise<void>`](#csrefresh-promisevoid)
  - [Client-side Events](#client-side-events)
    - [`cs:terminal-change`](#csterminal-change)
    - [`cs:terminal-connected`](#csterminal-connected)
    - [`cs:terminal-disconnected`](#csterminal-disconnected)
    - [`cs:terminal-resize`](#csterminal-resize)
    - [`cs:terminal-data`](#csterminal-data)
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

## General Usage

- **Button Type**: Create or Edit a button and select the type **Run Script**.
- **Payload**: Enter your script in the payload field.
- **TypeScript Support**: The editor supports TypeScript syntax highlighting, and scripts are automatically transpiled on-the-fly using [Sucrase](https://github.com/alangpierce/sucrase).
- **Auto-run**: You can enable **Auto-run on startup** for a script button. These scripts will execute automatically after the application finishes loading all data (hosts, buttons, variables). This is the recommended way to register global event listeners or initialize custom UI applets.
- **Execution**: Scripts are executed as ES modules via dynamic `import()`.
- **Top-level `await`**: Fully supported. You can use `await` directly at the top level of your scripts without wrapping them in an `async` function or IIFE.
- **Awaiting Completion**: The script engine automatically waits for all top-level `await` promises to resolve before finishing execution and re-focusing the terminal.

## Available modules

Use standard ES module import syntax to import modules. For example:

```javascript
import React, { useState } from "react";
```

Available modules:

- `react`: https://github.com/facebook/react
- `dompurify`: https://github.com/cure53/DOMPurify
- `marked`: https://github.com/markedjs/marked

## Available global functions

### `csOpenApplet(name: string, node: Node | React.ComponentType, options?: { position?: 'widget' | 'sidebar', width?: number, height?: number }): void`

Opens a custom UI applet. The applet is essentially a floating widget or a section in the right sidebar.

- `name`: Unique identifier for the applet. If an applet with the same name exists, it is replaced.
- `node`: A DOM element (e.g. `document.createElement('div')`) or a React Component.
- `options.position`: Decides the initial layout position of the applet. Can be `'widget'` (floatable, resizable) or `'sidebar'` (docked in a right sidebar). Defaults to `'widget'`.
- `options.width`, `options.height`: Initial dimensions for the widget (only applies to `'widget'` position).

### `csCloseApplet(name: string): void`

Closes the custom UI applet with the matching `name`.

### `csGetApplet(name?: string): AppletData | AppletData[]`

Returns information about currently open applets.
- `name`: Optional. If provided, returns the data for the specific applet.
- If omitted, returns an array of all open applet objects.

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

### `csGetTerminal(): Terminal | undefined`

Returns the currently active `xterm.js` Terminal instance. Returns `undefined` if no terminal is active.

### `csGetTerminalContents(lines = 100) : string`

Returns the contents of the currently active terminal buffer as a string.

- `lines`: The number of lines to return. Defaults to 100. If 0 or negative, all lines will be returned.

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

## Client-side Events

CozySSH dispatches various `cs:*` events to the `window` object. You can listen for these events in your scripts (especially those with **Auto-run** enabled) to react to application state changes.

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

You can create your own floating UI or sidebar using React. This is an example script that opens a widget which displays the current terminal size and updates in real-time as the user resizes the terminal or switches tabs:

```tsx
import React, { useState, useEffect } from 'react';

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
    window.addEventListener('cs:terminal-resize', handleResize);
    window.addEventListener('cs:terminal-change', handleChange);
    
    // Clean up listeners when applet is closed
    return () => {
      window.removeEventListener('cs:terminal-resize', handleResize);
      window.removeEventListener('cs:terminal-change', handleChange);
    };
  }, []);

  return (
    <div style={{ 
      padding: '24px', 
      textAlign: 'center', 
      background: '#121212', 
      color: '#00ff41', // Classic terminal green
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      boxSizing: 'border-box'
    }}>
      <div style={{ fontSize: '0.75rem', color: '#888', letterSpacing: '0.1em', marginBottom: '8px' }}>
        ACTIVE TERMINAL
      </div>
      <div style={{ fontSize: '2.8rem', fontWeight: '900', lineHeight: 1 }}>
        {size.cols}<span style={{ color: '#444', margin: '0 8px' }}>×</span>{size.rows}
      </div>
      <div style={{ marginTop: '12px', fontSize: '0.7rem', color: '#555' }}>
        COLUMNS × ROWS
      </div>
    </div>
  );
};

// Open as a small floating widget
csOpenApplet("Terminal Size", TerminalSizeApplet, { 
  position: "widget", 
});
```

### Variable Manager

This is a utility to manage variables in the CozySSH applet.

```tsx
import React, { useState, useEffect } from 'react';

const SettingsApplet = () => {
  const [variables, setVariables] = useState(csGetVar());
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const refresh = () => setVariables(csGetVar());

  const handleAdd = async () => {
    if (!newKey.trim()) return;
    await csSetVar(newKey.trim(), newValue);
    setNewKey('');
    setNewValue('');
    refresh();
    csNotify(`Variable "${newKey}" saved`);
  };

  const handleDelete = async (key) => {
    if( !confirm(`Delete ${key}?`) ) {
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
    <div style={{ 
      padding: '16px', 
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }}>
      {/* Header Section */}
      <div style={{ borderBottom: '1px solid #333', paddingBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#5d00ff' }}>Variable Manager</h3>
        <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem' }}>
          Persist script data in config.yaml
        </p>
      </div>

      {/* Add/Edit Variable Form */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '8px',
        background: '#00000014',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid #333'
      }}>
        <input 
          placeholder="Header Name (e.g. THEME)" 
          value={newKey} 
          onChange={e => setNewKey(e.target.value)}
          style={{ 
            border: '1px solid #444', 
            padding: '6px 10px', borderRadius: '4px', fontSize: '0.9rem' 
          }}
        />
        <input 
          placeholder="Value..." 
          value={newValue} 
          onChange={e => setNewValue(e.target.value)}
          style={{ 
            border: '1px solid #444', 
            padding: '6px 10px', borderRadius: '4px', fontSize: '0.9rem' 
          }}
        />
        <button 
          onClick={handleAdd}
          style={{ 
            background: '#5d00ff', color: '#fff', border: 'none', 
            padding: '8px', borderRadius: '4px', cursor: 'pointer',
            fontWeight: 'bold', marginTop: '4px'
          }}
        >
          Save Variable
        </button>
      </div>

      {/* Variable List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {Object.entries(variables).length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: '20px', fontSize: '0.9rem' }}>
            No variables stored.
          </div>
        ) : (
          Object.entries(variables).map(([key, val]) => (
            <div key={key} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              background: '#ffffff05',
              padding: '10px',
              borderRadius: '6px',
              border: '1px solid #222'
            }}>
              <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                <div style={{ fontSize: '0.75rem', color: '#5d00ff', fontWeight: 'bold'}}>{key}</div>
                <div style={{ 
                  fontSize: '0.95rem', 
                  whiteSpace: 'nowrap', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis' 
                }} title={val}>{val}</div>
              </div>
              
              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button 
                  onClick={() => handleEdit(key, val)}
                  style={{ 
                    background: 'transparent', color: '#4da6ff', border: '1px solid #4da6ff33', 
                    padding: '4px 8px', borderRadius: '4px', cursor: 'pointer',
                    fontSize: '0.75rem'
                  }}
                >
                  Edit
                </button>
                <button 
                  onClick={() => handleDelete(key)}
                  style={{ 
                    background: 'transparent', color: '#ff4444', border: '1px solid #ff444433', 
                    padding: '4px 8px', borderRadius: '4px', cursor: 'pointer',
                    fontSize: '0.75rem'
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

if( csGetApplet("Settings") ) {
  csCloseApplet("Settings")
} else {
  csOpenApplet("Settings", SettingsApplet, { position: "sidebar" });
}
```

### AI Assistant

This is an example "AI Assistant" that uses the Gemini API to help you with your terminal. You will need to provide your own API key in the settings.

```tsx
import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

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
  const [view, setView] = useState('chat'); // 'chat' | 'settings'
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Settings State (Initialized from csGetVar)
  const [provider, setProvider] = useState(() => csGetVar('AI_PROVIDER') || 'gemini');
  const [model, setModel] = useState(() => csGetVar('AI_MODEL') || 'gemini-3.1-flash-lite-preview');
  const [apiKey, setApiKey] = useState(() => csGetVar('AI_API_KEY') || '');

  const scrollRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleAsk = async (forcePrompt = null) => {
    const userPrompt = forcePrompt || input || "Analyze the terminal output, diagnose errors, suggest commands or explain what's happening";

    if (!apiKey) {
      csNotify("Please configure API Key in settings.");
      setView('settings');
      return;
    }

    const terminalOutput = csGetTerminalContents();
    if (!terminalOutput) {
      return;
    }
    const systemPrompt = "You are a helpful terminal assistant. You have access to the recent terminal output buffer. Help the user diagnose issues, explain commands, or provide guidance. Keep responses concise and use markdown formatting.";
    
    const newUserMsg = { role: 'user', content: userPrompt };
    setMessages(prev => [...prev, newUserMsg]);
    setInput('');
    setLoading(true);

    try {
      // Build Gemini history
      const history = messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

      // Inject terminal context into the current message
      const currentPrompt = `[TERMINAL OUTPUT START]\n${terminalOutput}\n[TERMINAL OUTPUT END]\n\nUser Question: ${userPrompt}`;
      
      const payload = {
        contents: [
          ...history,
          { role: 'user', parts: [{ text: currentPrompt }] }
        ],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        }
      };

      const response = await csFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || "Unknown API error");
      }

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let assistantMessage = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr.trim() === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.candidates && data.candidates[0].content?.parts?.[0]?.text) {
                assistantMessage += data.candidates[0].content.parts[0].text;
                setMessages(prev => {
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
      setMessages(prev => [...prev, { role: 'assistant', content: "⚠️ Error: " + e.message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleTestAndSave = async () => {
    setLoading(true);
    try {
      // Test the key with a minimal request
      const response = await csFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      // Save to persistent storage
      await csSetVar({
        'AI_PROVIDER': provider,
        'AI_MODEL': model,
        'AI_API_KEY': apiKey
      });
      csNotify("Settings saved!");
      setView('chat');
    } catch (e) {
      csNotify("Test failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const resetSession = () => {
    setMessages([]);
    setInput('');
  };

  // --- Styles ---
  const containerStyle = {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#0f0f0f', color: '#e0e0e0', fontFamily: 'system-ui, -apple-system, sans-serif'
  };

  const headerStyle = {
    padding: '12px 16px', background: '#1a1a1a', borderBottom: '1px solid #333',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  };

  const buttonStyle = {
    background: 'linear-gradient(135deg, #6e8efb, #a777e3)', color: '#fff',
    border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600'
  };

  const inputStyle = {
    width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px',
    padding: '12px', color: '#fff', fontSize: '0.9rem', outline: 'none', resize: 'none'
  };

  // --- Render Views ---

  if (view === 'settings') {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <span style={{ fontWeight: 'bold' }}>AI Settings</span>
          <button onClick={() => setView('chat')} style={{ background: 'none', color: '#888', border: 'none', cursor: 'pointer' }}>Back</button>
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '4px' }}>Provider</label>
            <select value={provider} onChange={e => setProvider(e.target.value)} style={inputStyle}>
              <option value="gemini">Gemini</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '4px' }}>Model</label>
            <select value={model} onChange={e => setModel(e.target.value)} style={inputStyle}>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '4px' }}>API Key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter API Key" style={inputStyle} />
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
        <span style={{ fontWeight: 'bold' }}>{AI_ASSISTANT_NAME}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={resetSession} style={{ background: 'none', color: '#888', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>Reset</button>
          <button onClick={() => setView('settings')} style={{ background: 'none', color: '#888', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>⚙️</button>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: '40px', opacity: 0.5 }}>
            <div style={{ fontSize: '2rem' }}>🤖</div>
            <p>How can I help with your terminal today?</p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%', padding: '10px 14px', borderRadius: '12px',
              background: m.role === 'user' ? '#3b3b3b' : '#252525',
              marginBottom: '10px', fontSize: '0.9rem', border: '1px solid #333',
              overflowX: 'auto'
            }}>
              {m.role === 'user' ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
              ) : (
                <div 
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(m.content)) }} 
                  style={{ 
                    display: 'flex', flexDirection: 'column', gap: '8px' 
                  }}
                />
              )}
            </div>
          ))
        )}
        {loading && <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>AI is thinking...</div>}
      </div>

      <div style={{ padding: '16px', background: '#121212', borderTop: '1px solid #333' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask a question..."
          style={{ ...inputStyle, marginBottom: '8px' }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
        />
        <button onClick={() => handleAsk()} disabled={loading} style={{ ...buttonStyle, width: '100%' }}>
          Ask
        </button>
      </div>
    </div>
  );
};

if( csGetApplet(AI_ASSISTANT_NAME) ) {
  csCloseApplet(AI_ASSISTANT_NAME);
} else {
  csOpenApplet(AI_ASSISTANT_NAME, AIAssistant, { position: 'sidebar' });
}
```
