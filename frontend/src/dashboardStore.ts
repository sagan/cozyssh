/**
 * dashboardStore.ts
 *
 * Zustand store for core Dashboard state that must be accessible from
 * non-reactive contexts (global window.cs* functions, keyboard event listeners).
 *
 * Use `useDashboardStore` inside React components for reactive subscriptions.
 * Use `getStore()` inside callbacks/event handlers for a synchronous, always-fresh snapshot.
 */

import { create } from 'zustand';
import type { Host } from './Sidebar';
import type { TerminalHandle, ShellIntegration } from './Terminal';
import type { ScratchpadHandle } from './Scratchpad';

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
  type?: 'terminal' | 'scratchpad';
}

export interface ButtonData {
  id: string;
  name: string;
  type: string;
  payload: string;
  group?: string;
  autorun?: number;
  order?: number;
  /** shortcut key combo, e.g. "ctrl+shift+m", modifiers in ctrl,alt,shift,meta order */
  shortcut?: string;
}

export type TerminalRefMap = Record<string, TerminalHandle | ScratchpadHandle | null>;

interface DashboardState {
  tabs: TabData[];
  activeTabId: string;
  activePaneId: string;
  hosts: Host[];
  buttons: ButtonData[];
  vars: Record<string, string>;
  /** Local (browser-only) vars. All names have a "local" (case-insensitive) prefix. */
  localVars: Record<string, string | undefined>;
  shellIntegrations: Record<string, ShellIntegration>;
}

interface DashboardActions {
  setTabs: (tabs: TabData[] | ((prev: TabData[]) => TabData[])) => void;
  setActiveTabId: (id: string) => void;
  setActivePaneId: (id: string) => void;
  setHosts: (hosts: Host[]) => void;
  setButtons: (buttons: ButtonData[]) => void;
  setVars: (vars: Record<string, string>) => void;
  setLocalVars: (localVars: Record<string, string | undefined>) => void;
  setShellIntegrations: (
    update:
      | Record<string, ShellIntegration>
      | ((prev: Record<string, ShellIntegration>) => Record<string, ShellIntegration>)
  ) => void;
}

type DashboardStore = DashboardState & DashboardActions;

export const useDashboardStore = create<DashboardStore>((set) => ({
  // ── State ──────────────────────────────────────────────────────────────
  tabs: [],
  activeTabId: '',
  activePaneId: '',
  hosts: [],
  buttons: [],
  vars: {},
  localVars: {},
  shellIntegrations: {},

  // ── Actions ────────────────────────────────────────────────────────────
  setTabs: (tabs) =>
    set((state) => ({ tabs: typeof tabs === 'function' ? tabs(state.tabs) : tabs })),

  setActiveTabId: (id) => set({ activeTabId: id }),
  setActivePaneId: (id) => set({ activePaneId: id }),
  setHosts: (hosts) => set({ hosts }),
  setButtons: (buttons) => set({ buttons }),
  setVars: (vars) => set({ vars }),
  setLocalVars: (localVars) => set({ localVars }),

  setShellIntegrations: (update) =>
    set((state) => ({
      shellIntegrations:
        typeof update === 'function' ? update(state.shellIntegrations) : update,
    })),
}));

/**
 * Synchronous, non-reactive getter — safe to call from event handlers,
 * setTimeout callbacks, and window.cs* plugin functions.
 */
export const getStore = () => useDashboardStore.getState();
