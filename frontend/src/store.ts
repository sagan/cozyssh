/**
 * store.ts
 *
 * Zustand store for core state that must be accessible from
 * non-reactive contexts (global window.cs* functions, keyboard event listeners).
 *
 * Use `useStore` inside React components for reactive subscriptions.
 * Use `getStore()` inside callbacks/event handlers for a synchronous, always-fresh snapshot.
 */

import { create } from "zustand";

import type { HostData, ButtonData, WsTerminalMessage, Recent, LocalShell } from "./api";
import {
  type HostForm,
  type Severity,
  type ShellIntegration,
  type Toast,
  type ViewMode,
  isMuiModalOpen,
  nextTerminalFontSize,
  prevTerminalFontSize,
} from "./common";
import type { TerminalHandle } from "./Terminal";
import type { ScratchpadHandle } from "./Scratchpad";
import {
  BROWSER_STORAGE_KEY_ACTIVE_GROUP,
  BROWSER_STORAGE_KEY_LOCAL_VARS,
  BROWSER_STORAGE_KEY_RECENT_BUTTONS,
  BROWSER_STORAGE_KEY_RECENTS,
  BROWSER_STORAGE_KEY_VARS,
  DEFAULT_BUTTON_GROUP,
  DEFAULT_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_SIZE,
  LOCAL_VAR_PREFIX,
  TOAST_KEY_FONT_SIZE,
  VAR_CS_FONT_SIZE,
  VAR_CS_TERMINAL_FONT_SIZE,
} from "./constants";

export interface PaneData {
  id: string;
  sessionId?: string;
  host: string;
  state: WsTerminalMessage["state"];
  cloneFrom?: string;
  // optional session scope params
  options?: Record<string, string>;
}

export interface TabData {
  id: string;
  title: string;
  panes: PaneData[];
  activePaneId: string;
  isPinned?: boolean;
  isLocked?: boolean;
  showFiles?: boolean;
  type?: "terminal" | "scratchpad";
}

export type TerminalRefMap = Record<string, TerminalHandle | ScratchpadHandle | null>;

interface Store {
  sendScope: 0 | 1 | 2;
  /**
   * Terminal Input dialog: Append new line (\n) checkbox
   */
  appendNewLine: boolean;
  searchOpen: boolean;
  mobileOpen: boolean;
  mobileAppletsOpen: boolean;
  activeGroup: string;
  recents: Recent[];
  toasts: Toast[];
  editHostName: string;
  /**
   * Current editing button
   */
  editButton: ButtonData | null;
  lastMenuBtn: ButtonData | null;
  btnMenuAnchor: { anchor: HTMLElement; btn: ButtonData } | null;
  hostFormData: HostForm;
  initialHostFormData: HostForm | null;
  buttonFormData: ButtonData;
  initialBtnFormData: ButtonData | null;
  editButtonDialogOpen: boolean;
  editHostDialogOpen: boolean;
  inputDialogOpen: boolean;
  inputValue: string;
  inputLiquid: boolean;
  newTabDialogOpen: boolean;
  newTabDialogFilter: string;
  sysHostname: string;
  unreadTabIds: Set<string>;
  focusTrigger: number;
  focusSearchInputTrigger: number;
  tabs: TabData[];
  activeTabId: string;
  activePaneId: string;
  hosts: HostData[];
  shells: LocalShell[];
  buttons: ButtonData[];
  vars: Record<string, string>;
  /** Local (browser-only) vars. All names have a "local_" (case-insensitive) prefix. */
  localVars: Record<string, string>;
  recentButtonIds: string[];
  shellIntegrations: Record<string, ShellIntegration>;
}

function loadFromStorage<T>(key: string, defaultValue: T): T {
  const varsStr = localStorage.getItem(key);
  if (typeof defaultValue === "string") {
    return varsStr ? (varsStr as T) : defaultValue;
  }
  if (varsStr) {
    try {
      return JSON.parse(varsStr);
    } catch {
      /* empty */
    }
  }
  return defaultValue;
}

export const useStore = create<Store>(() => ({
  sendScope: 0,
  appendNewLine: true,
  searchOpen: false,
  mobileOpen: false,
  mobileAppletsOpen: false,
  activeGroup: loadFromStorage(BROWSER_STORAGE_KEY_ACTIVE_GROUP, DEFAULT_BUTTON_GROUP),
  recents: loadFromStorage(BROWSER_STORAGE_KEY_RECENTS, []),
  toasts: [],
  editHostName: "",
  editButton: null,
  lastMenuBtn: null,
  btnMenuAnchor: null,
  hostFormData: {
    name: "",
    hostname: "",
    user: "root",
    port: "22",
    identity_file: "",
    source: "",
    proxy_jump: "",
    remote_command: "",
    tags: "",
    comment: "",
  },
  initialHostFormData: null,
  buttonFormData: {
    id: "",
    name: "",
    type: "send_string",
    payload: "",
    group: DEFAULT_BUTTON_GROUP,
    autorun: 0,
    order: 0,
    mtime: 0,
    shortcut: "",
  },
  initialBtnFormData: null,
  editButtonDialogOpen: false,
  editHostDialogOpen: false,
  newTabDialogOpen: false,
  newTabDialogFilter: "",
  inputDialogOpen: false,
  inputValue: "",
  inputLiquid: false,
  sysHostname: "",
  unreadTabIds: new Set<string>(),
  focusTrigger: 0,
  focusSearchInputTrigger: 0,
  tabs: [],
  activeTabId: "",
  activePaneId: "",
  hosts: [],
  shells: [],
  buttons: [],
  vars: loadFromStorage(BROWSER_STORAGE_KEY_VARS, {}),
  localVars: loadFromStorage(BROWSER_STORAGE_KEY_LOCAL_VARS, {}),
  recentButtonIds: loadFromStorage(BROWSER_STORAGE_KEY_RECENT_BUTTONS, []),
  shellIntegrations: {},
}));

export const triggerFocus = () =>
  useStore.setState((state) => ({
    focusTrigger: state.focusTrigger + 1,
  }));

export const triggerFocusSearchInput = () =>
  useStore.setState((state) => ({
    focusSearchInputTrigger: state.focusSearchInputTrigger + 1,
  }));

let toastId = 0;

export const notify = (msg: string, severity: Severity = "info", key?: string) => {
  const id = key ? `${key}-${toastId++}` : toastId++;
  setToasts((prev) => {
    const newToast = { id, key, msg, severity };
    const newToasts = key
      ? [...prev.filter((t) => typeof t.id === "number" || !t.id.startsWith(key + "-")), newToast]
      : [...prev, newToast];
    return newToasts.slice(-3); // Keep last 3
  });
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, 4000);
};

export const updateRecentButtonId = (id: string) => {
  useStore.setState((state) => {
    if (state.recentButtonIds[0] === id) {
      return {};
    }
    const filtered = state.recentButtonIds.filter((i) => i !== id);
    const updated = [id, ...filtered].slice(0, 10);
    localStorage.setItem(BROWSER_STORAGE_KEY_RECENT_BUTTONS, JSON.stringify(updated));
    return { recentButtonIds: updated };
  });
};

export const setSendScope = (sendScope: 0 | 1 | 2) => useStore.setState({ sendScope });

export const setAppendNewLine = (update: boolean | ((data: boolean) => boolean)) =>
  useStore.setState((state) => ({
    appendNewLine: typeof update === "function" ? update(state.appendNewLine) : update,
  }));

export const setSearchOpen = (update: boolean | ((data: boolean) => boolean)) =>
  useStore.setState((state) => ({
    searchOpen: typeof update === "function" ? update(state.searchOpen) : update,
  }));

export const setMobileOpen = (update: boolean | ((data: boolean) => boolean)) =>
  useStore.setState((state) => ({
    mobileOpen: typeof update === "function" ? update(state.mobileOpen) : update,
  }));

export const setMobileAppletsOpen = (update: boolean | ((data: boolean) => boolean)) =>
  useStore.setState((state) => ({
    mobileAppletsOpen: typeof update === "function" ? update(state.mobileAppletsOpen) : update,
  }));

export const setEditButton = (editButton: ButtonData | null) => useStore.setState({ editButton });
export const setLastMenuBtn = (lastMenuBtn: ButtonData | null) => useStore.setState({ lastMenuBtn });
export const setBtnMenuAnchor = (btnMenuAnchor: { anchor: HTMLElement; btn: ButtonData } | null) =>
  useStore.setState({ btnMenuAnchor });

export const setActiveGroup = (activeGroup: string) => {
  useStore.setState({ activeGroup });
  localStorage.setItem(BROWSER_STORAGE_KEY_ACTIVE_GROUP, activeGroup);
};

export const setRecents = (update: Recent[] | ((prev: Recent[]) => Recent[])) =>
  useStore.setState((state) => ({
    recents: typeof update === "function" ? update(state.recents) : update,
  }));

export const setToasts = (update: Toast[] | ((data: Toast[]) => Toast[])) =>
  useStore.setState((state) => ({
    toasts: typeof update === "function" ? update(state.toasts) : update,
  }));
export const setEditHostName = (editHostName: string) => useStore.setState({ editHostName });
export const setHostFormData = (hostFormData: HostForm) => useStore.setState({ hostFormData });
export const setInitialHostFormData = (initialHostFormData: HostForm | null) =>
  useStore.setState({ initialHostFormData });
export const setButtonFormData = (buttonFormData: ButtonData) => useStore.setState({ buttonFormData });
export const setInitialBtnFormData = (initialBtnFormData: ButtonData | null) =>
  useStore.setState({ initialBtnFormData });
export const setEditButtonDialogOpen = (editButtonDialogOpen: boolean) => useStore.setState({ editButtonDialogOpen });
export const setEditHostDialogOpen = (editHostDialogOpen: boolean) => useStore.setState({ editHostDialogOpen });
export const setNewTabDialogOpen = (newTabDialogOpen: boolean) => useStore.setState({ newTabDialogOpen });
export const setNewTabDialogFilter = (newTabDialogFilter: string) => useStore.setState({ newTabDialogFilter });
export const closeNewTabDialog = () => useStore.setState({ newTabDialogOpen: false, newTabDialogFilter: "" });

export function parseNewTabDialogFilter(filter: string): [viewMode: ViewMode, f: string] {
  if (filter.startsWith(">")) {
    return ["buttons", filter.slice(1)];
  } else if (filter.startsWith("@")) {
    return ["tabs", filter.slice(1)];
  } else if (filter.startsWith("?")) {
    return ["help", filter.slice(1)];
  }
  return ["servers", filter];
}

/**
 * Change new tab dialog view mode
 * @param target the new view mode; or undefined / false for next; true for prev;
 */
export const changeNewTabDialogViewMode = (target?: boolean | ViewMode) =>
  useStore.setState((state) => {
    let nextMode: ViewMode;
    const [mode, f] = parseNewTabDialogFilter(state.newTabDialogFilter);
    if (typeof target === "string") {
      nextMode = target;
    } else {
      const modes: ViewMode[] = ["servers", "tabs", "buttons"];
      const idx = modes.indexOf(mode);
      if (idx === -1) {
        nextMode = "servers";
      } else {
        nextMode = modes[(target ? idx - 1 + modes.length : idx + 1) % modes.length];
      }
    }
    const prefix = nextMode === "buttons" ? ">" : nextMode === "tabs" ? "@" : nextMode === "help" ? "?" : "";
    return { newTabDialogFilter: prefix + f };
  });

export const setInputDialogOpen = (inputDialogOpen: boolean) => useStore.setState({ inputDialogOpen });
export const setInputValue = (inputValue: string) => useStore.setState({ inputValue });
export const setInputLiquid = (inputLiquid: boolean) => useStore.setState({ inputLiquid });

export const setSysHostname = (sysHostname: string) => useStore.setState({ sysHostname });

export const setUnreadTabIds = (unreadTabIds: Set<string>) => useStore.setState({ unreadTabIds });

export const deleteUnreadTabId = (tabId: string) =>
  useStore.setState((state) => ({
    unreadTabIds: new Set([...state.unreadTabIds].filter((id) => id !== tabId)),
  }));

export const addUnreadTabId = (tabId: string) =>
  useStore.setState((state) => ({
    unreadTabIds: new Set([...state.unreadTabIds, tabId]),
  }));

export const setTabs = (update: TabData[] | ((data: TabData[]) => TabData[])) =>
  useStore.setState((state) => ({
    tabs: typeof update === "function" ? update(state.tabs) : update,
  }));

export const setActiveTabId = (activeTabId: string) => useStore.setState({ activeTabId });

export const setActivePaneId = (activePaneId: string) => useStore.setState({ activePaneId });

export const activatePane = (paneId: string, tabId?: string) => {
  useStore.setState((state) => {
    let targetTabId = tabId;

    // If tabId isn't provided, find the tab that contains the specified paneId
    if (!targetTabId) {
      const foundTab = state.tabs.find((tab) => tab.panes.some((pane) => pane.id === paneId));
      if (!foundTab) {
        return {}; // Target pane/tab not found, do nothing
      }
      targetTabId = foundTab.id;
    }

    const updates: Partial<Store> = {};

    // Only update activePaneId if it actually changed
    if (state.activePaneId !== paneId) {
      updates.activePaneId = paneId;
    }

    // Only update activeTabId if it actually changed
    if (state.activeTabId !== targetTabId) {
      updates.activeTabId = targetTabId;
    }

    // Only update the tab's activePaneId if it is different from the current setting
    const targetTab = state.tabs.find((tab) => tab.id === targetTabId);
    if (targetTab && targetTab.activePaneId !== paneId) {
      updates.tabs = state.tabs.map((tab) => (tab.id === targetTabId ? { ...tab, activePaneId: paneId } : tab));
    }

    // Return the partial state updates (Zustand will merge them)
    return updates;
  });
};

export const setHosts = (hosts: HostData[]) => useStore.setState({ hosts });
export const setShells = (shells: LocalShell[]) => useStore.setState({ shells });

export const setButtons = (buttons: ButtonData[]) => useStore.setState({ buttons });

export const setVars = (vars: Record<string, string>) => {
  useStore.setState({ vars });
  // store a duplicate in localStorage
  localStorage.setItem(BROWSER_STORAGE_KEY_VARS, JSON.stringify(vars));
};

export const setLocalVars = (localVars: Record<string, string>) => {
  useStore.setState({ localVars });
  localStorage.setItem(BROWSER_STORAGE_KEY_LOCAL_VARS, JSON.stringify(localVars));
};

/**
 * Clear all in-memory store data - call it when log out
 */
export const clearData = () =>
  useStore.setState({
    activeGroup: "",
    hosts: [],
    tabs: [],
    buttons: [],
    recents: [],
    toasts: [],
    vars: {},
    localVars: {},
    shellIntegrations: {},
    recentButtonIds: [],
  });

/**
 * Clean Cross-Tab Synchronization
 * Listens to storage events outside of React to ensure updates from other
 * browser tabs sync instantaneously into the global Zustand snapshot.
 */
window.addEventListener("storage", (e) => {
  try {
    if (e.key === BROWSER_STORAGE_KEY_VARS) {
      useStore.setState({ vars: e.newValue ? JSON.parse(e.newValue) : {} });
    }
    if (e.key === BROWSER_STORAGE_KEY_LOCAL_VARS) {
      useStore.setState({ localVars: e.newValue ? JSON.parse(e.newValue) : {} });
    }
    if (e.key === BROWSER_STORAGE_KEY_RECENT_BUTTONS) {
      useStore.setState({ recentButtonIds: e.newValue ? JSON.parse(e.newValue) : [] });
    }
  } catch (err) {
    console.warn("Failed to sync cross-tab localStorage update:", err);
  }
});

window.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    !isMuiModalOpen() &&
    (!document.activeElement || !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName))
  ) {
    triggerFocus();
  }
});

export const setShellIntegrations = (
  update:
    | Record<string, ShellIntegration>
    | ((data: Record<string, ShellIntegration>) => Record<string, ShellIntegration>),
) =>
  useStore.setState((state) => ({
    shellIntegrations: typeof update === "function" ? update(state.shellIntegrations) : update,
  }));

/**
 * Synchronous, non-reactive getter — safe to call from event handlers,
 * setTimeout callbacks, and window.cs* plugin functions.
 */
export const getStore = () => useStore.getState();

export type UseStore = typeof useStore;

export function resetFontSize(terminalFontSize: boolean, globalFontSize: boolean, noToast = false) {
  let msg = "";
  let varName: string;
  const { vars, localVars } = getStore();
  if (terminalFontSize) {
    if (!vars[VAR_CS_TERMINAL_FONT_SIZE] || localVars[LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE]) {
      varName = LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE;
    } else {
      varName = VAR_CS_TERMINAL_FONT_SIZE;
    }
    if (DEFAULT_TERMINAL_FONT_SIZE !== (__CS_TERMINAL_OPTIONS__.fontSize || DEFAULT_TERMINAL_FONT_SIZE)) {
      csSetVar(varName, DEFAULT_TERMINAL_FONT_SIZE.toString());
      msg += `Terminal font size reset to ${DEFAULT_TERMINAL_FONT_SIZE}`;
    }
  }

  if (globalFontSize) {
    if (!vars[VAR_CS_FONT_SIZE] || localVars[LOCAL_VAR_PREFIX + VAR_CS_FONT_SIZE]) {
      varName = LOCAL_VAR_PREFIX + VAR_CS_FONT_SIZE;
    } else {
      varName = VAR_CS_FONT_SIZE;
    }
    if (DEFAULT_FONT_SIZE !== __CS_FONT_SIZE__) {
      csSetVar(varName, DEFAULT_FONT_SIZE.toString());
      if (msg) {
        msg += `; `;
      }
      msg += `Global font size reset to ${DEFAULT_FONT_SIZE}`;
    }
  }

  if (msg && !noToast) {
    notify(msg, "info", TOAST_KEY_FONT_SIZE);
  }
}

export function decreseFontSize(terminalFontSize: boolean, globalFontSize: boolean, noToast = false) {
  const { vars, localVars } = getStore();
  let msg = "";
  let varName: string;
  if (terminalFontSize) {
    if (!vars[VAR_CS_TERMINAL_FONT_SIZE] || localVars[LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE]) {
      varName = LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE;
    } else {
      varName = VAR_CS_TERMINAL_FONT_SIZE;
    }
    const fontSize = prevTerminalFontSize(__CS_TERMINAL_OPTIONS__.fontSize || DEFAULT_TERMINAL_FONT_SIZE);
    if (fontSize !== (__CS_TERMINAL_OPTIONS__.fontSize || DEFAULT_TERMINAL_FONT_SIZE)) {
      csSetVar(varName, fontSize.toString());
      msg += `Terminal font size: ${fontSize.toFixed(1).padStart(4, "0")}`;
    }
  }

  if (globalFontSize) {
    if (!vars[VAR_CS_FONT_SIZE] || localVars[LOCAL_VAR_PREFIX + VAR_CS_FONT_SIZE]) {
      varName = LOCAL_VAR_PREFIX + VAR_CS_FONT_SIZE;
    } else {
      varName = VAR_CS_FONT_SIZE;
    }
    const fontSize = Math.max(10, __CS_FONT_SIZE__ - 1);
    if (fontSize !== __CS_FONT_SIZE__) {
      csSetVar(varName, fontSize.toString());
      if (msg) {
        msg += "; ";
      }
      msg += `Global font size: ${fontSize}`;
    }
  }
  if (msg && !noToast) {
    notify(msg, "info", TOAST_KEY_FONT_SIZE);
  }
}

export function increaseFontSize(terminalFontSize: boolean, globalFontSize: boolean, noToast = false) {
  let msg = "";
  const { vars, localVars } = getStore();
  let varName: string;
  if (terminalFontSize) {
    if (!vars[VAR_CS_TERMINAL_FONT_SIZE] || localVars[LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE]) {
      varName = LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE;
    } else {
      varName = VAR_CS_TERMINAL_FONT_SIZE;
    }
    const fontSize = nextTerminalFontSize(__CS_TERMINAL_OPTIONS__.fontSize || DEFAULT_TERMINAL_FONT_SIZE);
    if (fontSize !== (__CS_TERMINAL_OPTIONS__.fontSize || DEFAULT_TERMINAL_FONT_SIZE)) {
      csSetVar(varName, fontSize.toString());
      msg += `Terminal font size: ${fontSize.toFixed(1).padStart(4, "0")}`;
    }
  }

  if (globalFontSize) {
    if (!vars[VAR_CS_FONT_SIZE] || localVars[LOCAL_VAR_PREFIX + VAR_CS_FONT_SIZE]) {
      varName = LOCAL_VAR_PREFIX + VAR_CS_FONT_SIZE;
    } else {
      varName = VAR_CS_FONT_SIZE;
    }
    const fontSize = Math.min(40, __CS_FONT_SIZE__ + 1);
    if (fontSize !== __CS_FONT_SIZE__) {
      csSetVar(varName, fontSize.toString());
      if (msg) {
        msg += "; ";
      }
      msg += `Global font size: ${fontSize}`;
    }
  }
  if (msg && !noToast) {
    notify(msg, "info", TOAST_KEY_FONT_SIZE);
  }
}
