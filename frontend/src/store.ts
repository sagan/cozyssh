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

import type { HostData, ButtonData, WsTerminalMessage, Recent } from "./api";
import type { HostForm, ViewMode, Severity, ShellIntegration, Toast } from "./common";
import type { TerminalHandle } from "./Terminal";
import type { ScratchpadHandle } from "./Scratchpad";
import {
  BROWSER_STORAGE_KEY_ACTIVE_GROUP,
  BROWSER_STORAGE_KEY_LOCAL_VARS,
  BROWSER_STORAGE_KEY_RECENTS,
  BROWSER_STORAGE_KEY_VARS,
  DEFAULT_BUTTON_GROUP,
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
  newTabDialogInitialViewMode: ViewMode;
  sysHostname: string;
  unreadTabIds: Set<string>;
  focusTrigger: number;
  focusSearchInputTrigger: number;
  tabs: TabData[];
  activeTabId: string;
  activePaneId: string;
  hosts: HostData[];
  buttons: ButtonData[];
  vars: Record<string, string>;
  /** Local (browser-only) vars. All names have a "local_" (case-insensitive) prefix. */
  localVars: Record<string, string>;
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
  inputDialogOpen: false,
  inputValue: "",
  inputLiquid: false,
  newTabDialogInitialViewMode: "servers",
  sysHostname: "",
  unreadTabIds: new Set<string>(),
  focusTrigger: 0,
  focusSearchInputTrigger: 0,
  tabs: [],
  activeTabId: "",
  activePaneId: "",
  hosts: [],
  buttons: [],
  vars: loadFromStorage(BROWSER_STORAGE_KEY_VARS, {}),
  localVars: loadFromStorage(BROWSER_STORAGE_KEY_LOCAL_VARS, {}),
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

export const setRecents = (update: Recent[] | ((prev: Recent[]) => Recent[])) => {
  useStore.setState((state) => {
    const next = typeof update === "function" ? update(state.recents) : update;
    localStorage.setItem(BROWSER_STORAGE_KEY_RECENTS, JSON.stringify(next));
    return { recents: next };
  });
};

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
export const setInputDialogOpen = (inputDialogOpen: boolean) => useStore.setState({ inputDialogOpen });
export const setInputValue = (inputValue: string) => useStore.setState({ inputValue });
export const setInputLiquid = (inputLiquid: boolean) => useStore.setState({ inputLiquid });

export const setNewTabDialogInitialViewMode = (newTabDialogInitialViewMode: ViewMode) =>
  useStore.setState({ newTabDialogInitialViewMode });

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
  } catch (err) {
    console.warn("Failed to sync cross-tab localStorage update:", err);
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
