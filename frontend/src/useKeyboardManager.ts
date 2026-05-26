/**
 * useKeyboardManager.ts
 *
 * Isolates the global keyboard shortcut listener from Dashboard.tsx.
 *
 * Key design: the keydown handler calls getStore() at invocation time, so it
 * always sees fresh state (tabs, activePaneId, buttons, groups, etc.) without
 * needing a large dependency array or ref-mirroring.
 */

import { useEffect } from "react";

import { type ButtonData } from "./api";
import { BROWSER_STORAGE_KEY_ACTIVE_GROUP, DEFAULT_BUTTON_GROUP, DEFAULT_SCROLL_LINES, LOCAL_NAME } from "./constants";
import {
  type CSEventDetailActiveGroupChange,
  type NewTabDialogViewMode,
  CS_EVENT_ACTIVE_GROUP_CHANGE,
  getKeyCombination,
} from "./common";
import { type TerminalRefMap, getStore, setActivePaneId, setActiveTabId } from "./store";

export interface KeyboardManagerOptions {
  /** Called when a button shortcut is triggered */
  handleButtonClick: (btn: ButtonData, isAutoRun?: boolean) => void;
  /** Open a local terminal tab */
  handleSelectHost: (host: string) => void;
  /** Open (or switch to) the scratchpad tab */
  handleOpenScratchpad: () => void;
  /** Close the active pane, or the whole tab if it's the last pane */
  handleCloseCurrentPaneOrTab: () => void;
  /** Open / close the new-tab dialog */
  setNewTabDialogOpen: (open: boolean) => void;
  /** Set the initial view mode of the new-tab dialog */
  setNewTabDialogInitialViewMode: (mode: NewTabDialogViewMode) => void;
  /** Ref to the terminal search input */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  /** Open the in-terminal search bar */
  setSearchOpen: (open: boolean) => void;
  /** Getter for the live terminal ref map */
  getTerminalRefs: () => TerminalRefMap;
}

export function useKeyboardManager(options: KeyboardManagerOptions): void {
  const {
    handleButtonClick,
    handleSelectHost,
    handleOpenScratchpad,
    handleCloseCurrentPaneOrTab,
    setNewTabDialogOpen,
    setNewTabDialogInitialViewMode,
    searchInputRef,
    setSearchOpen,
    getTerminalRefs,
  } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ── Read fresh state at call-time (no stale closures) ────────────────
      const { tabs, activePaneId, activeTabId, buttons } = getStore();
      const terminalRefs = getTerminalRefs();

      // Derive scrollLines from store vars at call-time
      const { vars, localVars } = getStore();
      const scrollLinesVar = localVars["local_cs_scroll_lines"] ?? vars["cs_scroll_lines"];
      const scrollLines = scrollLinesVar ? parseInt(scrollLinesVar) || DEFAULT_SCROLL_LINES : DEFAULT_SCROLL_LINES;

      // Derive groups / activeGroup / shortcutButtons from store at call-time
      const activeGroup = localStorage.getItem(BROWSER_STORAGE_KEY_ACTIVE_GROUP) || DEFAULT_BUTTON_GROUP;
      const groups = [
        DEFAULT_BUTTON_GROUP,
        ...Array.from(
          new Set(buttons.map((b) => b.group || DEFAULT_BUTTON_GROUP).filter((g) => g !== DEFAULT_BUTTON_GROUP))
        ),
      ].sort();

      const shortcutButtons: Record<string, ButtonData> = {};
      for (const btn of buttons) {
        if ((btn.group || DEFAULT_BUTTON_GROUP) === activeGroup) {
          continue;
        }
        if (btn.shortcut && btn.shortcut.length > 1) {
          shortcutButtons[btn.shortcut.toLowerCase()] = btn;
        }
      }
      // active group button shortcut has priority
      for (const btn of buttons) {
        if ((btn.group || DEFAULT_BUTTON_GROUP) !== activeGroup) {
          continue;
        }
        if (btn.shortcut && btn.shortcut.length > 1) {
          shortcutButtons[btn.shortcut.toLowerCase()] = btn;
        }
      }

      const keycomb = getKeyCombination(e);

      // ── Button shortcuts ──────────────────────────────────────────────────
      if (shortcutButtons[keycomb]) {
        e.preventDefault();
        handleButtonClick(shortcutButtons[keycomb]);
        return;
      }

      // Suppress standalone Alt key
      if (e.key === "Alt" && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        return;
      }

      // ── Named shortcuts ───────────────────────────────────────────────────
      switch (keycomb) {
        case "alt+o":
          e.preventDefault();
          setNewTabDialogInitialViewMode("servers");
          setNewTabDialogOpen(true);
          return;

        case "alt+a":
          e.preventDefault();
          setNewTabDialogInitialViewMode("tabs");
          setNewTabDialogOpen(true);
          return;

        case "alt+e":
          e.preventDefault();
          setNewTabDialogInitialViewMode("buttons");
          setNewTabDialogOpen(true);
          return;

        case "alt+n":
          e.preventDefault();
          handleSelectHost(LOCAL_NAME);
          return;

        case "alt+s":
          e.preventDefault();
          handleOpenScratchpad();
          return;

        case "alt+h": {
          e.preventDefault();
          const allPanes = tabs.flatMap((t) => t.panes.map((p) => ({ tabId: t.id, paneId: p.id })));
          if (allPanes.length === 0) {
            return;
          }
          const idx = allPanes.findIndex((p) => p.paneId === activePaneId);
          const nextIdx = (idx - 1 + allPanes.length) % allPanes.length;
          const target = allPanes[nextIdx];
          setActiveTabId(target.tabId);
          setActivePaneId(target.paneId);
          (document.activeElement as HTMLElement)?.blur?.();
          terminalRefs[target.paneId]?.focus();
          setTimeout(() => terminalRefs[target.paneId]?.focus(), 100);
          return;
        }

        case "alt+l": {
          e.preventDefault();
          const allPanes = tabs.flatMap((t) => t.panes.map((p) => ({ tabId: t.id, paneId: p.id })));
          if (allPanes.length === 0) {
            return;
          }
          const idx = allPanes.findIndex((p) => p.paneId === activePaneId);
          const nextIdx = (idx + 1) % allPanes.length;
          const target = allPanes[nextIdx];
          setActiveTabId(target.tabId);
          setActivePaneId(target.paneId);
          (document.activeElement as HTMLElement)?.blur?.();
          terminalRefs[target.paneId]?.focus();
          setTimeout(() => terminalRefs[target.paneId]?.focus(), 100);
          return;
        }

        case "alt+w":
          e.preventDefault();
          handleCloseCurrentPaneOrTab();
          return;

        case "alt+g": {
          e.preventDefault();
          const currentTab = tabs.find((t) => t.id === activeTabId);
          if (currentTab && currentTab.panes.length > 0) {
            const pid = currentTab.panes[0].id;
            setActivePaneId(pid);
            setTimeout(() => terminalRefs[pid]?.focus(), 100);
          }
          return;
        }

        case "alt+v":
        case "alt+shift+v": {
          e.preventDefault();
          const idx = groups.indexOf(activeGroup);
          const nextIdx = (e.shiftKey ? idx - 1 + groups.length : idx + 1) % groups.length;
          localStorage.setItem("cozy_active_group", groups[nextIdx]);
          // Dashboard listens to storage or manages activeGroup state; trigger a
          // custom event so Dashboard can update its local activeGroup state.
          window.dispatchEvent(
            new CustomEvent(CS_EVENT_ACTIVE_GROUP_CHANGE, {
              detail: { group: groups[nextIdx] } satisfies CSEventDetailActiveGroupChange,
            })
          );
          return;
        }

        case "alt+j":
        case "alt+shift+j": {
          const term = terminalRefs[activePaneId];
          if (term && "getXterm" in term) {
            e.preventDefault();
            if (e.shiftKey) {
              term.scrollPages(1);
            } else {
              term.scrollLines(scrollLines);
            }
          }
          return;
        }

        case "alt+k":
        case "alt+shift+k": {
          const term = terminalRefs[activePaneId];
          if (term && "getXterm" in term) {
            e.preventDefault();
            if (e.shiftKey) {
              term.scrollPages(-1);
            } else {
              term.scrollLines(-scrollLines);
            }
          }
          return;
        }

        case "ctrl+shift+f":
          if (
            !document.querySelector("body > div.MuiDialog-root") &&
            terminalRefs[activePaneId] &&
            "clear" in terminalRefs[activePaneId]!
          ) {
            e.preventDefault();
            setSearchOpen(true);
            setTimeout(() => searchInputRef.current?.focus(), 100);
          }
          return;

        case "ctrl+shift+r": {
          const term = terminalRefs[activePaneId];
          if (term && "getXterm" in term) {
            e.preventDefault();
            term.reconnect();
          }
          return;
        }

        case "ctrl+shift+c": {
          const term = terminalRefs[activePaneId];
          if (term && "getXterm" in term) {
            e.preventDefault();
            const text = term.getSelection();
            if (text) {
              navigator.clipboard.writeText(text);
            }
          }
          return;
        }
      }

      // ── Alt+0-9: switch to tab by index ───────────────────────────────────
      if (e.altKey && e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        let idx = parseInt(e.key);
        idx = idx === 0 ? tabs.length - 1 : idx - 1;
        if (tabs[idx]) {
          const target = tabs[idx];
          setActiveTabId(target.id);
          setActivePaneId(target.activePaneId);
          (document.activeElement as HTMLElement)?.blur?.();
          terminalRefs[target.activePaneId]?.focus();
          setTimeout(() => terminalRefs[target.activePaneId]?.focus(), 100);
        }
        return;
      }

      // ── Alt+Shift+0-9: trigger button by index ────────────────────────────
      if (e.altKey && e.shiftKey) {
        const digitMatch = e.code.match(/Digit(\d)/);
        if (digitMatch) {
          e.preventDefault();
          const num = parseInt(digitMatch[1]);
          const idx = num === 0 ? 9 : num - 1;
          const filteredButtons = buttons.filter((b) => (b.group || DEFAULT_BUTTON_GROUP) === activeGroup);
          if (idx < filteredButtons.length) {
            handleButtonClick(filteredButtons[idx]);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // Stable callbacks only — no store state in deps.
  }, [
    handleButtonClick,
    handleSelectHost,
    handleOpenScratchpad,
    handleCloseCurrentPaneOrTab,
    setNewTabDialogOpen,
    setNewTabDialogInitialViewMode,
    searchInputRef,
    setSearchOpen,
    getTerminalRefs,
  ]);
}
