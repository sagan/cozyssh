import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Box } from '@mui/material';

export interface TerminalHandle {
  sendData: (data: string) => void;
  focus: () => void;
}

interface TerminalProps {
  host: string;
  sessionId?: string;
  isActive?: boolean;
  isCtrlActive?: boolean;
  onCtrlDone?: () => void;
  onStateChange?: (state: string) => void;
  onStolen?: () => void;
}

const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(({ host, sessionId, isActive, isCtrlActive, onCtrlDone, onStateChange, onStolen }, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctrlRef = useRef(isCtrlActive);

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
    }
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

    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'j' || e.key === 'k' || e.key === 'J' || e.key === 'K' || e.key === 'w' || e.key === 'W' || e.key === 't' || e.key === 'T')) {
        return false; 
      }
      return true;
    });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('cozy_token');
    const wsUrl = `${protocol}//${window.location.host}/api/ws?host=${encodeURIComponent(host)}&sessionId=${encodeURIComponent(sessionId || '')}&token=${encodeURIComponent(token || '')}`;
    
    let isDisposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connectWS = () => {
      if (isDisposed) return;
      onStateChange?.('connecting to host');
      const ws = new WebSocket(wsUrl);
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
            if (msg.type === 'state') {
              if (msg.state === 'stolen' || msg.state.includes('(fatal)')) {
                isDisposed = true;
                ws.close();
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
          term.write(ev.data);
        } else {
          term.write(new Uint8Array(ev.data));
        }
      };

      ws.onclose = () => {
        if (isDisposed) return;
        onStateChange?.('disconnected to ssh server');
        reconnectTimer = setTimeout(connectWS, 2000);
      };
    };

    connectWS();

    term.onData((data) => {
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
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(err => {
          console.error('Failed to copy text: ', err);
        });
      }
    });

    const handleContextMenu = (e: MouseEvent) => {
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

    const handleResize = () => {
      if (!isActive) return;
      fitAddon.fit();
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      isDisposed = true;
      clearTimeout(reconnectTimer);
      window.removeEventListener('resize', handleResize);
      if (container) {
        container.removeEventListener('contextmenu', handleContextMenu);
      }
      if (wsRef.current) wsRef.current.close();
      term.dispose();
    };
  }, [host]);

  // Execute focus hook firmly AFTER initialization hook to prevent null-ref on first mount explicitly
  useEffect(() => {
    if (isActive && xtermRef.current) {
      setTimeout(() => {
        xtermRef.current?.focus();
        // Force fit when becoming active
        const fitAddon = new FitAddon();
        xtermRef.current?.loadAddon(fitAddon);
        fitAddon.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: xtermRef.current?.cols, rows: xtermRef.current?.rows }));
        }
      }, 50);
    }
  }, [isActive]);

  return <Box ref={terminalRef} sx={{ width: '100%', height: '100%', overflow: 'hidden' }} />;
});

export default TerminalComponent;
