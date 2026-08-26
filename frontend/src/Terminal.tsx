import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { Terminal, type IMarker, type IDecoration, type ITerminalAddon } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { ImageAddon } from "@xterm/addon-image";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import { type ISearchOptions, SearchAddon } from "@xterm/addon-search";
import { Box } from "@mui/material";
import "@xterm/xterm/css/xterm.css";

export const DECORATION_COLOR_RUNNING = "rgba(160, 160, 160, 0.8)";
export const DECORATION_COLOR_SUCCESS = "#388bfd";
export const DECORATION_COLOR_FAILURE = "#f85149";

interface CommandDecorationEntry {
  marker: IMarker;
  runningDecoration?: IDecoration;
  finalDecoration?: IDecoration;
  commandId?: string;
  isExecuting: boolean;
}

import type { WsResizeMsg, WsTerminalMessage } from "./api";
import {
  BROWSER_STORAGE_KEY_TOKEN,
  DEFAULT_TERMINAL_RECENT_COMMANDS,
  TAG_FLAG_ENV,
  TAG_FLAG_PREFIX,
  TAG_FLAG_SHELL_INTEGRATION,
  TOAST_KEY_TERMINAL,
  VAR_CS_NOIMAGE,
  VAR_CS_NOMODTEXTAREA,
  VAR_CS_NOWEBGL,
  VAR_CS_NOWEBLINKS,
  VAR_CS_NO_PASTE_ON_CONTEXTMENU,
  VAR_CS_NO_SELECT_TO_COPY,
  VAR_CS_TERMINAL_RECENT_COMMANDS,
  WS_PROTOCOL_DUMMY,
  WS_PROTOCOL_IDENTITY_PREFIX,
  WS_PROTOCOL_QUERY_PREFIX,
} from "./constants";
import {
  type CommandHistoryEntry,
  type CSEventDetailShellIntegration,
  type CSEventDetailTerminalConnected,
  type CSEventDetailTerminalData,
  type CSEventDetailTerminalDisconnected,
  type CSEventDetailTerminalResize,
  type ShellIntegration,
  type CSEventDetailTerminalNew,
  CS_EVENT_TERMINAL_DATA,
  CS_EVENT_TERMINAL_CONNECTED,
  CS_EVENT_TERMINAL_NEW,
  CS_EVENT_TERMINAL_DISCONNECTED,
  CS_EVENT_SHELL_INTEGRATION,
  CS_EVENT_TERMINAL_RESIZE,
  getKeyCombination,
  base64urlEncode,
  passthroughKeyShortcuts,
  DefaultXtermOptions,
  applyFilters,
  appShortcuts,
  systemShortcuts,
  disableShortcuts,
  blackholeShortcuts,
  terminalClientSideParams,
  t,
} from "./common";
import { type PaneData, notify, getIntVar, getTerminalContents } from "./store";
import { patchAndroidSoftKeyboardInput } from "./xtermInternals";
import { MarkModeManager } from "./markMode";

export type TerminalMarkers = {
  /**
   * Last command output start
   */
  $start?: IMarker;
  /**
   * Last command output end
   */
  $end?: IMarker;
  /**
   * Last position a clear screen (Ctrl + L) is sent
   */
  $lastClear?: IMarker;
  /**
   * Custom / dynamic markers
   */
  [key: string]: IMarker | undefined;
};

export interface TerminalHandle {
  sendData: (data: string | BufferSource | Blob) => void;
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
  fit: () => void;
  /**
   * Return registered xterm.js Terminal instance markers.
   * It always returns the same object during the lifespan of the terminal.
   * It's OK to manually register new marker (using xterm.js API) and add it to the returned object.
   */
  getMarkers: () => TerminalMarkers | null;
  getBuffer: (start?: IMarker, end?: IMarker) => string;
  getXterm: () => Terminal | null;
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
  getAddon(): Record<string, ITerminalAddon>;
  getAddon(name: string): ITerminalAddon | undefined;
  enterMarkMode: () => void;
  exitMarkMode: () => void;
  toggleMarkMode: () => void;
  isMarkMode: () => boolean;
}

interface TerminalProps {
  host: string;
  options?: Record<string, string>;
  sessionId: string;
  isActive: boolean;
  isCtrlActive: boolean;
  onCtrlDone: () => void;
  isAltActive: boolean;
  onAltDone: () => void;
  onTerminalFocus: () => void;
  onTerminalBlur: () => void;
  onStateChange: (state: PaneData["state"]) => void;
  onTabStateChange: (state: { isPinned: boolean; isLocked: boolean }) => void;
  onStolen: () => void;
  onManualReconnect: (wasStolen: boolean) => void;
  onShellIntegrationChange: (info: ShellIntegration) => void;
  onDataReceived: () => void;
  cloneFrom?: string;
}

const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(
  (
    {
      host,
      options,
      sessionId,
      isActive,
      isCtrlActive,
      onCtrlDone,
      isAltActive,
      onAltDone,
      onStateChange,
      onTabStateChange,
      onStolen,
      onManualReconnect,
      onShellIntegrationChange,
      onDataReceived,
      cloneFrom,
      onTerminalBlur,
      onTerminalFocus,
    },
    ref,
  ) => {
    const addons = useRef<Record<string, ITerminalAddon>>({});
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const serializeAddonRef = useRef<SerializeAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const ctrlRef = useRef(isCtrlActive);
    const altRef = useRef(isAltActive);
    const isActiveRef = useRef(isActive);
    const reconnectFuncRef = useRef<(() => void) | null>(null);
    const forceReconnectRef = useRef(false);
    const shellIntegrationRef = useRef<ShellIntegration>({});
    const markersRef = useRef<TerminalMarkers>({});
    const markModeRef = useRef<MarkModeManager | null>(null);

    const activeCmdDecorationRef = useRef<CommandDecorationEntry | null>(null);
    const commandDecorationsRef = useRef<CommandDecorationEntry[]>([]);

    const handleCommandStartDecoration = useCallback((commandId?: string) => {
      const term = xtermRef.current;
      if (!term) return;

      const currentLine = term.buffer.active.cursorY + term.buffer.active.baseY;
      if (activeCmdDecorationRef.current && activeCmdDecorationRef.current.isExecuting) {
        if (activeCmdDecorationRef.current.marker.line === currentLine) {
          if (commandId) activeCmdDecorationRef.current.commandId = commandId;
          return;
        }
      }

      const marker = term.registerMarker(0);
      if (!marker || marker.isDisposed) return;

      const runningDecoration = term.registerDecoration({
        marker,
        overviewRulerOptions: {
          color: DECORATION_COLOR_RUNNING,
          position: "full",
        },
      });

      const entry: CommandDecorationEntry = {
        marker,
        runningDecoration,
        commandId,
        isExecuting: true,
      };

      activeCmdDecorationRef.current = entry;
      commandDecorationsRef.current.push(entry);

      marker.onDispose(() => {
        const idx = commandDecorationsRef.current.indexOf(entry);
        if (idx !== -1) {
          commandDecorationsRef.current.splice(idx, 1);
        }
        if (activeCmdDecorationRef.current === entry) {
          activeCmdDecorationRef.current = null;
        }
      });
    }, []);

    const handleCommandFinishedDecoration = useCallback((exitStatus?: number, commandId?: string) => {
      const term = xtermRef.current;
      if (!term) return;

      const status = exitStatus ?? 0;
      const finalColor = status === 0 ? DECORATION_COLOR_SUCCESS : DECORATION_COLOR_FAILURE;

      let entry = activeCmdDecorationRef.current;
      if (!entry || !entry.isExecuting) {
        if (commandId) {
          entry = commandDecorationsRef.current.find((e) => e.commandId === commandId && e.isExecuting) || null;
        }
      }

      if (entry) {
        entry.isExecuting = false;
        entry.runningDecoration?.dispose();
        entry.runningDecoration = undefined;

        if (!entry.marker.isDisposed) {
          entry.finalDecoration = term.registerDecoration({
            marker: entry.marker,
            overviewRulerOptions: {
              color: finalColor,
              position: "full",
            },
          });
        }

        if (activeCmdDecorationRef.current === entry) {
          activeCmdDecorationRef.current = null;
        }
      } else {
        const marker = term.registerMarker(0);
        if (marker && !marker.isDisposed) {
          const finalDecoration = term.registerDecoration({
            marker,
            overviewRulerOptions: {
              color: finalColor,
              position: "full",
            },
          });
          const newEntry: CommandDecorationEntry = {
            marker,
            finalDecoration,
            commandId,
            isExecuting: false,
          };
          commandDecorationsRef.current.push(newEntry);
          marker.onDispose(() => {
            const idx = commandDecorationsRef.current.indexOf(newEntry);
            if (idx !== -1) {
              commandDecorationsRef.current.splice(idx, 1);
            }
          });
        }
      }
    }, []);

    const clearCommandDecorations = useCallback(() => {
      for (const entry of commandDecorationsRef.current) {
        entry.runningDecoration?.dispose();
        entry.finalDecoration?.dispose();
        entry.marker.dispose();
      }
      commandDecorationsRef.current = [];
      activeCmdDecorationRef.current = null;
    }, []);

    /**
     * Cursor position recorded at OSC 133;B (right after the prompt, where user
     * input starts). Used to extract the live cmdline from the xterm buffer.
     */
    const promptEndRef = useRef<{ col: number; absLine: number } | null>(null);

    const updateShellIntegration = (updates: Partial<ShellIntegration>) => {
      shellIntegrationRef.current = { ...shellIntegrationRef.current, ...updates };
      onShellIntegrationChange?.(shellIntegrationRef.current);
      window.dispatchEvent(
        new CustomEvent(CS_EVENT_SHELL_INTEGRATION, {
          detail: {
            terminal: xtermRef.current!,
            sessionId,
            host,
            is_active_terminal: isActiveRef.current,
            shellIntegration: shellIntegrationRef.current,
          } satisfies CSEventDetailShellIntegration,
        }),
      );
    };

    const unescapeOsc3008 = (s: string): string =>
      s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

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

    const fit = useCallback(() => {
      if (!xtermRef.current) {
        return;
      }
      fitAddonRef.current?.fit();
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows,
          } satisfies WsResizeMsg),
        );
      }
    }, []);

    const getBuffer = useCallback((start?: IMarker, end?: IMarker) => {
      if (!xtermRef.current) {
        return "";
      }
      if (!start && !end) {
        const rawOutput = serializeAddonRef.current?.serialize() || "";
        // 1. Strips OSC sequences: \x1b\] ... (\x07 or \x1b\\)
        // 2. Strips CSI sequences (like [?2004h): \x1b\[ [\d;?]* [a-zA-Z]
        const cleanText = rawOutput
          // eslint-disable-next-line no-control-regex
          .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
          // eslint-disable-next-line no-control-regex
          .replace(/\x1b\[[\d;?]*[a-zA-Z]/g, "");
        return cleanText.trimEnd();
      }
      return getTerminalContents(xtermRef.current, start, end);
    }, []);

    useImperativeHandle(ref, () => ({
      sendData: (data: string | BufferSource | Blob) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          if (typeof data === "string") {
            // PTY input expects \r as Enter / new line
            data = data.replace(/\r?\n|\r/g, "\r");
            data = new TextEncoder().encode(data);
          }
          wsRef.current.send(data);
        }
      },
      focus: () => {
        xtermRef.current?.focus();
      },
      getSelection: () => {
        return xtermRef.current?.getSelection() || "";
      },
      selectAll: () => {
        xtermRef.current?.selectAll();
      },
      clearSelection: () => {
        xtermRef.current?.clearSelection();
      },
      clear: () => {
        markModeRef.current?.exit();
        clearCommandDecorations();
        xtermRef.current?.clear();
      },
      reset: () => {
        markModeRef.current?.exit();
        clearCommandDecorations();
        xtermRef.current?.reset();
      },
      reconnect: () => {
        markModeRef.current?.exit();
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
      fit,
      getMarkers: () => markersRef.current,
      getBuffer,
      getXterm: () => xtermRef.current,
      setInputMode: (mode: string) => {
        const textarea = xtermRef.current?.textarea;
        if (textarea) {
          textarea.inputMode = mode;
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAddon: (name?: string): any => {
        return name ? addons.current[name] : addons.current;
      },
      replaceCmdLine: (newText: string) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          // \x05 = Ctrl+E  - move cursor to end of line (no-op if already there)
          // \x15 = Ctrl+U  - kill from cursor to start of line (readline unix-line-discard)
          // newText        - the replacement command text to type
          ws.send(new TextEncoder().encode("\x05\x15" + newText));
        }
      },
      enterMarkMode: () => {
        markModeRef.current?.enter();
      },
      exitMarkMode: () => {
        markModeRef.current?.exit();
      },
      toggleMarkMode: () => {
        markModeRef.current?.toggle();
      },
      isMarkMode: () => {
        return markModeRef.current?.isActive || false;
      },
    }));

    useEffect(() => {
      if (!terminalRef.current) {
        return;
      }

      // Track the webgl addon
      let webglAddon: WebglAddon | null = null;

      const termOptions = {
        ...DefaultXtermOptions,
        ...__CS_TERMINAL_OPTIONS__,
        scrollbar: {
          width: 14,
          ...DefaultXtermOptions.scrollbar,
          ...__CS_TERMINAL_OPTIONS__?.scrollbar,
        },
      };
      const term = new Terminal(termOptions);
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      fitAddonRef.current = fitAddon;
      addons.current.fitAddon = fitAddon;

      const serializeAddon = new SerializeAddon();
      term.loadAddon(serializeAddon);
      serializeAddonRef.current = serializeAddon;
      addons.current.serializeAddon = serializeAddon;

      const searchAddon = new SearchAddon();
      term.loadAddon(searchAddon);
      searchAddonRef.current = searchAddon;
      addons.current.searchAddon = searchAddon;

      term.open(terminalRef.current!);
      xtermRef.current = term;

      const markMode = new MarkModeManager(term, terminalRef.current!);
      markModeRef.current = markMode;

      const textarea = term.textarea;
      if (textarea) {
        // Workaround for https://github.com/xtermjs/xterm.js/issues/3600
        if (getIntVar(VAR_CS_NOMODTEXTAREA) !== 1) {
          patchAndroidSoftKeyboardInput(term);
        }
        textarea.addEventListener("blur", (ev) => {
          // When the Android soft-keyboard patch is active, it redirects focus
          // from the textarea to a hidden proxy <input>.  That redirect fires
          // a blur on the textarea, but the terminal is still logically
          // focused — so don't propagate the blur to the UI layer (which would
          // e.g. close the MobileInputBar's extra-keys panel).
          const related = (ev as FocusEvent).relatedTarget;
          if (related instanceof HTMLElement && related.classList.contains("kolu-android-keyboard-input")) {
            return;
          }
          onTerminalBlur();
        });
        textarea.addEventListener("focus", () => {
          onTerminalFocus();
        });

        // When the Android patch is active, the real focus target is the
        // hidden proxy <input>.  Wire up its blur so that onTerminalBlur
        // fires when focus genuinely leaves the terminal (not when focus
        // just bounces back to the textarea).
        const androidProxy = textarea.parentElement?.querySelector<HTMLInputElement>(".kolu-android-keyboard-input");
        if (androidProxy) {
          androidProxy.addEventListener("blur", (ev) => {
            const related = (ev as FocusEvent).relatedTarget;
            if (related === textarea) return; // focus returning to textarea — not a real blur
            // When inputMode is "none" the MobileInputBar is intentionally
            // suppressing the keyboard (extra-keys panel open).  The proxy
            // blur is from the MutationObserver calling input.blur(), not
            // from the user moving focus away.
            if (textarea.inputMode === "none") return;
            onTerminalBlur();
          });
        }
      }

      if (getIntVar(VAR_CS_NOIMAGE) !== 1) {
        const imageAddon = new ImageAddon();
        term.loadAddon(imageAddon);
        addons.current.imageAddon = imageAddon;
      }
      if (getIntVar(VAR_CS_NOWEBLINKS) !== 1) {
        const webLinksAddon = new WebLinksAddon();
        term.loadAddon(webLinksAddon);
        addons.current.webLinksAddon = webLinksAddon;
      }

      // Load WebGL Addon
      if (getIntVar(VAR_CS_NOWEBGL) !== 1) {
        try {
          webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            webglAddon?.dispose();
          });
          term.loadAddon(webglAddon);
          addons.current.webglAddon = webglAddon;
        } catch (e) {
          console.warn("WebGL addon failed to load, falling back to canvas", e);
        }
      }

      document.fonts.ready.then(fit);

      term.parser.registerOscHandler(7, (data) => {
        try {
          let path = "";
          if (data.startsWith("file://")) {
            // Handle standard file://hostname/path
            // Look for the first '/' after file://
            const firstSlash = data.indexOf("/", 7);
            if (firstSlash !== -1) {
              path = data.substring(firstSlash);
            } else {
              path = data.substring(7);
            }
          } else if (data.startsWith("CurrentDir=")) {
            // Support for CurrentDir='/path style sequences
            path = data.substring(11);
          } else if (data.includes("=")) {
            // Fallback for non-standard formats like CWD=/path
            const parts = data.split("=");
            path = parts.slice(1).join("=");
          } else {
            path = data;
          }

          // Final cleaning: remove any surrounding quotes and trim
          path = path.replace(/^['"]+|['"]+$/g, "").trim();

          if (path && (path.startsWith("/") || path.includes("\\") || /^[a-zA-Z]:/.test(path))) {
            updateShellIntegration({ cwd: path });
          }
        } catch (e) {
          console.error("Error parsing OSC 7:", e);
        }
        return true;
      });

      term.parser.registerOscHandler(3008, (data) => {
        try {
          const parts = data.split(";");
          const info: Record<string, string> = {};
          parts.forEach((part) => {
            const equalsIdx = part.indexOf("=");
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
            updates.command = info.cmd;
          }
          if (info.start) {
            const type = info.type || "shell";
            if (type === "command") {
              updates.commandId = info.start;
              updates.isExecuting = true;
              updates.executingStartTime = Date.now();
              updates.promptPhase = "output";
              updates.currentCmdLine = undefined;
              promptEndRef.current = null;

              // Initialize/Reset command string for new command execution
              updates.command = info.cmd || "";

              // <-- Dispose old markers and set the start marker right before command runs
              markersRef.current.$start?.dispose();
              markersRef.current.$end?.dispose();
              markersRef.current.$start = term.registerMarker(0);

              handleCommandStartDecoration(info.start);

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
                  const lastPromptChar = Math.max(text.lastIndexOf("#"), text.lastIndexOf("$"), text.lastIndexOf(">"));
                  if (lastPromptChar !== -1) {
                    updates.command = text.substring(lastPromptChar + 1).trim();
                  } else {
                    updates.command = text;
                  }
                }
              }
            } else if (type === "shell") {
              updates.shellId = info.start;
              updates.isExecuting = false;
              // Shell is back at the prompt. Activate live cmdline tracking.
              // OSC 3008 with type=shell is emitted once the prompt is drawn,
              // corresponding to OSC 133 prompt lifecycle phase B ("input").
              updates.promptPhase = "input";
              updates.currentCmdLine = "";
              // Capture cursor position as fallback anchor for readCurrentCmdLine().
              // OSC 3008 has no explicit "prompt-end" marker (unlike OSC 133;B), so
              // we record the cursor right now — it sits at the start of user-input
              // area once the prompt finishes drawing, which is when this OSC fires.
              const buf = term.buffer.active;
              promptEndRef.current = {
                col: buf.cursorX,
                absLine: buf.cursorY + buf.baseY,
              };
            }
          }

          if (info.end) {
            if (info.end === shellIntegrationRef.current.commandId) {
              updates.isExecuting = false;
              updates.promptPhase = "finished";
              updates.currentCmdLine = undefined;
              promptEndRef.current = null;

              // <-- Set the end marker right after the command finishes, before the new prompt
              markersRef.current.$end = term.registerMarker(0);

              const exitStatus = info.status ? parseInt(info.status) : info.exit === "success" ? 0 : 1;
              handleCommandFinishedDecoration(exitStatus, info.end);
              const entry: CommandHistoryEntry = {
                commandId: info.end,
                command: shellIntegrationRef.current.command,
                exitStatus,
                exitSignal: info.signal,
                timestamp: Date.now(),
              };

              const oldHistory = shellIntegrationRef.current.recentCommands || [];
              updates.recentCommands = [entry, ...oldHistory].slice(
                0,
                getIntVar(VAR_CS_TERMINAL_RECENT_COMMANDS, DEFAULT_TERMINAL_RECENT_COMMANDS),
              );

              updates.exitStatus = exitStatus;
              if (info.signal) {
                updates.exitSignal = info.signal;
              }
            }
          }

          updateShellIntegration(updates);
        } catch (e) {
          console.error("Error parsing OSC 3008:", e);
        }
        return true;
      });

      term.onTitleChange((title) => {
        // Often shells set the window title to the running command.
        // If we are executing, this is likely the command name or full command.
        const titleUpdates: Partial<ShellIntegration> = { windowTitle: title };
        if (shellIntegrationRef.current.isExecuting) {
          titleUpdates.command = title;
        }
        updateShellIntegration(titleUpdates);
      });

      // -------------------------------------------------------------------------
      // OSC 633 - VS Code shell integration (superset of OSC 133)
      //
      //   OSC 633 ; A ST           - Prompt start  (same as OSC 133;A)
      //   OSC 633 ; B ST           - Command start (same as OSC 133;B)
      //   OSC 633 ; C ST           - Output start  (same as OSC 133;C)
      //   OSC 633 ; D [; exitCode] - Command done  (same as OSC 133;D)
      //   OSC 633 ; E ; cmd [; nonce] - Command text (VS Code specific)
      //   OSC 633 ; P ; key=value  - Property (e.g. Cwd=, IsWindows=, Prompt=)
      // -------------------------------------------------------------------------
      // -----------------------------------------------------------------------
      // Helper: decode the \xHH hex-escaping used by VS Code shell integration
      // scripts (__VSCode-Escape-Value / __vsc_escape_value).
      //
      // The scripts escape: control chars (0x00-0x1f), backslash (0x5c),
      // semicolons (0x3b), and newlines as \x<hex> sequences.  Without decoding,
      // Windows paths like C:\Users\root appear as C:\x5cUsers\x5croot.
      // -----------------------------------------------------------------------
      const decodeVscodeOscValue = (s: string): string =>
        s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

      term.parser.registerOscHandler(633, (data) => {
        try {
          const parts = data.split(";");
          const type = parts[0];

          if (type === "A") {
            // Prompt start — shell is idle, new prompt being drawn
            updateShellIntegration({ promptPhase: "prompt", isExecuting: false });
          } else if (type === "B") {
            // Command input starting — cursor is right after the prompt
            const buf = term.buffer.active;
            promptEndRef.current = {
              col: buf.cursorX,
              absLine: buf.cursorY + buf.baseY,
            };
            updateShellIntegration({ promptPhase: "input" });
            handleCommandStartDecoration(shellIntegrationRef.current.commandId);
          } else if (type === "C") {
            // Output starting — command is now running
            markersRef.current.$start?.dispose();
            markersRef.current.$end?.dispose();
            markersRef.current.$start = term.registerMarker(0);
            promptEndRef.current = null;
            updateShellIntegration({ promptPhase: "output", isExecuting: true, currentCmdLine: undefined });
            handleCommandStartDecoration(shellIntegrationRef.current.commandId);
          } else if (type === "D") {
            // Command finished — optional exit code in parts[1]
            const exitCodeStr = parts[1];
            const exitStatus = exitCodeStr !== undefined && exitCodeStr !== "" ? parseInt(exitCodeStr, 10) : undefined;

            markersRef.current.$end = term.registerMarker(0);
            handleCommandFinishedDecoration(exitStatus, shellIntegrationRef.current.commandId);

            const updates: Partial<ShellIntegration> = {
              promptPhase: "finished",
              isExecuting: false,
            };

            if (exitStatus !== undefined && !isNaN(exitStatus)) {
              updates.exitStatus = exitStatus;

              const entry: CommandHistoryEntry = {
                commandId: shellIntegrationRef.current.commandId || String(Date.now()),
                command: shellIntegrationRef.current.command,
                exitStatus,
                timestamp: Date.now(),
              };
              const oldHistory = shellIntegrationRef.current.recentCommands || [];
              updates.recentCommands = [entry, ...oldHistory].slice(
                0,
                getIntVar(VAR_CS_TERMINAL_RECENT_COMMANDS, DEFAULT_TERMINAL_RECENT_COMMANDS),
              );
            }

            promptEndRef.current = null;
            updateShellIntegration(updates);
          } else if (type === "E" && parts[1]) {
            // Command text — parts[1] is the command (escaped), parts[2] is an optional nonce (ignored)
            const command = decodeVscodeOscValue(parts[1]);
            if (!command.startsWith("__systemd_osc_context_")) {
              updateShellIntegration({ command });
            }
          } else if (type === "P" && parts[1]) {
            // Property — key=value pairs (Cwd, IsWindows, Prompt, HasRichCommandDetection, …)
            const eqIdx = parts[1].indexOf("=");
            if (eqIdx !== -1) {
              const key = parts[1].substring(0, eqIdx);
              const value = decodeVscodeOscValue(parts[1].substring(eqIdx + 1));
              if (key === "Cwd" && value) {
                updateShellIntegration({ cwd: value });
              }
            }
          }
        } catch (e) {
          console.error("Error parsing OSC 633:", e);
        }
        return true;
      });

      // -------------------------------------------------------------------------
      // OSC 133 - Shell prompt / command lifecycle (FTCS / VS Code shell integration)
      //
      //   OSC 133 ; A ST - Prompt mark: the shell is drawing a new prompt
      //   OSC 133 ; B ST - Command start: user pressed Enter, command text begins
      //   OSC 133 ; C ST - Output start: command has started producing output
      //   OSC 133 ; D [; <exitCode>] ST - Command finished, optional exit code
      // -------------------------------------------------------------------------
      term.parser.registerOscHandler(133, (data) => {
        try {
          const parts = data.split(";");
          const subCmd = parts[0];

          if (subCmd === "A") {
            // Prompt is starting - shell is idle, new prompt being drawn
            updateShellIntegration({ promptPhase: "prompt", isExecuting: false });
          } else if (subCmd === "B") {
            // Command input starting - user is typing / about to hit Enter.
            // The cursor is now positioned at the very start of user input,
            // i.e. immediately after the prompt. Capture this position so we
            // can read the live cmdline from the buffer on each keypress.
            const buf = term.buffer.active;
            promptEndRef.current = {
              col: buf.cursorX,
              absLine: buf.cursorY + buf.baseY,
            };
            updateShellIntegration({ promptPhase: "input" });
            handleCommandStartDecoration(shellIntegrationRef.current.commandId);
          } else if (subCmd === "C") {
            // Output starting - command is now running and producing output
            markersRef.current.$start?.dispose();
            markersRef.current.$end?.dispose();
            markersRef.current.$start = term.registerMarker(0);
            promptEndRef.current = null;
            updateShellIntegration({ promptPhase: "output", isExecuting: true, currentCmdLine: undefined });
            handleCommandStartDecoration(shellIntegrationRef.current.commandId);
          } else if (subCmd === "D") {
            // Command finished - optional exit code in parts[1]
            const exitCodeStr = parts[1];
            const exitStatus = exitCodeStr !== undefined && exitCodeStr !== "" ? parseInt(exitCodeStr, 10) : undefined;

            // Place end marker right here before the new prompt renders
            markersRef.current.$end = term.registerMarker(0);
            handleCommandFinishedDecoration(exitStatus, shellIntegrationRef.current.commandId);

            const updates: Partial<ShellIntegration> = {
              promptPhase: "finished",
              isExecuting: false,
            };

            if (exitStatus !== undefined && !isNaN(exitStatus)) {
              updates.exitStatus = exitStatus;

              // Record in recent-commands history
              const entry: CommandHistoryEntry = {
                commandId: shellIntegrationRef.current.commandId || String(Date.now()),
                command: shellIntegrationRef.current.command,
                exitStatus,
                timestamp: Date.now(),
              };
              const oldHistory = shellIntegrationRef.current.recentCommands || [];
              updates.recentCommands = [entry, ...oldHistory].slice(
                0,
                getIntVar(VAR_CS_TERMINAL_RECENT_COMMANDS, DEFAULT_TERMINAL_RECENT_COMMANDS),
              );
            }

            promptEndRef.current = null;
            updateShellIntegration(updates);
          }
        } catch (e) {
          console.error("Error parsing OSC 133:", e);
        }
        return true;
      });

      // -------------------------------------------------------------------------
      // OSC 52 - System clipboard access
      //
      //   OSC 52 ; <clipboardTarget> ; <base64data> ST
      //
      // <clipboardTarget> is typically 'c' (clipboard) or 'p' (primary / X11).
      // We only act on write requests ('c' or 'p') - read requests are ignored
      // for security reasons (the remote shell could silently exfiltrate clipboard).
      // -------------------------------------------------------------------------
      term.parser.registerOscHandler(52, (data) => {
        try {
          const firstSemi = data.indexOf(";");
          if (firstSemi === -1) {
            return true;
          }

          // Everything after the first ';' is the base64 payload.
          // We intentionally ignore the clipboard-target field - we always
          // write to the OS clipboard (navigator.clipboard).
          const b64 = data.substring(firstSemi + 1);

          // '?' means the remote is requesting a clipboard read - deny silently
          if (b64 === "?") {
            return true;
          }

          // Decode the base64 payload and write to the OS clipboard
          const decoded = atob(b64);
          navigator.clipboard.writeText(decoded).catch(() => {});
        } catch (e) {
          console.error("Error parsing OSC 52:", e);
        }
        return true;
      });

      // -------------------------------------------------------------------------
      // OSC 1337 - iTerm2 extensions (proprietary)
      //
      // We support the CurrentDir= sub-command for CWD reporting (some shells
      // emit this instead of / in addition to OSC 7).
      // Image/file-transfer payloads are intentionally left to the ImageAddon.
      // -------------------------------------------------------------------------
      term.parser.registerOscHandler(1337, (data) => {
        try {
          if (data.startsWith("CurrentDir=")) {
            const path = data.substring(11).trim();
            if (path) {
              updateShellIntegration({ cwd: path });
            }
          }
        } catch (e) {
          console.error("Error parsing OSC 1337:", e);
        }
        return true;
      });

      // -------------------------------------------------------------------------
      // OSC 0 / OSC 1 / OSC 2 - Window icon and title
      //
      //   OSC 0 ; <string> ST - Set both icon title AND window title
      //   OSC 1 ; <string> ST - Set icon (minimised-window) title only
      //   OSC 2 ; <string> ST - Set window title only
      //
      // xterm.js fires onTitleChange() for OSC 0 and OSC 2 by default.
      // We register explicit OSC 1 handler so we can also capture the icon title,
      // and we hook onTitleChange for OSC 0/2 to keep everything in sync.
      // -------------------------------------------------------------------------
      // OSC 1 - icon title
      term.parser.registerOscHandler(1, (data) => {
        updateShellIntegration({ iconTitle: data });
        return true;
      });

      // OSC 2 - window title (also covers OSC 0 via onTitleChange below)
      term.parser.registerOscHandler(2, (data) => {
        updateShellIntegration({ windowTitle: data });
        return true;
      });

      // OSC 0 - both icon + window title simultaneously
      term.parser.registerOscHandler(0, (data) => {
        updateShellIntegration({ windowTitle: data, iconTitle: data });
        return true;
      });

      term.onResize(({ cols, rows }) => {
        window.dispatchEvent(
          new CustomEvent(CS_EVENT_TERMINAL_RESIZE, {
            detail: {
              terminal: term,
              cols,
              rows,
              sessionId,
              host,
              is_active_terminal: isActive,
            } satisfies CSEventDetailTerminalResize,
          }),
        );
      });

      // Use ResizeObserver for more reliable fitting
      const resizeObserver = new ResizeObserver(() => {
        if (terminalRef.current && terminalRef.current.offsetWidth > 0) {
          requestAnimationFrame(fit);
        }
      });
      resizeObserver.observe(terminalRef.current);

      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        // Only evaluate on keydown to prevent double-firing
        if (e.type !== "keydown") {
          return true;
        }

        const kcomb = getKeyCombination(e);

        if (__CS_REMAP_CTRL_L__) {
          if (kcomb === "ctrl+l") {
            if (__CS_ENV__ === 1) {
              // don't intercept in desktop app
              return true;
            }
            return false;
          } else if (kcomb === "ctrl+shift+l" || kcomb === "ctrl+alt+l") {
            // we support both ctrl+shift+l & ctrl+alt+l because some browser extension (aka. Bitwarden) uses former
            term.clear();
            markersRef.current.$lastClear?.dispose();
            markersRef.current.$lastClear = term.registerMarker(0);
            return false;
          }
        }

        if (passthroughKeyShortcuts.has(kcomb)) {
          return true;
        }

        if (
          __CS_SHORTCUT_BUTTONS__[kcomb] ||
          (__CS_CUSTOM_SHORTCUTS__[kcomb] && !__CS_CUSTOM_SHORTCUTS__[kcomb].disabledInTerminal) ||
          ((appShortcuts.has(kcomb) || systemShortcuts.has(kcomb)) &&
            !disableShortcuts.has(kcomb) &&
            !blackholeShortcuts.has(kcomb))
        ) {
          return false;
        }

        if (markModeRef.current?.isActive) {
          markModeRef.current.handleKeyDown(e);
          return false;
        }

        return true;
      });

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      const params = new URLSearchParams({
        host,
        sessionId: sessionId || "",
        cloneFrom: cloneFrom || "",
      });

      let isDisposed = false;
      let isDead = false;
      let sessionExited = false; // true when the session ended normally (user typed exit / process ended)
      let expectingHistory = false;
      let isRestoringHistory = false;
      let deathType: "fatal" | "stolen" | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout>;
      // Set to true by the Ctrl+L key handler; consumed by onWriteParsed once the
      // PTY's clear response has been fully parsed into the xterm buffer.
      let pendingClearMarker = false;

      const connectWS = async () => {
        if (wsRef.current) {
          wsRef.current.onclose = null;
          wsRef.current.close();
        }
        clearTimeout(reconnectTimer);

        fitAddonRef.current?.fit();
        const { cols, rows } = { cols: term.cols, rows: term.rows };

        params.set("cols", String(cols));
        params.set("rows", String(rows));

        let identity: string | undefined;
        if (options) {
          identity = options.identity;
          delete options.identity;
          const keys = Object.keys(options).sort(); // make variables in $foo, _foo, foo order
          for (const key of keys) {
            if (!key.startsWith(TAG_FLAG_PREFIX) && !terminalClientSideParams.has(key)) {
              params.set(key, options[key]!);
            } else if (key === TAG_FLAG_SHELL_INTEGRATION) {
              params.set(key.slice(1), options[key]!);
            } else if (key === TAG_FLAG_ENV) {
              let value = options[key]!;
              try {
                // value may contains `%0A` (\n)
                value = decodeURIComponent(value);
              } catch {
                /* empty */
              }
              params.set(key.slice(1), value);
            }
          }
        }

        if (forceReconnectRef.current) {
          params.set("reconnect", "1");
          forceReconnectRef.current = false;
          xtermRef.current?.reset();
        }

        const promises: PromiseLike<unknown>[] = [];
        window.dispatchEvent(
          new CustomEvent(CS_EVENT_TERMINAL_NEW, {
            detail: {
              terminal: term,
              sessionId,
              host,
              params,
              promises,
              is_active_terminal: isActive,
            } satisfies CSEventDetailTerminalNew,
          }),
        );
        try {
          await Promise.all(promises);
        } catch (err: unknown) {
          notify(t("Error in terminal setup:") + ` ${err}`, "error", TOAST_KEY_TERMINAL);
          return;
        }

        const wsUrl = `${protocol}//${location.host}/api/ws`;

        if (isDisposed) {
          return;
        }

        const websocket_protocols: string[] = [WS_PROTOCOL_DUMMY];
        if (token) {
          websocket_protocols.push(token);
        }
        websocket_protocols.push(WS_PROTOCOL_QUERY_PREFIX + base64urlEncode(params.toString()));
        if (identity) {
          websocket_protocols.push(WS_PROTOCOL_IDENTITY_PREFIX + base64urlEncode(identity.toString()));
        }

        isDead = false;
        deathType = null;
        onStateChange?.("connecting");
        const ws = new WebSocket(wsUrl, websocket_protocols);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          if (isDisposed) {
            ws.close();
            return;
          }
          // Send initial resize using correct dimensions
          ws.send(JSON.stringify({ type: "resize", cols, rows } satisfies WsResizeMsg));
          window.dispatchEvent(
            new CustomEvent(CS_EVENT_TERMINAL_CONNECTED, {
              detail: {
                terminal: term,
                sessionId,
                host,
                is_active_terminal: isActive,
              } satisfies CSEventDetailTerminalConnected,
            }),
          );
        };

        ws.onmessage = (ev) => {
          if (typeof ev.data === "string") {
            try {
              const msg = JSON.parse(ev.data) as WsTerminalMessage;
              if (msg.type === "historyStart") {
                expectingHistory = true;
                return;
              }
              if (msg.type === "tabState") {
                onTabStateChange?.(msg);
                return;
              }
              if (msg.type === "state") {
                if (msg.state === "exited") {
                  // Normal session termination (user typed exit, or remoteCommand ended).
                  // Mark as exited so ws.onclose won't auto-reconnect.
                  sessionExited = true;
                  return;
                }
                if (msg.state === "stolen" || msg.state.includes("(fatal)")) {
                  isDisposed = true;
                  isDead = true;
                  deathType = msg.state === "stolen" ? "stolen" : "fatal";
                  ws.close();
                  if (msg.state === "stolen") {
                    term.write(
                      "\r\n\x1b[31;1m*** Session stolen (attached by another client) *** (Press Enter to reconnect)\x1b[0m\r\n",
                    );
                    onStolen?.();
                  } else {
                    term.write(`\r\n\x1b[31;1m*** ${msg.state} *** (Press Enter to reconnect)\x1b[0m\r\n`);
                  }
                  onStateChange?.(msg.state);
                  window.dispatchEvent(
                    new CustomEvent(CS_EVENT_TERMINAL_DISCONNECTED, {
                      detail: {
                        terminal: term,
                        sessionId,
                        host,
                        is_active_terminal: isActive,
                        reason: deathType,
                      } satisfies CSEventDetailTerminalDisconnected,
                    }),
                  );
                  return;
                }
                onStateChange?.(msg.state);
                return;
              }
            } catch {
              /* empty */
            }
            let data: string | Uint8Array = ev.data;
            if (!isRestoringHistory) {
              onDataRef.current?.();
              const filters: CSEventDetailTerminalData["filters"] = [];
              window.dispatchEvent(
                new CustomEvent(CS_EVENT_TERMINAL_DATA, {
                  detail: {
                    terminal: term,
                    sessionId,
                    host,
                    data,
                    filters,
                    is_active_terminal: isActive,
                  } satisfies CSEventDetailTerminalData,
                }),
              );
              data = applyFilters(filters, ev.data);
            }
            term.write(data);
          } else {
            let data: string | Uint8Array = new Uint8Array(ev.data);
            if (expectingHistory) {
              expectingHistory = false;
              isRestoringHistory = true;
              term.write(data, () => {
                isRestoringHistory = false;
              });
            } else {
              if (!isRestoringHistory) {
                onDataRef.current?.();
                const filters: CSEventDetailTerminalData["filters"] = [];
                window.dispatchEvent(
                  new CustomEvent(CS_EVENT_TERMINAL_DATA, {
                    detail: {
                      terminal: term,
                      sessionId,
                      host,
                      data,
                      filters,
                      is_active_terminal: isActive,
                    } satisfies CSEventDetailTerminalData,
                  }),
                );
                data = applyFilters(filters, data);
              }
              term.write(data);
            }
          }
        };

        ws.onclose = () => {
          if (isDisposed) {
            return;
          }
          if (sessionExited) {
            // Session ended normally - show a tip and wait for the user to press Enter.
            // Reset the flag so a future reconnect starts fresh.
            sessionExited = false;
            isDisposed = true;
            isDead = true;
            deathType = null;
            term.write(
              "\r\n\x1b[2m--- Session ended. Press \x1b[0m\x1b[1mEnter\x1b[0m\x1b[2m to reconnect. ---\x1b[0m\r\n",
            );
            onStateChange?.("exited");
            window.dispatchEvent(
              new CustomEvent(CS_EVENT_TERMINAL_DISCONNECTED, {
                detail: {
                  terminal: term,
                  sessionId,
                  host,
                  is_active_terminal: isActive,
                  reason: "normal",
                } satisfies CSEventDetailTerminalDisconnected,
              }),
            );
            return;
          }
          onStateChange?.("disconnected");
          window.dispatchEvent(
            new CustomEvent(CS_EVENT_TERMINAL_DISCONNECTED, {
              detail: {
                terminal: term,
                sessionId,
                host,
                is_active_terminal: isActive,
                reason: "normal",
              } satisfies CSEventDetailTerminalDisconnected,
            }),
          );
          reconnectTimer = setTimeout(connectWS, 2000);
        };
      };

      reconnectFuncRef.current = connectWS;
      setTimeout(connectWS, 50);

      term.onData((data) => {
        if (markModeRef.current?.isActive) {
          return;
        }
        if (data === "\x0c") {
          // \x0c is the ASCII Form Feed sent by Ctrl + L
          pendingClearMarker = true;
        }
        if (isRestoringHistory) {
          return;
        }
        if (isDead && data === "\r") {
          if (deathType === "stolen") {
            onManualReconnect?.(true);
            return;
          }
          // Handles both fatal errors and normal session exit (exited state)
          isDead = false;
          deathType = null;
          isDisposed = false;
          term.write("\r\nReconnecting...\r\n");
          connectWS();
          return;
        }
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          if (ctrlRef.current && data && !data.startsWith("\x1b")) {
            // Mobile IMEs often send composition artifacts. We extract the first valid char.
            // This regex matches a-z, A-Z, and the symbols @, [, \, ], ^, _, ?
            const match = data.match(/[a-zA-Z@[\\\]^_?]/);
            let sent = false;
            let dataToSend = data;
            if (match) {
              const code = match[0].toUpperCase().charCodeAt(0);
              let ctrlCode = String.fromCharCode(code - 64);
              // Special case for Ctrl + ? (often maps to DEL)
              if (match[0] === "?") {
                ctrlCode = "\x7F";
              }
              dataToSend = ctrlCode;
              sent = true;
            } else if (data.includes(" ")) {
              // Handle Ctrl + Space
              dataToSend = "\x00";
              sent = true;
            }
            if (sent) {
              if (altRef.current) {
                ws.send(new TextEncoder().encode("\x1b" + dataToSend));
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
            ws.send(new TextEncoder().encode("\x1b" + data));
            onAltDone?.();
            return;
          }

          ws.send(new TextEncoder().encode(data));
        }
      });

      // -------------------------------------------------------------------------
      // Live cmdline tracking
      //
      // Reads the xterm buffer from the prompt-end cursor position (captured at
      // OSC 133;B) after each server write (echo).  Falls back to a heuristic
      // prompt-strip when 133;B hasn't fired (e.g. shells that only emit 133;A/D).
      //
      // This fires on onWriteParsed - i.e. after server-echoed data has been
      // rendered into the xterm buffer - so the buffer reflects what the user sees.
      // -------------------------------------------------------------------------
      const readCurrentCmdLine = (): string => {
        const phase = shellIntegrationRef.current.promptPhase;
        if (phase !== "prompt" && phase !== "input") {
          return "";
        }

        const buffer = term.buffer.active;
        const promptEnd = promptEndRef.current;

        if (promptEnd && promptEnd.col > 0) {
          // --- Primary path: use the exact cursor anchor from OSC 133;B or OSC 3008 ---
          // col > 0 guard: if col is 0, the OSC fired before the prompt was drawn
          // (cursor was at the start of the line), so we can't safely use it as
          // the input start - fall through to the heuristic instead.
          const { col: startCol, absLine: startAbsLine } = promptEnd;
          const cursorAbsLine = buffer.cursorY + buffer.baseY;

          const segments: string[] = [];
          for (let absLine = startAbsLine; absLine <= cursorAbsLine; absLine++) {
            const line = buffer.getLine(absLine);
            if (!line) continue;
            const fullText = line.translateToString(false);
            const text = absLine === startAbsLine ? fullText.substring(startCol) : fullText;
            segments.push(text);
          }
          // Trim trailing spaces per-segment, then join logical lines with \n
          return segments
            .map((s) => s.trimEnd())
            .join("\n")
            .trimEnd();
        } else {
          // --- Fallback: heuristic strip of the prompt on the cursor line ---
          // Used when:
          //  - no anchor is available (promptEndRef is null), or
          //  - the anchor was captured at col 0 (OSC fired before prompt rendered)
          const cursorLine = buffer.getLine(buffer.cursorY + buffer.baseY);
          if (!cursorLine) {
            return "";
          }
          const text = cursorLine.translateToString(true);
          // Strip everything up to and including the last $, #, %, or > followed by a space
          const lastPrompt = Math.max(
            text.lastIndexOf("$ "),
            text.lastIndexOf("# "),
            text.lastIndexOf("% "),
            text.lastIndexOf("> "),
          );
          return lastPrompt !== -1 ? text.substring(lastPrompt + 2) : text;
        }
      };

      term.onWriteParsed(() => {
        markModeRef.current?.onBufferChange();

        // Consume a pending Ctrl+L clear-marker request. We defer registration to
        // here because Ctrl+L sends \x0c to the PTY asynchronously; by the time
        // this callback fires the clear sequences have been fully applied to the
        // buffer so registerMarker(0) correctly anchors to the new top of content.
        if (pendingClearMarker) {
          pendingClearMarker = false;
          markersRef.current.$lastClear?.dispose();
          markersRef.current.$lastClear = term.registerMarker(0);
        }

        const phase = shellIntegrationRef.current.promptPhase;
        if (phase !== "prompt" && phase !== "input") {
          return;
        }
        const live = readCurrentCmdLine();
        if (live !== shellIntegrationRef.current.currentCmdLine) {
          updateShellIntegration({ currentCmdLine: live });
        }
      });

      // Track whether selection has changed since last copy
      let hasNewSelection = false;
      const selectionDisposable = term.onSelectionChange(() => {
        hasNewSelection = Boolean(term.getSelection());
      });

      // Copy-on-select: triggered on mouseup, blur, or mouseleave.
      //
      // navigator.clipboard.writeText() requires either a trusted user gesture
      // ("transient activation") or an actively focused document at the moment
      // of the call.
      //
      // We listen on `window` (and blur/mouseleave) rather than `container` so that
      // if the user starts selecting inside the terminal and drags the mouse past the
      // container edge (e.g. over sidebar, header, or outside window), mouseup still fires
      // and copies the selection reliably.
      const handleCopyOnSelect = () => {
        if (!hasNewSelection) {
          return;
        }
        if (getIntVar(VAR_CS_NO_SELECT_TO_COPY) === 1) {
          return;
        }
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch((err) => {
            console.debug("[terminal] copy-on-select failed:", err);
          });
          hasNewSelection = false;
        }
      };

      const handleContextMenu = (e: PointerEvent) => {
        if (getIntVar(VAR_CS_NO_PASTE_ON_CONTEXTMENU) === 1) {
          return;
        }
        e.preventDefault();
        navigator.clipboard
          .readText()
          .then((text) => {
            const ws = wsRef.current;
            if (text && ws && ws.readyState === WebSocket.OPEN) {
              text = text.replace(/\r\n|\r|\n/g, "\n");
              ws.send(new TextEncoder().encode(text));
            }
          })
          .catch(() => {});
      };

      const container = terminalRef.current;
      if (container) {
        container.addEventListener("contextmenu", handleContextMenu);
      }

      window.addEventListener("mouseup", handleCopyOnSelect);
      window.addEventListener("blur", handleCopyOnSelect);
      document.addEventListener("mouseleave", handleCopyOnSelect);

      return () => {
        isDisposed = true;
        clearTimeout(reconnectTimer);
        resizeObserver.disconnect();
        selectionDisposable.dispose();
        if (container) {
          container.removeEventListener("contextmenu", handleContextMenu);
        }
        window.removeEventListener("mouseup", handleCopyOnSelect);
        window.removeEventListener("blur", handleCopyOnSelect);
        document.removeEventListener("mouseleave", handleCopyOnSelect);
        if (wsRef.current) {
          wsRef.current.close();
        }

        clearCommandDecorations();
        markMode.dispose();
        markModeRef.current = null;

        // <-- Dispose of markers
        markersRef.current.$start?.dispose();
        // eslint-disable-next-line react-hooks/exhaustive-deps
        markersRef.current.$end?.dispose();

        // Explicitly kill the WebGL addon first
        if (webglAddon) {
          try {
            webglAddon.dispose();
          } catch (e) {
            console.warn("Error disposing WebGL addon", e);
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
        }, 100);
      }
    }, [isActive]);

    return (
      <Box
        className="terminal-pane"
        ref={terminalRef}
        sx={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          ...(options?.terminalStyle ? (JSON.parse(options.terminalStyle) as React.CSSProperties) : undefined),
        }}
      />
    );
  },
);

export default TerminalComponent;
