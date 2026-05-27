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

import type { HostData, ButtonData } from "./api";
import type { ShellIntegration } from "./common";
import type { TerminalHandle } from "./Terminal";
import type { ScratchpadHandle } from "./Scratchpad";
import { BROWSER_STORAGE_KEY_LOCAL_VARS, BROWSER_STORAGE_KEY_VARS } from "./constants";

// Re-exported so consumers don't need to import from Dashboard.tsx
export interface PaneData {
  id: string;
  sessionId?: string;
  host: string;
  state?: string;
  cloneFrom?: string;
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
  tabs: TabData[];
  activeTabId: string;
  activePaneId: string;
  hosts: HostData[];
  buttons: ButtonData[];
  vars: Record<string, string>;
  /** Local (browser-only) vars. All names have a "local" (case-insensitive) prefix. */
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

export const useStore = create<Store>((_set) => ({
  tabs: [],
  activeTabId: "",
  activePaneId: "",
  hosts: [],
  buttons: [],
  vars: loadVarsFromStorate(BROWSER_STORAGE_KEY_VARS),
  localVars: loadVarsFromStorate(BROWSER_STORAGE_KEY_LOCAL_VARS),
  shellIntegrations: {},
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
    | ((data: Record<string, ShellIntegration>) => Record<string, ShellIntegration>)
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

window.__CS_USE_STORE__ = useStore;
