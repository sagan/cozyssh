import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal, type IMarker } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { ImageAddon } from '@xterm/addon-image';
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { Box } from '@mui/material';
import '@xterm/xterm/css/xterm.css';

import type { WsResizeMsg, WsTerminalMessage } from './api';
import { BROWSER_STORAGE_KEY_TOKEN } from './constants';
import { CS_EVENT_TERMINAL_DISCONNECTED, CS_EVENT_SHELL_INTEGRATION, CS_EVENT_TERMINAL_RESIZE, getIntVar, getKeyCombination, type CommandHistoryEntry, type CSEventDetailShellIntegration, type CSEventDetailTerminalConnected, type CSEventDetailTerminalData, type CSEventDetailTerminalDisconnected, type CSEventDetailTerminalResize, type ShellIntegration, CS_EVENT_TERMINAL_DATA, CS_EVENT_TERMINAL_CONNECTED, CS_EVENT_TERMINAL_NEW, type CSEventDetailTerminalNew } from './common';

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
  findNext: (term: string, searchOptions?: ISearchOptions) => boolean;
  findPrevious: (term: string, searchOptions?: ISearchOptions) => boolean;
  clearSearchDecorations: () => void;
  clearSearchActiveDecoration: () => void;
  getLastCommandOutput: () => string;
  getXterm: () => Terminal | null;
  /** Set the inputMode on the hidden xterm textarea (e.g. 'none' to suppress system keyboard) */
  setInputMode: (mode: string) => void;
}

interface TerminalProps {
  host: string;
  sessionId: string;
  isActive: boolean;
  isCtrlActive?: boolean;
  onCtrlDone?: () => void;
  isAltActive?: boolean;
  onAltDone?: () => void;
  onTerminalFocus: () => void;
  onTerminalBlur: () => void;
  onStateChange?: (state: string) => void;
  onTabStateChange?: (state: { isPinned: boolean, isLocked: boolean }) => void;
  onStolen?: () => void;
  onManualReconnect?: (wasStolen: boolean) => void;
  onCwdChange?: (cwd: string) => void;
  onShellIntegrationChange?: (info: ShellIntegration) => void;
  onDataReceived?: () => void;
  cloneFrom?: string;
  isTouch?: boolean;
  vars: Record<string, string | undefined>;
  localVars: Record<string, string | undefined>;
}

const RECENT_COMMANDS_NUM = 10;

/**
 * These shortcuts should be handled by the terminal / shell itself.
 */
const terminalKeyShortcuts = new Set([
  // TTY / Kernel Signals
  "ctrl+c",  // SIGINT (Kill process)
  "ctrl+d",  // EOF (End of input / Exit)
  "ctrl+q",  // XON (Resume screen output)
  "ctrl+s",  // XOFF (Freeze screen output)
  "ctrl+z",  // SIGTSTP (Suspend process)
  "ctrl+\\", // SIGQUIT (Quit and core dump)

  // Shell / Readline Shortcuts (Emacs Mode) - Navigation
  "ctrl+a",  // Move cursor to beginning of line
  "ctrl+e",  // Move cursor to end of line
  "ctrl+b",  // Move backward one character
  "ctrl+f",  // Move forward one character
  "alt+b",   // Move backward one word
  "alt+f",   // Move forward one word
  "ctrl+x",  // Prefix for chorded commands (e.g., ctrl+x, ctrl+x)

  // Shell / Readline Shortcuts (Emacs Mode) - Editing
  "ctrl+u",  // Cut from cursor to beginning of line
  "ctrl+k",  // Cut from cursor to end of line
  "ctrl+w",  // Cut word before cursor
  "alt+d",   // Cut word after cursor
  "ctrl+y",  // Paste (yank) previously cut text
  "ctrl+t",  // Swap last two characters
  "alt+t",   // Swap current word with previous word
  "ctrl+h",  // Backspace
  "ctrl+l",  // Clear screen and redraw current line

  // Shell / Readline Shortcuts (Emacs Mode) - History & Search
  "ctrl+r",  // Reverse history search
  "ctrl+g",  // Cancel reverse search / current action
  "ctrl+p",  // Fetch previous command (Up)
  "ctrl+n",  // Fetch next command (Down)
  "alt+.",   // Insert last argument of previous command
]);

window.__CS_PASSTHROUGH_SHORTCUTS__ = terminalKeyShortcuts;

const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(({
  host, sessionId, isActive, isCtrlActive, onCtrlDone, isAltActive, onAltDone, onStateChange, onTabStateChange,
  onStolen, onManualReconnect, onCwdChange, onShellIntegrationChange, onDataReceived,
  cloneFrom, isTouch, vars, localVars,
  onTerminalBlur, onTerminalFocus,
}, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctrlRef = useRef(isCtrlActive);
  const altRef = useRef(isAltActive);
  const isActiveRef = useRef(isActive);
  const reconnectFuncRef = useRef<(() => void) | null>(null);
  const forceReconnectRef = useRef(false);
  // Track last known good terminal dimensions so we don't send tiny sizes when hidden
  const lastKnownSizeRef = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
  const shellIntegrationRef = useRef<ShellIntegration>({});
  const markersRef = useRef<{ start?: IMarker, end?: IMarker }>({});

  const updateShellIntegration = (updates: Partial<ShellIntegration>) => {
    shellIntegrationRef.current = { ...shellIntegrationRef.current, ...updates };
    onShellIntegrationChange?.(shellIntegrationRef.current);
    window.dispatchEvent(new CustomEvent(CS_EVENT_SHELL_INTEGRATION, {
      detail: {
        terminal: xtermRef.current!,
        sessionId,
        host,
        is_active_terminal: isActiveRef.current,
        shellIntegration: shellIntegrationRef.current,
      } satisfies CSEventDetailShellIntegration,
    }));
    if (updates.cwd) {
      onCwdChange?.(updates.cwd);
    }
  };

  const unescapeOsc3008 = (s: string): string => {
    return s.replace(/\\x5c/g, '\\').replace(/\\x3b/g, ';');
  };

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const onDataRef = useRef(onDataReceived);
  useEffect(() => {
    onDataRef.current = onDataReceived;
  }, [onDataReceived]);

  useEffect(() => {
    ctrlRef.current = isCtrlActive;
  }, [isCtrlActive]);

  useEffect(() => {
    altRef.current = isAltActive;
  }, [isAltActive]);

  useImperativeHandle(ref, () => ({
    sendData: (data: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        data = data.replace(/\r\n|\r|\n/g, '\n');
        wsRef.current.send(new TextEncoder().encode(data));
      }
    },
    focus: () => {
      xtermRef.current?.focus();
    },
    getSelection: () => {
      return xtermRef.current?.getSelection() || '';
    },
    selectAll: () => {
      xtermRef.current?.selectAll();
    },
    clearSelection: () => {
      xtermRef.current?.clearSelection();
    },
    clear: () => {
      xtermRef.current?.clear();
    },
    reset: () => {
      xtermRef.current?.reset();
    },
    reconnect: () => {
      forceReconnectRef.current = true;
      reconnectFuncRef.current?.();
    },
    scrollLines: (amount: number) => {
      xtermRef.current?.scrollLines(amount);
    },
    scrollToTop: () => {
      xtermRef.current?.scrollToTop();
    },
    scrollToBottom: () => {
      xtermRef.current?.scrollToBottom();
    },
    scrollPages: (amount: number) => {
      xtermRef.current?.scrollPages(amount);
    },
    findNext: (term: string, searchOptions?: ISearchOptions) => {
      return searchAddonRef.current?.findNext(term, searchOptions) || false;
    },
    findPrevious: (term: string, searchOptions?: ISearchOptions) => {
      return searchAddonRef.current?.findPrevious(term, searchOptions) || false;
    },
    clearSearchDecorations: () => {
      searchAddonRef.current?.clearDecorations();
    },
    clearSearchActiveDecoration: () => {
      searchAddonRef.current?.clearActiveDecoration();
    },
    getLastCommandOutput: () => {
      const { start, end } = markersRef.current;
      const buffer = xtermRef.current?.buffer.active;

      if (!buffer || !start || !end || start.isDisposed || end.isDisposed) {
        console.warn('Cannot copy: markers are missing or have scrolled out of the buffer.');
        return "";
      }

      const outputLines: string[] = [];

      // Fix: The start marker is placed exactly where the output begins.
      // The end marker is placed on the line where the new shell prompt is drawn.
      const startLine = start.line;
      const endLine = end.line - 1; // Exclude the new prompt line

      for (let i = startLine; i <= endLine; i++) {
        const line = buffer.getLine(i);
        if (line) {
          // translateToString(true) trims right-side whitespace from the line
          outputLines.push(line.translateToString(true));
        }
      }

      // Remove any trailing empty lines caused by the cursor resting on a new line
      while (outputLines.length > 0 && outputLines[outputLines.length - 1] === '') {
        outputLines.pop();
      }

      const textToCopy = outputLines.join('\n');

      return textToCopy;
    },
    getXterm: () => xtermRef.current,
    setInputMode: (mode: string) => {
      const textarea = xtermRef.current?.textarea;
      if (textarea) (textarea as HTMLTextAreaElement).inputMode = mode;
    },
  }));

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    // Track the webgl addon
    let webglAddon: WebglAddon | null = null;

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#ffffff',
        foreground: '#000000',
        cursor: '#000000',
        cursorAccent: '#ffffff',
        selectionBackground: 'rgba(0, 0, 0, 0.2)'
      },
      fontFamily: 'Consolas, "Courier New", monospace',
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    console.log('Opening xterm for', host, 'on', terminalRef.current);
    term.open(terminalRef.current!);
    xtermRef.current = term;


    const textarea = term.textarea;
    if (textarea) {
      if (getIntVar(vars, localVars, "cs_nocompletions") === 1) {
        textarea.setAttribute('autocomplete', 'off');
        textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('autocapitalize', 'off');
        textarea.setAttribute('spellcheck', 'false');
      }
      textarea.addEventListener("blur", () => {
        onTerminalBlur();
      })
      textarea.addEventListener("focus", () => {
        onTerminalFocus();
      })
    }

    if (getIntVar(vars, localVars, "cs_noimage") !== 1) {
      const imageAddon = new ImageAddon();
      term.loadAddon(imageAddon);
    }
    if (getIntVar(vars, localVars, "cs_noweblinks") !== 1) {
      term.loadAddon(new WebLinksAddon());
    }

    // Load WebGL Addon
    if (getIntVar(vars, localVars, "cs_nowebgl") !== 1) {
      try {
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon?.dispose();
        });
        term.loadAddon(webglAddon);
      } catch (e) {
        console.warn('WebGL addon failed to load, falling back to canvas', e);
      }
    }

    document.fonts.ready.then(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        lastKnownSizeRef.current = { cols: term.cols, rows: term.rows };
      }
    });

    term.parser.registerOscHandler(7, (data) => {
      try {
        let path = '';
        if (data.startsWith('file://')) {
          // Handle standard file://hostname/path
          // Look for the first '/' after file://
          const firstSlash = data.indexOf('/', 7);
          if (firstSlash !== -1) {
            path = data.substring(firstSlash);
          } else {
            path = data.substring(7);
          }
        } else if (data.startsWith('CurrentDir=')) {
          // Support for CurrentDir='/path style sequences
          path = data.substring(11);
        } else if (data.includes('=')) {
          // Fallback for non-standard formats like CWD=/path
          const parts = data.split('=');
          path = parts.slice(1).join('=');
        } else {
          path = data;
        }

        // Final cleaning: remove any surrounding quotes and trim
        path = path.replace(/^['"]+|['"]+$/g, '').trim();

        if (path && (path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path))) {
          updateShellIntegration({ cwd: path });
        }
      } catch (e) {
        console.error('Error parsing OSC 7:', e);
      }
      return true;
    });

    term.parser.registerOscHandler(3008, (data) => {
      try {
        const parts = data.split(';');
        const info: Record<string, string> = {};
        parts.forEach(part => {
          const equalsIdx = part.indexOf('=');
          if (equalsIdx !== -1) {
            const k = part.substring(0, equalsIdx);
            const v = part.substring(equalsIdx + 1);
            info[k] = unescapeOsc3008(v);
          }
        });

        const updates: Partial<ShellIntegration> = {};
        if (info.cwd) {
          updates.cwd = info.cwd;
        }
        if (info.user) {
          updates.user = info.user;
        }
        if (info.hostname) {
          updates.hostname = info.hostname;
        }
        if (info.machineid) {
          updates.machineId = info.machineid;
        }
        if (info.bootid) {
          updates.bootId = info.bootid;
        }
        if (info.pid) {
          updates.pid = info.pid;
        }
        if (info.cmd) {
          updates.command = info.cmd; updates.command = info.cmd;
        }
        if (info.start) {
          const type = info.type || 'shell';
          if (type === 'command') {
            updates.commandId = info.start;
            updates.isExecuting = true;
            // Initialize/Reset command string for new command execution
            updates.command = info.cmd || '';

            // <-- Dispose old markers and set the start marker right before command runs
            markersRef.current.start?.dispose();
            markersRef.current.end?.dispose();
            markersRef.current.start = term.registerMarker(0);

            // Fallback: if no command string provided via OSC, try to read from buffer
            if (!updates.command) {
              const buffer = term.buffer.active;
              // PS0 is usually printed right after the command is submitted.
              // The command is likely on the current or previous line.
              let line = buffer.getLine(buffer.cursorY + buffer.baseY);
              let text = line?.translateToString(true).trim();
              if (!text) {
                line = buffer.getLine(buffer.cursorY + buffer.baseY - 1);
                text = line?.translateToString(true).trim();
              }
              if (text) {
                // Heuristic to strip prompt: find last #, $, or >
                const lastPromptChar = Math.max(text.lastIndexOf('#'), text.lastIndexOf('$'), text.lastIndexOf('>'));
                if (lastPromptChar !== -1) {
                  updates.command = text.substring(lastPromptChar + 1).trim();
                } else {
                  updates.command = text;
                }
              }
            }
          } else if (type === 'shell') {
            updates.shellId = info.start;
            updates.isExecuting = false;
          }
        }

        if (info.end) {
          if (info.end === shellIntegrationRef.current.commandId) {
            updates.isExecuting = false;

            // <-- Set the end marker right after the command finishes, before the new prompt
            markersRef.current.end = term.registerMarker(0);

            const exitStatus = info.status ? parseInt(info.status) : (info.exit === 'success' ? 0 : 1);
            const entry: CommandHistoryEntry = {
              commandId: info.end,
              command: shellIntegrationRef.current.command,
              exitStatus,
              exitSignal: info.signal,
              timestamp: Date.now()
            };

            const oldHistory = shellIntegrationRef.current.recentCommands || [];
            updates.recentCommands = [entry, ...oldHistory].slice(0, RECENT_COMMANDS_NUM);

            updates.exitStatus = exitStatus;
            if (info.signal) {
              updates.exitSignal = info.signal;
            }
          }
        }

        updateShellIntegration(updates);
      } catch (e) {
        console.error('Error parsing OSC 3008:', e);
      }
      return true;
    });

    term.onTitleChange((title) => {
      // Often shells set the window title to the running command.
      // If we are executing, this is likely the command name or full command.
      if (shellIntegrationRef.current.isExecuting) {
        updateShellIntegration({ command: title });
      }
    });

    term.parser.registerOscHandler(633, (data) => {
      try {
        const parts = data.split(';');
        const type = parts[0];
        if (type === 'E' && parts[1]) {
          updateShellIntegration({ command: parts[1] });
        }
      } catch (e) {
        console.error('Error parsing OSC 633:', e);
      }
      return true;
    });

    term.onResize(({ cols, rows }) => {
      window.dispatchEvent(new CustomEvent(CS_EVENT_TERMINAL_RESIZE, {
        detail: {
          terminal: term, cols, rows, sessionId, host, is_active_terminal: isActive
        } satisfies CSEventDetailTerminalResize,
      }));
    });

    // Use ResizeObserver for more reliable fitting
    const resizeObserver = new ResizeObserver(() => {
      if (terminalRef.current && terminalRef.current.offsetWidth > 0) {
        requestAnimationFrame(() => {
          fitAddon.fit();
          // Update last known good size whenever we successfully fit
          lastKnownSizeRef.current = { cols: term.cols, rows: term.rows };
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows } satisfies WsResizeMsg));
          }
        });
      }
    });
    resizeObserver.observe(terminalRef.current);

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Only evaluate on keydown to prevent double-firing
      if (e.type !== 'keydown') {
        return true;
      }
      // Allow all standard typing (including Shift) to pass through to xterm
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        return true;
      }
      const kcomb = getKeyCombination(e);
      if (terminalKeyShortcuts.has(kcomb)) {
        return true;
      }
      return false;
    });



    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const params = new URLSearchParams({
      host,
      sessionId: sessionId || '',
      cloneFrom: cloneFrom || '',
    })

    window.dispatchEvent(new CustomEvent(CS_EVENT_TERMINAL_NEW, {
      detail: {
        terminal: term,
        sessionId,
        host,
        params,
        is_active_terminal: isActive,
      } satisfies CSEventDetailTerminalNew,
    }));

    let wsUrl = `${protocol}//${window.location.host}/api/ws?${params.toString()}`;

    let isDisposed = false;
    let isDead = false;
    let expectingHistory = false;
    let isRestoringHistory = false;
    let deathType: 'fatal' | 'stolen' | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connectWS = () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      clearTimeout(reconnectTimer);

      // Only call fit() if the container is visible (non-zero dimensions).
      // When a tab is inactive (display:none), fit() would calculate a tiny
      // fallback size (e.g. 10x5) which corrupts the remote PTY size.
      const isVisible = terminalRef.current && terminalRef.current.offsetWidth > 0;
      if (isVisible && fitAddonRef.current) {
        fitAddonRef.current.fit();
        lastKnownSizeRef.current = { cols: term.cols, rows: term.rows };
      }

      // Use last known good size when hidden, current size when visible
      const { cols, rows } = isVisible
        ? { cols: term.cols, rows: term.rows }
        : lastKnownSizeRef.current;

      let finalUrl = wsUrl + `&cols=${cols}&rows=${rows}`;
      if (forceReconnectRef.current) {
        finalUrl += '&reconnect=1';
        forceReconnectRef.current = false;
        xtermRef.current?.reset();
      }

      if (isDisposed) {
        return;
      }
      isDead = false;
      deathType = null;
      onStateChange?.('connecting to host');
      const ws = new WebSocket(finalUrl, token ? [token] : undefined);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDisposed) {
          ws.close();
          return;
        }
        // Send initial resize using correct dimensions
        ws.send(JSON.stringify({ type: 'resize', cols, rows } satisfies WsResizeMsg));
        window.dispatchEvent(new CustomEvent(CS_EVENT_TERMINAL_CONNECTED, {
          detail: {
            terminal: term, sessionId, host, is_active_terminal: isActive
          } satisfies CSEventDetailTerminalConnected,
        }));
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const msg = JSON.parse(ev.data) as WsTerminalMessage;
            if (msg.type === 'historyStart') {
              expectingHistory = true;
              return;
            }
            if (msg.type === 'tabState') {
              onTabStateChange?.({ isPinned: msg.isPinned, isLocked: msg.isLocked });
              return;
            }
            if (msg.type === 'state') {
              if (msg.state === 'stolen' || msg.state.includes('(fatal)')) {
                isDisposed = true;
                isDead = true;
                deathType = msg.state === 'stolen' ? 'stolen' : 'fatal';
                ws.close();
                if (msg.state === 'stolen') {
                  term.write('\r\n\x1b[31;1m*** Session stolen (attached by another client) *** (Press Enter to reconnect)\x1b[0m\r\n');
                  onStolen?.();
                } else {
                  term.write(`\r\n\x1b[31;1m*** ${msg.state} *** (Press Enter to reconnect)\x1b[0m\r\n`);
                }
                onStateChange?.(msg.state);
                window.dispatchEvent(new CustomEvent(CS_EVENT_TERMINAL_DISCONNECTED, {
                  detail: {
                    terminal: term, sessionId, host, is_active_terminal: isActive, reason: deathType
                  } satisfies CSEventDetailTerminalDisconnected,
                }));
                return;
              }
              onStateChange?.(msg.state);
              return;
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            // ignore
          }
          if (!isRestoringHistory) {
            onDataRef.current?.();
            window.dispatchEvent(new CustomEvent(CS_EVENT_TERMINAL_DATA, {
              detail: {
                terminal: term, sessionId, host, is_active_terminal: isActive
              } satisfies CSEventDetailTerminalData,
            }));
          }
          term.write(ev.data);
        } else {
          const buffer = new Uint8Array(ev.data);
          if (expectingHistory) {
            expectingHistory = false;
            isRestoringHistory = true;
            term.write(buffer, () => {
              isRestoringHistory = false;
            });
          } else {
            if (!isRestoringHistory) {
              onDataRef.current?.();
              window.dispatchEvent(new CustomEvent(CS_EVENT_TERMINAL_DATA, {
                detail: {
                  terminal: term, sessionId, host, is_active_terminal: isActive
                } satisfies CSEventDetailTerminalData,
              }));
            }
            term.write(buffer);
          }
        }
      };

      ws.onclose = () => {
        if (isDisposed) {
          return;
        }
        onStateChange?.('disconnected to ssh server');
        window.dispatchEvent(new CustomEvent(CS_EVENT_TERMINAL_DISCONNECTED, {
          detail: {
            terminal: term, sessionId, host, is_active_terminal: isActive, reason: 'normal'
          } satisfies CSEventDetailTerminalDisconnected,
        }));
        reconnectTimer = setTimeout(connectWS, 2000);
      };
    };

    reconnectFuncRef.current = connectWS;
    setTimeout(connectWS, 50);

    term.onData((data) => {
      if (isRestoringHistory) {
        return;
      }
      if (isDead && data === '\r') {
        if (deathType === 'stolen') {
          onManualReconnect?.(true);
          return;
        }
        isDead = false;
        deathType = null;
        isDisposed = false;
        term.write('\r\nReconnecting...\r\n');
        connectWS();
        return;
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (ctrlRef.current && data && !data.startsWith('\x1b')) {
          // Mobile IMEs often send composition artifacts. We extract the first valid char.
          // This regex matches a-z, A-Z, and the symbols @, [, \, ], ^, _, ?
          const match = data.match(/[a-zA-Z@[\\\]^_?]/);
          let sent = false;
          let dataToSend = data;
          if (match) {
            const code = match[0].toUpperCase().charCodeAt(0);
            let ctrlCode = String.fromCharCode(code - 64);
            // Special case for Ctrl + ? (often maps to DEL)
            if (match[0] === '?') {
              ctrlCode = '\x7F';
            }
            dataToSend = ctrlCode;
            sent = true;
          } else if (data.includes(' ')) {
            // Handle Ctrl + Space
            dataToSend = '\x00';
            sent = true;
          }
          if (sent) {
            if (altRef.current) {
              ws.send(new TextEncoder().encode('\x1b' + dataToSend));
              onAltDone?.();
            } else {
              ws.send(new TextEncoder().encode(dataToSend));
            }
            onCtrlDone?.();
            return;
          }
          // Optional: Release Ctrl lock if an unmappable key was pressed to avoid getting stuck
          onCtrlDone?.();
        }

        if (altRef.current && data) {
          ws.send(new TextEncoder().encode('\x1b' + data));
          onAltDone?.();
          return;
        }

        ws.send(new TextEncoder().encode(data));
      }
    });

    let selectionTimeout: number;

    term.onSelectionChange(() => {
      if (isTouch) {
        return;
      }

      clearTimeout(selectionTimeout);

      // Wait 200ms after the selection stops changing to copy
      selectionTimeout = setTimeout(() => {
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(err => {
            console.error('Failed to copy text: ', err);
          });
        }
      }, 200);
    });

    const handleContextMenu = (e: MouseEvent) => {
      if (isTouch) {
        return;
      }
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        const ws = wsRef.current;
        if (text && ws && ws.readyState === WebSocket.OPEN) {
          text = text.replace(/\r\n|\r|\n/g, '\n');
          ws.send(new TextEncoder().encode(text));
        }
      }).catch(err => {
        console.error('Failed to read clipboard: ', err);
      });
    };

    const container = terminalRef.current;
    if (container) {
      container.addEventListener('contextmenu', handleContextMenu);
    }

    return () => {
      isDisposed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(selectionTimeout);
      resizeObserver.disconnect();
      if (container) {
        container.removeEventListener('contextmenu', handleContextMenu);
      }
      if (wsRef.current) wsRef.current.close();

      // <-- Dispose of markers
      markersRef.current.start?.dispose();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      markersRef.current.end?.dispose();

      // Explicitly kill the WebGL addon first
      if (webglAddon) {
        try {
          webglAddon.dispose();
        } catch (e) {
          console.warn('Error disposing WebGL addon', e);
        }
      }

      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, sessionId]);

  // Execute focus and fit firmly when becoming active or mounted
  useEffect(() => {
    if (xtermRef.current && terminalRef.current) {
      setTimeout(() => {
        if (isActive) {
          xtermRef.current?.focus();
        }
        // Force fit and update server with correct size (critical after reconnecting while hidden)
        if (fitAddonRef.current && terminalRef.current && terminalRef.current.offsetWidth > 0) {
          fitAddonRef.current.fit();
          const cols = xtermRef.current?.cols || 80;
          const rows = xtermRef.current?.rows || 24;
          lastKnownSizeRef.current = { cols, rows };
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols, rows } satisfies WsResizeMsg));
          }
        }
      }, 100);
    }
  }, [isActive]);

  return <Box className="terminal-pane" ref={terminalRef} sx={{ width: '100%', height: '100%', overflow: 'hidden' }} />;
});

export default TerminalComponent;
