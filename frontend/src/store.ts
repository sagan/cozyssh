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

import type { HostData, ButtonData, WsTerminalMessage } from "./api";
import type { HostForm, NewTabDialogViewMode, Severity, ShellIntegration, Toast } from "./common";
import type { TerminalHandle } from "./Terminal";
import type { ScratchpadHandle } from "./Scratchpad";
import { BROWSER_STORAGE_KEY_LOCAL_VARS, BROWSER_STORAGE_KEY_VARS, DEFAULT_BUTTON_GROUP } from "./constants";

// Re-exported so consumers don't need to import from Dashboard.tsx
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
  toasts: Toast[];
  editHostName: string;
  hostFormData: HostForm;
  initialHostFormData: HostForm | null;
  buttonFormData: ButtonData;
  initialBtnFormData: ButtonData | null;
  editButtonDialogOpen: boolean;
  editHostDialogOpen: boolean;
  newTabDialogOpen: boolean;
  newTabDialogInitialViewMode: NewTabDialogViewMode;
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

function loadVarsFromStorate(key: string): Record<string, string> {
  let vars: Record<string, string> | undefined;
  const varsStr = localStorage.getItem(key);
  if (varsStr) {
    try {
      vars = JSON.parse(varsStr);
    } catch {
      // do nothing
    }
  }
  if (!vars || typeof vars !== "object") {
    vars = {};
  }
  return vars;
}

export const useStore = create<Store>(() => ({
  toasts: [],
  editHostName: "",
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
    shortcut: "",
  },
  initialBtnFormData: null,
  editButtonDialogOpen: false,
  editHostDialogOpen: false,
  newTabDialogOpen: false,
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
  vars: loadVarsFromStorate(BROWSER_STORAGE_KEY_VARS),
  localVars: loadVarsFromStorate(BROWSER_STORAGE_KEY_LOCAL_VARS),
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

export const setNewTabDialogInitialViewMode = (newTabDialogInitialViewMode: NewTabDialogViewMode) =>
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

export const setHosts = (hosts: HostData[]) => useStore.setState({ hosts });

export const setButtons = (buttons: ButtonData[]) => useStore.setState({ buttons });

export const setVars = (vars: Record<string, string>) => {
  useStore.setState({ vars });
  // store a duplicate in localStorage
  localStorage.setItem(BROWSER_STORAGE_KEY_VARS, JSON.stringify(vars));
};

export const setLocalVars = (localVars: Record<string, string>) => useStore.setState({ localVars });

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
