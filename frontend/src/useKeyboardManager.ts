/**
 * useKeyboardManager.ts
 *
 * Isolates the global keyboard shortcut listener from Dashboard.tsx.
 *
 * Key design: the keydown handler calls getStore() at invocation time, so it
 * always sees fresh state (tabs, activePaneId, buttons, groups, etc.) without
 * needing a large dependency array or ref-mirroring.
 */

import {
  DEFAULT_BUTTON_GROUP,
  DEFAULT_SCROLL_LINES,
  ID_INPUT_DIALOG_INPUT,
  ID_SIDEBAR,
  ID_SIDEBAR_FILTER,
  LOCAL_NAME,
  SETTINGS_TABS,
  TOAST_KEY_REFRESH,
  VAR_CS_SCROLL_LINES,
} from "./constants";
import {
  blackholeShortcuts,
  closeModal,
  disableShortcuts,
  forceReload,
  getKeyCombination,
  isModifier,
  getActiveMuiModal,
  localShellHost,
  t,
} from "./common";
import {
  activatePane,
  changeNewTabDialogViewMode,
  cloneSession,
  closeInputDialog,
  closeOtherTabs,
  closeTabOrPane,
  decreseFontSize,
  getStore,
  increaseFontSize,
  nextButtonGroup,
  openHost,
  openInputDialog,
  openScratchpad,
  prevButtonGroup,
  resetFontSize,
  setActivePaneId,
  setActiveTabId,
  setEditButtonDialogOpen,
  setEditHostDialogOpen,
  setNewTabDialogOpen,
  setSearchOpen,
  triggerFocus,
  triggerFocusSearchInput,
  getIntVar,
  setToasts,
  unlockTab,
  lockTab,
  setFavExpanded,
  setAllExpanded,
  setAutoExpanded,
  setTagsExpanded,
  toggleExpandAllGroups,
  setSettingsTab,
  refreshData,
  notify,
  useStore,
  runButton,
  setMobileOpen,
  toggleMarkMode,
} from "./store";

const handleKeyDown = (e: KeyboardEvent) => {
  const keycomb = getKeyCombination(e);
  if (__CS_SHORTCUT_BUTTONS__[keycomb]) {
    e.preventDefault();
    runButton(__CS_SHORTCUT_BUTTONS__[keycomb]);
    return;
  }
  if (__CS_CUSTOM_SHORTCUTS__[keycomb] && !__CS_CUSTOM_SHORTCUTS__[keycomb].disabled) {
    e.preventDefault();
    __CS_CUSTOM_SHORTCUTS__[keycomb].action(__CS_CUSTOM_SHORTCUTS__[keycomb]);
    return;
  }
  if (blackholeShortcuts.has(keycomb)) {
    e.preventDefault();
    return;
  }
  if (disableShortcuts.has(keycomb)) {
    return;
  }

  // Internal shortcuts
  switch (keycomb) {
    case "f11": {
      if (window.appToggleFullscreen) {
        e.preventDefault();
        window.appToggleFullscreen();
      }
      return;
    }
    case "alt+`": {
      // Alt + Backquote
      e.preventDefault();
      closeModal().then((closed) => {
        if (!closed) {
          setSearchOpen(false);
        }
      });
      return;
    }
    case "alt+shift+~": {
      e.preventDefault();
      setNewTabDialogOpen(false);
      closeInputDialog();
      setEditButtonDialogOpen(false);
      setEditHostDialogOpen(false);
      setSearchOpen(false);
      closeModal(true);
      setToasts([]);
      return;
    }
    case "alt+enter": {
      e.preventDefault();
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        closeModal(true);
        document.getElementById("main-content")?.requestFullscreen();
        triggerFocus();
      }
      return;
    }
    case "ctrl+alt+r": {
      e.preventDefault();
      refreshData({ sync: 2 })
        .then(() => {
          notify(t("Data refreshed"), "success", TOAST_KEY_REFRESH);
        })
        .catch((err: unknown) => {
          notify(t("Data refresh failure:") + ` ${err}`, "error", TOAST_KEY_REFRESH);
        });
      return;
    }
    case "ctrl+alt+shift+r": {
      // force clear service worker, cache and reload
      e.preventDefault();
      forceReload();
      return;
    }
    case "ctrl+alt+0": {
      e.preventDefault();
      resetFontSize(true, true);
      return;
    }
    case "ctrl+alt+1": {
      e.preventDefault();
      setFavExpanded();
      return;
    }
    case "ctrl+alt+2": {
      e.preventDefault();
      setAllExpanded();
      return;
    }
    case "ctrl+alt+3": {
      e.preventDefault();
      setAutoExpanded();
      return;
    }
    case "ctrl+alt+`": {
      e.preventDefault();
      setTagsExpanded();
      return;
    }
    case "ctrl+alt+g": {
      e.preventDefault();
      toggleExpandAllGroups();
      return;
    }
    case "alt+-":
    case "alt+shift+_": {
      e.preventDefault();
      decreseFontSize(true, keycomb === "alt+shift+_");
      return;
    }
    case "alt+=":
    case "alt+shift++": {
      e.preventDefault();
      increaseFontSize(true, keycomb === "alt+shift++");
      return;
    }
    case "alt+c":
      e.preventDefault();
      cloneSession(getStore().activePaneId);
      return;

    case "alt+shift+c":
      e.preventDefault();
      cloneSession(getStore().activePaneId, true);
      return;

    case "alt+o":
    case "alt+shift+o":
      e.preventDefault();
      changeNewTabDialogViewMode("servers", !e.shiftKey && !getStore().newTabDialogOpen);
      setNewTabDialogOpen(true);
      return;

    case "alt+p":
    case "alt+shift+p":
      e.preventDefault();
      changeNewTabDialogViewMode("tags", !e.shiftKey && !getStore().newTabDialogOpen);
      setNewTabDialogOpen(true);
      return;

    case "alt+;":
    case "alt+shift+:":
      e.preventDefault();
      changeNewTabDialogViewMode("tunnels", !e.shiftKey && !getStore().newTabDialogOpen);
      setNewTabDialogOpen(true);
      return;

    case "alt+/":
    case "alt+shift+?":
      e.preventDefault();
      changeNewTabDialogViewMode("help", !e.shiftKey && !getStore().newTabDialogOpen);
      setNewTabDialogOpen(true);
      return;

    case "alt+a":
    case "alt+shift+a":
      e.preventDefault();
      changeNewTabDialogViewMode("tabs", !e.shiftKey && !getStore().newTabDialogOpen);
      setNewTabDialogOpen(true);
      return;

    case "alt+e":
    case "alt+shift+e":
    case "ctrl+shift+p":
      e.preventDefault();
      changeNewTabDialogViewMode("buttons", keycomb !== "alt+shift+e" && !getStore().newTabDialogOpen);
      setNewTabDialogOpen(true);
      return;

    case "alt+n":
    case "ctrl+alt+n":
      e.preventDefault();
      openHost(LOCAL_NAME, { target: keycomb === "ctrl+alt+n" ? "_self" : undefined });
      return;

    case "alt+shift+n":
    case "ctrl+alt+shift+n": {
      e.preventDefault();
      const shells = getStore().shells;
      openHost(shells[1] ? localShellHost(shells[1]) : LOCAL_NAME, {
        target: keycomb === "ctrl+alt+shift+n" ? "_self" : undefined,
      });
      return;
    }

    case "alt+s":
      e.preventDefault();
      openScratchpad();
      return;

    case "alt+i":
    case "alt+shift+i": {
      const modal = getActiveMuiModal();
      if (!modal || modal.id === ID_SIDEBAR) {
        e.preventDefault();
        if (!e.shiftKey) {
          csSetSidebarFilter("");
        }
        if (__CS_IS_MOBILE__ && !getStore().mobileOpen) {
          setMobileOpen(true);
          setTimeout(() => {
            document.getElementById(ID_SIDEBAR_FILTER)?.focus();
          }, 0);
        } else {
          document.getElementById(ID_SIDEBAR_FILTER)?.focus();
        }
      }
      return;
    }
    case "ctrl+shift+tab":
    case "alt+h":
    case "alt+shift+h": {
      e.preventDefault();
      const { tabs, activeTabId, activePaneId, settingsOpen, settingsTab } = getStore();
      if (settingsOpen) {
        setSettingsTab((settingsTab - 1 + SETTINGS_TABS) % SETTINGS_TABS);
        return;
      }
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx < 0) {
        return;
      }
      const activeTab = tabs[idx]!;
      const tabMode = keycomb === "alt+shift+h" || keycomb === "ctrl+shift+tab";
      if (activeTab.panes.length <= 1 || tabMode) {
        // single pane tab or shift pressed, switch to prev tab
        const prevIdx = (idx - 1 + tabs.length) % tabs.length;
        activatePane(tabs[prevIdx]!.activePaneId, tabs[prevIdx]!.id);
        (document.activeElement as HTMLElement)?.blur?.();
        triggerFocus();
      } else {
        // multiple-panes tab, switch to prev pane of this tab
        const paneIdx = activeTab.panes.findIndex((p) => p.id === activePaneId);
        const prevPaneIdx = (paneIdx - 1 + activeTab.panes.length) % activeTab.panes.length;
        activatePane(activeTab.panes[prevPaneIdx]!.id);
        (document.activeElement as HTMLElement)?.blur?.();
        triggerFocus();
      }
      return;
    }

    case "ctrl+tab": // only works in Desktop app
    case "alt+l":
    case "alt+shift+l": {
      e.preventDefault();
      const { tabs, activeTabId, activePaneId, settingsOpen, settingsTab } = getStore();
      if (settingsOpen) {
        setSettingsTab((settingsTab + 1) % SETTINGS_TABS);
        return;
      }
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx < 0) {
        return;
      }
      const activeTab = tabs[idx]!;
      const tabMode = keycomb === "alt+shift+l" || keycomb === "ctrl+tab";
      if (activeTab.panes.length <= 1 || tabMode) {
        // single pane tab or shift pressed, switch to next tab
        const nextIdx = (idx + 1) % tabs.length;
        activatePane(tabs[nextIdx]!.activePaneId, tabs[nextIdx]!.id);
        (document.activeElement as HTMLElement)?.blur?.();
        triggerFocus();
      } else {
        // multiple-panes tab, switch to next pane of this tab
        const paneIdx = activeTab.panes.findIndex((p) => p.id === activePaneId);
        const nextPaneIdx = (paneIdx + 1) % activeTab.panes.length;
        activatePane(activeTab.panes[nextPaneIdx]!.id);
        (document.activeElement as HTMLElement)?.blur?.();
        triggerFocus();
      }
      return;
    }

    case "alt+q":
    case "alt+shift+q": {
      e.preventDefault();
      const inputEl = document.getElementById(ID_INPUT_DIALOG_INPUT);
      if (inputEl) {
        if (getStore().newTabDialogOpen) {
          setNewTabDialogOpen(false);
          setTimeout(() => inputEl.focus(), 0);
        } else {
          inputEl.focus();
        }
      } else {
        if (e.shiftKey) {
          useStore.setState({ inputDialogOpen: true, newTabDialogOpen: false });
        } else {
          openInputDialog();
        }
      }
      return;
    }

    case "alt+w":
      e.preventDefault();
      closeTabOrPane();
      return;

    case "ctrl+alt+shift+w":
      e.preventDefault();
      closeOtherTabs();
      return;

    case "ctrl+alt+shift+l": {
      e.preventDefault();
      const { activeTabId, tabs } = getStore();
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (activeTab && activeTab.type === "terminal") {
        if (activeTab.isLocked) {
          unlockTab(activeTab.id);
        } else {
          lockTab(activeTab.id);
        }
      }
      return;
    }

    case "alt+shift+w":
      e.preventDefault();
      closeTabOrPane(getStore().activeTabId);
      return;

    case "alt+g": {
      e.preventDefault();
      const { activeTabId, tabs } = getStore();
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
      const { tabs, activeTabId } = getStore();
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (activeTab) {
        activatePane(activeTab.panes[0]!.id, activeTab.id);
        triggerFocus();
      }
      return;
    }

    case "alt+v":
    case "ctrl+alt+v": {
      e.preventDefault();
      nextButtonGroup(keycomb === "ctrl+alt+v");
      return;
    }
    case "alt+shift+v":
    case "ctrl+alt+shift+v": {
      e.preventDefault();
      prevButtonGroup(keycomb === "ctrl+alt+shift+v");
      return;
    }

    case "alt+j":
    case "alt+shift+j": {
      const { activePaneId } = getStore();
      const term = __CS_TERMINALS__.current[activePaneId];
      if (term && "getXterm" in term) {
        e.preventDefault();
        if (e.shiftKey) {
          term.scrollPages(1);
        } else {
          term.scrollLines(getIntVar(VAR_CS_SCROLL_LINES, DEFAULT_SCROLL_LINES));
        }
      }
      return;
    }

    case "alt+k":
    case "alt+shift+k": {
      const { activePaneId } = getStore();
      const term = __CS_TERMINALS__.current[activePaneId];
      if (term && "getXterm" in term) {
        e.preventDefault();
        if (e.shiftKey) {
          term.scrollPages(-1);
        } else {
          term.scrollLines(-getIntVar(VAR_CS_SCROLL_LINES, DEFAULT_SCROLL_LINES));
        }
      }
      return;
    }

    case "ctrl+alt+k": {
      const { activePaneId } = getStore();
      const term = __CS_TERMINALS__.current[activePaneId];
      if (term && "getXterm" in term) {
        e.preventDefault();
        term.scrollToTop();
      }
      return;
    }
    case "ctrl+alt+j": {
      const { activePaneId } = getStore();
      const term = __CS_TERMINALS__.current[activePaneId];
      if (term && "getXterm" in term) {
        e.preventDefault();
        term.scrollToBottom();
      }
      return;
    }

    case "ctrl+shift+f": {
      const { activePaneId } = getStore();
      if (
        !getActiveMuiModal() &&
        __CS_TERMINALS__.current[activePaneId] &&
        "clear" in __CS_TERMINALS__.current[activePaneId]!
      ) {
        e.preventDefault();
        setSearchOpen(true);
        triggerFocusSearchInput();
      }
      return;
    }
    case "ctrl+shift+r": {
      const { activePaneId } = getStore();
      const term = __CS_TERMINALS__.current[activePaneId];
      if (term && "getXterm" in term) {
        e.preventDefault();
        term.reconnect();
      }
      return;
    }

    case "ctrl+shift+c": {
      const { activePaneId } = getStore();
      const term = __CS_TERMINALS__.current[activePaneId];
      if (term && "getXterm" in term) {
        e.preventDefault();
        const text = term.getSelection();
        if (text) {
          navigator.clipboard.writeText(text);
        }
      }
      return;
    }

    case "ctrl+shift+m": {
      toggleMarkMode(getStore().activePaneId);
      return;
    }
  }

  // ── Alt+0-9: switch to tab by index ───────────────────────────────────
  if (
    isModifier(e, "alt") &&
    !isModifier(e, "ctrl") &&
    !e.shiftKey &&
    !isModifier(e, "meta") &&
    e.key >= "0" &&
    e.key <= "9"
  ) {
    e.preventDefault();
    const tabs = getStore().tabs;
    let idx = parseInt(e.key);
    idx = idx === 0 ? tabs.length - 1 : idx - 1;
    if (tabs[idx]) {
      const target = tabs[idx]!;
      setActiveTabId(target.id);
      setActivePaneId(target.activePaneId);
      setNewTabDialogOpen(false);
      (document.activeElement as HTMLElement)?.blur?.();
      triggerFocus();
    }
    return;
  }

  // ── Alt+Shift+0-9: trigger button by index ────────────────────────────
  if (isModifier(e, "alt") && e.shiftKey && !isModifier(e, "ctrl") && !isModifier(e, "meta")) {
    const { buttons, activeGroup } = getStore();
    const digitMatch = e.code.match(/Digit(\d)/);
    if (digitMatch) {
      e.preventDefault();
      const num = parseInt(digitMatch[1]!);
      const idx = num === 0 ? 9 : num - 1;
      const filteredButtons = buttons.filter((b) => (b.group || DEFAULT_BUTTON_GROUP) === activeGroup);
      if (idx < filteredButtons.length) {
        runButton(filteredButtons[idx]!);
      }
    }
  }
};

window.addEventListener("keydown", handleKeyDown);
