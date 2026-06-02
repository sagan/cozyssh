import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router";
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

import type {
  FullData,
  HostData,
  ButtonData,
  RecentUpdateRequest,
  SessionsAttachRequest,
  TabsPinRequest,
  TabsUnpinRequest,
  SessionsCloseRequest,
  TabsRenameRequest,
  ButtonsMoveRequest,
  TabsLockRequest,
} from "./api";
import {
  APP_NAME,
  DEFAULT_SCROLL_LINES,
  BROWSER_STORAGE_KEY_ACTIVE_GROUP,
  BROWSER_STORAGE_KEY_LOCAL_VARS,
  BROWSER_STORAGE_KEY_RECENTS,
  BROWSER_STORAGE_KEY_TAB_ID,
  BROWSER_STORAGE_KEY_TOKEN,
  DEFAULT_BUTTON_GROUP,
  HEADER_AUTHORIZATION,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  HEADER_CONTENT_TYPE,
  LOCAL_NAME,
  METHOD_DELETE,
  METHOD_POST,
  METHOD_PUT,
  MIME_JSON,
  VAR_CS_NOAUTOLOAD,
  VAR_CS_NOAUTORUN,
  VAR_CS_NOWAKELOCK,
  VAR_CS_SCROLL_LINES,
  VAR_NOAUTOLOAD,
  VAR_NOAUTORUN,
  VIBRATE_PATTERN,
  BROWSER_STORAGE_KEY_SCRATCHPAD_SYNC_STATE,
} from "./constants";
import {
  type ContextMenu,
  type CSEventDetailTerminalChange,
  type NewTabDialogViewMode,
  type Recent,
  type ScratchpadSyncState,
  type Severity,
  type Toast,
  CS_EVENT_TERMINAL_CHANGE,
  defaultTheme,
  genTabId,
  getIntVar,
  nextName,
  genPaneId,
  hostTitle,
  removePassFromHost,
} from "./common";
import {
  type TabData,
  type PaneData,
  useStore,
  getStore,
  setTabs,
  setActiveTabId,
  setActivePaneId,
  setHosts,
  setButtons,
  setVars,
  setLocalVars as storeSetLocalVars,
  triggerFocus,
} from "./store";
import { useLocalStorage } from "./useLocalStorage";
import { setupPluginAPI, runScript, moduleCache } from "./pluginAPI";
import { useKeyboardManager } from "./useKeyboardManager";
import Sidebar from "./Sidebar";
import type { TerminalHandle } from "./Terminal";
import type { ScratchpadHandle } from "./Scratchpad";
import TabBar from "./TabBar";
import TerminalGrid from "./TerminalGrid";
import ButtonBar from "./ButtonBar";
import DialogManager from "./DialogManager";
import AppletWrapper, { type AppletData } from "./AppletWrapper";
import { dialogs } from "./Dialogs";
import { useWakeLock } from "./useWakeLock";

interface DashboardProps {
  initialData?: FullData;
}

export default function Dashboard({ initialData }: DashboardProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isTouch = useMediaQuery("(pointer: coarse)");
  // ── Store state (shared with pluginAPI and keyboard manager) ────────────
  const { tabs, activeTabId, activePaneId, hosts, buttons, vars } = useStore();

  // ── UI-only state (stays in React) ────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileAppletsOpen, setMobileAppletsOpen] = useState(false);
  // terminalRefs is kept as a local ref for all Dashboard-internal usage,
  // and also written into the store so pluginAPI / useKeyboardManager can read it.
  const terminalRefs = useRef<{ [key: string]: TerminalHandle | ScratchpadHandle | null }>({});
  const [viewportHeight, setViewportHeight] = useState("100dvh");
  const [isCtrlActive, setIsCtrlActive] = useState(false);
  const [isAltActive, setIsAltActive] = useState(false);
  const [scratchpadSyncState, setScratchpadSyncState] = useState<ScratchpadSyncState>("offline");
  const [memoTabId, setMemoTabId] = useState<string | null>(null);
  const [unreadTabIds, setUnreadTabIds] = useState<Set<string>>(new Set());
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

  const [activeGroup, setActiveGroup] = useLocalStorage(BROWSER_STORAGE_KEY_ACTIVE_GROUP, DEFAULT_BUTTON_GROUP);
  const [buttonDialogOpen, setButtonDialogOpen] = useState(false);
  const [editingButton, setEditingButton] = useState<ButtonData | null>(null);
  const [buttonFormData, setButtonFormData] = useState<ButtonData>({
    id: "",
    name: "",
    type: "send_string",
    payload: "",
    group: DEFAULT_BUTTON_GROUP,
    autorun: 0,
    order: 0,
    shortcut: "",
  });
  const [initialBtnFormData, setInitialBtnFormData] = useState<ButtonData | null>(null);
  const [btnMenuAnchor, setBtnMenuAnchor] = useState<{ anchor: HTMLElement; btn: ButtonData } | null>(null);
  const [lastMenuBtn, setLastMenuBtn] = useState<ButtonData | null>(null);
  const handleNewButtonClick = useCallback(() => {
    const maxOrder = buttons.length > 0 ? Math.max(...buttons.map((b) => b.order || 0)) : 0;
    const data: ButtonData = {
      id: "",
      name: "",
      type: "send_string",
      payload: "",
      group: activeGroup,
      autorun: 0,
      order: maxOrder + 10 || 10,
      shortcut: "",
    };
    setEditingButton(null);
    setButtonFormData(data);
    setInitialBtnFormData(data);
    setButtonDialogOpen(true);
  }, [activeGroup, buttons]);
  const [buttonsLoaded, setButtonsLoaded] = useState(false);
  const [inputDialogOpen, setInputDialogOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [appendNewLine, setAppendNewLine] = useState(true);
  const [sendScope, setSendScope] = useState<0 | 1 | 2>(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const [recents, setRecents] = useLocalStorage<Recent[]>(BROWSER_STORAGE_KEY_RECENTS, []);
  const [newTabDialogOpen, setNewTabDialogOpen] = useState(false);
  const [newTabDialogInitialViewMode, setNewTabDialogInitialViewMode] = useState<NewTabDialogViewMode>("servers");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarFilterRef = useRef<HTMLInputElement>(null);

  // localVars uses useLocalStorage for persistence; synced into store for pluginAPI
  const [localVars, setLocalVars] = useLocalStorage<Record<string, string>>(BROWSER_STORAGE_KEY_LOCAL_VARS, {});
  useEffect(() => {
    storeSetLocalVars(localVars);
  }, [localVars]);

  // sendScope needs to be readable from stable callbacks
  const sendScopeRef = useRef<0 | 1 | 2>(0);
  useEffect(() => {
    sendScopeRef.current = sendScope;
  }, [sendScope]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(CS_EVENT_TERMINAL_CHANGE, {
        detail: { activePaneId } satisfies CSEventDetailTerminalChange,
      }),
    );
  }, [activePaneId]);

  const csNotify = useCallback((msg: string, severity: Severity = "info") => {
    toastIdRef.current++;
    const id = toastIdRef.current;
    setToasts((prev) => {
      const newToasts = [...prev, { id, msg, severity }];
      return newToasts.slice(-3); // Keep last 3
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const handleTerminalData = useCallback((tabId: string) => {
    setUnreadTabIds((prev) => {
      // Don't mark active tab or already unread tabs
      if (tabId === getStore().activeTabId || prev.has(tabId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (unreadTabIds.has(activeTabId)) {
      setUnreadTabIds((prev) => {
        const next = new Set(prev);
        next.delete(activeTabId);
        return next;
      });
    }
  }, [activeTabId, unreadTabIds]);

  useEffect(() => {
    localStorage.setItem(BROWSER_STORAGE_KEY_ACTIVE_GROUP, activeGroup);
  }, [activeGroup]);

  const [groups, filteredButtons] = useMemo(() => {
    const groups = [
      DEFAULT_BUTTON_GROUP,
      ...Array.from(
        new Set(buttons.map((b) => b.group || DEFAULT_BUTTON_GROUP).filter((g) => g !== DEFAULT_BUTTON_GROUP)),
      ),
    ].sort();
    const filteredButtons = buttons.filter((b) => (b.group || DEFAULT_BUTTON_GROUP) === activeGroup);
    return [groups, filteredButtons];
  }, [buttons, activeGroup]);

  useEffect(() => {
    if (buttonsLoaded && !groups.includes(activeGroup)) {
      setActiveGroup(DEFAULT_BUTTON_GROUP);
    }
  }, [groups, buttonsLoaded, activeGroup, setActiveGroup]);

  useEffect(() => {
    appletRefs.current = applets;
  }, [applets]);

  const handleSelectHost = useCallback(
    async (
      host: string,
      {
        title,
        target,
        options,
        noUpdateRecent,
      }: { title?: string; target?: string; options?: Record<string, string>; noUpdateRecent?: boolean } = {},
    ) => {
      const i = host.lastIndexOf("?");
      if (i !== -1) {
        options = { ...Object.fromEntries(new URLSearchParams(host.slice(i))), ...options };
        host = host.slice(0, i);
      }
      if (options) {
        const { title: _title, target: _target, ...otherOptions } = options;
        title = title || _title;
        target = target || _target;
        options = otherOptions;
      }
      if (options?.id) {
        for (const tab of getStore().tabs) {
          for (const pane of tab.panes) {
            if (pane.id === options.id) {
              setActiveTabId(tab.id);
              setActivePaneId(pane.id);
              if (tab.activePaneId !== pane.id) {
                setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, activePaneId: pane.id } : t)));
              }
              triggerFocus();
              return;
            }
          }
        }
      }
      const paneId = options?.id || genPaneId(host);
      const sessionId = options?.id || undefined;
      let targetTab: TabData | undefined;
      if (target === "_blank") {
        target = "";
      } else if (target === "_self") {
        target = getStore().activeTabId;
      }
      if (target) {
        targetTab = getStore().tabs.find((t) => t.id === target);
        if (targetTab && targetTab.panes.length >= 4) {
          target = "";
          targetTab = undefined;
        }
      }
      if (targetTab) {
        const newPane: PaneData = { id: paneId, sessionId, host, options };
        setTabs((prev) =>
          prev.map((t) => (t.id === target ? { ...t, panes: [...t.panes, newPane], activePaneId: paneId } : t)),
        );
        setActiveTabId(targetTab.id);
        setActivePaneId(paneId);
      } else {
        const tabId = target || genTabId(host);
        const newTab: TabData = {
          id: tabId,
          title: title || hostTitle(host),
          panes: [{ id: paneId, host, options }],
          activePaneId: paneId,
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(tabId);
        setActivePaneId(paneId);
      }

      host = removePassFromHost(host);

      // Record recent
      if (!noUpdateRecent && host !== LOCAL_NAME) {
        const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
        try {
          fetch("/api/recents", {
            method: METHOD_POST,
            headers: {
              [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
              [HEADER_CONTENT_TYPE]: MIME_JSON,
            },
            body: JSON.stringify({ host } satisfies RecentUpdateRequest),
          });

          // Optimistic update for local recents
          setRecents((prev) => {
            const now = Math.floor(Date.now() / 1000);
            const idx = prev.findIndex((r) => r.host === host);
            const next = [...prev];
            if (idx >= 0) {
              next[idx] = { ...next[idx], last_used: now };
            } else {
              next.push({ host, last_used: now });
            }
            return next.sort((a, b) => b.last_used - a.last_used).slice(0, 50);
          });
        } catch (e) {
          console.error("Failed to record recent:", e);
        }
      }
    },
    [setRecents],
  );

  const handleSelectTagAsSplit = useCallback(
    (tag: string, hosts: string[], hostOptions?: (Record<string, string> | undefined)[]) => {
      const tabId = genTabId(tag);
      const panes: PaneData[] = hosts.map(
        (host, i) =>
          ({
            id: genPaneId(host),
            host,
            options: hostOptions?.[i],
          }) satisfies PaneData,
      );
      const newTab: TabData = {
        id: tabId,
        title: tag,
        panes: panes,
        activePaneId: panes[0].id,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setActivePaneId(panes[0].id);
    },
    [],
  );

  const handleAttach = useCallback(async (id: string, host: string, title: string, isLocked: boolean = false) => {
    const existing = getStore().tabs.find((t) =>
      t.panes.some((p) => (p.sessionId || p.id) === id && p.state !== "stolen"),
    );
    if (existing) {
      setActiveTabId(existing.id);
      setActivePaneId(
        existing.panes.find((p) => (p.sessionId || p.id) === id && p.state !== "stolen")?.id || existing.activePaneId,
      );
      return;
    }
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    await fetch("/api/sessions/attach", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify({ id } satisfies SessionsAttachRequest),
    });
    const tabId = genTabId(host);
    const paneId = genPaneId(host);
    setTabs((prev) => [
      ...prev,
      {
        id: tabId,
        panes: [{ id: paneId, sessionId: id, host }],
        activePaneId: paneId,
        title,
        isPinned: true,
        isLocked,
      },
    ]);
    setActiveTabId(tabId);
    setActivePaneId(paneId);
  }, []);

  const [sysHostname, setSysHostname] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>("dev");

  const loadFullData = useCallback(
    (data: FullData) => {
      if (data.sysinfo) {
        setSysHostname(data.sysinfo.hostname || "unknown");
        setAppVersion(data.sysinfo.version || "dev");
      }
      if (data.hosts) {
        setHosts(data.hosts);
      }
      if (data.buttons) {
        setButtons(data.buttons || []);
        setButtonsLoaded(true);
      }
      if (data.vars) {
        setVars(data.vars || {});
      }
      if (data.recents) {
        setRecents(data.recents);
      }
    },
    [setRecents],
  );

  const handleRefresh = useCallback(async () => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      const r = await fetch("/api/fulldata", {
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });
      if (r.status === 401) {
        localStorage.removeItem(BROWSER_STORAGE_KEY_TOKEN);
        window.location.href = "/login";
        return;
      }
      const data: FullData = await r.json();
      loadFullData(data);
    } catch (e) {
      console.error(e);
    }
  }, [loadFullData]);

  const [muiTheme, setMuiTheme] = useState(defaultTheme);

  const handleCloseInputDialog = useCallback(() => {
    setInputDialogOpen(false);
    triggerFocus();
  }, []);

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

  const sendParsedString = useCallback(async (input: string) => {
    const scope = sendScopeRef.current;
    const { tabs: currentTabs, activeTabId, activePaneId } = getStore();
    let targetPaneIds: string[] = [];
    if (scope === 2) {
      targetPaneIds = currentTabs.flatMap((t) => t.panes.map((p) => p.id));
    } else if (scope === 1) {
      const currentTab = currentTabs.find((t) => t.id === activeTabId);
      targetPaneIds = currentTab ? currentTab.panes.map((p) => p.id) : [activePaneId];
    } else {
      targetPaneIds = [activePaneId];
    }

    // <ctrl-x> syntax. x ranges from ! ( 0b00100001 ) to ~ ( 0b01111110 ).
    // we mask them with 0x1f ( 0b00011111 ) to clear high 3 bits.
    const parts = input.split(/(<ctrl-[!-~]>)/g);
    for (const part of parts) {
      if (!part) {
        continue;
      }
      const ctrlMatch = part.match(/<ctrl-([!-~])>/);
      const dataToSend = ctrlMatch ? String.fromCharCode(ctrlMatch[1].charCodeAt(0) & 0x1f) : part;

      for (const pid of targetPaneIds) {
        if (pid && terminalRefs.current[pid]) {
          const term = terminalRefs.current[pid];
          if (term && "getXterm" in term) {
            term.sendData(dataToSend);
          }
        }
      }
      await new Promise((r) => setTimeout(r, ctrlMatch ? 50 : 10));
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

  const tabId = useRef(sessionStorage.getItem(BROWSER_STORAGE_KEY_TAB_ID) || genTabId(""));

  useEffect(() => {
    sessionStorage.setItem(BROWSER_STORAGE_KEY_TAB_ID, tabId.current);
  }, []);

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
        const term = terminalRefs.current[activePaneId];
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
  }, [extraKeysOpen, activePaneId]);

  const fetchHosts = useCallback(async () => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      const r = await fetch("/api/hosts", {
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });
      if (r.status === 401) {
        localStorage.removeItem(BROWSER_STORAGE_KEY_TOKEN);
        window.location.href = "/login";
        return;
      }
      const data: HostData[] = await r.json();
      setHosts(data || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // these variables are only used in initial phrase, so don't add them to dependency array
  const [startupParams] = useSearchParams();

  useWakeLock(tabs.length > 0 && getIntVar(vars, localVars, VAR_CS_NOWAKELOCK) !== 1);

  useEffect(() => {
    const autorun = getIntVar(vars, localVars, VAR_CS_NOAUTORUN) !== 1 && startupParams.get(VAR_NOAUTORUN) !== "1";
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const hash = window.location.hash.substring(1);
    if (hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    const initAsync = async () => {
      console.log("initAsync starting, hash:", hash);
      let data = initialData;
      if (!data) {
        try {
          const r = await fetch("/api/fulldata", {
            headers: {
              [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
            },
          });
          if (r.status === 401) {
            localStorage.removeItem(BROWSER_STORAGE_KEY_TOKEN);
            window.location.href = "/login";
            return;
          }
          if (!r.ok) {
            csNotify(`Fail to load data: status=${r.status}`);
            return;
          }
          data = (await r.json()) as FullData;
        } catch (e) {
          console.error(e);
          const tabId = genTabId(LOCAL_NAME);
          const paneId = genPaneId(LOCAL_NAME);
          setTabs((tabs) => [
            ...tabs,
            {
              id: tabId,
              panes: [{ id: paneId, host: LOCAL_NAME }],
              activePaneId: paneId,
              title: LOCAL_NAME,
            },
          ]);
          setActiveTabId(tabId);
          setActivePaneId(paneId);
          return;
        }
      }

      loadFullData(data);

      __CS_AUTORUN_DONE__ = 0;
      if (autorun) {
        const buttons = getStore().buttons;
        if (!hash) {
          for (const button of buttons) {
            if (button.type === "open_terminal" && button.autorun === 1) {
              await handleSelectHost(button.payload, { noUpdateRecent: true });
            }
          }
        }
        for (const btn of buttons) {
          if (btn.type === "run_script" && btn.autorun === 1) {
            try {
              await handleButtonClick(btn);
            } catch (e) {
              console.error(`Autorun script ${btn.name} error:`, e);
            }
          }
        }
      }
      __CS_AUTORUN_DONE__ = 1;

      const pinnedTabsData = data.pinned || [];
      const pinnedElsewhere = pinnedTabsData.some((p) => p.listenerCount > 0);

      const autoload =
        getIntVar(vars, localVars, VAR_CS_NOAUTOLOAD) !== 1 &&
        startupParams.get(VAR_NOAUTOLOAD) !== "1" &&
        getStore().tabs.length === 0;

      if (hash) {
        const hostsData = data.hosts || [];
        if (hash.startsWith("#")) {
          // Tag mode /##tag
          const tag = hash.substring(1);
          const filtered = hostsData.filter((h) => h.tags && h.tags.includes(tag));

          const nameSorter = (a: HostData, b: HostData) => a.name.localeCompare(b.name);
          const hostNameSorter = (a: HostData, b: HostData) => {
            if (a.hostname === b.hostname) {
              return a.name.localeCompare(b.name);
            }
            return a.hostname.localeCompare(b.hostname);
          };

          const favs = filtered.filter((h) => h.tags?.includes("fav")).sort(nameSorter);
          const normals = filtered.filter((h) => !h.tags?.includes("fav") && !h.is_auto).sort(nameSorter);
          const autos = filtered.filter((h) => !h.tags?.includes("fav") && h.is_auto).sort(hostNameSorter);

          const targets = [...favs, ...normals, ...autos].slice(0, 4);
          if (targets.length > 0) {
            handleSelectTagAsSplit(
              tag,
              targets.map((h) => h.name),
            );
          } else {
            const tabId = genTabId(LOCAL_NAME);
            const paneId = genPaneId(LOCAL_NAME);
            setTabs((tabs) => [
              ...tabs,
              {
                id: tabId,
                panes: [{ id: paneId, host: LOCAL_NAME }],
                activePaneId: paneId,
                title: LOCAL_NAME,
              },
            ]);
            setActiveTabId(tabId);
            setActivePaneId(paneId);
          }
        } else {
          // Single host mode /#host
          const host =
            hash !== LOCAL_NAME
              ? hostsData.find((h) =>
                  hash.includes("@")
                    ? hash === `${h.user || "root"}@${h.hostname}`
                    : h.name === hash || h.hostname === hash,
                )
              : { name: LOCAL_NAME };
          if (host) {
            handleSelectHost(host.name);
          } else {
            const tabId = genTabId(LOCAL_NAME);
            const paneId = genPaneId(LOCAL_NAME);
            setTabs((tabs) => [
              ...tabs,
              {
                id: tabId,
                panes: [{ id: paneId, host: LOCAL_NAME }],
                activePaneId: paneId,
                title: LOCAL_NAME,
              },
            ]);
            setActiveTabId(tabId);
            setActivePaneId(paneId);
            setTimeout(() => dialogs.alert(`SSH server "${hash}" not found in config.`), 100);
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
              panes: [{ id: paneId, host: p.host }],
              activePaneId: paneId,
              title: p.title,
              isPinned: true,
              isLocked: p.isLocked,
            };
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
                      panes: [{ id: paneId, host: LOCAL_NAME }],
                      activePaneId: paneId,
                      title: LOCAL_NAME,
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
                    panes: [{ id: paneId, host: LOCAL_NAME }],
                    activePaneId: paneId,
                    title: LOCAL_NAME,
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

  useEffect(() => {
    const active = tabs.find((t) => t.id === activeTabId);
    if (!active || active.title === LOCAL_NAME) {
      document.title = APP_NAME + " " + sysHostname;
    } else {
      document.title = `${active.title} - ${APP_NAME} ${sysHostname}`;
    }
  }, [tabs, activeTabId, sysHostname]);

  const handleLogout = useCallback(async () => {
    const syncState = localStorage.getItem(BROWSER_STORAGE_KEY_SCRATCHPAD_SYNC_STATE);
    if (syncState && syncState !== "synced") {
      if (
        !(await dialogs.confirm(
          "Scratchpad data is not fully synced to the server. Are you sure you want to log out and clear the local cache?",
        ))
      ) {
        return;
      }
    }
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    if (token) {
      await fetch("/api/sessions/close_all_normal", {
        method: METHOD_POST,
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });
      await fetch("/api/logout", {
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });
    }
    localStorage.clear();
    sessionStorage.clear();
    if (window.caches) {
      await caches.delete("api-data-cache");
      await caches.delete("manifest-cache");
    }
    window.location.href = "/login";
  }, []);

  const handleOpenScratchpad = useCallback(() => {
    const existing = getStore().tabs.find((t) => t.type === "scratchpad");
    if (existing) {
      setActiveTabId(existing.id);
      setActivePaneId(existing.panes[0].id);
      triggerFocus();
      return;
    }
    const tabId = `scratchpad-${Date.now()}`;
    const newTab: TabData = {
      id: tabId,
      title: "Scratchpad",
      panes: [{ id: tabId, host: "scratchpad" }],
      activePaneId: tabId,
      type: "scratchpad",
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setActivePaneId(tabId);
    triggerFocus();
  }, []);

  const handleUnpinTab = useCallback(async (id: string) => {
    setContextMenu(null);
    const tab = getStore().tabs.find((t) => t.id === id);
    if (!tab) {
      return;
    }
    const backendSessionId = tab.panes[0]?.sessionId || tab.panes[0]?.id || id;
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    await fetch("/api/tabs/unpin", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify({ id: backendSessionId } satisfies TabsUnpinRequest),
    });
  }, []);

  const handleCloseTab = useCallback(
    (e: React.MouseEvent | null, id: string) => {
      e?.stopPropagation();
      const { activeTabId, tabs } = getStore();
      const targetTab = tabs.find((t) => t.id === id);
      if (targetTab?.isPinned && !targetTab?.isLocked) {
        handleUnpinTab(id);
      }
      if (targetTab && !targetTab.isLocked) {
        const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
        targetTab.panes.forEach((p) => {
          if (p.state !== "stolen") {
            fetch("/api/sessions/close", {
              method: METHOD_POST,
              headers: {
                [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
                [HEADER_CONTENT_TYPE]: MIME_JSON,
              },
              body: JSON.stringify({ id: p.sessionId || p.id } satisfies SessionsCloseRequest),
            }).catch((e) => console.error(e));
          }
        });
      }

      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        const newTabs = prev.filter((t) => t.id !== id);
        if (activeTabId === id && newTabs.length > 0) {
          const nextIdx = idx > 0 ? idx - 1 : 0;
          const nextTab = newTabs[nextIdx];
          setActiveTabId(nextTab.id);
          setActivePaneId(nextTab.activePaneId);
        } else if (newTabs.length === 0) {
          setActiveTabId("");
          setActivePaneId("");
        }
        return newTabs;
      });
      triggerFocus();
    },
    [handleUnpinTab],
  );

  const handleCloseTabOrPane = useCallback(
    (tabOrPaneId?: string) => {
      const { activeTabId, activePaneId, tabs } = getStore();
      tabOrPaneId = tabOrPaneId || activePaneId;
      if (!tabOrPaneId) {
        return;
      }

      // 1. Check if targetId is a Tab ID
      const targetTab = tabs.find((t) => t.id === tabOrPaneId);
      if (targetTab) {
        handleCloseTab(null, tabOrPaneId);
        return;
      }

      // 2. Check if targetId is a Pane ID
      let parentTab: TabData | undefined;
      let targetPane: PaneData | undefined;
      for (const t of tabs) {
        const p = t.panes.find((pane) => pane.id === tabOrPaneId);
        if (p) {
          parentTab = t;
          targetPane = p;
          break;
        }
      }

      if (parentTab && targetPane) {
        if (parentTab.panes.length > 1) {
          // Multi-pane tab: close the pane
          const paneIdx = parentTab.panes.findIndex((p) => p.id === tabOrPaneId);
          const newPanes = parentTab.panes.filter((p) => p.id !== tabOrPaneId);
          let nextPaneId = parentTab.activePaneId;
          if (parentTab.activePaneId === tabOrPaneId) {
            nextPaneId = newPanes[Math.max(0, paneIdx - 1)].id;
          }

          if (!parentTab.isLocked && targetPane.state !== "stolen") {
            const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
            fetch("/api/sessions/close", {
              method: METHOD_POST,
              headers: {
                [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
                [HEADER_CONTENT_TYPE]: MIME_JSON,
              },
              body: JSON.stringify({ id: targetPane.sessionId || targetPane.id } satisfies SessionsCloseRequest),
            }).catch((e) => console.error(e));
          }

          setTabs((prev) =>
            prev.map((t) => (t.id === parentTab.id ? { ...t, panes: newPanes, activePaneId: nextPaneId } : t)),
          );

          if (activeTabId === parentTab.id) {
            setActivePaneId(nextPaneId);
            triggerFocus();
          }
        } else {
          handleCloseTab(null, parentTab.id);
        }
      }
    },
    [handleCloseTab],
  );

  const handlePinTab = useCallback(async (id: string) => {
    setContextMenu(null);
    const tab = getStore().tabs.find((t) => t.id === id);
    if (!tab) {
      return;
    }
    if (tab.panes.length > 1) {
      dialogs.alert("Only single-pane tabs can be pinned.");
      return;
    }
    const pane = tab.panes[0];
    if (!pane) {
      return;
    }
    const backendSessionId = pane.sessionId || pane.id;
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    // Pinning only supports single-pane tabs for now (backend requirement)
    const host = pane.host || LOCAL_NAME;
    await fetch("/api/tabs/pin", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify({ id: backendSessionId, host, title: tab.title } satisfies TabsPinRequest),
    });
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isPinned: true } : t)));
  }, []);

  const handleLockTab = useCallback(async (id: string) => {
    setContextMenu(null);
    const tab = getStore().tabs.find((t) => t.id === id);
    if (!tab) {
      return;
    }
    if (tab.panes.length > 1) {
      dialogs.alert("Only single-pane tabs can be locked.");
      return;
    }
    const pane = tab.panes[0];
    if (!pane) {
      return;
    }
    const backendSessionId = pane.sessionId || pane.id;
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const host = pane.host || LOCAL_NAME;
    await fetch("/api/tabs/lock", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify({ id: backendSessionId, host, title: tab.title } satisfies TabsLockRequest),
    });
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isLocked: true } : t)));
  }, []);

  const handleUnlockTab = useCallback(async (id: string) => {
    setContextMenu(null);
    const tab = getStore().tabs.find((t) => t.id === id);
    if (!tab) {
      return;
    }
    if (tab.panes.length > 1) {
      dialogs.alert("Only single-pane tabs can be unlocked.");
      return;
    }
    const pane = tab.panes[0];
    if (!pane) {
      return;
    }
    const paneId = pane.sessionId || pane.id;
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const host = pane.host || LOCAL_NAME;
    await fetch("/api/tabs/pin", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify({ id: paneId, host, title: tab.title } satisfies TabsPinRequest),
    });
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isLocked: false } : t)));
  }, []);

  const handleRename = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const targetId = contextMenu.targetTabId;
    setContextMenu(null);
    const targetTab = getStore().tabs.find((t) => t.id === targetId);
    if (!targetTab) {
      return;
    }
    let newTitle = await dialogs.prompt("Enter new tab title:", targetTab.title);
    if (!newTitle) {
      return;
    }
    newTitle = newTitle.trim();
    if (newTitle && newTitle !== targetTab.title) {
      if (targetTab.isPinned) {
        const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
        const backendSessionId = targetTab.panes[0]?.sessionId || targetTab.panes[0]?.id || targetId;
        await fetch("/api/tabs/rename", {
          method: METHOD_POST,
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
            [HEADER_CONTENT_TYPE]: MIME_JSON,
          },
          body: JSON.stringify({ id: backendSessionId, title: newTitle } satisfies TabsRenameRequest),
        });
      }
      setTabs((prev) => prev.map((t) => (t.id === targetId ? { ...t, title: newTitle } : t)));
    }
    triggerFocus();
  }, [contextMenu]);

  const handleCloneSession = useCallback((id: string, cloneInSameTab?: boolean) => {
    setContextMenu(null);
    let pane: PaneData | undefined;
    let tab: TabData | undefined;
    outer: for (const t of getStore().tabs) {
      if (t.id === id) {
        if (t.panes.length === 0) {
          // impossible case
          return;
        }
        tab = t;
        pane = t.panes[0];
        break;
      }
      for (const p of t.panes) {
        if (p.id === id) {
          pane = p;
          tab = t;
          break outer;
        }
      }
    }
    if (!tab || !pane || (cloneInSameTab && tab.panes.length >= 4)) {
      return;
    }
    const newPaneId = genPaneId(pane.host);
    const newTabId = genTabId(pane.host);
    const backendSessionId = pane.sessionId || pane.id;
    setTabs((prev) => {
      const newPane = { id: newPaneId, host: pane.host, cloneFrom: backendSessionId, state: pane.state };
      if (cloneInSameTab) {
        return prev.map((t) =>
          t.id === tab.id && t.panes.length < 4 ? { ...t, panes: [...t.panes, newPane], activePaneId: newPaneId } : t,
        );
      }
      return [
        ...prev,
        {
          id: newTabId,
          title: nextName(tab.title),
          panes: [newPane],
          activePaneId: newPaneId,
          showFiles: false,
        },
      ];
    });
    if (!cloneInSameTab) {
      setActiveTabId(newTabId);
    }
    setActivePaneId(newPaneId);
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

  const handleCloseOther = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    const targetId = contextMenu.targetTabId;
    setContextMenu(null);
    const tab = getStore().tabs.find((t) => t.id === targetId);
    setTabs((prev) => prev.filter((t) => t.id === targetId));
    setActiveTabId(targetId);
    if (tab) {
      setActivePaneId(tab.activePaneId);
    }
    triggerFocus();
  }, [contextMenu]);

  const handleCloseRight = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    const targetId = contextMenu.targetTabId;
    setContextMenu(null);
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === targetId);
      const newTabs = prev.slice(0, idx + 1);
      const targetTab = newTabs[idx];
      if (getStore().activeTabId !== targetId) {
        setActiveTabId(targetId);
        setActivePaneId(targetTab.activePaneId);
      }
      return newTabs;
    });
    triggerFocus();
  }, [contextMenu]);

  useEffect(() => {
    return setupPluginAPI({
      notify: csNotify,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTheme: (options: any, ...args: any[]) => setMuiTheme(createTheme(options, ...args)),
      handleSelectHost,
      handleSelectTagAsSplit,
      handleAttach,
      handleRefresh,
      setApplets,
      setMobileAppletsOpen,
      isMobile,
      maxZIndexRef,
      setLocalVars,
      getTerminalRefs: () => terminalRefs.current,
      getApplets: () => appletRefs.current,
      handleCloseTabOrPane,
    });
  }, [
    csNotify,
    handleAttach,
    handleRefresh,
    handleSelectHost,
    handleSelectTagAsSplit,
    isMobile,
    setLocalVars,
    handleCloseTabOrPane,
  ]);

  const handleButtonClick = useCallback(
    async (btn: Pick<ButtonData, "id" | "name" | "type" | "payload">) => {
      window.navigator.vibrate?.(VIBRATE_PATTERN);
      switch (btn.type) {
        case "send_string":
          await sendParsedString(btn.payload);
          triggerFocus();
          break;

        case "open_terminal":
          handleSelectHost(btn.payload || LOCAL_NAME);
          break;

        case "terminal_function": {
          const term = terminalRefs.current[getStore().activePaneId];
          if (!term || !("getXterm" in term)) {
            return;
          }
          switch (btn.payload) {
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
              setInputValue("");
              setSendScope(0);
              setInputDialogOpen(true);
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
              handleCloseTabOrPane();
              break;

            case "CLOSE_TAB": {
              handleCloseTabOrPane(getStore().activeTabId);
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
              const scrollLines = getIntVar(
                getStore().vars,
                getStore().localVars,
                VAR_CS_SCROLL_LINES,
                DEFAULT_SCROLL_LINES,
              );
              term.scrollLines(-scrollLines);
              term.focus();
              break;
            }

            case "SCROLL_DOWN": {
              const scrollLines = getIntVar(
                getStore().vars,
                getStore().localVars,
                VAR_CS_SCROLL_LINES,
                DEFAULT_SCROLL_LINES,
              );
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
              handleCloneSession(getStore().activePaneId);
              break;

            case "CLONE_SESSION_IN_SAME_TAB":
              handleCloneSession(getStore().activePaneId, true);
              break;

            case "SEARCH":
              setSearchOpen(true);
              setTimeout(() => searchInputRef.current?.focus(), 100);
              break;

            default:
              break;
          }
          break;
        }

        case "misc":
          switch (btn.payload) {
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
              const idx = groups.indexOf(activeGroup);
              let nextIdx = (idx + 1) % groups.length;
              while (nextIdx !== idx && groups[nextIdx].startsWith("_")) {
                nextIdx = (nextIdx + 1) % groups.length;
              }
              setActiveGroup(groups[nextIdx]);
              break;
            }
            case "PREV_BUTTON_GROUP": {
              const idx = groups.indexOf(activeGroup);
              let prevIdx = (idx - 1 + groups.length) % groups.length;
              while (prevIdx !== idx && groups[prevIdx].startsWith("_")) {
                prevIdx = (prevIdx - 1 + groups.length) % groups.length;
              }
              setActiveGroup(groups[prevIdx]);
              break;
            }
            case "OPEN_SCRATCHPAD":
              handleOpenScratchpad();
              break;
            default:
              break;
          }
          triggerFocus();
          break;

        case "run_script":
          await runScript(btn, csNotify);
          break;

        default:
          break;
      }
    },
    [
      sendParsedString,
      handleSelectHost,
      csNotify,
      handleCloseTabOrPane,
      handleCloneSession,
      handleOpenScratchpad,
      groups,
      activeGroup,
      setActiveGroup,
    ],
  );

  // ── Keyboard shortcuts (reads fresh state from store — tiny stable dep array) ──
  useKeyboardManager({
    handleCloneSession,
    handleButtonClick,
    handleSelectHost,
    handleOpenScratchpad,
    handleCloseTabOrPane,
    setNewTabDialogOpen,
    setNewTabDialogInitialViewMode,
    searchInputRef,
    setSearchOpen,
    getTerminalRefs: () => terminalRefs.current,
    sidebarFilterRef,
  });

  const handleSaveButton = useCallback(async () => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const method = editingButton ? METHOD_PUT : METHOD_POST;
    const url = editingButton ? `/api/buttons/${editingButton.id}` : "/api/buttons";
    if (editingButton) {
      delete moduleCache[editingButton.id];
    }
    await fetch(url, {
      method,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(buttonFormData),
    });
    setInitialBtnFormData(null);
    setButtonDialogOpen(false);
    fetch("/api/buttons", {
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    })
      .then((r) => r.json() as Promise<ButtonData[]>)
      .then((data) => {
        setButtons(data || []);
        setButtonsLoaded(true);
        setActiveGroup(buttonFormData.group || DEFAULT_BUTTON_GROUP);
      });
  }, [buttonFormData, editingButton, setActiveGroup]);

  const handleDeleteButton = useCallback(async (id: string, name: string) => {
    setBtnMenuAnchor(null);
    if (!(await dialogs.confirm(`Delete button "${name}"?`))) {
      return;
    }
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    await fetch(`/api/buttons/${id}`, {
      method: METHOD_DELETE,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });
    const res = await fetch("/api/buttons", {
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });
    const data: ButtonData[] = await res.json();
    setButtons(data || []);
    setButtonsLoaded(true);
  }, []);

  const handleMoveButton = useCallback(async (id: string, direction: number) => {
    setBtnMenuAnchor(null);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    await fetch("/api/buttons/move", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify({ id, direction } satisfies ButtonsMoveRequest),
    });
    const res = await fetch("/api/buttons", {
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });
    const data: ButtonData[] = await res.json();
    setButtons(data || []);
    setButtonsLoaded(true);
  }, []);

  const handleCloseBtnDialog = useCallback(
    (_e: unknown, reason: string) => {
      const isDirty = initialBtnFormData && JSON.stringify(buttonFormData) !== JSON.stringify(initialBtnFormData);
      if (isDirty && (reason === "backdropClick" || reason === "escapeKeyDown")) {
        return;
      }
      setButtonDialogOpen(false);
      triggerFocus();
    },
    [buttonFormData, initialBtnFormData],
  );

  const [lastKeyboardHeight, setLastKeyboardHeight] = useState(0);

  // 1. Bring back a safe tracking state just for the closing transition
  const [isClosingPanel, setIsClosingPanel] = useState(false);
  const prevExtraKeysOpen = useRef(extraKeysOpen);

  useEffect(() => {
    if (keyboardHeight > 60) {
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

  return (
    <ThemeProvider theme={muiTheme}>
      <Box id="main-ui" sx={{ display: "flex", height: viewportHeight, overflow: "hidden" }}>
        <CssBaseline />
        <Sidebar
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          onSelect={(host) => {
            handleSelectHost(host);
            setMobileOpen(false);
          }}
          onSelectTagAsSplit={(tag, hosts) => {
            handleSelectTagAsSplit(tag, hosts);
            setMobileOpen(false);
          }}
          onLogout={handleLogout}
          activeTabs={tabs.flatMap((t) => t.panes.filter((p) => p.state !== "stolen").map((p) => p.sessionId || p.id))}
          sysHostname={sysHostname}
          appVersion={appVersion}
          onAttach={(id, host, title, isLocked) => {
            handleAttach(id, host, title, isLocked);
            setMobileOpen(false);
          }}
          onRefresh={() => {
            handleRefresh();
            setMobileOpen(false);
          }}
          hosts={hosts}
          fetchHosts={fetchHosts}
          onOpenScratchpad={() => {
            handleOpenScratchpad();
            setMobileOpen(false);
          }}
          filterRef={sidebarFilterRef}
        />
        <Box
          id="ui-fix-spacer"
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
            mobileOpen={mobileOpen}
            setMobileOpen={setMobileOpen}
            mobileAppletsOpen={mobileAppletsOpen}
            setMobileAppletsOpen={setMobileAppletsOpen}
            searchOpen={searchOpen}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            terminalRefs={terminalRefs}
            unreadTabIds={unreadTabIds}
            isMobile={isMobile}
            applets={applets}
            scratchpadSyncState={scratchpadSyncState}
            handleContextMenu={handleContextMenu}
            handleCloseTab={handleCloseTab}
            handleCloseSearch={handleCloseSearch}
            setNewTabDialogInitialViewMode={setNewTabDialogInitialViewMode}
            setNewTabDialogOpen={setNewTabDialogOpen}
          />
          <TerminalGrid
            terminalRefs={terminalRefs}
            onTerminalBlur={onTerminalBlur}
            onTerminalFocus={onTerminalFocus}
            isCtrlActive={isCtrlActive}
            setIsCtrlActive={setIsCtrlActive}
            isAltActive={isAltActive}
            setIsAltActive={setIsAltActive}
            scratchpadSyncState={scratchpadSyncState}
            setScratchpadSyncState={setScratchpadSyncState}
            handleTerminalData={handleTerminalData}
            isTouch={isTouch}
            isMobile={isMobile}
            mobileAppletsOpen={mobileAppletsOpen}
            setMobileAppletsOpen={setMobileAppletsOpen}
            applets={applets}
            setMobileOpen={setMobileOpen}
            setNewTabDialogOpen={setNewTabDialogOpen}
            setNewTabDialogInitialViewMode={setNewTabDialogInitialViewMode}
            handleTouchStart={handleTouchStart}
            handleTouchEnd={handleTouchEnd}
            handleSendKey={handleSendKey}
            gestureMode={gestureMode}
            onGestureModeChange={setGestureMode}
            extraKeysOpen={extraKeysOpen}
            onExtraKeysOpenChange={setExtraKeysOpen}
            keyboardHeight={keyboardHeight}
            getActiveTerminal={() => terminalRefs.current[activePaneId]}
          />
          <ButtonBar
            activeGroup={activeGroup}
            setActiveGroup={setActiveGroup}
            groups={groups}
            filteredButtons={filteredButtons}
            handleButtonClick={handleButtonClick}
            setBtnMenuAnchor={setBtnMenuAnchor}
            setLastMenuBtn={setLastMenuBtn}
            onNewButtonClick={handleNewButtonClick}
          />
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
        contextMenu={contextMenu}
        handleCloseMenu={handleCloseMenu}
        memoTabId={memoTabId}
        handleUnpinTab={handleUnpinTab}
        handlePinTab={handlePinTab}
        handleUnlockTab={handleUnlockTab}
        handleLockTab={handleLockTab}
        handleCloneSession={handleCloneSession}
        handleToggleFiles={handleToggleFiles}
        handleReconnectTab={handleReconnectTab}
        handleRename={handleRename}
        handleCloseOther={handleCloseOther}
        handleCloseRight={handleCloseRight}
        btnMenuAnchor={btnMenuAnchor}
        setBtnMenuAnchor={setBtnMenuAnchor}
        lastMenuBtn={lastMenuBtn}
        handleMoveButton={handleMoveButton}
        handleDeleteButton={handleDeleteButton}
        buttonDialogOpen={buttonDialogOpen}
        editingButton={editingButton}
        buttonFormData={buttonFormData}
        setButtonFormData={setButtonFormData}
        handleCloseBtnDialog={handleCloseBtnDialog}
        handleSaveButton={handleSaveButton}
        hosts={hosts}
        groups={groups}
        inputDialogOpen={inputDialogOpen}
        handleCloseInputDialog={handleCloseInputDialog}
        inputValue={inputValue}
        setInputValue={setInputValue}
        appendNewLine={appendNewLine}
        setAppendNewLine={setAppendNewLine}
        sendScope={sendScope}
        setSendScope={setSendScope}
        sendParsedString={sendParsedString}
        newTabDialogOpen={newTabDialogOpen}
        setNewTabDialogOpen={setNewTabDialogOpen}
        recents={recents}
        newTabDialogInitialViewMode={newTabDialogInitialViewMode}
        setEditingButton={setEditingButton}
        setInitialBtnFormData={setInitialBtnFormData}
        setButtonDialogOpen={setButtonDialogOpen}
        setInputDialogOpen={setInputDialogOpen}
        activeGroup={activeGroup}
        handleButtonClick={handleButtonClick}
        handleAttach={handleAttach}
        handleRefresh={handleRefresh}
        handleSelectHost={handleSelectHost}
        toasts={toasts}
        setToasts={setToasts}
      />
    </ThemeProvider>
  );
}
