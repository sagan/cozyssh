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

interface MainState {
  tabs: TabData[];
  activeTabId: string;
  activePaneId: string;
  hosts: HostData[];
  buttons: ButtonData[];
  vars: Record<string, string>;
  /** Local (browser-only) vars. All names have a "local" (case-insensitive) prefix. */
  localVars: Record<string, string | undefined>;
  shellIntegrations: Record<string, ShellIntegration>;
}

interface MainActions {
  setTabs: (tabs: TabData[] | ((prev: TabData[]) => TabData[])) => void;
  setActiveTabId: (id: string) => void;
  setActivePaneId: (id: string) => void;
  setHosts: (hosts: HostData[]) => void;
  setButtons: (buttons: ButtonData[]) => void;
  setVars: (vars: Record<string, string>) => void;
  setLocalVars: (localVars: Record<string, string | undefined>) => void;
  setShellIntegrations: (
    update:
      | Record<string, ShellIntegration>
      | ((prev: Record<string, ShellIntegration>) => Record<string, ShellIntegration>)
  ) => void;
}

type DashboardStore = MainState & MainActions;

export const useStore = create<DashboardStore>((set) => ({
  // ── State ──────────────────────────────────────────────────────────────
  tabs: [],
  activeTabId: "",
  activePaneId: "",
  hosts: [],
  buttons: [],
  vars: {},
  localVars: {},
  shellIntegrations: {},

  // ── Actions ────────────────────────────────────────────────────────────
  setTabs: (tabs) => set((state) => ({ tabs: typeof tabs === "function" ? tabs(state.tabs) : tabs })),

  setActiveTabId: (id) => set({ activeTabId: id }),
  setActivePaneId: (id) => set({ activePaneId: id }),
  setHosts: (hosts) => set({ hosts }),
  setButtons: (buttons) => set({ buttons }),
  setVars: (vars) => set({ vars }),
  setLocalVars: (localVars) => set({ localVars }),

  setShellIntegrations: (update) =>
    set((state) => ({
      shellIntegrations: typeof update === "function" ? update(state.shellIntegrations) : update,
    })),
}));

/**
 * Synchronous, non-reactive getter — safe to call from event handlers,
 * setTimeout callbacks, and window.cs* plugin functions.
 */
export const getStore = () => useStore.getState();

export type UseStore = typeof useStore;

window.__CS_USE_STORE__ = useStore;
