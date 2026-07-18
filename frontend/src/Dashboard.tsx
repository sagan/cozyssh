import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Box,
  CssBaseline,
  createTheme,
  ThemeProvider,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ViewSidebarIcon from "@mui/icons-material/ViewSidebar";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import type { FullData, ButtonData } from "./api";
import {
  DEFAULT_SCROLL_LINES,
  BROWSER_STORAGE_KEY_TOKEN,
  DEFAULT_BUTTON_GROUP,
  LOCAL_NAME,
  VAR_CS_NOAUTOLOAD,
  VAR_CS_NOAUTORUN,
  VAR_CS_SCROLL_LINES,
  VAR_NOAUTOLOAD,
  VAR_NOAUTORUN,
  VIBRATE_PATTERN,
  ID_TERMINAL_SEARCH_INPUT,
  TAG_GROUP_PREFIX,
  TAG_FAV,
  TOAST_KEY_API_FULLDATA,
  VAR_CS_NO_SANITIZE_HASH,
  TOAST_KEY_COPY,
  TERMINAL_FUNCTIONS,
  MISC_FUNCTIONS,
} from "./constants";
import {
  type ContextMenu,
  type ScratchpadSyncState,
  defaultThemeOptions,
  genTabId,
  genPaneId,
  getTemplateVariables,
  liquidEngine,
  apiReqHeaders,
  cutString,
  openHostInNewWindow,
  hostSorter,
  assertUnreachable,
} from "./common";
import {
  type TabData,
  useStore,
  getStore,
  setTabs,
  setActiveTabId,
  setActivePaneId,
  triggerFocus,
  notify,
  setMobileOpen,
  setMobileAppletsOpen,
  setSearchOpen,
  resetFontSize,
  decreseFontSize,
  increaseFontSize,
  prevButtonGroup,
  nextButtonGroup,
  closeOtherTabs,
  closeRightTabs,
  openInputDialog,
  openHostsAsSplit,
  openHost,
  cloneSession,
  attachSession,
  closeTabOrPane,
  openScratchpad,
  openHostsAsSplit2,
  getIntVar,
  refreshData,
  lockTab,
  unlockTab,
  pinTab,
  unpinTab,
  renameTab,
  openSaveTabToButtonDialog,
  setTagsExpanded,
  setAllExpanded,
  setAutoExpanded,
  setFavExpanded,
  toggleExpandAllGroups,
  openEditTabHost,
  openEditButtonDialog,
  openAddButtonDialog,
  hideTab,
  fetchSessions,
  startupParams,
  type PaneData,
  getPane,
  getTab,
  getHost,
  setUnreadTabIds,
  openAddHostDialog,
  setSettingsOpen,
  moveTabLeft,
  moveTabRight,
} from "./store";
import { setupPluginAPI, runScript } from "./pluginAPI";
import { useKeyboardManager } from "./useKeyboardManager";
import Sidebar from "./Sidebar";
import type { TerminalHandle } from "./Terminal";
import type { ScratchpadHandle } from "./Scratchpad";
import TabBar from "./TabBar";
import TerminalGrid from "./TerminalGrid";
import ButtonBar from "./ButtonBar";
import DialogManager from "./DialogManager";
import AppletWrapper, { type AppletData } from "./AppletWrapper";
import SideEffect from "./SideEffect";
import { dialogs } from "./Dialogs";

interface DashboardProps {
  initialData?: FullData;
}

export default function Dashboard({ initialData }: DashboardProps) {
  const mobileAppletsOpen = useStore((state) => state.mobileAppletsOpen);
  const groups = useStore(
    useShallow((state) =>
      [
        DEFAULT_BUTTON_GROUP,
        ...Array.from(
          new Set(state.buttons.map((b) => b.group || DEFAULT_BUTTON_GROUP).filter((g) => g !== DEFAULT_BUTTON_GROUP)),
        ),
      ].sort(),
    ),
  );

  // ── UI-only state (stays in React) ────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  // terminalRefs is kept as a local ref for all Dashboard-internal usage,
  // and also written into the store so pluginAPI / useKeyboardManager can read it.
  const terminalRefs = useRef<{ [key: string]: TerminalHandle | ScratchpadHandle | null }>({});
  const [viewportHeight, setViewportHeight] = useState("100dvh");
  const [scratchpadSyncState, setScratchpadSyncState] = useState<ScratchpadSyncState>("offline");
  const [memoTabId, setMemoTabId] = useState<string | null>(null);
  const [applets, setApplets] = useState<AppletData[]>([]);
  const appletRefs = useRef<AppletData[]>([]);
  const maxZIndexRef = useRef(10000);
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // ── Mobile bar state ─────────────────────────────────────────────────────
  /** When true, swipe gestures on the terminal send arrow keys instead of switching tabs */
  const [gestureMode, setGestureMode] = useState(false);
  /** When true, the extra-keys panel is visible and the system keyboard is suppressed */
  const [extraKeysOpen, setExtraKeysOpen] = useState(false);
  /** Height of the on-screen keyboard in px (0 when hidden) */
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isTouch = useMediaQuery("(pointer: coarse)");

  useEffect(() => {
    appletRefs.current = applets;
  }, [applets]);

  const hasSidebarApplet = useMemo(() => !!applets.find((a) => a.position === "sidebar"), [applets]);

  const [muiTheme, setMuiTheme] = useState(() => createTheme(defaultThemeOptions({ fontSize: __CS_FONT_SIZE__ })));

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    const term = terminalRefs.current[getStore().activePaneId];
    if (term && "getXterm" in term) {
      term.clearSearchDecorations();
      term.focus();
    }
  }, []);

  const handleSendKey = useCallback((key: string) => {
    const term = terminalRefs.current[getStore().activePaneId];
    if (term && "getXterm" in term) {
      term.sendData(key);
      term.focus();
    }
  }, []);

  const sendParsedString = useCallback(async (input: string, isLiquid?: boolean, userVars?: Record<string, string>) => {
    const { sendScope, tabs } = getStore();
    let targetPanes: PaneData[] = [];
    if (sendScope === 2) {
      targetPanes = tabs.flatMap((t) => t.panes);
    } else if (sendScope === 1) {
      const currentTab = getTab();
      targetPanes = currentTab ? currentTab.panes : [];
    } else {
      const pane = getPane();
      targetPanes = pane ? [pane] : [];
    }

    let hasShellIntegration = false;
    if (isLiquid) {
      try {
        const parsedTemplate = liquidEngine.parse(input);
        const allVars = liquidEngine.variablesSync(parsedTemplate);
        hasShellIntegration = allVars.includes("shellIntegration");
      } catch (e) {
        console.error("Failed to parse liquid template: ", e);
      }
    }

    let clipboard = "";
    try {
      clipboard = await navigator.clipboard.readText();
    } catch {
      /* empty */
    }

    if (isLiquid && hasShellIntegration) {
      // Execute template independently for each terminal pane
      for (const pane of targetPanes) {
        try {
          const { vars, localVars, shellIntegrations } = getStore();
          const context = {
            shellIntegration: shellIntegrations[pane.id] || {},
            vars: vars || {},
            localVars: localVars || {},
            host: getHost(pane.host),
            clipboard,
            ...(userVars || {}),
          };
          const rendered = await liquidEngine.parseAndRender(input, context);

          // send this rendered string to pid
          const parts = rendered.split(/(<ctrl-[!-~]>)/g);
          for (const part of parts) {
            if (!part) continue;
            const ctrlMatch = part.match(/<ctrl-([!-~])>/);
            const dataToSend = ctrlMatch ? String.fromCharCode(ctrlMatch[1].charCodeAt(0) & 0x1f) : part;

            if (terminalRefs.current[pane.id]) {
              const term = terminalRefs.current[pane.id];
              if (term && "getXterm" in term) {
                term.sendData(dataToSend);
              }
            }
            await new Promise((r) => setTimeout(r, ctrlMatch ? 50 : 10));
          }
        } catch (e) {
          console.error(`Failed to render liquid template for pane ${pane.id} - ${pane.host}:`, e);
        }
      }
    } else {
      // Normal execution flow (rendered once or not liquid)
      let renderedInput = input;
      if (isLiquid) {
        try {
          const { vars, localVars, shellIntegrations, activePaneId } = getStore();
          const context = {
            shellIntegration: shellIntegrations[activePaneId] || {},
            vars: vars || {},
            localVars: localVars || {},
            host: getHost(activePaneId),
            clipboard,
            ...(userVars || {}),
          };
          renderedInput = await liquidEngine.parseAndRender(input, context);
        } catch (e) {
          console.error("Failed to render liquid template:", e);
        }
      }

      const parts = renderedInput.split(/(<ctrl-[!-~]>)/g);
      for (const part of parts) {
        if (!part) {
          continue;
        }
        const ctrlMatch = part.match(/<ctrl-([!-~])>/);
        const dataToSend = ctrlMatch ? String.fromCharCode(ctrlMatch[1].charCodeAt(0) & 0x1f) : part;

        for (const pane of targetPanes) {
          if (terminalRefs.current[pane.id]) {
            const term = terminalRefs.current[pane.id];
            if (term && "getXterm" in term) {
              term.sendData(dataToSend);
            }
          }
        }
        await new Promise((r) => setTimeout(r, ctrlMatch ? 50 : 10));
      }
    }
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isTouch || !isMobile || gestureMode) {
        return; // gesture mode uses native listeners
      }
      const touch = e.touches[0];
      swipeStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    },
    [gestureMode, isMobile, isTouch],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!isTouch || !isMobile || gestureMode || !swipeStartRef.current) {
        return;
      }
      const touch = e.changedTouches[0];
      const diffX = touch.clientX - swipeStartRef.current.x;
      const diffY = touch.clientY - swipeStartRef.current.y;
      const diffTime = Date.now() - swipeStartRef.current.time;
      swipeStartRef.current = null;

      // Thresholds: move at least 100px, mostly horizontal, within 500ms
      if (Math.abs(diffX) > 100 && Math.abs(diffX) > Math.abs(diffY) * 2 && diffTime < 500) {
        const { activeTabId, tabs } = getStore();
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        if (diffX > 0 && currentIndex > 0) {
          const newTab = tabs[currentIndex - 1];
          window.navigator.vibrate?.(VIBRATE_PATTERN);
          setActiveTabId(newTab.id);
          setActivePaneId(newTab.activePaneId);
          triggerFocus();
        } else if (diffX < 0 && currentIndex < tabs.length - 1) {
          const newTab = tabs[currentIndex + 1];
          window.navigator.vibrate?.(VIBRATE_PATTERN);
          setActiveTabId(newTab.id);
          setActivePaneId(newTab.activePaneId);
          triggerFocus();
        }
      }
    },
    [gestureMode, isMobile, isTouch],
  );

  // 1. Add this ref right above the visualViewport useEffect
  const extraKeysOpenRef = useRef(extraKeysOpen);
  useEffect(() => {
    extraKeysOpenRef.current = extraKeysOpen;
  }, [extraKeysOpen]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      return;
    }
    const handleVVResize = () => {
      // 1. Lock dimensions to perfect integers immediately
      const roundedVVHeight = Math.floor(vv.height);
      const roundedInnerHeight = Math.floor(window.innerHeight);

      setViewportHeight(`${roundedVVHeight}px`);
      // 2. Derive the keyboard height using the exact same integers
      setKeyboardHeight(Math.max(0, roundedInnerHeight - roundedVVHeight));
    };
    vv.addEventListener("resize", handleVVResize);
    handleVVResize();
    return () => vv.removeEventListener("resize", handleVVResize);
  }, []);

  // ── VirtualKeyboard API setup ───────────────────────────────────────────
  useEffect(() => {
    const vk = navigator.virtualKeyboard;
    if (!vk) {
      return;
    }
    // Opt-in: keyboard overlays content instead of resizing the viewport.
    // This lets us position our bar precisely at keyboardHeight.
    // vk.overlaysContent = true;
    const handleGeometryChange = () => {
      setKeyboardHeight(vk.boundingRect?.height ?? 0);
    };
    vk.addEventListener("geometrychange", handleGeometryChange);
    return () => {
      vk.removeEventListener("geometrychange", handleGeometryChange);
      // Restore default behaviour on unmount
      vk.overlaysContent = false;
    };
  }, []);

  // ── Keep inputmode in sync with extraKeysOpen across tab/pane changes ────
  // When the extra-keys panel is open, every terminal that becomes active must
  // have inputmode="none" so the system keyboard stays suppressed.  We also
  // call vk.hide() explicitly for the VirtualKeyboard API path.
  useEffect(() => {
    const applyMode = () => {
      if (extraKeysOpen) {
        // Only suppress the active terminal
        const term = terminalRefs.current[getStore().activePaneId];
        if (term && "getXterm" in term) {
          const textarea = term.getXterm()?.textarea as HTMLTextAreaElement | undefined;
          if (textarea) {
            textarea.inputMode = "none";
          }
        }
        // Belt-and-suspenders: force-hide via VK API
        navigator.virtualKeyboard?.hide();
      } else {
        // Restore all terminals so the keyboard can appear naturally again
        for (const term of Object.values(terminalRefs.current)) {
          if (term && "getXterm" in term) {
            const textarea = term.getXterm()?.textarea as HTMLTextAreaElement | undefined;
            if (textarea && textarea.inputMode === "none") {
              textarea.inputMode = "";
            }
          }
        }
      }
    };

    applyMode();
    // Newly-opened tabs mount their xterm asynchronously; retry after a short
    // delay to make sure the textarea exists when we try to patch it.
    const t = setTimeout(applyMode, 350);
    return () => clearTimeout(t);
  }, [extraKeysOpen]);

  const handleButtonClick = useCallback(
    async (btn: Pick<ButtonData, "id" | "name" | "type" | "payload" | "liquidjs">, alternativeMode = 0) => {
      if (alternativeMode === 2) {
        let button: ButtonData | undefined;
        if (btn.id) {
          button = getStore().buttons.find((b) => b.id === btn.id);
        }
        if (button) {
          openEditButtonDialog(button);
        } else {
          openAddButtonDialog({ ...btn, shortcut: undefined });
        }
        return;
      }
      window.navigator.vibrate?.(VIBRATE_PATTERN);
      let noFocus = false;
      switch (btn.type) {
        case "send_string": {
          if (alternativeMode === 1) {
            navigator.clipboard.writeText(btn.payload);
            notify("Copied", "info", TOAST_KEY_COPY);
            triggerFocus();
          } else {
            const openDialog =
              alternativeMode === 3 || (!!btn.liquidjs && getTemplateVariables(btn.payload).length > 0);
            if (openDialog) {
              openInputDialog({
                inputValue: btn.payload,
                inputLiquid: !!btn.liquidjs,
                sendScope: 0,
                appendNewLine: false,
              });
            } else {
              await sendParsedString(btn.payload);
              triggerFocus();
            }
          }
          break;
        }

        case "open_terminal": {
          if (alternativeMode === 3) {
            openHostInNewWindow(btn.payload);
          } else {
            const hosts = btn.payload.split(/\s*,\s*/);
            openHostsAsSplit2(hosts, { target: alternativeMode === 1 ? "_self" : undefined });
          }
          break;
        }

        case "terminal_function": {
          const payload = btn.payload as (typeof TERMINAL_FUNCTIONS)[number]["value"];
          if (payload === "ATTACH") {
            (async () => {
              const sessions = await fetchSessions(true);
              const session = sessions.find((s) => !s.isHidden);
              if (session) {
                attachSession(session.id, session.host, session.title, session.isLocked);
              }
            })();
            return;
          }
          const term = terminalRefs.current[getStore().activePaneId];
          if (!term || !("getXterm" in term)) {
            return;
          }
          switch (payload) {
            case "COPY": {
              const xterm = term.getXterm();
              if (!xterm) {
                return;
              }
              const buffer = xterm.buffer.active;
              let text = "";
              for (let i = 0; i < xterm.rows; i++) {
                const line = buffer.getLine(i);
                if (line) {
                  text += line.translateToString(true) + "\n";
                }
              }
              text = text.trim();
              if (text) {
                navigator.clipboard.writeText(text);
              }
              term.focus();
              break;
            }

            case "COPY_VISIBLE": {
              const xterm = term.getXterm();
              if (!xterm) {
                return;
              }
              const buffer = xterm.buffer.active;
              const start = buffer.viewportY;
              const end = start + xterm.rows;
              let text = "";
              for (let i = start; i < end; i++) {
                const line = buffer.getLine(i);
                if (line) {
                  text += line.translateToString(true) + "\n";
                }
              }
              text = text.trim();
              if (text) {
                navigator.clipboard.writeText(text);
              }
              term.focus();
              break;
            }

            case "COPY_SELECTION": {
              const text = term.getSelection();
              if (text) {
                navigator.clipboard.writeText(text);
              }
              term.focus();
              break;
            }

            case "COPY_CWD": {
              const shellIntegration = getStore().shellIntegrations[getStore().activePaneId];
              if (shellIntegration?.cwd) {
                navigator.clipboard.writeText(shellIntegration.cwd);
              }
              term.focus();
              break;
            }

            case "COPY_CURRENT_CMDLINE": {
              const shellIntegration = getStore().shellIntegrations[getStore().activePaneId];
              if (shellIntegration?.currentCmdLine) {
                navigator.clipboard.writeText(shellIntegration.currentCmdLine);
              }
              term.focus();
              break;
            }

            case "COPY_LAST_COMMAND_OUTPUT": {
              const text = term.getLastCommandOutput();
              if (text) {
                navigator.clipboard.writeText(text);
              }
              term.focus();
              break;
            }

            case "PASTE": {
              const text = await navigator.clipboard.readText();
              if (text) {
                term.sendData(text);
              }
              term.focus();
              break;
            }

            case "INPUT":
              openInputDialog();
              break;

            case "CLEAR":
              term.clear();
              term.focus();
              break;

            case "RESET":
              term.reset();
              term.focus();
              break;

            case "RECONNECT":
              term.reconnect();
              term.focus();
              break;

            case "CLOSE":
              closeTabOrPane();
              break;

            case "CLOSE_TAB": {
              closeTabOrPane(getStore().activeTabId);
              break;
            }

            case "SCROLL_TO_TOP":
              term.scrollToTop();
              term.focus();
              break;

            case "SCROLL_TO_BOTTOM":
              term.scrollToBottom();
              term.focus();
              break;

            case "SCROLL_UP": {
              const scrollLines = getIntVar(VAR_CS_SCROLL_LINES, DEFAULT_SCROLL_LINES);
              term.scrollLines(-scrollLines);
              term.focus();
              break;
            }

            case "SCROLL_DOWN": {
              const scrollLines = getIntVar(VAR_CS_SCROLL_LINES, DEFAULT_SCROLL_LINES);
              term.scrollLines(scrollLines);
              term.focus();
              break;
            }

            case "SCROLL_PAGE_UP":
              term.scrollPages(-1);
              term.focus();
              break;

            case "SCROLL_PAGE_DOWN":
              term.scrollPages(1);
              term.focus();
              break;

            case "CLONE_SESSION":
              cloneSession(getStore().activePaneId);
              break;

            case "CLONE_SESSION_IN_SAME_TAB":
              cloneSession(getStore().activePaneId, true);
              break;

            case "SEARCH":
              setSearchOpen(true);
              setTimeout(() => document.getElementById(ID_TERMINAL_SEARCH_INPUT)?.focus(), 100);
              break;

            case "LOCK_TAB": {
              lockTab();
              break;
            }

            case "UNLOCK_TAB": {
              unlockTab();
              break;
            }

            case "PIN_TAB": {
              pinTab();
              break;
            }

            case "UNPIN_TAB": {
              unpinTab();
              break;
            }

            case "HIDE_TAB": {
              hideTab();
              break;
            }

            case "RENAME_TAB": {
              noFocus = true;
              renameTab();
              break;
            }

            case "EDIT_TAB_HOST": {
              noFocus = true;
              openEditTabHost();
              break;
            }

            case "SAVE_TAB": {
              noFocus = true;
              openSaveTabToButtonDialog();
              break;
            }

            case "CLEAR_UNREAD_TABS": {
              setUnreadTabIds(new Set());
              break;
            }
            case "MOVE_TAB_LEFT": {
              moveTabLeft();
              break;
            }
            case "MOVE_TAB_RIGHT": {
              moveTabRight();
              break;
            }
            case "CLOSE_OTHER_TABS":
              closeOtherTabs();
              break;
            case "CLOSE_RIGHT_TABS":
              closeRightTabs();
              break;
            default: {
              return assertUnreachable(payload);
            }
          }
          if (!noFocus) {
            triggerFocus();
          }
          break;
        }

        case "misc": {
          const payload = btn.payload as (typeof MISC_FUNCTIONS)[number]["value"];
          switch (payload) {
            case "RESET_FONT_SIZE":
              resetFontSize(true, true);
              break;
            case "RESET_TERMINAL_FONT_SIZE":
              resetFontSize(true, false);
              break;
            case "RESET_GLOBAL_FONT_SIZE":
              resetFontSize(false, true);
              break;
            case "DECREASE_FONT_SIZE":
              decreseFontSize(true, true);
              break;
            case "DECREASE_TERMINAL_FONT_SIZE":
              decreseFontSize(true, false);
              break;
            case "DECREASE_GLOBAL_FONT_SIZE":
              decreseFontSize(false, true);
              break;
            case "INCREASE_FONT_SIZE":
              increaseFontSize(true, true);
              break;
            case "INCREASE_TERMINAL_FONT_SIZE":
              increaseFontSize(true, false);
              break;
            case "INCREASE_GLOBAL_FONT_SIZE":
              increaseFontSize(false, true);
              break;
            case "TABS_SCROLL_LEFT":
              (document.querySelector("#tab-bar .MuiTabScrollButton-root:first-of-type") as HTMLElement)?.click();
              break;
            case "TABS_SCROLL_RIGHT":
              (document.querySelector("#tab-bar .MuiTabScrollButton-root:last-of-type") as HTMLElement)?.click();
              break;
            case "BUTTONS_SCROLL_LEFT":
              (document.querySelector("#button-bar .MuiTabScrollButton-root:first-of-type") as HTMLElement)?.click();
              break;
            case "BUTTONS_SCROLL_RIGHT":
              (document.querySelector("#button-bar .MuiTabScrollButton-root:last-of-type") as HTMLElement)?.click();
              break;
            case "NEXT_BUTTON_GROUP": {
              nextButtonGroup();
              break;
            }
            case "PREV_BUTTON_GROUP": {
              prevButtonGroup();
              break;
            }
            case "TOGGLE_SIDEBAR_TAGS": {
              setTagsExpanded();
              break;
            }
            case "TOGGLE_SIDEBAR_FAV": {
              setFavExpanded();
              break;
            }
            case "TOGGLE_SIDEBAR_ALL": {
              setAllExpanded();
              break;
            }
            case "TOGGLE_SIDEBAR_AUTO": {
              setAutoExpanded();
              break;
            }
            case "TOGGLE_SIDEBAR_GROUPS": {
              toggleExpandAllGroups();
              break;
            }
            case "OPEN_SCRATCHPAD":
              openScratchpad();
              break;
            case "OPEN_DASHBOARD_DIALOG":
              setSettingsOpen(true);
              break;
            case "OPEN_NEW_HOST_DIALOG":
              openAddHostDialog();
              break;
            case "OPEN_NEW_BUTTON_DIALOG":
              openAddButtonDialog();
              break;
            case "REFRESH":
              refreshData({ sync: 2 });
              break;
            case "NONE":
              break;
            default: {
              return assertUnreachable(payload);
            }
          }
          if (!noFocus) {
            triggerFocus();
          }
          break;
        }
        case "run_script":
          await runScript({ button: btn, alternativeMode });
          break;

        default:
          return assertUnreachable(btn.type);
      }
    },
    [sendParsedString],
  );

  useEffect(() => {
    const autorun = getIntVar(VAR_CS_NOAUTORUN) !== 1 && startupParams.get(VAR_NOAUTORUN) !== "1";
    const sanitizeHash =
      __CS_ENV__ === 0 &&
      getIntVar(VAR_CS_NO_SANITIZE_HASH) !== 1 &&
      startupParams.get(VAR_CS_NO_SANITIZE_HASH) !== "1";
    let hash = window.location.hash.substring(1);
    if (hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    try {
      hash = decodeURIComponent(hash);
    } catch {
      /* empty */
    }
    // hash comes from url and is suecptible to XSS attacks, so sanitize it by default
    if (sanitizeHash) {
      const elements = hash.split(/\s*,\s*/);
      for (let i = 0; i < elements.length; i++) {
        let element = elements[i];
        [element] = cutString(element, "?");
        element = element.replace(/[^a-z0-9._:#@-[\]]+/gi, "");
        elements[i] = element;
      }
      hash = elements.filter(Boolean).join(",");
    }

    const initAsync = async () => {
      console.log("initAsync starting, hash:", hash);
      let data = initialData;
      if (!data) {
        try {
          const res = await fetch("/api/fulldata", { headers: apiReqHeaders() });
          if (res.status === 401) {
            localStorage.removeItem(BROWSER_STORAGE_KEY_TOKEN);
            window.location.href = "/login";
            return;
          }
          if (!res.ok) {
            throw new Error(`status=${res.status}`);
          }
          data = (await res.json()) as FullData;
        } catch (e: unknown) {
          notify(`Fail to load data: ${e}`, "error", TOAST_KEY_API_FULLDATA);
          const tabId = genTabId(LOCAL_NAME);
          const paneId = genPaneId(LOCAL_NAME);
          setTabs((tabs) => [
            ...tabs,
            {
              id: tabId,
              panes: [{ id: paneId, host: LOCAL_NAME, state: "" }],
              activePaneId: paneId,
              title: LOCAL_NAME,
              type: "terminal",
            },
          ]);
          setActiveTabId(tabId);
          setActivePaneId(paneId);
          return;
        }
      }

      useStore.setState(data);

      __CS_AUTORUN_DONE__ = 0;
      if (autorun) {
        const buttons = getStore().buttons;
        if (!hash) {
          for (const button of buttons) {
            if (button.type === "open_terminal" && button.autorun === 1) {
              await openHost(button.payload, { noUpdateRecent: true });
            }
          }
        }
        for (const button of buttons) {
          if (button.type === "run_script" && button.autorun === 1) {
            try {
              await runScript({ button, background: true });
            } catch (e) {
              console.error(`Autorun script ${button.name} error:`, e);
            }
          }
        }
      }
      __CS_AUTORUN_DONE__ = 1;

      const pinnedTabsData = data.pinned.filter((p) => !p.isHidden);
      const pinnedElsewhere = pinnedTabsData.some((p) => p.listenerCount > 0);

      const autoload =
        getIntVar(VAR_CS_NOAUTOLOAD) !== 1 && startupParams.get(VAR_NOAUTOLOAD) !== "1" && getStore().tabs.length === 0;

      if (hash) {
        const hostsData = data.hosts || [];
        if (hash.startsWith("#")) {
          // Tag mode /##tag
          const tag = hash.substring(1);
          const filtered = hostsData.filter((h) => h.tags && h.tags.includes(tag));

          const favs = filtered.filter((h) => h.tags?.includes(TAG_FAV)).sort(hostSorter);
          const normals = filtered.filter((h) => !h.tags?.includes(TAG_FAV) && !h.isAuto).sort(hostSorter);
          const autos = filtered.filter((h) => !h.tags?.includes(TAG_FAV) && h.isAuto).sort(hostSorter);

          const targets = [...favs, ...normals, ...autos].slice(0, 4);
          if (targets.length > 0) {
            openHostsAsSplit(
              tag.startsWith(TAG_GROUP_PREFIX) ? tag.slice(TAG_GROUP_PREFIX.length) : tag,
              targets.map((h) => h.name),
            );
          } else {
            const tabId = genTabId(LOCAL_NAME);
            const paneId = genPaneId(LOCAL_NAME);
            setTabs((tabs) => [
              ...tabs,
              {
                id: tabId,
                panes: [{ id: paneId, host: LOCAL_NAME, state: "" }],
                activePaneId: paneId,
                title: LOCAL_NAME,
                type: "terminal",
              },
            ]);
            setActiveTabId(tabId);
            setActivePaneId(paneId);
          }
        } else if (!hash.startsWith("$")) {
          // Directly open host(s): /#host1,host2
          const hosts: string[] = hash.split(/\s*,\s*/);
          if (hosts.length > 0) {
            openHostsAsSplit2(hosts);
          } else {
            const tabId = genTabId(LOCAL_NAME);
            const paneId = genPaneId(LOCAL_NAME);
            setTabs((tabs) => [
              ...tabs,
              {
                id: tabId,
                panes: [{ id: paneId, host: LOCAL_NAME, state: "" }],
                activePaneId: paneId,
                title: LOCAL_NAME,
                type: "terminal",
              },
            ]);
            setActiveTabId(tabId);
            setActivePaneId(paneId);
            dialogs.alert(`SSH server "${hash}" not found.`);
          }
        }
      } else if (autoload) {
        if (!pinnedElsewhere) {
          // Only auto-open tabs that are not currently in use by any client
          const availablePins = pinnedTabsData.filter((p) => !p.listenerCount || p.listenerCount === 0);
          const pinnedTabs = availablePins.map((p) => {
            const paneId = p.id;
            return {
              id: p.id,
              panes: [{ id: paneId, host: p.host, state: "" }],
              activePaneId: paneId,
              title: p.title,
              isPinned: true,
              isLocked: p.isLocked,
              type: "terminal",
            } satisfies TabData;
          });
          if (pinnedTabs.length > 0) {
            setTabs((prev) => (prev.length > 0 ? prev : pinnedTabs));
            if (!getStore().activeTabId) {
              setActiveTabId(pinnedTabs[0].id);
            }
            if (!getStore().activePaneId) {
              setActivePaneId(pinnedTabs[0].activePaneId);
            }
          } else {
            const tabId = genTabId(LOCAL_NAME);
            const paneId = genPaneId(LOCAL_NAME);
            setTabs((prev) =>
              prev.length > 0
                ? prev
                : [
                    {
                      id: tabId,
                      panes: [{ id: paneId, host: LOCAL_NAME, state: "" }],
                      activePaneId: paneId,
                      title: LOCAL_NAME,
                      type: "terminal",
                    },
                  ],
            );
            if (!getStore().activeTabId) {
              setActiveTabId(tabId);
            }
            if (!getStore().activePaneId) {
              setActivePaneId(paneId);
            }
          }
        } else {
          const tabId = genTabId(LOCAL_NAME);
          const paneId = genPaneId(LOCAL_NAME);
          setTabs((prev) =>
            prev.length > 0
              ? prev
              : [
                  {
                    id: tabId,
                    panes: [{ id: paneId, host: LOCAL_NAME, state: "" }],
                    activePaneId: paneId,
                    title: LOCAL_NAME,
                    type: "terminal",
                  },
                ],
          );
          if (!getStore().activeTabId) {
            setActiveTabId(tabId);
          }
          if (!getStore().activePaneId) {
            setActivePaneId(paneId);
          }
        }
      }
    };

    initAsync();
    // Run ONLY once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReconnectTab = useCallback((id: string) => {
    setContextMenu(null);
    const targetTab = getStore().tabs.find((t) => t.id === id);
    if (!targetTab) {
      return;
    }
    targetTab.panes.forEach((p) => {
      const term = terminalRefs.current[p.id];
      if (term && "getXterm" in term) {
        term.reconnect();
      }
    });
  }, []);

  const handleToggleFiles = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    const targetId = contextMenu.targetTabId;
    setContextMenu(null);
    setTabs((prev) => prev.map((t) => (t.id === targetId ? { ...t, showFiles: !t.showFiles } : t)));
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setMemoTabId(id);
    setContextMenu({ mouseX: e.clientX + 2, mouseY: e.clientY - 6, targetTabId: id });
  }, []);

  const handleCloseMenu = useCallback(() => setContextMenu(null), []);

  const getTerminalRefs = useCallback(() => terminalRefs.current, []);
  const getApplets = useCallback(() => appletRefs.current, []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setTheme = useCallback((options: any, ...args: any[]) => setMuiTheme(createTheme(options, ...args)), []);

  useEffect(() => {
    return setupPluginAPI({
      setTheme,
      setApplets,
      isMobile,
      maxZIndexRef,
      getTerminalRefs,
      getApplets,
    });
  }, [isMobile, getTerminalRefs, getApplets, setTheme]);

  // ── Keyboard shortcuts (reads fresh state from store — tiny stable dep array) ──
  useKeyboardManager({
    handleButtonClick,
    getTerminalRefs,
  });

  const [lastKeyboardHeight, setLastKeyboardHeight] = useState(0);

  // 1. Bring back a safe tracking state just for the closing transition
  const [isClosingPanel, setIsClosingPanel] = useState(false);
  const prevExtraKeysOpen = useRef(extraKeysOpen);

  useEffect(() => {
    if (keyboardHeight > 60) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastKeyboardHeight(keyboardHeight);
    }
  }, [keyboardHeight]);

  // 2. Track when the panel closes to hold the spacer momentarily
  useEffect(() => {
    if (prevExtraKeysOpen.current === true && extraKeysOpen === false) {
      setIsClosingPanel(true);
      const timer = setTimeout(() => setIsClosingPanel(false), 200);
      return () => clearTimeout(timer);
    }
    prevExtraKeysOpen.current = extraKeysOpen;
  }, [extraKeysOpen]);

  const activeKbHeight = keyboardHeight > 60 ? keyboardHeight : lastKeyboardHeight;
  const panelHeight = activeKbHeight > 60 ? activeKbHeight + 40 : Math.floor(window.innerHeight * 0.38);

  const barHeight = extraKeysOpen ? 0 : 40;

  // 3. CRITICAL FIX: Only calculate the spacer if the panel is open or closing.
  // Otherwise, it must be exactly 0 (like on initial page load).
  const spacerHeight = Math.floor(
    extraKeysOpen || isClosingPanel ? Math.max(0, panelHeight - keyboardHeight - barHeight) : 0,
  );

  const onTerminalFocus = useCallback(() => {}, []);
  const onTerminalBlur = useCallback(() => {
    setExtraKeysOpen(false);
  }, []);

  useEffect(() => {
    if (applets.length === 0) {
      triggerFocus();
    }
  }, [applets.length]);

  return (
    <ThemeProvider theme={muiTheme}>
      <Box id="main-ui" sx={{ display: "flex", height: viewportHeight, overflow: "hidden" }}>
        <CssBaseline />
        <Sidebar
          isMobile={isMobile}
          isTouch={isTouch}
          onAttach={(id, host, title, isLocked) => {
            attachSession(id, host, title, isLocked);
            setMobileOpen(false);
          }}
          onRefresh={() => {
            refreshData({ sync: 2 });
            setMobileOpen(false);
          }}
          onOpenScratchpad={() => {
            openScratchpad();
            setMobileOpen(false);
          }}
        />
        <Box
          id="main-content"
          component="main"
          sx={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            position: "relative",
          }}
        >
          <TabBar
            terminalRefs={terminalRefs}
            isMobile={isMobile}
            isTouch={isTouch}
            hasSidebarApplet={hasSidebarApplet}
            scratchpadSyncState={scratchpadSyncState}
            handleContextMenu={handleContextMenu}
            handleCloseSearch={handleCloseSearch}
          />
          <TerminalGrid
            terminalRefs={terminalRefs}
            onTerminalBlur={onTerminalBlur}
            onTerminalFocus={onTerminalFocus}
            scratchpadSyncState={scratchpadSyncState}
            setScratchpadSyncState={setScratchpadSyncState}
            isTouch={isTouch}
            isMobile={isMobile}
            hasSidebarApplet={hasSidebarApplet}
            handleTouchStart={handleTouchStart}
            handleTouchEnd={handleTouchEnd}
            handleSendKey={handleSendKey}
            gestureMode={gestureMode}
            onGestureModeChange={setGestureMode}
            extraKeysOpen={extraKeysOpen}
            onExtraKeysOpenChange={setExtraKeysOpen}
            keyboardHeight={keyboardHeight}
          />
          <ButtonBar groups={groups} handleButtonClick={handleButtonClick} isMobile={isMobile} isTouch={isTouch} />
          <Box
            id="mobile-keyboard-spacer"
            sx={{
              flexShrink: 0,
              order: 9999,
              height: `${spacerHeight}px`, // Controlled strictly by React math
              width: "100%",
            }}
          />
        </Box>
        {applets.filter((a) => a.position === "sidebar").length > 0 &&
          (isMobile ? (
            <Drawer
              anchor="right"
              open={mobileAppletsOpen}
              onClose={() => setMobileAppletsOpen(false)}
              sx={{ "& .MuiDrawer-paper": { width: 320, boxSizing: "border-box" } }}
            >
              <Box
                sx={{
                  px: 1,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: 1,
                  borderColor: "divider",
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: "bold" }}>
                  Applets
                </Typography>
                <IconButton onClick={() => setMobileAppletsOpen(false)}>
                  <CloseIcon />
                </IconButton>
              </Box>
              <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
                {applets
                  .filter((a) => a.position === "sidebar")
                  .map((applet, idx) => (
                    <AppletWrapper
                      key={applet.name}
                      applet={applet}
                      invisible={isMobile && !mobileAppletsOpen}
                      index={idx}
                      onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
                      onSwitchPosition={(pos) =>
                        setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: pos } : a)))
                      }
                    />
                  ))}
              </Box>
            </Drawer>
          ) : (
            <Box
              sx={{
                width: 320,
                flexShrink: 0,
                borderLeft: 1,
                borderColor: "divider",
                display: "flex",
                flexDirection: "column",
                bgcolor: "background.paper",
                overflow: "hidden",
                height: "100%",
              }}
            >
              {applets
                .filter((a) => a.position === "sidebar")
                .map((applet, idx) => (
                  <AppletWrapper
                    key={applet.name}
                    applet={applet}
                    index={idx}
                    onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
                    onSwitchPosition={(pos) =>
                      setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: pos } : a)))
                    }
                  />
                ))}
            </Box>
          ))}
      </Box>

      {applets
        .filter((a) => a.position === "widget")
        .map((applet, idx) => (
          <AppletWrapper
            key={applet.name}
            applet={applet}
            index={idx}
            onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
            onSwitchPosition={(pos) =>
              setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: pos } : a)))
            }
            onFocus={() =>
              setApplets((prev) =>
                prev.map((a) => (a.name === applet.name ? { ...a, zIndex: maxZIndexRef.current++ } : a)),
              )
            }
          />
        ))}

      {applets
        .filter((a) => a.position === "dialog")
        .map((applet) => (
          <Dialog
            key={applet.name}
            open
            onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
            fullWidth
            fullScreen={applet.fullScreen}
            maxWidth={false}
            slotProps={{
              paper: {
                sx: {
                  width: applet.width ?? 600,
                  maxWidth: "95vw",
                  height: applet.height ?? undefined,
                },
              },
            }}
          >
            <DialogTitle
              sx={{
                display: "flex",
                alignItems: "center",
                p: 1,
                pl: 2,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: "bold" }}>
                {applet.name}
              </Typography>
              <IconButton
                size="small"
                title="Move to sidebar"
                onClick={() =>
                  setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: "sidebar" } : a)))
                }
                sx={{ mr: 0.5 }}
              >
                <ViewSidebarIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                title="Move to widget"
                onClick={() =>
                  setApplets((prev) =>
                    prev.map((a) =>
                      a.name === applet.name ? { ...a, position: "widget", zIndex: maxZIndexRef.current++ } : a,
                    ),
                  )
                }
                sx={{ mr: 0.5 }}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
              <AppletWrapper
                applet={applet}
                index={0}
                onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
                onSwitchPosition={(pos) =>
                  setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: pos } : a)))
                }
              />
            </DialogContent>
          </Dialog>
        ))}

      <DialogManager
        isMobile={isMobile}
        isTouch={isTouch}
        contextMenu={contextMenu}
        handleCloseMenu={handleCloseMenu}
        memoTabId={memoTabId}
        handleToggleFiles={handleToggleFiles}
        handleReconnectTab={handleReconnectTab}
        groups={groups}
        sendParsedString={sendParsedString}
        handleButtonClick={handleButtonClick}
      />
      <SideEffect />
    </ThemeProvider>
  );
}
