import { useRef, useEffect, useCallback, useState } from "react";
import { Box, Tooltip, IconButton, Typography, Button, useTheme } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import AddIcon from "@mui/icons-material/Add";
import ViewSidebarIcon from "@mui/icons-material/ViewSidebar";

import { version as PACKAGE_JSON_VERSION } from "../package.json";
import {
  VAR_CS_VIBRATE_PATTERN,
  DEFAULT_VIBRATE_PATTERN,
  SETTINGS_TAB_IDX_SHORTCUTS,
  APP_NAME,
  LINK_COZYSSH_GITHUB,
} from "./constants";
import { type ScratchpadSyncState, genPaneId, t } from "./common";
import {
  type PaneData,
  activatePane,
  addUnreadTabId,
  getIntVar,
  getStore,
  handleSendKey,
  setActivePaneId,
  setMobileAppletsOpen,
  setMobileOpen,
  setNewTabDialogFilter,
  setNewTabDialogOpen,
  setSessionBufferDataTime,
  setSettingsOpen,
  setSettingsTab,
  setShellIntegrations,
  setTabs,
  useStore,
} from "./store";
import Scratchpad, { type ScratchpadHandle } from "./Scratchpad";
import TerminalComponent, { type TerminalHandle } from "./Terminal";
import FileBrowser from "./FileBrowser";
import MobileInputBar from "./MobileInputBar";

export interface TerminalGridProps {
  terminalRefs: React.RefObject<Record<string, TerminalHandle | ScratchpadHandle | null>>;
  onTerminalFocus: () => void;
  onTerminalBlur: () => void;
  scratchpadSyncState: ScratchpadSyncState;
  setScratchpadSyncState: (v: ScratchpadSyncState) => void;
  isMobile: boolean;
  hasSidebarApplet: boolean;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchEnd: (e: React.TouchEvent) => void;
  gestureMode: boolean;
  onGestureModeChange: (v: boolean) => void;
  extraKeysOpen: boolean;
  onExtraKeysOpenChange: (v: boolean) => void;
  keyboardHeight: number;
}

export default function TerminalGrid({
  terminalRefs,
  setScratchpadSyncState,
  onTerminalFocus,
  onTerminalBlur,
  isMobile,
  hasSidebarApplet,
  handleTouchStart,
  handleTouchEnd,
  gestureMode,
  onGestureModeChange,
  extraKeysOpen,
  onExtraKeysOpenChange,
  keyboardHeight,
}: TerminalGridProps) {
  const theme = useTheme();

  const appVersion = useStore((state) => state.sysinfo.version);
  const focusTrigger = useStore((state) => state.focusTrigger);
  const tabs = useStore((state) => state.tabs);
  const activeTabId = useStore((state) => state.activeTabId);
  const activePaneId = useStore((state) => state.activePaneId);
  const shellIntegrations = useStore((state) => state.shellIntegrations);

  const [isCtrlActive, setIsCtrlActive] = useState(false);
  const [isAltActive, setIsAltActive] = useState(false);

  const handleTerminalData = useCallback((tabId: string, paneId: string) => {
    const { activeTabId } = getStore();
    if (activeTabId !== tabId) {
      addUnreadTabId(tabId);
    }
    setSessionBufferDataTime(paneId);
  }, []);

  // ── Gesture-mode: non-passive native touch listeners ─────────────────────
  // React synthetic touch events are passive (cannot preventDefault), so we
  // must use native listeners to block the browser scroll while in gesture mode.
  const termAreaRef = useRef<HTMLDivElement>(null);
  const gestureModeRef = useRef(gestureMode);
  useEffect(() => {
    gestureModeRef.current = gestureMode;
  }, [gestureMode]);

  useEffect(() => {
    const el = termAreaRef.current;
    if (!el) {
      return;
    }

    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (!gestureModeRef.current) {
        return;
      }
      // CRITICAL: Stop the event from ever reaching xterm.js
      e.stopPropagation();
      e.preventDefault();
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!gestureModeRef.current) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!gestureModeRef.current) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      const diffX = e.changedTouches[0]!.clientX - startX;
      const diffY = e.changedTouches[0]!.clientY - startY;
      const THRESHOLD = 40;
      if (Math.abs(diffX) < THRESHOLD && Math.abs(diffY) < THRESHOLD) {
        return;
      }
      const isHoriz = Math.abs(diffX) > Math.abs(diffY);
      if (isHoriz) {
        handleSendKey(diffX > 0 ? "\x1b[C" : "\x1b[D");
      } else {
        handleSendKey(diffY > 0 ? "\x1b[B" : "\x1b[A");
      }
      window.navigator.vibrate?.(getIntVar(VAR_CS_VIBRATE_PATTERN, DEFAULT_VIBRATE_PATTERN));
    };

    // CRITICAL FIX: Use { capture: true } so this outer wrapper intercepts the
    // touches before the inner xterm.js canvas has a chance to process them.
    el.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    el.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });

    return () => {
      // Must include { capture: true } when removing the listeners as well
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
      el.removeEventListener("touchmove", onTouchMove, { capture: true });
      el.removeEventListener("touchend", onTouchEnd, { capture: true });
    };
  }, []); // refs keep values fresh; no re-run needed

  // Note it must not depend on any state other then focusTrigger to avoid re-rendering.
  useEffect(() => {
    // during first render window.__CS_TERMINALS__ may not be set yet
    if (focusTrigger > 0 && window.__CS_TERMINALS__) {
      __CS_TERMINALS__.current[getStore().activePaneId]?.focus();
    }
  }, [focusTrigger]);

  return (
    <>
      <Box
        id="terminals"
        ref={termAreaRef}
        sx={{ flexGrow: 1, bgcolor: "#ffffff", overflow: "hidden", position: "relative" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {tabs.map((tab) => (
          <Box
            className={`terminal-wrap ${tab.id === activeTabId ? "active" : ""}`}
            key={tab.id}
            data-id={tab.id}
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              zIndex: activeTabId === tab.id ? 1 : 0,
              visibility: activeTabId === tab.id ? "visible" : "hidden",
              flexDirection: "column",
            }}
          >
            <Box
              className="terminal"
              sx={{
                flexGrow: 1,
                minHeight: 0,
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {(() => {
                const renderPaneInner = (pane: PaneData) => (
                  <Box
                    className={`terminal-pane-wrap ${pane.id === activePaneId ? "active" : ""} ${
                      pane.options?.terminalClass || ""
                    }`}
                    data-id={pane.id}
                    data-session-id={pane.sessionId || ""}
                    data-name={pane.host}
                    data-state={pane.state || ""}
                    sx={{
                      flex: 1,
                      height: "100%",
                      minWidth: 0,
                      minHeight: 0,
                      position: "relative",
                      outline: activePaneId === pane.id ? "1px solid #1976d2" : "1px solid #ffffff",
                      outlineOffset: -1,
                      zIndex: activePaneId === pane.id ? 1 : 0,
                    }}
                    onClick={() => {
                      activatePane(pane.id, tab.id);
                    }}
                  >
                    {tab.type === "scratchpad" ? (
                      <Scratchpad
                        ref={(el) => {
                          terminalRefs.current[pane.id] = el;
                        }}
                        onSyncStateChange={setScratchpadSyncState}
                      />
                    ) : (
                      <TerminalComponent
                        key={pane.id}
                        options={pane.options}
                        ref={(el) => {
                          if (el) {
                            terminalRefs.current[pane.id] = el;
                          } else {
                            delete terminalRefs.current[pane.id];
                          }
                        }}
                        host={pane.host}
                        sessionId={pane.sessionId || pane.id}
                        cloneFrom={pane.cloneFrom}
                        isActive={activeTabId === tab.id && activePaneId === pane.id}
                        isCtrlActive={isCtrlActive}
                        onCtrlDone={() => setIsCtrlActive(false)}
                        onTerminalBlur={onTerminalBlur}
                        onTerminalFocus={onTerminalFocus}
                        isAltActive={isAltActive}
                        onAltDone={() => setIsAltActive(false)}
                        onStateChange={(state: PaneData["state"]) => {
                          setTabs((prev) =>
                            prev.map((t) =>
                              t.id === tab.id
                                ? {
                                    ...t,
                                    panes: t.panes.map((p) => (p.id === pane.id ? { ...p, state } : p)),
                                  }
                                : t,
                            ),
                          );
                        }}
                        onShellIntegrationChange={(info) => {
                          setShellIntegrations((prev) => ({ ...prev, [pane.id]: info }));
                        }}
                        onDataReceived={() => handleTerminalData(tab.id, pane.id)}
                        onTabStateChange={(state) => {
                          setTabs((prev) =>
                            prev.map((t) =>
                              t.id === tab.id ? { ...t, isPinned: state.isPinned, isLocked: state.isLocked } : t,
                            ),
                          );
                        }}
                        onStolen={() => {
                          setTabs((prev) =>
                            prev.map((t) =>
                              t.id === tab.id
                                ? {
                                    ...t,
                                    isPinned: false,
                                    isLocked: false,
                                    panes: t.panes.map((p) => (p.id === pane.id ? { ...p, state: "stolen" } : p)),
                                  }
                                : t,
                            ),
                          );
                        }}
                        onManualReconnect={(wasStolen) => {
                          if (wasStolen) {
                            const newPaneId = genPaneId(pane.host);
                            setTabs((prev) =>
                              prev.map((t) =>
                                t.id === tab.id
                                  ? {
                                      ...t,
                                      activePaneId: newPaneId,
                                      panes: t.panes.map((p) =>
                                        p.id === pane.id
                                          ? { ...p, id: newPaneId, sessionId: newPaneId, state: "connecting" }
                                          : p,
                                      ),
                                    }
                                  : t,
                              ),
                            );
                            setActivePaneId(newPaneId);
                          }
                        }}
                      />
                    )}
                  </Box>
                );

                const n = tab.panes.length;
                if (n <= 1) {
                  return renderPaneInner(tab.panes[0]!);
                }
                if (n === 2) {
                  return (
                    <Box sx={{ display: "flex", flexDirection: "row", height: "100%" }}>
                      {renderPaneInner(tab.panes[0]!)}
                      <Box sx={{ width: "1px", bgcolor: "divider", flexShrink: 0 }} />
                      {renderPaneInner(tab.panes[1]!)}
                    </Box>
                  );
                }
                if (n === 3) {
                  return (
                    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
                      {renderPaneInner(tab.panes[0]!)}
                      <Box sx={{ height: "1px", bgcolor: "divider", flexShrink: 0 }} />
                      <Box sx={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
                        {renderPaneInner(tab.panes[1]!)}
                        <Box sx={{ width: "1px", bgcolor: "divider", flexShrink: 0 }} />
                        {renderPaneInner(tab.panes[2]!)}
                      </Box>
                    </Box>
                  );
                }
                if (n === 4) {
                  return (
                    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
                      <Box sx={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
                        {renderPaneInner(tab.panes[0]!)}
                        <Box sx={{ width: "1px", bgcolor: "divider", flexShrink: 0 }} />
                        {renderPaneInner(tab.panes[1]!)}
                      </Box>
                      <Box sx={{ height: "1px", bgcolor: "divider", flexShrink: 0 }} />
                      <Box sx={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
                        {renderPaneInner(tab.panes[2]!)}
                        <Box sx={{ width: "1px", bgcolor: "divider", flexShrink: 0 }} />
                        {renderPaneInner(tab.panes[3]!)}
                      </Box>
                    </Box>
                  );
                }
                return null;
              })()}
            </Box>
            {tab.showFiles && (
              <Box sx={{ height: "50%", minHeight: 200, borderTop: 1, borderColor: "divider" }}>
                <FileBrowser
                  sessionId={tab.panes.find((p) => p.id === tab.activePaneId)?.sessionId || tab.activePaneId}
                  isActive={activeTabId === tab.id && tab.showFiles}
                  shellCwd={shellIntegrations[tab.activePaneId]?.cwd}
                  onClose={() => setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, showFiles: false } : t)))}
                />
              </Box>
            )}
          </Box>
        ))}

        {tabs.length === 0 && (
          <Box
            sx={{
              p: 4,
              mt: 5,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Box sx={{ display: "flex", textAlign: "center", justifyContent: "center", gap: 3, mb: 4 }}>
              <Tooltip title={t("Open Sidebar") + " (alt+i)"}>
                <IconButton
                  onClick={() => setMobileOpen(true)}
                  sx={{
                    display: { md: "none" },
                    width: 64,
                    height: 64,
                    bgcolor: "background.paper",
                    boxShadow: 2,
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <MenuIcon sx={{ fontSize: 32 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("New Tab") + " (alt+o)"}>
                <IconButton
                  onClick={() => {
                    setNewTabDialogFilter("");
                    setNewTabDialogOpen(true);
                  }}
                  color="primary"
                  sx={{
                    width: 64,
                    height: 64,
                    bgcolor: "background.paper",
                    boxShadow: 2,
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <AddIcon sx={{ fontSize: 32 }} />
                </IconButton>
              </Tooltip>
              {isMobile && hasSidebarApplet && (
                <Tooltip title={t("Open Applets")}>
                  <IconButton
                    color="inherit"
                    onClick={() => setMobileAppletsOpen((a) => !a)}
                    sx={{
                      width: 64,
                      height: 64,
                      bgcolor: "background.paper",
                      boxShadow: 2,
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <ViewSidebarIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            <Typography color="text.secondary" variant="body1" sx={{ maxWidth: 400, fontWeight: 500 }}>
              {t("Open new tab:")} <code>alt+o</code>
              <br />
              {t("Open local shell:")} <code>alt+n</code>
              <br />
              {t("Search from sidebar:")} <code>alt+i</code>
              <br />
              {t("Help:")} <code>alt+?</code>
              <br />
              <code>{t("In Mac use command for alt")}</code>
              <br />
              {APP_NAME} <code>v{PACKAGE_JSON_VERSION}</code> ({t("Backend:")} <code>v{appVersion}</code>)
              <br />
              <Button
                sx={{ pl: 0 }}
                variant="text"
                size="small"
                onClick={() => {
                  setSettingsOpen(true);
                  setSettingsTab(SETTINGS_TAB_IDX_SHORTCUTS);
                }}
              >
                {t("View shortcuts")}
              </Button>
              <br />
              <a
                href={LINK_COZYSSH_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: theme.palette.primary.main, textDecoration: "none" }}
              >
                GitHub
              </a>
            </Typography>
          </Box>
        )}
      </Box>

      <MobileInputBar
        isCtrlActive={isCtrlActive}
        setIsCtrlActive={setIsCtrlActive}
        isAltActive={isAltActive}
        setIsAltActive={setIsAltActive}
        gestureMode={gestureMode}
        onGestureModeChange={onGestureModeChange}
        extraKeysOpen={extraKeysOpen}
        onExtraKeysOpenChange={onExtraKeysOpenChange}
        keyboardHeight={keyboardHeight}
      />
    </>
  );
}
