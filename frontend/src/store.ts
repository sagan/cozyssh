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

import type {
  HostData,
  ButtonData,
  WsTerminalMessage,
  Recent,
  LocalShell,
  ActiveTunnel,
  RecentUpdateRequest,
  SessionsAttachRequest,
  TabsUnpinRequest,
  TabsPinRequest,
  TabsLockRequest,
  SessionsCloseRequest,
  TabsRenameRequest,
  ButtonsMoveRequest,
  Sysinfo,
  FullData,
} from "./api";
import {
  type HostForm,
  type Severity,
  type ShellIntegration,
  type Toast,
  type ViewMode,
  genPaneId,
  genTabId,
  getTemplateVariables,
  hostTitle,
  isMuiModalOpen,
  nextName,
  nextTerminalFontSize,
  prevTerminalFontSize,
  removePassFromHost,
} from "./common";
import type { TerminalHandle } from "./Terminal";
import type { ScratchpadHandle } from "./Scratchpad";
import {
  BROWSER_STORAGE_KEY_ACTIVE_GROUP,
  BROWSER_STORAGE_KEY_LOCAL_VARS,
  BROWSER_STORAGE_KEY_RECENT_BUTTONS,
  BROWSER_STORAGE_KEY_RECENTS,
  BROWSER_STORAGE_KEY_SCRATCHPAD_SYNC_STATE,
  BROWSER_STORAGE_KEY_TAGS_EXPANDED,
  BROWSER_STORAGE_KEY_TOKEN,
  BROWSER_STORAGE_KEY_VARS,
  CACHE_API_DATA,
  CACHE_MANIFEST,
  DEFAULT_BUTTON_GROUP,
  DEFAULT_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_SIZE,
  HEADER_AUTHORIZATION,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  HEADER_CONTENT_TYPE,
  LOCAL_NAME,
  LOCAL_VAR_PREFIX,
  METHOD_DELETE,
  METHOD_POST,
  METHOD_PUT,
  MIME_JSON,
  TOAST_KEY_FONT_SIZE,
  VAR_CS_FONT_SIZE,
  VAR_CS_TERMINAL_FONT_SIZE,
} from "./constants";
import { dialogs } from "./Dialogs";

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
  type: "terminal" | "scratchpad";
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
  inputDialogDirty: boolean;
  inputValue: string;
  inputLiquid: boolean;
  newTabDialogOpen: boolean;
  newTabDialogFilter: string;
  unreadTabIds: Set<string>;
  focusTrigger: number;
  focusSearchInputTrigger: number;
  tabs: TabData[];
  activeTabId: string;
  activePaneId: string;
  hosts: HostData[];
  groups: string[];
  shells: LocalShell[];
  buttons: ButtonData[];
  sysinfo: Sysinfo;
  tagsExpanded: number;
  vars: Record<string, string>;
  /** Local (browser-only) vars. All names have a "local_" (case-insensitive) prefix. */
  localVars: Record<string, string>;
  recentButtonIds: string[];
  shellIntegrations: Record<string, ShellIntegration>;
  activeTunnels: ActiveTunnel[];
}

/**
 * The module type of custom script
 */
export interface CsScriptModule {
  default?: CsScript;
  // [key: string]: unknown;
}

/**
 * id => moduleObj
 */
export const moduleCache: Record<string, CsScriptModule> = {};

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
    local_forward: "",
    remote_forward: "",
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
  inputDialogDirty: false,
  inputValue: "",
  inputLiquid: false,
  unreadTabIds: new Set<string>(),
  focusTrigger: 0,
  focusSearchInputTrigger: 0,
  tabs: [],
  activeTabId: "",
  activePaneId: "",
  hosts: [],
  groups: [],
  shells: [],
  buttons: [],
  sysinfo: {
    hostname: "",
    version: "dev",
    savePassword: "ask",
    isSecure: false,
    insecureAllowed: false,
  },
  tagsExpanded: loadFromStorage(BROWSER_STORAGE_KEY_TAGS_EXPANDED, 0),
  vars: loadFromStorage(BROWSER_STORAGE_KEY_VARS, {}),
  localVars: loadFromStorage(BROWSER_STORAGE_KEY_LOCAL_VARS, {}),
  recentButtonIds: loadFromStorage(BROWSER_STORAGE_KEY_RECENT_BUTTONS, []),
  shellIntegrations: {},
  activeTunnels: [],
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
  } else if (filter.startsWith("#") && !filter.includes(" ")) {
    return ["tags", filter.slice(1)];
  } else if (filter.startsWith(":")) {
    return ["tunnels", filter.slice(1)];
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
      const modes: ViewMode[] = ["servers", "buttons", "tabs", "tags", "tunnels", "help"];
      const idx = modes.indexOf(mode);
      if (idx === -1) {
        nextMode = "servers";
      } else {
        nextMode = modes[(target ? idx - 1 + modes.length : idx + 1) % modes.length];
      }
    }
    const prefix =
      nextMode === "buttons"
        ? ">"
        : nextMode === "tabs"
          ? "@"
          : nextMode === "tunnels"
            ? ":"
            : nextMode === "tags"
              ? "#"
              : nextMode === "help"
                ? "?"
                : "";
    return { newTabDialogFilter: prefix + f };
  });

export const setInputDialogOpen = (inputDialogOpen: boolean) => useStore.setState({ inputDialogOpen });
export const setInputDialogDirty = (inputDialogDirty: boolean) => useStore.setState({ inputDialogDirty });
export const setInputValue = (inputValue: string) => useStore.setState({ inputValue });
export const setInputLiquid = (inputLiquid: boolean) => useStore.setState({ inputLiquid });

export const closeInputDialog = () => useStore.setState({ inputDialogOpen: false, inputDialogDirty: false });

export const openInputDialog = ({
  inputValue = "",
  inputLiquid = false,
  appendNewLine = true,
  sendScope = 0,
}: { inputValue?: string; inputLiquid?: boolean; sendScope?: 0 | 1 | 2; appendNewLine?: boolean } = {}) =>
  useStore.setState({
    newTabDialogOpen: false,
    inputDialogOpen: true,
    inputValue,
    appendNewLine,
    inputLiquid,
    sendScope,
  });

export const setUnreadTabIds = (unreadTabIds: Set<string>) => useStore.setState({ unreadTabIds });

export const deleteUnreadTabId = (tabId: string) =>
  useStore.setState((state) => ({
    unreadTabIds: new Set([...state.unreadTabIds].filter((id) => id !== tabId)),
  }));

export const addUnreadTabId = (tabId: string) =>
  useStore.setState((state) => ({
    unreadTabIds: new Set([...state.unreadTabIds, tabId]),
  }));

export const closeOtherTabs = (targetTabId?: string) => {
  const { activeTabId, tabs } = getStore();
  targetTabId = targetTabId || activeTabId;
  if (tabs.length === 0 || (tabs.length === 1 && tabs[0].id === targetTabId)) {
    return;
  }
  const targetTab = tabs.find((tab) => tab.id === targetTabId);
  if (!targetTab) {
    return;
  }
  useStore.setState({
    tabs: [targetTab],
    activeTabId: targetTab.id,
    activePaneId: targetTab.activePaneId,
  });
  triggerFocus();
};

export const closeRightTabs = (targetTabId?: string) => {
  const { activeTabId, tabs } = getStore();
  targetTabId = targetTabId || activeTabId;
  if (tabs.length === 0 || (tabs.length === 1 && tabs[0].id === targetTabId)) {
    return;
  }
  const targetTabIndex = tabs.findIndex((tab) => tab.id === targetTabId);
  if (targetTabIndex === -1) {
    return;
  }
  const targetTab = tabs[targetTabIndex];
  const activeTabClosed = tabs.findIndex((tab) => tab.id === activeTabId) > targetTabIndex;
  const newTabs = tabs.slice(0, targetTabIndex + 1);
  useStore.setState(
    activeTabClosed
      ? {
          tabs: newTabs,
          activeTabId: targetTab.id,
          activePaneId: targetTab.activePaneId,
        }
      : { tabs: newTabs },
  );
  triggerFocus();
};

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
export const setGroups = (groups: string[]) => useStore.setState({ groups });
export const setShells = (shells: LocalShell[]) => useStore.setState({ shells });

export const setButtons = (buttons: ButtonData[]) => useStore.setState({ buttons });

export const setSysinfo = (sysinfo: Partial<Sysinfo>) =>
  useStore.setState((state) => ({ sysinfo: { ...state.sysinfo, ...sysinfo } }));

export const prevButtonGroup = (includeHidden = false) => {
  useStore.setState((state) => {
    const groups = Array.from(new Set([DEFAULT_BUTTON_GROUP, ...state.buttons.map((button) => button.group)])).sort();
    const idx = groups.indexOf(state.activeGroup);
    let nextIdx = (idx - 1 + groups.length) % groups.length;
    if (!includeHidden) {
      while (nextIdx !== idx && groups[nextIdx].startsWith("_")) {
        nextIdx = (nextIdx - 1 + groups.length) % groups.length;
      }
    }
    return { activeGroup: groups[nextIdx] };
  });
};

export const nextButtonGroup = (includeHidden = false) => {
  useStore.setState((state) => {
    const groups = Array.from(new Set([DEFAULT_BUTTON_GROUP, ...state.buttons.map((button) => button.group)])).sort();
    const idx = groups.indexOf(state.activeGroup);
    let nextIdx = (idx + 1) % groups.length;
    if (!includeHidden) {
      while (nextIdx !== idx && groups[nextIdx].startsWith("_")) {
        nextIdx = (nextIdx + 1) % groups.length;
      }
    }
    return { activeGroup: groups[nextIdx] };
  });
};

export const setTagsExpanded = (update: number | ((prev: number) => number)) =>
  useStore.setState((state) => {
    const tagsExpanded = typeof update === "function" ? update(state.tagsExpanded) : update;
    localStorage.setItem(BROWSER_STORAGE_KEY_TAGS_EXPANDED, JSON.stringify(tagsExpanded));
    return { tagsExpanded };
  });

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
    groups: [],
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
    switch (e.key) {
      case BROWSER_STORAGE_KEY_VARS:
        useStore.setState({ vars: e.newValue ? JSON.parse(e.newValue) : {} });
        break;
      case BROWSER_STORAGE_KEY_LOCAL_VARS:
        useStore.setState({ localVars: e.newValue ? JSON.parse(e.newValue) : {} });
        break;
      case BROWSER_STORAGE_KEY_RECENT_BUTTONS:
        useStore.setState({ recentButtonIds: e.newValue ? JSON.parse(e.newValue) : [] });
        break;
      case BROWSER_STORAGE_KEY_TAGS_EXPANDED:
        useStore.setState({ tagsExpanded: e.newValue ? JSON.parse(e.newValue) : 0 });
        break;
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

export const setActiveTunnels = (update: ActiveTunnel[] | ((data: ActiveTunnel[]) => ActiveTunnel[])) =>
  useStore.setState((state) => ({
    activeTunnels: typeof update === "function" ? update(state.activeTunnels) : update,
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

export async function fetchActiveTunnels() {
  const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
  try {
    const r = await fetch("/api/tunnels", {
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });
    if (r.ok) {
      const data = (await r.json()) as ActiveTunnel[];
      setActiveTunnels(data || []);
    }
  } catch (e) {
    console.error("Failed to fetch active tunnels:", e);
  }
}

export function openHostsAsSplit(title: string, hosts: string[], hostOptions?: (Record<string, string> | undefined)[]) {
  const tabId = genTabId(title);
  const panes: PaneData[] = hosts.map(
    (host, i) =>
      ({
        id: genPaneId(host),
        host,
        options: hostOptions?.[i],
        state: "",
      }) satisfies PaneData,
  );
  const newTab: TabData = {
    title,
    id: tabId,
    panes: panes,
    activePaneId: panes[0].id,
    type: "terminal",
  };
  setTabs((prev) => [...prev, newTab]);
  setActiveTabId(newTab.id);
  setActivePaneId(panes[0].id);
}

export function openHostsAsSplit2(
  host: HostData | string | (HostData | string)[],
  { title, target }: { title?: string; target?: string } = {},
) {
  const { hosts } = getStore();
  const targetHosts = Array.isArray(host) ? host.slice(0, 4) : [host];
  const hostNames: string[] = [];
  const hostOptions: (Record<string, string> | undefined)[] = [];
  for (let targetHost of targetHosts) {
    if (typeof targetHost === "object") {
      hostNames.push(targetHost.name);
      hostOptions.push(undefined);
    } else if (typeof targetHost === "string") {
      let option: Record<string, string> | undefined = undefined;
      const i = targetHost.lastIndexOf("?");
      if (i !== -1) {
        option = Object.fromEntries(new URLSearchParams(targetHost.slice(i)));
        targetHost = targetHost.slice(0, i);
        if (option.title) {
          title = option.title;
          delete option.title;
        }
        if (option.target) {
          target = option.target;
          delete option.target;
        }
      }
      hostOptions.push(option);
      if (targetHost === LOCAL_NAME) {
        hostNames.push(LOCAL_NAME);
      } else {
        const known = hosts.find((h) => h.name === targetHost || h.hostname === targetHost);
        if (known) {
          hostNames.push(known.name);
        } else {
          hostNames.push(targetHost);
        }
      }
    }
  }
  title = title || hostNames[0];
  if (target === "_self") {
    target = getStore().activeTabId;
  } else if (target === "_blank") {
    target = undefined;
  }
  if (hostNames.length > 1) {
    openHostsAsSplit(title, hostNames, hostOptions);
  } else {
    openHost(hostNames[0], { title, target, options: hostOptions[0] });
  }
}

export async function openHost(
  host: string,
  {
    title,
    target,
    options,
    noUpdateRecent,
  }: {
    title?: string;
    target?: string;
    options?: Record<string, string>;
    noUpdateRecent?: boolean;
  } = {},
) {
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
          activatePane(pane.id, tab.id);
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
      // target = "";
      // targetTab = undefined;
      return; // do nothing
    }
  }
  if (targetTab) {
    const newPane: PaneData = { id: paneId, sessionId, host, options, state: "" };
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
      panes: [{ id: paneId, host, options, state: "" }],
      activePaneId: paneId,
      type: "terminal",
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
}

export async function logout() {
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
  clearData();
  if (window.caches) {
    await caches.delete(CACHE_API_DATA);
    await caches.delete(CACHE_MANIFEST);
  }
  window.location.href = "/login";
}

export async function logoutAll() {
  const syncState = localStorage.getItem(BROWSER_STORAGE_KEY_SCRATCHPAD_SYNC_STATE);
  if (syncState && syncState !== "synced") {
    if (
      !(await dialogs.confirm(
        "Scratchpad data is not fully synced to the server. Are you sure you want to log out of all browser sessions and clear the local cache?",
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
    }).catch((e) => console.error(e));
    await fetch("/api/logout_all", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    }).catch((e) => console.error(e));
  }
  localStorage.clear();
  sessionStorage.clear();
  clearData();
  if (window.caches) {
    await caches.delete(CACHE_API_DATA);
    await caches.delete(CACHE_MANIFEST);
  }
  window.location.href = "/login";
}

export async function cloneSession(id: string, cloneInSameTab?: boolean) {
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
        type: "terminal",
      },
    ];
  });
  if (!cloneInSameTab) {
    setActiveTabId(newTabId);
  }
  setActivePaneId(newPaneId);
}

export async function attachSession(id: string, host: string, title: string, isLocked: boolean = false) {
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
      panes: [{ id: paneId, sessionId: id, host, state: "" }],
      activePaneId: paneId,
      title,
      isPinned: true,
      isLocked,
      type: "terminal",
    },
  ]);
  setActiveTabId(tabId);
  setActivePaneId(paneId);
}

export async function unpinTab(id: string) {
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
}

export async function pinTab(id: string) {
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
}

export async function unlockTab(id: string) {
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
}

export async function lockTab(id: string) {
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
}

export function closeTab(id: string) {
  const { activeTabId, tabs } = getStore();
  const targetTab = tabs.find((t) => t.id === id);
  if (targetTab?.isPinned && !targetTab?.isLocked) {
    unpinTab(id);
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
}

export function closeTabOrPane(tabOrPaneId?: string) {
  const { activeTabId, activePaneId, tabs } = getStore();
  tabOrPaneId = tabOrPaneId || activePaneId;
  if (!tabOrPaneId) {
    return;
  }

  // 1. Check if targetId is a Tab ID
  const targetTab = tabs.find((t) => t.id === tabOrPaneId);
  if (targetTab) {
    closeTab(tabOrPaneId);
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
      closeTab(parentTab.id);
    }
  }
}

export async function renameTab(targetId: string) {
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
}

export async function fetchHosts() {
  const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
  try {
    const r = await fetch("/api/hosts", {
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });
    if (r.status === 401) {
      localStorage.removeItem(BROWSER_STORAGE_KEY_TOKEN);
      window.location.href = "/login"; // @todo : move side effect out of it
      return;
    }
    const data: HostData[] = await r.json();
    setHosts(data || []);
  } catch (e) {
    console.error(e);
  }
}

export function openNewButtonDialog() {
  const { activeGroup, buttons } = getStore();
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
  setEditButton(null);
  setButtonFormData(data);
  setInitialBtnFormData(data);
  setEditButtonDialogOpen(true);
}

export async function openSaveTabToButtonDialog(tabId?: string) {
  const { activeTabId, tabs, activeGroup, buttons } = getStore();
  tabId = tabId || activeTabId;
  const targetTab = tabs.find((t) => t.id === tabId);
  if (!targetTab || targetTab.type !== "terminal") {
    return;
  }
  const maxOrder = buttons.length > 0 ? Math.max(...buttons.map((b) => b.order || 0)) : 0;
  const hostConnectionStrings: string[] = targetTab.panes.map((p, idx) => {
    let s = p.host;
    const params = new URLSearchParams(p.options);
    if (idx === 0 && targetTab.title !== p.host) {
      params.set("title", targetTab.title);
    }
    if (params.size > 0) {
      s += "?" + params.toString();
    }
    return s;
  });
  const payload = hostConnectionStrings.join(",");
  const existingButton = buttons.find((b) => b.type === "open_terminal" && b.payload === payload);
  if (existingButton) {
    const action = await dialogs.choose(
      `This tab is already bound to button "${existingButton.name}" in group "${existingButton.group}"`,
      "",
      ["Edit existing button", "Create new button"],
    );
    if (action === "Edit existing button") {
      setEditButton(existingButton);
      setButtonFormData(existingButton);
      setInitialBtnFormData(existingButton);
      setEditButtonDialogOpen(true);
      return;
    }
    if (!action) {
      return;
    }
  }
  const data: ButtonData = {
    id: "",
    name: targetTab.title,
    type: "open_terminal",
    payload,
    group: activeGroup,
    autorun: 0,
    order: maxOrder + 10 || 10,
    shortcut: "",
  };
  setEditButton(null);
  setButtonFormData(data);
  setInitialBtnFormData(data);
  setEditButtonDialogOpen(true);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function onButtonDialogClose(_e: unknown, _reason: "backdropClick" | "escapeKeyDown") {
  const { buttonFormData, initialBtnFormData } = getStore();
  const isDirty = initialBtnFormData && JSON.stringify(buttonFormData) !== JSON.stringify(initialBtnFormData);
  if (isDirty) {
    return;
  }
  setEditButtonDialogOpen(false);
}

export function openScratchpad() {
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
    panes: [{ id: tabId, host: "scratchpad", state: "" }],
    activePaneId: tabId,
    type: "scratchpad",
  };
  setTabs((prev) => [...prev, newTab]);
  setActiveTabId(tabId);
  setActivePaneId(tabId);
  triggerFocus();
}

export async function saveButton() {
  const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
  const { editButton, buttonFormData } = getStore();

  // Auto-update liquidjs value based on detected user variables
  const finalButtonFormData = { ...buttonFormData };
  if (finalButtonFormData.type === "send_string") {
    if (finalButtonFormData.liquidjs !== 0) {
      const varsList = getTemplateVariables(finalButtonFormData.payload);
      finalButtonFormData.liquidjs = varsList.length > 0 ? 2 : 1;
    } else {
      finalButtonFormData.liquidjs = 0;
    }
  } else {
    finalButtonFormData.liquidjs = 0;
  }

  const method = editButton ? METHOD_PUT : METHOD_POST;
  const url = editButton ? `/api/buttons/${editButton.id}` : "/api/buttons";
  if (editButton) {
    const id = editButton.id;
    if (moduleCache[id]?.default?.unload) {
      await moduleCache[id].default.unload();
    }
    delete moduleCache[id];
  }
  await fetch(url, {
    method,
    headers: {
      [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      [HEADER_CONTENT_TYPE]: MIME_JSON,
    },
    body: JSON.stringify(finalButtonFormData),
  });
  setInitialBtnFormData(null);
  setEditButtonDialogOpen(false);
  const r = await fetch("/api/buttons", {
    headers: {
      [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
    },
  });
  const data = (await r.json()) as ButtonData[];
  setButtons(data || []);
  setActiveGroup(getStore().buttonFormData.group || DEFAULT_BUTTON_GROUP);
}

export async function deleteButton(id: string, name: string) {
  setBtnMenuAnchor(null);
  if (!(await dialogs.confirm(`Delete button "${name}"?`))) {
    return;
  }
  if (moduleCache[id]) {
    if (moduleCache[id].default?.unload) {
      moduleCache[id].default.unload();
    }
    delete moduleCache[id];
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
}

export async function moveButton(id: string, direction: number) {
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
}

/**
 * Return effective value for a variable:
 * 1. Lookup in localVars (with "local_" prefix)
 * 2. Lookup in vars
 * 3. Return defaultValue
 * @param name variable name
 * @param defaultValue fallback value, default is ""
 */
export function getVar(name: string, defaultValue = ""): string {
  const { vars, localVars } = getStore();
  if (localVars["local_" + name]) {
    return localVars["local_" + name]!;
  }
  if (vars[name]) {
    return vars[name]!;
  }
  return defaultValue;
}

/**
 * Return integer variable value:
 * 1. Lookup in localVars (with "local_" prefix)
 * 2. Lookup in vars
 * @param name variable name
 * @param defaultValue fallback value, default is 0. Used if variable not found, or not a valid integer.
 */
export function getIntVar(name: string, defaultValue = 0): number {
  const value = getVar(name);
  if (value === "") {
    return defaultValue;
  }
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

export async function refreshData({ sync = 0, refresh = 0 } = {}) {
  const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
  try {
    const r = await fetch(`/api/fulldata?sync=${sync}&refresh=${refresh}`, {
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
    useStore.setState(data);
  } catch (e) {
    console.error(e);
  }
}
