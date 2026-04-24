import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Box } from '@mui/material';

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
  getXterm: () => Terminal | null;
}

interface TerminalProps {
  host: string;
  sessionId?: string;
  isActive?: boolean;
  isCtrlActive?: boolean;
  onCtrlDone?: () => void;
  onStateChange?: (state: string) => void;
  onStolen?: () => void;
  onManualReconnect?: (wasStolen: boolean) => void;
  onCwdChange?: (cwd: string) => void;
  onDataReceived?: () => void;
  cloneFrom?: string;
  isTouch?: boolean;
}

const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(({ host, sessionId, isActive, isCtrlActive, onCtrlDone, onStateChange, onStolen, onManualReconnect, onCwdChange, onDataReceived, cloneFrom, isTouch }, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctrlRef = useRef(isCtrlActive);
  const reconnectFuncRef = useRef<(() => void) | null>(null);
  const forceReconnectRef = useRef(false);

  const onDataRef = useRef(onDataReceived);
  useEffect(() => {
    onDataRef.current = onDataReceived;
  }, [onDataReceived]);

  useEffect(() => {
    ctrlRef.current = isCtrlActive;
  }, [isCtrlActive]);

  useImperativeHandle(ref, () => ({
    sendData: (data: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
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
    getXterm: () => xtermRef.current
  }));

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#ffffff',
        foreground: '#000000',
        cursor: '#000000',
        selectionBackground: 'rgba(0, 0, 0, 0.2)'
      },
      fontFamily: 'Consolas, "Courier New", monospace',
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    term.open(terminalRef.current);
    xtermRef.current = term;

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
          onCwdChange?.(path);
        }
      } catch (e) {
        console.error('Error parsing OSC 7:', e);
      }
      return true;
    });

    // Use ResizeObserver for more reliable fitting
    const resizeObserver = new ResizeObserver(() => {
      if (terminalRef.current && terminalRef.current.offsetWidth > 0) {
        requestAnimationFrame(() => {
          fitAddon.fit();
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        });
      }
    });
    resizeObserver.observe(terminalRef.current);

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'j' || e.key === 'k' || e.key === 'i' || e.key === 'g' || e.key === 'J' || e.key === 'K' || e.key === 'I' || e.key === 'G' || e.key === 'w' || e.key === 'W' || e.key === 't' || e.key === 'T' || (e.key >= '0' && e.key <= '9') || (e.shiftKey && e.code.startsWith('Digit')) || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return false;
      }
      return true;
    });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('cozy_token');
    let wsUrl = `${protocol}//${window.location.host}/api/ws?host=${encodeURIComponent(host)}&sessionId=${encodeURIComponent(sessionId || '')}&token=${encodeURIComponent(token || '')}`;
    if (cloneFrom) {
      wsUrl += `&cloneFrom=${encodeURIComponent(cloneFrom)}`;
    }

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

      let finalUrl = wsUrl;
      if (forceReconnectRef.current) {
        finalUrl += '&reconnect=true';
        forceReconnectRef.current = false;
        xtermRef.current?.reset();
      }

      if (isDisposed) return;
      isDead = false;
      deathType = null;
      onStateChange?.('connecting to host');
      const ws = new WebSocket(finalUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDisposed) { ws.close(); return; }
        // Send initial resize
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'history_start') {
              expectingHistory = true;
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
                } else {
                  term.write(`\r\n\x1b[31;1m*** ${msg.state} *** (Press Enter to reconnect)\x1b[0m\r\n`);
                }
                onStateChange?.(msg.state);
                if (msg.state === 'stolen') onStolen?.();
                return;
              }
              onStateChange?.(msg.state);
              return;
            }
          } catch (e) {
            // ignore
          }
          if (!isRestoringHistory) onDataRef.current?.();
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
            if (!isRestoringHistory) onDataRef.current?.();
            term.write(buffer);
          }
        }
      };

      ws.onclose = () => {
        if (isDisposed) return;
        onStateChange?.('disconnected to ssh server');
        reconnectTimer = setTimeout(connectWS, 2000);
      };
    };

    reconnectFuncRef.current = connectWS;
    connectWS();

    term.onData((data) => {
      if (isRestoringHistory) return;
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
        if (ctrlRef.current && data.length === 1) {
          const code = data.toUpperCase().charCodeAt(0);
          if (code >= 64 && code <= 90) { // @ to Z
            const ctrlCode = String.fromCharCode(code - 64);
            ws.send(new TextEncoder().encode(ctrlCode));
            onCtrlDone?.();
            return;
          }
        }
        ws.send(new TextEncoder().encode(data));
      }
    });

    term.onSelectionChange(() => {
      if (isTouch) return;
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(err => {
          console.error('Failed to copy text: ', err);
        });
      }
    });

    const handleContextMenu = (e: MouseEvent) => {
      if (isTouch) return;
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        const ws = wsRef.current;
        if (text && ws && ws.readyState === WebSocket.OPEN) {
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
      resizeObserver.disconnect();
      if (container) {
        container.removeEventListener('contextmenu', handleContextMenu);
      }
      if (wsRef.current) wsRef.current.close();
      term.dispose();
    };
  }, [host, sessionId]);

  // Execute focus and fit firmly when becoming active or mounted
  useEffect(() => {
    if (xtermRef.current && terminalRef.current) {
      setTimeout(() => {
        if (isActive) xtermRef.current?.focus();
        // Force fit
        if (fitAddonRef.current && terminalRef.current && terminalRef.current.offsetWidth > 0) {
          fitAddonRef.current.fit();
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: xtermRef.current?.cols, rows: xtermRef.current?.rows }));
          }
        }
      }, 100);
    }
  }, [isActive]);

  return <Box ref={terminalRef} sx={{ width: '100%', height: '100%', overflow: 'hidden' }} />;
});

export default TerminalComponent;
