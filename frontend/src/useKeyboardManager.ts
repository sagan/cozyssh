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
import {
  BROWSER_STORAGE_KEY_ACTIVE_GROUP,
  DEFAULT_BUTTON_GROUP,
  DEFAULT_SCROLL_LINES,
  DEFAULT_TERMINAL_FONT_SIZE,
  LOCAL_NAME,
  LOCAL_VAR_PREFIX,
  TOAST_KEY_TERMINAL_FONT_SIZE,
  VAR_CS_SCROLL_LINES,
  VAR_CS_TERMINAL_FONT_SIZE,
} from "./constants";
import { getIntVar, getKeyCombination, isMuiDialogOpen, nextTerminalFontSize, prevTerminalFontSize } from "./common";
import {
  type TerminalRefMap,
  getStore,
  setActiveGroup,
  setActivePaneId,
  setActiveTabId,
  setNewTabDialogInitialViewMode,
  setNewTabDialogOpen,
  setTabs,
  triggerFocus,
  triggerFocusSearchInput,
} from "./store";

export interface KeyboardManagerOptions {
  handleCloneSession: (id: string, cloneInSameTab?: boolean) => void;
  /** Called when a button shortcut is triggered */
  handleButtonClick: (btn: ButtonData, isAutoRun?: boolean) => void;
  /** Open a local terminal tab */
  handleSelectHost: (host: string) => void;
  /** Open (or switch to) the scratchpad tab */
  handleOpenScratchpad: () => void;
  /** Close the active pane, or the whole tab if it's the last pane */
  handleCloseTabOrPane: (tabOrPaneId?: string) => void;
  /** Ref to the terminal search input */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  /** Open the in-terminal search bar */
  setSearchOpen: (open: boolean) => void;
  /** Getter for the live terminal ref map */
  getTerminalRefs: () => TerminalRefMap;
  /** Ref to the sidebar filter input */
  sidebarFilterRef: React.RefObject<HTMLInputElement | null>;
}

export const disableShortcuts = new Set<string>();

export function useKeyboardManager(options: KeyboardManagerOptions): void {
  const {
    handleCloneSession,
    handleButtonClick,
    handleSelectHost,
    handleOpenScratchpad,
    handleCloseTabOrPane,
    searchInputRef,
    setSearchOpen,
    getTerminalRefs,
    sidebarFilterRef,
  } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ── Read fresh state at call-time (no stale closures) ────────────────
      const { tabs, activePaneId, activeTabId, buttons } = getStore();
      const terminalRefs = getTerminalRefs();

      // Derive scrollLines from store vars at call-time
      const { vars, localVars } = getStore();
      const scrollLines = getIntVar(vars, localVars, VAR_CS_SCROLL_LINES, DEFAULT_SCROLL_LINES);

      // Derive groups / activeGroup / shortcutButtons from store at call-time
      const activeGroup = localStorage.getItem(BROWSER_STORAGE_KEY_ACTIVE_GROUP) || DEFAULT_BUTTON_GROUP;
      const groups = [
        DEFAULT_BUTTON_GROUP,
        ...Array.from(
          new Set(buttons.map((b) => b.group || DEFAULT_BUTTON_GROUP).filter((g) => g !== DEFAULT_BUTTON_GROUP)),
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

      if (disableShortcuts.has(keycomb)) {
        return;
      }

      // ── Named shortcuts ───────────────────────────────────────────────────
      switch (keycomb) {
        case "alt+enter": {
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.getElementById("main-content")?.requestFullscreen();
          }
          return;
        }
        case "ctrl+alt+0": {
          e.preventDefault();
          const { vars, localVars } = getStore();
          let varName: string;
          if (!vars[VAR_CS_TERMINAL_FONT_SIZE] || localVars[LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE]) {
            varName = LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE;
          } else {
            varName = VAR_CS_TERMINAL_FONT_SIZE;
          }
          if (DEFAULT_TERMINAL_FONT_SIZE !== __CS_TERMINAL_FONT_SIZE__) {
            csSetVar(varName, DEFAULT_TERMINAL_FONT_SIZE.toString());
            csNotify(`Terminal font size reset to ${DEFAULT_TERMINAL_FONT_SIZE}`, "info", TOAST_KEY_TERMINAL_FONT_SIZE);
          }
          return;
        }
        case "alt+-": {
          e.preventDefault();
          const { vars, localVars } = getStore();
          let varName: string;
          if (!vars[VAR_CS_TERMINAL_FONT_SIZE] || localVars[LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE]) {
            varName = LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE;
          } else {
            varName = VAR_CS_TERMINAL_FONT_SIZE;
          }
          const fontSize = prevTerminalFontSize(__CS_TERMINAL_FONT_SIZE__);
          if (fontSize !== __CS_TERMINAL_FONT_SIZE__) {
            csSetVar(varName, fontSize.toString());
            csNotify(
              `Terminal font size: ${fontSize.toFixed(1).padStart(4, "0")}`,
              "info",
              TOAST_KEY_TERMINAL_FONT_SIZE,
            );
          }
          return;
        }
        case "alt+=": // in most keyboard layout the "+" key lowercase char is "="
        case "alt++": {
          e.preventDefault();
          let varName: string;
          if (!vars[VAR_CS_TERMINAL_FONT_SIZE] || localVars[LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE]) {
            varName = LOCAL_VAR_PREFIX + VAR_CS_TERMINAL_FONT_SIZE;
          } else {
            varName = VAR_CS_TERMINAL_FONT_SIZE;
          }
          const fontSize = nextTerminalFontSize(__CS_TERMINAL_FONT_SIZE__);
          if (fontSize !== __CS_TERMINAL_FONT_SIZE__) {
            csSetVar(varName, fontSize.toString());
            csNotify(
              `Terminal font size: ${fontSize.toFixed(1).padStart(4, "0")}`,
              "info",
              TOAST_KEY_TERMINAL_FONT_SIZE,
            );
          }
          return;
        }
        case "alt+c":
          e.preventDefault();
          handleCloneSession(activePaneId);
          return;

        case "alt+shift+c":
          e.preventDefault();
          handleCloneSession(activePaneId, true);
          return;

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

        case "alt+i":
        case "alt+shift+i":
          if (!isMuiDialogOpen()) {
            e.preventDefault();
            if (keycomb === "alt+shift+i") {
              csSetSidebarFilter("");
            }
            sidebarFilterRef.current?.focus();
          }
          return;

        case "alt+h":
        case "alt+shift+h": {
          e.preventDefault();
          const idx = tabs.findIndex((t) => t.id === activeTabId);
          if (idx < 0) {
            return;
          }
          const activeTab = tabs[idx];
          if (activeTab.panes.length <= 1 || keycomb === "alt+shift+h") {
            // single pane tab or shift pressed, switch to prev tab
            const prevIdx = (idx - 1 + tabs.length) % tabs.length;
            const targetTab = tabs[prevIdx];
            const targetPaneId = targetTab.activePaneId;
            setActiveTabId(targetTab.id);
            setActivePaneId(targetPaneId);
            setTabs((tabs) => tabs.map((t) => (t.id === targetTab.id ? { ...t, activePaneId: targetPaneId } : t)));
            (document.activeElement as HTMLElement)?.blur?.();
            triggerFocus();
          } else {
            // multiple-panes tab, switch to prev pane of this tab
            const paneIdx = activeTab.panes.findIndex((p) => p.id === activePaneId);
            const prevPaneIdx = (paneIdx - 1 + activeTab.panes.length) % activeTab.panes.length;
            const targetPaneId = activeTab.panes[prevPaneIdx].id;
            setActivePaneId(targetPaneId);
            setTabs((tabs) => tabs.map((t) => (t.id === activeTab.id ? { ...t, activePaneId: targetPaneId } : t)));
            (document.activeElement as HTMLElement)?.blur?.();
            triggerFocus();
          }
          return;
        }

        case "alt+l":
        case "alt+shift+l": {
          e.preventDefault();
          const idx = tabs.findIndex((t) => t.id === activeTabId);
          if (idx < 0) {
            return;
          }
          const activeTab = tabs[idx];
          if (activeTab.panes.length <= 1 || keycomb === "alt+shift+l") {
            // single pane tab or shift pressed, switch to next tab
            const nextIdx = (idx + 1) % tabs.length;
            const targetTab = tabs[nextIdx];
            const targetPaneId = targetTab.activePaneId;
            setActiveTabId(targetTab.id);
            setActivePaneId(targetPaneId);
            setTabs((tabs) => tabs.map((t) => (t.id === targetTab.id ? { ...t, activePaneId: targetPaneId } : t)));
            (document.activeElement as HTMLElement)?.blur?.();
            triggerFocus();
          } else {
            // multiple-panes tab, switch to next pane of this tab
            const paneIdx = activeTab.panes.findIndex((p) => p.id === activePaneId);
            const nextPaneIdx = (paneIdx + 1) % activeTab.panes.length;
            const targetPaneId = activeTab.panes[nextPaneIdx].id;
            setActivePaneId(targetPaneId);
            setTabs((tabs) => tabs.map((t) => (t.id === activeTab.id ? { ...t, activePaneId: targetPaneId } : t)));
            (document.activeElement as HTMLElement)?.blur?.();
            triggerFocus();
          }
          return;
        }

        case "alt+w":
          e.preventDefault();
          handleCloseTabOrPane();
          return;

        case "alt+shift+w":
          e.preventDefault();
          handleCloseTabOrPane(activeTabId);
          return;

        case "alt+g": {
          e.preventDefault();
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab?.activePaneId) {
            const pid = activeTab.activePaneId;
            setActivePaneId(pid);
            triggerFocus();
          }
          return;
        }

        case "alt+shift+g": {
          e.preventDefault();
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab && activeTab.panes.length > 0) {
            const pid = activeTab.panes[0].id;
            setActivePaneId(pid);
            setTabs((tabs) => tabs.map((t) => (t.id === activeTabId ? { ...t, activePaneId: pid } : t)));
            triggerFocus();
          }
          return;
        }

        case "alt+v":
        case "alt+shift+v": {
          e.preventDefault();
          const idx = groups.indexOf(activeGroup);
          let nextIdx = (e.shiftKey ? idx - 1 + groups.length : idx + 1) % groups.length;
          while (nextIdx !== idx && groups[nextIdx].startsWith("_")) {
            nextIdx = (e.shiftKey ? nextIdx - 1 + groups.length : nextIdx + 1) % groups.length;
          }
          setActiveGroup(groups[nextIdx]);
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
          if (!isMuiDialogOpen() && terminalRefs[activePaneId] && "clear" in terminalRefs[activePaneId]!) {
            e.preventDefault();
            setSearchOpen(true);
            triggerFocusSearchInput();
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
          triggerFocus();
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
    handleCloseTabOrPane,
    searchInputRef,
    setSearchOpen,
    getTerminalRefs,
    handleCloneSession,
    sidebarFilterRef,
  ]);
}
