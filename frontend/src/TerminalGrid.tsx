import { useRef, useEffect } from "react";
import { Box, Tooltip, IconButton, Typography } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import AddIcon from "@mui/icons-material/Add";
import ViewSidebarIcon from "@mui/icons-material/ViewSidebar";

import { VIBRATE_PATTERN } from "./constants";
import { type NewTabDialogViewMode, type ScratchpadSyncState, genPaneId } from "./common";
import {
  type PaneData,
  type TerminalRefMap,
  setActivePaneId,
  setActiveTabId,
  setShellIntegrations,
  setTabs,
  useStore,
} from "./store";
import type { AppletData } from "./AppletWrapper";
import Scratchpad, { type ScratchpadHandle } from "./Scratchpad";
import TerminalComponent, { type TerminalHandle } from "./Terminal";
import FileBrowser from "./FileBrowser";
import MobileInputBar from "./MobileInputBar";

export interface TerminalGridProps {
  terminalRefs: React.MutableRefObject<TerminalRefMap>;
  isCtrlActive: boolean;
  setIsCtrlActive: (v: boolean) => void;
  isAltActive: boolean;
  setIsAltActive: (v: boolean) => void;
  onTerminalFocus: () => void;
  onTerminalBlur: () => void;
  scratchpadSyncState: ScratchpadSyncState;
  setScratchpadSyncState: (v: ScratchpadSyncState) => void;
  handleTerminalData: (tabId: string) => void;
  isTouch: boolean;
  isMobile: boolean;
  mobileAppletsOpen: boolean;
  setMobileAppletsOpen: (v: boolean) => void;
  applets: AppletData[];
  setMobileOpen: (v: boolean) => void;
  setNewTabDialogOpen: (v: boolean) => void;
  setNewTabDialogInitialViewMode: React.Dispatch<React.SetStateAction<NewTabDialogViewMode>>;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchEnd: (e: React.TouchEvent) => void;
  handleSendKey: (key: string) => void;
  gestureMode: boolean;
  onGestureModeChange: (v: boolean) => void;
  extraKeysOpen: boolean;
  onExtraKeysOpenChange: (v: boolean) => void;
  keyboardHeight: number;
  getActiveTerminal: () => TerminalHandle | ScratchpadHandle | null;
}

export default function TerminalGrid({
  terminalRefs,
  isCtrlActive,
  setIsCtrlActive,
  isAltActive,
  setIsAltActive,
  setScratchpadSyncState,
  onTerminalFocus,
  onTerminalBlur,
  handleTerminalData,
  isTouch,
  isMobile,
  mobileAppletsOpen,
  setMobileAppletsOpen,
  applets,
  setMobileOpen,
  setNewTabDialogOpen,
  setNewTabDialogInitialViewMode,
  handleTouchStart,
  handleTouchEnd,
  handleSendKey,
  gestureMode,
  onGestureModeChange,
  extraKeysOpen,
  onExtraKeysOpenChange,
  keyboardHeight,
  getActiveTerminal,
}: TerminalGridProps) {
  const { tabs, activeTabId, activePaneId, shellIntegrations, vars, localVars } = useStore();

  // ── Gesture-mode: non-passive native touch listeners ─────────────────────
  // React synthetic touch events are passive (cannot preventDefault), so we
  // must use native listeners to block the browser scroll while in gesture mode.
  const termAreaRef = useRef<HTMLDivElement>(null);
  const gestureModeRef = useRef(gestureMode);
  const handleSendKeyRef = useRef(handleSendKey);
  useEffect(() => {
    gestureModeRef.current = gestureMode;
  }, [gestureMode]);
  useEffect(() => {
    handleSendKeyRef.current = handleSendKey;
  }, [handleSendKey]);

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
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
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
      const diffX = e.changedTouches[0].clientX - startX;
      const diffY = e.changedTouches[0].clientY - startY;
      const THRESHOLD = 40;
      if (Math.abs(diffX) < THRESHOLD && Math.abs(diffY) < THRESHOLD) {
        return;
      }
      const isHoriz = Math.abs(diffX) > Math.abs(diffY);
      if (isHoriz) {
        handleSendKeyRef.current(diffX > 0 ? "\x1b[C" : "\x1b[D");
      } else {
        handleSendKeyRef.current(diffY > 0 ? "\x1b[B" : "\x1b[A");
      }
      window.navigator.vibrate?.(VIBRATE_PATTERN);
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
            className="terminal-tab-wrap"
            key={tab.id}
            data-tab-id={tab.id}
            sx={{
              position: "absolute",
              inset: 0,
              display: activeTabId === tab.id ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <Box
              className="terminal-tab"
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
                    className="terminal-pane-wrap"
                    data-pane-id={pane.id}
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
                      setActiveTabId(tab.id);
                      setActivePaneId(pane.id);
                      setTabs((tabs) => tabs.map((t) => (t.id === tab.id ? { ...t, activePaneId: pane.id } : t)));
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
                        ref={(el) => {
                          if (el) terminalRefs.current[pane.id] = el;
                          else delete terminalRefs.current[pane.id];
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
                        onStateChange={(state) => {
                          setTabs((prev) =>
                            prev.map((t) =>
                              t.id === tab.id
                                ? {
                                    ...t,
                                    panes: t.panes.map((p) => (p.id === pane.id ? { ...p, state } : p)),
                                  }
                                : t
                            )
                          );
                        }}
                        onShellIntegrationChange={(info) => {
                          setShellIntegrations((prev) => ({ ...prev, [pane.id]: info }));
                        }}
                        onDataReceived={() => handleTerminalData(tab.id)}
                        onTabStateChange={(state) => {
                          setTabs((prev) =>
                            prev.map((t) =>
                              t.id === tab.id ? { ...t, isPinned: state.isPinned, isLocked: state.isLocked } : t
                            )
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
                                : t
                            )
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
                                          : p
                                      ),
                                    }
                                  : t
                              )
                            );
                            setActivePaneId(newPaneId);
                          }
                        }}
                        vars={vars}
                        localVars={localVars}
                        isTouch={isTouch}
                      />
                    )}
                  </Box>
                );

                const n = tab.panes.length;
                if (n <= 1) {
                  return renderPaneInner(tab.panes[0]);
                }
                if (n === 2) {
                  return (
                    <Box sx={{ display: "flex", flexDirection: "row", height: "100%" }}>
                      {renderPaneInner(tab.panes[0])}
                      <Box sx={{ width: "1px", bgcolor: "divider", flexShrink: 0 }} />
                      {renderPaneInner(tab.panes[1])}
                    </Box>
                  );
                }
                if (n === 3) {
                  return (
                    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
                      {renderPaneInner(tab.panes[0])}
                      <Box sx={{ height: "1px", bgcolor: "divider", flexShrink: 0 }} />
                      <Box sx={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
                        {renderPaneInner(tab.panes[1])}
                        <Box sx={{ width: "1px", bgcolor: "divider", flexShrink: 0 }} />
                        {renderPaneInner(tab.panes[2])}
                      </Box>
                    </Box>
                  );
                }
                if (n === 4) {
                  return (
                    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
                      <Box sx={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
                        {renderPaneInner(tab.panes[0])}
                        <Box sx={{ width: "1px", bgcolor: "divider", flexShrink: 0 }} />
                        {renderPaneInner(tab.panes[1])}
                      </Box>
                      <Box sx={{ height: "1px", bgcolor: "divider", flexShrink: 0 }} />
                      <Box sx={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
                        {renderPaneInner(tab.panes[2])}
                        <Box sx={{ width: "1px", bgcolor: "divider", flexShrink: 0 }} />
                        {renderPaneInner(tab.panes[3])}
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
              textAlign: "center",
              mt: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "center", gap: 3, mb: 4 }}>
              <Tooltip title="Open Sidebar">
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
              <Tooltip title="New Tab (Alt+O)">
                <IconButton
                  onClick={() => {
                    setNewTabDialogInitialViewMode("servers");
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
              {isMobile && applets.filter((a) => a.position === "sidebar").length > 0 && (
                <Tooltip title="Open Applets">
                  <IconButton
                    color="inherit"
                    onClick={() => setMobileAppletsOpen(!mobileAppletsOpen)}
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
              Select a server from the sidebar or open a new tab to start.
            </Typography>
          </Box>
        )}
      </Box>

      <MobileInputBar
        isCtrlActive={isCtrlActive}
        setIsCtrlActive={setIsCtrlActive}
        isAltActive={isAltActive}
        setIsAltActive={setIsAltActive}
        handleSendKey={handleSendKey}
        gestureMode={gestureMode}
        onGestureModeChange={onGestureModeChange}
        extraKeysOpen={extraKeysOpen}
        onExtraKeysOpenChange={onExtraKeysOpenChange}
        keyboardHeight={keyboardHeight}
        getActiveTerminal={getActiveTerminal}
      />
    </>
  );
}
