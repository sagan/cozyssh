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
  SessionsUnpinRequest,
  SessionsPinRequest,
  SessionsLockRequest,
  SessionsCloseRequest,
  SessionsRenameRequest,
  ButtonsMoveRequest,
  Sysinfo,
  FullData,
  Session,
  ConfigRequest,
  CopyIDRequest,
  CopyIDResponse,
  SessionsHideRequest,
} from "./api";
import {
  type ButtonForm,
  type HostForm,
  type Severity,
  type ShellIntegration,
  type Toast,
  type ViewMode,
  apiReqHeaders,
  createSetProxy,
  genPaneId,
  genTabId,
  generatePassword,
  getCanonicalHostString,
  getHostGroupPath,
  getHostOrder,
  getTemplateVariables,
  hostTitle,
  hostSorter,
  isMuiModalOpen,
  nextTerminalFontSize,
  openBackgroundTerminal,
  parseHostName,
  prevTerminalFontSize,
  removeNameNumSuffix,
  removePassFromHost,
  assertUnreachable,
} from "./common";
import type { TerminalHandle } from "./Terminal";
import type { ScratchpadHandle } from "./Scratchpad";
import {
  APP_NAME,
  BROWSER_STORAGE_KEY_ACTIVE_GROUP,
  BROWSER_STORAGE_KEY_ALL_EXPANDED,
  BROWSER_STORAGE_KEY_AUTO_EXPANDED,
  BROWSER_STORAGE_KEY_EXPANDED_GROUPS,
  BROWSER_STORAGE_KEY_FAV_EXPANDED,
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
  HEADER_CONTENT_TYPE,
  LOCAL_NAME,
  LOCAL_VAR_PREFIX,
  METHOD_DELETE,
  METHOD_POST,
  METHOD_PUT,
  MIME_JSON,
  TAG_GROUP_PREFIX,
  TAG_ORDER_PREFIX,
  TOAST_KEY_API_SETTINGS,
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
  settingsTab: number;
  settingsOpen: boolean;
  filterStr: string;
  asyncDialogOpen: boolean;
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
  buttonFormData: ButtonForm;
  initialBtnFormData: ButtonForm | null;
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
  favExpanded: number;
  allExpanded: number;
  autoExpanded: number;
  expandedGroups: Set<string>;
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

/**
 * Load value from a localStorage item. The parsing behavior depends on T (infered from defaultValue at runtime).
 * If T is a string, it will be returned as-is (don't parse it as a "" quoted JSON string).
 * If T is a Set, it will be parsed as an array, and then converted to a Set.
 * Otherwise, it will be parsed as a JSON object.
 * @param key The key of the localStorage item.
 * @param defaultValue The default value to return if the item is not found or parsing fails.
 */
function loadFromStorage<T>(key: string, defaultValue: T): T {
  const varsStr = localStorage.getItem(key);
  if (typeof defaultValue === "string") {
    return varsStr ? (varsStr as T) : defaultValue;
  }
  if (varsStr) {
    try {
      if (defaultValue instanceof Set) {
        return new Set(JSON.parse(varsStr)) as T;
      }
      return JSON.parse(varsStr) as T;
    } catch {
      /* empty */
    }
  }
  return defaultValue;
}

export type MsgLogout = {
  type: "logout";
  preserveLocalVars?: boolean;
};

export type Msg = MsgLogout;

export const channel = new BroadcastChannel(APP_NAME);

channel.onmessage = (event) => {
  const msg = event.data as Msg;
  switch (msg.type) {
    case "logout":
      clearData(msg.preserveLocalVars);
      location.reload();
      break;
    default:
      return assertUnreachable(msg.type);
  }
};

/**
 * The initial URL params parsed from location.search
 */
export const startupParams = new URLSearchParams(location.search);

export const useStore = create<Store>(
  () =>
    ({
      settingsTab: 0,
      settingsOpen: false,
      filterStr: startupParams.get("filter") || "",
      asyncDialogOpen: false,
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
        identityFile: "",
        source: "",
        proxyJump: "",
        remoteCommand: "",
        localForward: "",
        remoteForward: "",
        verifyHostKeyDns: "",
        tags: "",
        comment: "",
      },
      initialHostFormData: null,
      buttonFormData: {
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
        username: "",
        sitename: "",
        version: "dev",
        savePassword: "ask",
        isSecure: false,
        insecureAllowed: false,
        configDir: "",
        sshDir: "",
        defaultIdentityPath: "",
        defaultIdentityPublicKey: "",
      },
      tagsExpanded: loadFromStorage(BROWSER_STORAGE_KEY_TAGS_EXPANDED, 0),
      favExpanded: loadFromStorage(BROWSER_STORAGE_KEY_FAV_EXPANDED, 1),
      allExpanded: loadFromStorage(BROWSER_STORAGE_KEY_ALL_EXPANDED, 1),
      autoExpanded: loadFromStorage(BROWSER_STORAGE_KEY_AUTO_EXPANDED, 1),
      expandedGroups: loadFromStorage(BROWSER_STORAGE_KEY_EXPANDED_GROUPS, new Set<string>()),
      vars: loadFromStorage(BROWSER_STORAGE_KEY_VARS, {}),
      localVars: loadFromStorage(BROWSER_STORAGE_KEY_LOCAL_VARS, {}),
      recentButtonIds: loadFromStorage(BROWSER_STORAGE_KEY_RECENT_BUTTONS, []),
      shellIntegrations: {},
      activeTunnels: [],
    }) satisfies Store,
);

export const triggerFocus = () =>
  useStore.setState((state) => ({
    focusTrigger: state.focusTrigger + 1,
  }));

export const triggerFocusSearchInput = () =>
  useStore.setState((state) => ({
    focusSearchInputTrigger: state.focusSearchInputTrigger + 1,
  }));

let toastId = 0;

let toastKeyMuteRegExp: RegExp | undefined;
export const toastKeyMuteSet = createSetProxy<string>([], (set) => {
  if (set.size > 0) {
    toastKeyMuteRegExp = new RegExp(
      "^(" +
        Array.from(set)
          .sort((a, b) => b.length - a.length)
          .map((a) => {
            if (a.endsWith("-")) {
              // treat as prefix
              return RegExp.escape(a);
            }
            // exact match
            return RegExp.escape(a) + "$";
          })
          .join("|") +
        ")",
    );
  } else {
    toastKeyMuteRegExp = undefined;
  }
});

export const notify = (msg: string, severity: Severity = "info", key?: string) => {
  if (key && toastKeyMuteRegExp?.test(key)) {
    return;
  }
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

/**
 * Remove a host from the server-side recents list.
 * Optimistically removes from local state, then persists via DELETE /api/recents/:host.
 */
export const deleteRecent = (host: string) => {
  // Optimistic update
  setRecents((prev) => prev.filter((r) => r.host !== host));
  // Persist to server
  fetch(`/api/recents/${encodeURIComponent(host)}`, {
    method: METHOD_DELETE,
    headers: apiReqHeaders(),
  }).catch((e) => console.error("Failed to delete recent:", e));
};

/**
 * Remove a button id from the browser-only recent buttons list.
 */
export const removeRecentButtonId = (id: string) => {
  useStore.setState((state) => {
    const updated = state.recentButtonIds.filter((i) => i !== id);
    localStorage.setItem(BROWSER_STORAGE_KEY_RECENT_BUTTONS, JSON.stringify(updated));
    return { recentButtonIds: updated };
  });
};

export const setSettingsTab = (settingsTab: number) => useStore.setState({ settingsTab });

export const setSettingsOpen = (settingsOpen: boolean) => useStore.setState({ settingsOpen });

export const setFilterStr = (filterStr: string) => useStore.setState({ filterStr });

export const setAsyncDialogOpen = (update: boolean | ((data: boolean) => boolean)) =>
  useStore.setState((state) => ({
    asyncDialogOpen: typeof update === "function" ? update(state.asyncDialogOpen) : update,
  }));

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
export const setButtonFormData = (buttonFormData: ButtonForm) => useStore.setState({ buttonFormData });
export const setInitialBtnFormData = (initialBtnFormData: ButtonForm | null) =>
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
  const { buttons, activeGroup } = getStore();
  const groups = Array.from(new Set([DEFAULT_BUTTON_GROUP, ...buttons.map((button) => button.group)])).sort();
  const idx = groups.indexOf(activeGroup);
  let nextIdx = (idx - 1 + groups.length) % groups.length;
  if (!includeHidden) {
    while (nextIdx !== idx && groups[nextIdx].startsWith("_")) {
      nextIdx = (nextIdx - 1 + groups.length) % groups.length;
    }
  }
  setActiveGroup(groups[nextIdx]);
};

export const nextButtonGroup = (includeHidden = false) => {
  const { buttons, activeGroup } = getStore();
  const groups = Array.from(new Set([DEFAULT_BUTTON_GROUP, ...buttons.map((button) => button.group)])).sort();
  const idx = groups.indexOf(activeGroup);
  let nextIdx = (idx + 1) % groups.length;
  if (!includeHidden) {
    while (nextIdx !== idx && groups[nextIdx].startsWith("_")) {
      nextIdx = (nextIdx + 1) % groups.length;
    }
  }
  setActiveGroup(groups[nextIdx]);
};

/**
 * If update is undefined, toggle the expandness, otherwise use the update value
 */
export const setTagsExpanded = (update?: number | ((prev: number) => number)) =>
  useStore.setState((state) => {
    const tagsExpanded =
      update === undefined ? +!state.tagsExpanded : typeof update === "function" ? update(state.tagsExpanded) : update;
    localStorage.setItem(BROWSER_STORAGE_KEY_TAGS_EXPANDED, JSON.stringify(tagsExpanded));
    return { tagsExpanded };
  });

/**
 * If update is undefined, toggle the expandness, otherwise use the update value
 */
export const setFavExpanded = (update?: number | ((prev: number) => number)) =>
  useStore.setState((state) => {
    const favExpanded =
      update === undefined ? +!state.favExpanded : typeof update === "function" ? update(state.favExpanded) : update;
    localStorage.setItem(BROWSER_STORAGE_KEY_FAV_EXPANDED, JSON.stringify(favExpanded));
    return { favExpanded };
  });

/**
 * If update is undefined, toggle the expandness, otherwise use the update value
 */
export const setAllExpanded = (update?: number | ((prev: number) => number)) =>
  useStore.setState((state) => {
    const allExpanded =
      update === undefined ? +!state.allExpanded : typeof update === "function" ? update(state.allExpanded) : update;
    localStorage.setItem(BROWSER_STORAGE_KEY_ALL_EXPANDED, JSON.stringify(allExpanded));
    return { allExpanded };
  });

/**
 * If update is undefined, toggle the expandness, otherwise use the update value
 */
export const setAutoExpanded = (update?: number | ((prev: number) => number)) =>
  useStore.setState((state) => {
    const autoExpanded =
      update === undefined ? +!state.autoExpanded : typeof update === "function" ? update(state.autoExpanded) : update;
    localStorage.setItem(BROWSER_STORAGE_KEY_AUTO_EXPANDED, JSON.stringify(autoExpanded));
    return { autoExpanded };
  });

export const setExpandedGroups = (update: Set<string> | ((prev: Set<string>) => Set<string>)) =>
  useStore.setState((state) => {
    const expandedGroups = typeof update === "function" ? update(state.expandedGroups) : update;
    localStorage.setItem(BROWSER_STORAGE_KEY_EXPANDED_GROUPS, JSON.stringify(Array.from(expandedGroups)));
    return { expandedGroups };
  });

export const toggleExpandAllGroups = (open?: boolean) => {
  const { expandedGroups, groups } = getStore();
  open = open ?? JSON.stringify(Array.from(expandedGroups).sort()) !== JSON.stringify([...groups].sort());
  if (open) {
    setExpandedGroups(new Set<string>(groups));
  } else {
    setExpandedGroups(new Set<string>());
  }
};

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
 * Clear all in-memory store data
 */
export const clearData = (preserveLocalVars = false) =>
  useStore.setState({
    activeGroup: "",
    hosts: [],
    groups: [],
    tabs: [],
    buttons: [],
    recents: [],
    toasts: [],
    vars: {},
    shellIntegrations: {},
    recentButtonIds: [],
    ...(preserveLocalVars ? {} : { localVars: {} }),
  });

/**
 * Clear local storage, clear all in-memory store data, and redirect to login page.
 */
export async function safeLogout(preserveLocalVars = false) {
  if (preserveLocalVars) {
    for (const key of Object.keys(localStorage)) {
      if (key !== BROWSER_STORAGE_KEY_LOCAL_VARS) {
        localStorage.removeItem(key);
      }
    }
  } else {
    localStorage.clear();
  }
  sessionStorage.clear();
  clearData(preserveLocalVars);
  if (window.caches) {
    await caches.delete(CACHE_API_DATA);
    await caches.delete(CACHE_MANIFEST);
  }
  channel.postMessage({ type: "logout", preserveLocalVars } satisfies MsgLogout);
  window.location.href = "/login";
}

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
      case BROWSER_STORAGE_KEY_FAV_EXPANDED:
        useStore.setState({ favExpanded: e.newValue ? JSON.parse(e.newValue) : 1 });
        break;
      case BROWSER_STORAGE_KEY_ALL_EXPANDED:
        useStore.setState({ allExpanded: e.newValue ? JSON.parse(e.newValue) : 1 });
        break;
      case BROWSER_STORAGE_KEY_AUTO_EXPANDED:
        useStore.setState({ autoExpanded: e.newValue ? JSON.parse(e.newValue) : 1 });
        break;
      case BROWSER_STORAGE_KEY_EXPANDED_GROUPS:
        useStore.setState({ expandedGroups: e.newValue ? new Set(JSON.parse(e.newValue)) : new Set<string>() });
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
    Record<string, ShellIntegration> | ((data: Record<string, ShellIntegration>) => Record<string, ShellIntegration>),
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

export async function fetchActiveTunnels(): Promise<ActiveTunnel[]> {
  const res = await fetch("/api/tunnels", { headers: apiReqHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch active tunnels: status=${res.status}`);
  }
  const data = (await res.json()) as ActiveTunnel[];
  setActiveTunnels(data); // for now, leave side effect here
  return data;
}

export async function fetchSessions(pinnedOnly = false): Promise<Session[]> {
  const res = await fetch(`/api/sessions?pinned=${pinnedOnly ? "1" : "0"}`, { headers: apiReqHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch sessions: status=${res.status}`);
  }
  return (await res.json()) as Session[];
}

export function openHostsAsSplit(
  title: string,
  hosts: string[],
  hostOptions?: (Record<string, string> | undefined)[],
): string {
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
  return tabId;
}

export function openHostsAsSplit2(
  host: HostData | string | (HostData | string)[],
  { title, target }: { title?: string; target?: string } = {},
): string | Promise<string> {
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
        const known = getHost(targetHost);
        if (known.source === "config") {
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
    return openHostsAsSplit(title, hostNames, hostOptions);
  } else {
    return openHost(hostNames[0], { title, target, options: hostOptions[0] });
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
): Promise<string> {
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
          return tab.id;
        }
      }
    }
  }
  if (options?.state === "3") {
    const open = await openBackgroundTerminal(host, options);
    const hostLabel = removePassFromHost(host);
    if (open) {
      notify(`Background terminal "${hostLabel}" opened successfully`, "success");
      return "_";
    } else {
      notify(`Failed to open background terminal "${hostLabel}"`, "error");
      return "";
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
      return targetTab.id; // do nothing
    }
  }
  let tabId: string;
  if (targetTab) {
    const newPane: PaneData = { id: paneId, sessionId, host, options, state: "" };
    setTabs((prev) =>
      prev.map((t) => (t.id === target ? { ...t, panes: [...t.panes, newPane], activePaneId: paneId } : t)),
    );
    setActiveTabId(targetTab.id);
    setActivePaneId(paneId);
    tabId = targetTab.id;
  } else {
    tabId = target || genTabId(host);
    const newTab: TabData = {
      id: tabId,
      title: title || newTabTitle(hostTitle(host)),
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
    try {
      fetch("/api/recents", {
        method: METHOD_POST,
        headers: apiReqHeaders(),
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
  return tabId;
}

export async function logout(needConfirm: boolean = false) {
  if (
    needConfirm &&
    !(await dialogs.confirm("Log out of current device?", "All data stored in this browser will be cleared."))
  ) {
    return;
  }
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
  if (localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN)) {
    await fetch("/api/sessions/close_all_normal", { method: METHOD_POST, headers: apiReqHeaders() }).catch(
      Function.prototype as never,
    );
    await fetch("/api/logout", { method: METHOD_POST, headers: apiReqHeaders() }).catch(Function.prototype as never);
  }
  safeLogout();
}

export async function logoutAll(needConfirm = false) {
  if (
    needConfirm &&
    !(await dialogs.confirm(
      "Log out of all browser sessions?",
      "This will invalidate all active sessions and require you to sign in again on all devices." +
        " All data stored in this browser will be cleared.",
    ))
  ) {
    return;
  }
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
  if (localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN)) {
    await fetch("/api/sessions/close_all_normal", { method: METHOD_POST, headers: apiReqHeaders() }).catch(
      Function.prototype as never,
    );
    await fetch("/api/logout_all", { method: METHOD_POST, headers: apiReqHeaders() }).catch(
      Function.prototype as never,
    );
  }
  safeLogout();
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
        title: newTabTitle(removeNameNumSuffix(tab.title)),
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

export async function attachSession(
  id: string,
  host: string,
  title: string,
  isLocked: boolean = false,
): Promise<string> {
  const existing = getStore().tabs.find((t) =>
    t.panes.some((p) => (p.sessionId || p.id) === id && p.state !== "stolen"),
  );
  if (existing) {
    setActiveTabId(existing.id);
    setActivePaneId(
      existing.panes.find((p) => (p.sessionId || p.id) === id && p.state !== "stolen")?.id || existing.activePaneId,
    );
    return existing.id;
  }
  await fetch("/api/sessions/attach", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
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
  return tabId;
}

export async function unpinTab(id?: string) {
  id = id || getStore().activeTabId;
  const tab = getStore().tabs.find((t) => t.id === id);
  if (!tab) {
    return;
  }
  const backendSessionId = tab.panes[0]?.sessionId || tab.panes[0]?.id || id;
  await fetch("/api/sessions/unpin", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify({ id: backendSessionId } satisfies SessionsUnpinRequest),
  });
}

export async function pinTab(id?: string) {
  id = id || getStore().activeTabId;
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
  // Pinning only supports single-pane tabs for now (backend requirement)
  const host = pane.host || LOCAL_NAME;
  await fetch("/api/sessions/pin", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify({ id: backendSessionId, host, title: tab.title } satisfies SessionsPinRequest),
  });
  setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isPinned: true } : t)));
}

export async function unlockTab(id?: string) {
  id = id || getStore().activeTabId;
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
  const host = pane.host || LOCAL_NAME;
  await fetch("/api/sessions/pin", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify({ id: paneId, host, title: tab.title } satisfies SessionsPinRequest),
  });
  setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isLocked: false } : t)));
}

export async function lockTab(id?: string) {
  id = id || getStore().activeTabId;
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
  const host = pane.host || LOCAL_NAME;
  await fetch("/api/sessions/lock", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify({ id: backendSessionId, host, title: tab.title } satisfies SessionsLockRequest),
  });
  setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isLocked: true } : t)));
}

export async function hideTab(id?: string) {
  id = id || getStore().activeTabId;
  const tab = getStore().tabs.find((t) => t.id === id);
  if (!tab) {
    return;
  }
  if (tab.panes.length > 1) {
    dialogs.alert("Only single-pane tabs can be hided.");
    return;
  }
  const pane = tab.panes[0];
  if (!pane) {
    return;
  }
  const backendSessionId = pane.sessionId || pane.id;
  await fetch("/api/sessions/hide", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify({ id: backendSessionId } satisfies SessionsHideRequest),
  });
  const { tabs, activeTabId } = getStore();
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) {
    return;
  }
  const newTabs = [...tabs];
  newTabs.splice(idx, 1);
  setTabs(newTabs);
  if (activeTabId === id && newTabs.length > 0) {
    const nextIdx = idx > 0 ? idx - 1 : 0;
    const nextTab = newTabs[nextIdx];
    setActiveTabId(nextTab.id);
    setActivePaneId(nextTab.activePaneId);
  } else if (newTabs.length === 0) {
    setActiveTabId("");
    setActivePaneId("");
  }
}

export function closeTab(id?: string) {
  const { activeTabId, tabs } = getStore();
  id = id || activeTabId;
  const targetTab = tabs.find((t) => t.id === id);
  if (targetTab?.isPinned && !targetTab?.isLocked) {
    unpinTab(id);
  }
  if (targetTab && !targetTab.isLocked) {
    targetTab.panes.forEach((p) => {
      if (p.state !== "stolen") {
        fetch("/api/sessions/close", {
          method: METHOD_POST,
          headers: apiReqHeaders(),
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
        fetch("/api/sessions/close", {
          method: METHOD_POST,
          headers: apiReqHeaders(),
          body: JSON.stringify({ id: targetPane.sessionId || targetPane.id } satisfies SessionsCloseRequest),
        }).catch(Function.prototype as never);
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

export async function renameTab(targetId?: string) {
  targetId = targetId || getStore().activeTabId;
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
      const backendSessionId = targetTab.panes[0]?.sessionId || targetTab.panes[0]?.id || targetId;
      await fetch("/api/sessions/rename", {
        method: METHOD_POST,
        headers: apiReqHeaders(),
        body: JSON.stringify({ id: backendSessionId, title: newTitle } satisfies SessionsRenameRequest),
      });
    }
    setTabs((prev) => prev.map((t) => (t.id === targetId ? { ...t, title: newTitle } : t)));
  }
}

export async function fetchHosts() {
  try {
    const res = await fetch("/api/hosts", { headers: apiReqHeaders() });
    if (res.status === 401) {
      safeLogout(true);
      return;
    }
    const data: HostData[] = await res.json();
    setHosts(data || []);
  } catch (err) {
    console.error(err);
  }
}

export function openAddButtonDialog(initial?: Partial<ButtonForm>) {
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
  Object.assign(data, initial);
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
    const titleBase = removeNameNumSuffix(targetTab.title);
    if (idx === 0 && titleBase !== p.host) {
      params.set("title", titleBase);
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
  const { editButton, buttonFormData } = getStore();

  // Auto-update liquidjs value based on detected user variables
  const finalButtonFormData: ButtonData = {
    ...buttonFormData,
    id: buttonFormData.id || editButton?.id || generatePassword(12),
  };
  if (finalButtonFormData.type === "send_string") {
    if (finalButtonFormData.liquidjs !== undefined && finalButtonFormData.liquidjs !== 0) {
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
  await fetch(url, { method, headers: apiReqHeaders(), body: JSON.stringify(finalButtonFormData) });
  setInitialBtnFormData(null);
  setEditButtonDialogOpen(false);
  const res = await fetch("/api/buttons", { headers: apiReqHeaders() });
  const data = (await res.json()) as ButtonData[];
  setButtons(data || []);
  setActiveGroup(getStore().buttonFormData.group || DEFAULT_BUTTON_GROUP);
}

export async function deleteButton(id: string, name: string) {
  if (!(await dialogs.confirm(`Delete button "${name}" (${id})?`))) {
    return;
  }
  if (moduleCache[id]) {
    if (moduleCache[id].default?.unload) {
      moduleCache[id].default.unload();
    }
    delete moduleCache[id];
  }
  await fetch(`/api/buttons/${id}`, { method: METHOD_DELETE, headers: apiReqHeaders() });
  const res = await fetch("/api/buttons", { headers: apiReqHeaders() });
  const data: ButtonData[] = await res.json();
  setButtons(data || []);
}

export async function moveButton(id: string, direction: number) {
  await fetch("/api/buttons/move", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify({ id, direction } satisfies ButtonsMoveRequest),
  });
  const res = await fetch("/api/buttons", { headers: apiReqHeaders() });
  const data: ButtonData[] = await res.json();
  setButtons(data || []);
}

export async function reorderButtons(draggedId: string, targetId: string, position: "before" | "after") {
  const { buttons, activeGroup } = getStore();
  const groupButtons = buttons.filter((b) => (b.group || DEFAULT_BUTTON_GROUP) === activeGroup);
  const otherButtons = buttons.filter((b) => (b.group || DEFAULT_BUTTON_GROUP) !== activeGroup);

  const draggedIdx = groupButtons.findIndex((b) => b.id === draggedId);
  const targetIdx = groupButtons.findIndex((b) => b.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1) return;

  const newGroupButtons = [...groupButtons];
  const [removed] = newGroupButtons.splice(draggedIdx, 1);
  const newTargetIdx = newGroupButtons.findIndex((b) => b.id === targetId);
  const insertIdx = position === "before" ? newTargetIdx : newTargetIdx + 1;
  newGroupButtons.splice(insertIdx, 0, removed);

  const now = Date.now();
  const updatedGroupButtons = newGroupButtons.map((b, i) => ({
    ...b,
    order: (i + 1) * 10,
    mtime: now,
  }));

  const allButtons = [...otherButtons, ...updatedGroupButtons];
  // Sort them as backend would
  allButtons.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name);
  });

  // Optimistic update
  setButtons(allButtons);

  // Persist to backend
  try {
    const res = await fetch("/api/buttons?force=1", {
      method: METHOD_POST,
      headers: apiReqHeaders(),
      body: JSON.stringify(updatedGroupButtons),
    });
    if (!res.ok) {
      console.error("Failed to save reordered buttons:", await res.text());
    }
  } catch (e) {
    console.error("Failed to save reordered buttons:", e);
  }
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
  try {
    const res = await fetch(`/api/fulldata?sync=${sync}&refresh=${refresh}`, { headers: apiReqHeaders() });
    if (res.status === 401) {
      safeLogout(true);
      return;
    }
    const data: FullData = await res.json();
    useStore.setState(data);
  } catch (err) {
    console.error(err);
  }
}

export async function moveServer(serverName: string, destGroupPath: string | null, beforeServerName: string | null) {
  const hosts = getStore().hosts;
  const host = hosts.find((h) => h.name === serverName);
  if (!host) {
    return;
  }

  const siblingHosts = hosts.filter((h) => !h.isAuto && h.name !== serverName && getHostGroupPath(h) === destGroupPath);
  siblingHosts.sort((a, b) => {
    const orderA = getHostOrder(a);
    const orderB = getHostOrder(b);
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.name.localeCompare(b.name);
  });

  const newSortedList = [...siblingHosts];
  if (beforeServerName) {
    const idx = newSortedList.findIndex((h) => h.name === beforeServerName);
    if (idx !== -1) {
      newSortedList.splice(idx, 0, host);
    } else {
      newSortedList.push(host);
    }
  } else {
    newSortedList.push(host);
  }

  const updatedHosts: HostData[] = [];
  for (let i = 0; i < newSortedList.length; i++) {
    const h = newSortedList[i];
    const newOrder = (i + 1) * 10;
    const newGroupTag = destGroupPath ? `g-${destGroupPath}` : null;

    let tagsChanged = false;
    const newTags = h.tags
      ? h.tags.filter((t) => !t.startsWith(TAG_ORDER_PREFIX) && !t.startsWith(TAG_GROUP_PREFIX))
      : [];

    const oldGroupTag = h.tags ? h.tags.find((t) => t.startsWith(TAG_GROUP_PREFIX)) : null;
    const expectedGroupTag = newGroupTag;
    if (oldGroupTag !== expectedGroupTag) {
      tagsChanged = true;
    }
    if (newGroupTag) {
      newTags.push(newGroupTag);
    }

    const oldOrder = getHostOrder(h);
    if (oldOrder !== newOrder) {
      tagsChanged = true;
    }
    newTags.push(`o-${newOrder}`);

    if (h.name === serverName || tagsChanged) {
      const updatedHost = {
        ...h,
        tags: newTags,
      };
      updatedHosts.push(updatedHost);
    }
  }

  await fetch("/api/hosts", {
    method: METHOD_PUT,
    headers: apiReqHeaders(),
    body: JSON.stringify(updatedHosts),
  });

  fetchHosts();
}

export async function reorderFavourites(draggedName: string, targetName: string, position: "before" | "after") {
  const hosts = getStore().hosts;

  // Find all favourites
  const favs = hosts.filter((h) => h.isFavourite);
  // Sort them using hostSorter
  favs.sort(hostSorter);

  const draggedIdx = favs.findIndex((h) => h.name === draggedName);
  const targetIdx = favs.findIndex((h) => h.name === targetName);
  if (draggedIdx === -1 || targetIdx === -1) return;

  const newFavs = [...favs];
  const [removed] = newFavs.splice(draggedIdx, 1);
  const newTargetIdx = newFavs.findIndex((h) => h.name === targetName);
  const insertIdx = position === "before" ? newTargetIdx : newTargetIdx + 1;
  newFavs.splice(insertIdx, 0, removed);

  const updatedHosts: HostData[] = [];
  for (let i = 0; i < newFavs.length; i++) {
    const h = newFavs[i];
    const newOrder = (i + 1) * 10;

    // We clean existing o- tags
    const newTags = h.tags ? h.tags.filter((t) => !t.startsWith(TAG_ORDER_PREFIX)) : [];
    newTags.push(`o-${newOrder}`);

    // Compare with old order to only update if changed or if it is the dragged host
    const oldOrder = getHostOrder(h);
    if (oldOrder !== newOrder || h.name === draggedName) {
      const updatedHost = {
        ...h,
        tags: newTags,
      };
      updatedHosts.push(updatedHost);
    }
  }

  if (updatedHosts.length === 0) return;

  // Optimistic update to keep the UI snappy
  const updatedHostsMap = new Map(updatedHosts.map((h) => [h.name, h]));
  const optimisticHosts = hosts.map((h) => {
    if (updatedHostsMap.has(h.name)) {
      const updated = updatedHostsMap.get(h.name)!;
      return updated;
    }
    return h;
  });
  setHosts(optimisticHosts);

  // Send request to backend
  try {
    const res = await fetch("/api/hosts", {
      method: METHOD_PUT,
      headers: apiReqHeaders(),
      body: JSON.stringify(updatedHosts),
    });
    if (!res.ok) {
      console.error("Failed to reorder favourites:", await res.text());
      fetchHosts();
    } else {
      fetchHosts();
    }
  } catch (err) {
    console.error("Failed to reorder favourites:", err);
    fetchHosts();
  }
}

export async function moveGroup(srcPath: string, beforeSiblingPath: string) {
  const groups = getStore().groups;
  const draggedGroupList = groups.filter((g) => g === srcPath || g.startsWith(srcPath + "/"));
  const remainingGroups = groups.filter((g) => g !== srcPath && !g.startsWith(srcPath + "/"));

  const idx = remainingGroups.indexOf(beforeSiblingPath);
  const nextGroups = [...remainingGroups];
  if (idx !== -1) {
    nextGroups.splice(idx, 0, ...draggedGroupList);
  } else {
    nextGroups.push(...draggedGroupList);
  }

  const res = await fetch("/api/groups", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify(nextGroups),
  });
  if (res.ok) {
    setGroups(nextGroups);
  } else {
    dialogs.alert("Failed to save group order");
  }
}

export async function updateConfig(config: ConfigRequest) {
  try {
    const res = await fetch("/api/settings/config", {
      method: METHOD_POST,
      headers: apiReqHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      throw new Error(`status=${res.status}, msg=${await res.text()}`);
    }
    setSysinfo(config satisfies Partial<Sysinfo>);
    notify("Settings saved", "success", TOAST_KEY_API_SETTINGS);
  } catch (e) {
    notify(`Failed to save setting: ${e}`, "error", TOAST_KEY_API_SETTINGS);
  }
}

export function toggleGroupExpanded(path: string, includeChildren = false) {
  const { expandedGroups, groups } = getStore();
  const next = new Set(expandedGroups);
  const subGroups = includeChildren ? groups.filter((g) => g === path || g.startsWith(path + "/")) : [path];
  if (next.has(path)) {
    for (const g of subGroups) {
      next.delete(g);
    }
  } else {
    for (const g of subGroups) {
      next.add(g);
    }
  }
  setExpandedGroups(next);
}

export function openAddHostDialog(initial?: Partial<HostData>) {
  const data: HostForm = {
    name: "",
    hostname: "",
    user: "root",
    port: "22",
    source: "",
    identityFile: "",
    proxyJump: "",
    remoteCommand: "",
    addressFamily: "",
    userKnownHostsFile: "",
    strictHostKeyChecking: "",
    hostKeyAlgorithms: "",
    verifyHostKeyDns: "",
    sendEnv: "",
    localForward: "",
    remoteForward: "",
    tags: "",
    comment: "",
    password: "",
    passwordExists: false,
    clearPassword: false,
  };
  Object.assign(data, initial);
  setEditHostName("");
  setHostFormData(data);
  setInitialHostFormData(data);
  setEditHostDialogOpen(true);
}

export async function sshCopyId(target: HostData | HostForm) {
  let passwordInput: string | undefined = undefined;
  let expectedFingerprint: string | undefined = undefined;
  while (true) {
    try {
      const payload: CopyIDRequest = {
        name: target.name,
        password: passwordInput,
        expectedFingerprint,
      };

      const res = await fetch("/api/hosts/copy-id", {
        method: METHOD_POST,
        headers: apiReqHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        dialogs.alert(`ssh-copy-id "${payload.name}": Error copying SSH key: ${text || res.statusText}`);
        break;
      }

      const data = (await res.json()) as CopyIDResponse;
      if (data.status === "success") {
        dialogs.alert(`ssh-copy-id "${payload.name}": ${data.message}`);
        break;
      } else if (data.status === "need_app_password") {
        const appPwd = await dialogs.promptPassword(
          `ssh-copy-id "${payload.name}": ${
            data.message || "The password store is locked. Enter your CozySSH app password to unlock it:"
          }`,
        );
        if (!appPwd) {
          break;
        }
        const res = await fetch("/api/login", {
          method: METHOD_POST,
          headers: {
            [HEADER_CONTENT_TYPE]: MIME_JSON,
          },
          body: JSON.stringify({ password: appPwd }),
        });
        if (!res.ok) {
          dialogs.alert(`ssh-copy-id "${payload.name}": Invalid app password, can't unlock password store.`);
          break;
        }
      } else if (data.status === "need_password") {
        const promptMsg = `ssh-copy-id "${payload.name}": ${
          data.message || `Enter password for ${target.user || "root"}@${target.hostname}:`
        }`;
        const pwd = await dialogs.promptPassword(promptMsg);
        if (pwd === null) {
          break;
        }
        passwordInput = pwd;
      } else if (data.status === "need_hostkey_confirm") {
        if (
          !(await dialogs.confirm(
            `ssh-copy-id "${payload.name}": host key isn't trusted: ${data.message}. ` +
              `New host key finterprint: ${data.fingerprint}. Accept it?`,
            "",
            true,
          ))
        ) {
          return;
        }
        if (!data.fingerprint) {
          break;
        }
        expectedFingerprint = data.fingerprint;
      } else {
        dialogs.alert(`ssh-copy-id "${payload.name}": Error: ${data.message}`);
        break;
      }
    } catch (err: unknown) {
      dialogs.alert(`ssh-copy-id "${target.name}": Error: ${err}`);
      break;
    }
  }
}

export function openEditHostDialog(target: HostData) {
  const isAuto = target.source === "known_hosts";
  const data: HostForm = {
    ...target,
    name: parseHostName(target.name || target.hostname).hostname,
    tags: target.tags?.join(" ") || "",
  };
  setEditHostName(isAuto ? "" : target.name);
  setHostFormData(data);
  setInitialHostFormData(data);
  setEditHostDialogOpen(true);
}

/**
 * Open edit tab's first pane host dialog.
 * @param target can be a tab or a tab id. Defaults to current active tab.
 */
export function openEditTabHost(target?: TabData | string) {
  const { tabs, activeTabId } = getStore();
  target = target || activeTabId;
  if (typeof target === "string") {
    target = tabs.find((t) => t.id === target);
  }
  if (!target || target.type !== "terminal") {
    return;
  }
  const pane = target.panes.find((p) => p.id === target.activePaneId) || target.panes[0];
  openEditHostByName(pane.host);
}

export function openEditHostByName(hostname: string) {
  const host = getHost(hostname);
  if (host.hostname === LOCAL_NAME) {
    dialogs.alert("local shell can't be edited");
    return;
  }
  if (host.source) {
    openEditHostDialog(host);
  } else {
    openAddHostDialog(host);
  }
}

/**
 * Find a host. It always returns a HostData.
 * It first tries to match the host with existing store hosts record.
 * If not found, it constructs and returns a new HostData object which source = "".
 */
export function getHost(
  host: string | (Pick<HostData, "hostname"> & Partial<Pick<HostData, "port" | "user" | "password">>),
): HostData {
  const parsedHost = typeof host === "string" ? parseHostName(host) : host;
  const parsedHostString = getCanonicalHostString(parsedHost, undefined, true);
  const known = getStore().hosts.find(
    (h) =>
      (parsedHost.user === undefined &&
        parsedHost.password === undefined &&
        parsedHost.port === undefined &&
        h.name === parsedHost.hostname) ||
      getCanonicalHostString(h, undefined, true) === parsedHostString,
  );
  return (
    known ||
    Object.assign(parsedHost, {
      name: parsedHost.hostname,
      port: parsedHost.port || "22",
      user: parsedHost.user || "root",
    })
  );
}

export function openEditButtonDialog(btn: ButtonData) {
  const data: ButtonForm = { ...btn, group: btn.group || DEFAULT_BUTTON_GROUP };
  setEditButton(btn);
  setButtonFormData(data);
  setInitialBtnFormData(data);
  setEditButtonDialogOpen(true);
}

export function getTab(tabId?: string): TabData | undefined {
  const { tabs, activeTabId } = getStore();
  tabId = tabId || activeTabId;
  return tabs.find((t) => t.id === tabId);
}

export function getPane(paneId?: string): PaneData | undefined {
  const { tabs, activePaneId } = getStore();
  paneId = paneId || activePaneId;
  for (const tab of tabs) {
    const pane = tab.panes.find((p) => p.id === paneId);
    if (pane) {
      return pane;
    }
  }
  return undefined;
}

export function newTabTitle(baseTitle: string): string {
  baseTitle = baseTitle || "server";
  const tabNames = getStore().tabs.reduce((v, t) => {
    if (t.type === "terminal") {
      v.add(t.title);
    }
    return v;
  }, new Set<string>());

  if (!tabNames.has(baseTitle)) {
    return baseTitle;
  }
  let num = 1;
  let title = "";
  do {
    title = `${baseTitle} (${num++})`;
  } while (tabNames.has(title));
  return title;
}

export async function deleteHost(name: string) {
  if (!(await dialogs.confirm(`Are you certain you want to permanently delete host "${name}"?`))) {
    return;
  }
  await fetch(`/api/hosts/${name}`, { method: METHOD_DELETE, headers: apiReqHeaders() });
  fetchHosts();
}

export function moveTabLeft(tabId?: string) {
  const { tabs, activeTabId } = getStore();
  tabId = tabId || activeTabId;
  const i = tabs.findIndex((t) => t.id === tabId);
  if (i <= 0) {
    return;
  }
  const newTabs = tabs.slice();
  newTabs[i - 1] = tabs[i];
  newTabs[i] = tabs[i - 1];
  setTabs(newTabs);
}

export function moveTabRight(tabId?: string) {
  const { tabs, activeTabId } = getStore();
  tabId = tabId || activeTabId;
  const i = tabs.findIndex((t) => t.id === tabId);
  if (i < 0 || i === tabs.length - 1) {
    return;
  }
  const newTabs = tabs.slice();
  newTabs[i + 1] = tabs[i];
  newTabs[i] = tabs[i + 1];
  setTabs(newTabs);
}
