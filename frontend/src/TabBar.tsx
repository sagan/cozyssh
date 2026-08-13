import React, { useEffect, useMemo, useState } from "react";
import { Box, Tabs, Tab, IconButton, Menu, MenuItem } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import AddIcon from "@mui/icons-material/Add";
import ViewSidebarIcon from "@mui/icons-material/ViewSidebar";
import CloseIcon from "@mui/icons-material/Close";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import LockIcon from "@mui/icons-material/Lock";
import PushPinIcon from "@mui/icons-material/PushPin";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import SyncIcon from "@mui/icons-material/Sync";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloudDoneIcon from "@mui/icons-material/CloudDone";
import PriorityHighIcon from "@mui/icons-material/PriorityHigh";
import DoneIcon from "@mui/icons-material/Done";
import ErrorIcon from "@mui/icons-material/Error";

import {
  type CSEventDetailTerminalChange,
  type ScratchpadSyncState,
  CS_EVENT_TERMINAL_CHANGE,
  getKeyCombination,
  t,
  ViewModePrefix,
} from "./common";
import {
  deleteUnreadTabId,
  setActivePaneId,
  setActiveTabId,
  setMobileAppletsOpen,
  setMobileOpen,
  setNewTabDialogOpen,
  triggerFocus,
  useStore,
  setNewTabDialogFilter,
  closeTab,
  setTabs,
  activatePane,
  openSaveTabsToButtonDialog,
  getStore,
  handleCloseSearch,
  parseNewTabDialogFilter,
  PaneStateLabels,
  getIntVar,
  getPaneTip,
} from "./store";
import {
  APP_NAME,
  DEFAULT_TERMINAL_ACTIVE_PERIOD,
  ID_TERMINAL_SEARCH_INPUT,
  LOCAL_NAME,
  VAR_CS_TERMINAL_ACTIVE_PERIOD,
} from "./constants";
import TextFieldWithCopy from "./components/TextFieldWithCopy";
import ExtraMenu from "./components/ExtraMenu";

interface TabState {
  /**
   * last command execution failed and current in INPUT phrase
   */
  error: boolean;
  /**
   * last command execution success and current in INPUT phrase
   */
  success: boolean;
  /**
   * tab contains unread messages
   */
  unread: boolean;
  /**
   * tab contains unread messages and is executing
   */
  executingUnread: boolean;
  /**
   * tab contains only unread messages
   */
  unreadOnly: boolean;
  /**
   * tab contains only executing commands
   */
  executingOnly: boolean;
  /**
   * tab contains executing commands that are recent (last command execution success or failed and current in INPUT phrase)
   */
  executingSpin: boolean;
}

export interface TabBarProps {
  isMobile: boolean;
  isTouch: boolean;
  hasSidebarApplet: boolean;
  scratchpadSyncState: ScratchpadSyncState;
  handleContextMenu: (e: React.MouseEvent, tabId: string) => void;
}

export default function TabBar({
  isMobile,
  isTouch,
  hasSidebarApplet,
  scratchpadSyncState,
  handleContextMenu,
}: TabBarProps) {
  const focusSearchInputTrigger = useStore((state) => state.focusSearchInputTrigger);
  const tabs = useStore((state) => state.tabs);
  const activeTabId = useStore((state) => state.activeTabId);
  const activePaneId = useStore((state) => state.activePaneId);
  const unreadTabIds = useStore((state) => state.unreadTabIds);
  const sessionBufferDataTimes = useStore((state) => state.sessionBufferDataTimes);
  const shellIntegrations = useStore((state) => state.shellIntegrations);
  const sysSitename = useStore((state) => state.sysinfo.sitename);
  const searchOpen = useStore((state) => state.searchOpen);
  const extraTabBarMenu = useStore((state) => state.extraTabBarMenu);

  const [searchQuery, setSearchQuery] = useState("");
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<{ id: string; position: "before" | "after" } | null>(null);

  const [tabBarContextMenu, setTabBarContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);

  const activePeriod = getIntVar(VAR_CS_TERMINAL_ACTIVE_PERIOD, DEFAULT_TERMINAL_ACTIVE_PERIOD);
  // Force a re-evaluation of executingSpin right after the last data arrived + active period,
  // so the spin animation stops once the recency window expires.
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    if (activePeriod > 0) {
      const timer = setTimeout(() => setRefreshToken((t) => t + 1), activePeriod + 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionBufferDataTimes]);

  const tabStates: TabState[] = useMemo(() => {
    return tabs.map((tab) => {
      let unread = false;
      let executingUnread = false;
      let unreadOnly = false;
      let executingOnly = false;
      let executingSpin = false;
      let error = false;
      let success = false;
      if (tab.type === "terminal") {
        unread = unreadTabIds.has(tab.id);
        for (const pane of tab.panes) {
          if (pane.state !== "connected") {
            unread = false;
            executingUnread = false;
            unreadOnly = false;
            executingOnly = false;
            executingSpin = false;
            error = false;
            success = false;
            break; // if any pane is disconnected, the tab will display as disconnected
          }
          const isExecuting = shellIntegrations[pane.id]?.isExecuting === true;
          const lastTime = sessionBufferDataTimes[pane.id] || 0;
          // eslint-disable-next-line react-hooks/purity
          const isRecent = activePeriod > 0 && Date.now() - lastTime < activePeriod;
          if (isExecuting) {
            if (isRecent) {
              executingSpin = true;
            }
            if (unread) {
              executingUnread = true;
            } else {
              executingOnly = true;
            }
          } else {
            if (unread) {
              unreadOnly = true;
            }
            const si = shellIntegrations[pane.id];
            if (si && si.promptPhase === "input" && si.exitStatus !== undefined) {
              if (si.exitStatus === 0) {
                success = true;
              } else {
                error = true;
              }
            }
          }
        }
      }
      // Error has higher priority than success: if any pane has an error, the tab is in error state
      if (error) {
        success = false;
      }
      return {
        error,
        success,
        unread,
        executingUnread,
        unreadOnly,
        executingOnly,
        executingSpin,
      } satisfies TabState;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, unreadTabIds, shellIntegrations, sessionBufferDataTimes, refreshToken]);

  const reorderTabs = (draggedId: string, targetId: string, position: "before" | "after") => {
    const draggedIndex = tabs.findIndex((t) => t.id === draggedId);
    const targetIndex = tabs.findIndex((t) => t.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const newTabs = [...tabs];
    const [removed] = newTabs.splice(draggedIndex, 1);

    // After removing the dragged tab, we need to find the new index of the target tab
    const newTargetIndex = newTabs.findIndex((t) => t.id === targetId);
    const insertIndex = position === "before" ? newTargetIndex : newTargetIndex + 1;

    newTabs.splice(insertIndex, 0, removed!);
    setTabs(newTabs);
  };

  useEffect(() => {
    if (unreadTabIds.has(activeTabId)) {
      deleteUnreadTabId(activeTabId);
    }
  }, [activeTabId, unreadTabIds]);

  useEffect(() => {
    const active = tabs.find((t) => t.id === activeTabId);
    let title: string;
    if (!active || active.title === LOCAL_NAME) {
      title = APP_NAME + " " + sysSitename;
    } else {
      title = `${active.title} - ${APP_NAME} ${sysSitename}`;
    }
    document.title = title;
    window.appSetWindowTitle?.(title);
  }, [tabs, activeTabId, sysSitename]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(CS_EVENT_TERMINAL_CHANGE, {
        detail: { activePaneId } satisfies CSEventDetailTerminalChange,
      }),
    );
  }, [activePaneId]);

  useEffect(() => {
    if (focusSearchInputTrigger > 0 && searchOpen) {
      document.getElementById(ID_TERMINAL_SEARCH_INPUT)?.focus();
    }
  }, [searchOpen, focusSearchInputTrigger]);

  return (
    <>
      {tabs.length > 0 && (
        <Box
          id="tab-bar"
          sx={{
            bgcolor: "#f4f6f8",
            display: "flex",
            alignItems: "center",
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
            overflow: "hidden",
            position: "relative",
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTabBarContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4 });
          }}
        >
          <IconButton
            color="inherit"
            aria-label={t("Open drawer")}
            edge="start"
            onClick={() => setMobileOpen((a) => !a)}
            sx={{ ml: 1, display: { md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <Box sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
            <Tabs
              id="tabs"
              value={activeTabId}
              onChange={(_, val) => {
                const t = tabs.find((x) => x.id === val);
                if (!t) {
                  return;
                }
                setActiveTabId(val);
                setActivePaneId(t.activePaneId);
                triggerFocus();
              }}
              variant="scrollable"
              scrollButtons={true}
              allowScrollButtonsMobile
              sx={{ minHeight: 40 }}
            >
              {tabs.map((tab, i) => {
                const state = tabStates[i]!;
                return (
                  <Tab
                    className={`tab ${tab.id === activeTabId ? "active" : ""} ${state.unread ? "unread" : ""} ${
                      tab.id === draggedTabId ? "dragging" : ""
                    } ${state.executingUnread || state.executingOnly ? "executing" : ""} ${tab.panes
                      .map((p) => p.options?.tabClass || "")
                      .join(" ")}`}
                    data-id={tab.id}
                    data-type={tab.type}
                    data-is-pinned={tab.isPinned ? "1" : "0"}
                    data-is-locked={tab.isLocked ? "1" : "0"}
                    key={tab.id}
                    value={tab.id}
                    title={
                      tab.type === "terminal"
                        ? t("Hosts:") + `\n${tab.panes.map((p) => getPaneTip(p, shellIntegrations[p.id])).join("\n")}`
                        : t("Scratchpad")
                    }
                    onContextMenu={(e) => handleContextMenu(e, tab.id)}
                    onAuxClick={(e) => {
                      // mouse middle key
                      if (e.button === 1) {
                        e.preventDefault();
                        closeTab(tab.id);
                      }
                    }}
                    draggable={!isMobile && !isTouch}
                    onDragStart={(e) => {
                      activatePane(tab.activePaneId, tab.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", tab.id);
                      setDraggedTabId(tab.id);
                    }}
                    onDragEnd={() => {
                      setDraggedTabId(null);
                      setDragOverTab(null);
                    }}
                    onDragOver={(e) => {
                      if (!draggedTabId || draggedTabId === tab.id) {
                        return;
                      }
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const rect = e.currentTarget.getBoundingClientRect();
                      const position = e.clientX > rect.left + rect.width / 2 ? "after" : "before";
                      if (!dragOverTab || dragOverTab.id !== tab.id || dragOverTab.position !== position) {
                        setDragOverTab({ id: tab.id, position });
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverTab?.id === tab.id) {
                        setDragOverTab(null);
                      }
                    }}
                    onDrop={(e) => {
                      if (!draggedTabId || draggedTabId === tab.id) {
                        return;
                      }
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const position = e.clientX > rect.left + rect.width / 2 ? "after" : "before";
                      reorderTabs(draggedTabId, tab.id, position);
                      setDraggedTabId(null);
                      setDragOverTab(null);
                    }}
                    sx={{
                      minHeight: 40,
                      py: 0,
                      textTransform: "none",
                      minWidth: "auto",
                      opacity: draggedTabId === tab.id ? 0.4 : 1,
                      boxShadow:
                        dragOverTab?.id === tab.id
                          ? (theme) =>
                              `inset ${dragOverTab.position === "before" ? "3px" : "-3px"} 0 0 ${theme.palette.primary.main}`
                          : undefined,
                      transition: "opacity 0.2s, box-shadow 0.1s",
                      // ...(tab.id !== activeTabId
                      //   ? {
                      //       "&:hover": {
                      //         bgcolor: "primary.light",
                      //         color: "white",
                      //       },
                      //     }
                      //   : undefined),
                      ...(tab.panes[0]?.options?.tabStyle
                        ? (JSON.parse(tab.panes[0].options.tabStyle) as React.CSSProperties)
                        : undefined),
                    }}
                    label={
                      <Box sx={{ display: "flex", alignItems: "center" }}>
                        {tab.isLocked ? (
                          <LockIcon sx={{ fontSize: 14, mr: 0.5, color: "primary.main" }} />
                        ) : (
                          tab.isPinned && <PushPinIcon sx={{ fontSize: 14, mr: 0.5, color: "primary.main" }} />
                        )}
                        <Box
                          sx={{ width: 16, mr: 0.5, display: "flex", justifyContent: "center", alignItems: "center" }}
                        >
                          {tab.type === "scratchpad" ? (
                            <Box sx={{ display: "flex", alignItems: "center" }}>
                              {scratchpadSyncState === "offline" && <CloudOffIcon fontSize="small" color="error" />}
                              {scratchpadSyncState === "syncing" && (
                                <SyncIcon
                                  fontSize="small"
                                  color="info"
                                  sx={{
                                    animation: "spin 2s linear infinite",
                                    "@keyframes spin": {
                                      "0%": { transform: "rotate(0deg)" },
                                      "100%": { transform: "rotate(360deg)" },
                                    },
                                  }}
                                />
                              )}
                              {scratchpadSyncState === "dirty" && <CloudUploadIcon fontSize="small" color="warning" />}
                              {scratchpadSyncState === "synced" && <CloudDoneIcon fontSize="small" color="success" />}
                            </Box>
                          ) : (
                            (() => {
                              if (state.executingUnread) {
                                return (
                                  <Box
                                    title={t("Executing & unread")}
                                    sx={{
                                      position: "relative",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      width: 18,
                                      height: 18,
                                    }}
                                  >
                                    <SyncIcon
                                      sx={{
                                        fontSize: 16,
                                        color: "#2196f3",
                                        ...(state.executingSpin
                                          ? {
                                              animation: "spin 2s linear infinite",
                                              "@keyframes spin": {
                                                "0%": { transform: "rotate(0deg)" },
                                                "100%": { transform: "rotate(360deg)" },
                                              },
                                            }
                                          : {}),
                                      }}
                                    />
                                    <PriorityHighIcon
                                      sx={{
                                        position: "absolute",
                                        top: -3,
                                        right: -5,
                                        fontSize: 12,
                                        color: "#2196f3",
                                        fontWeight: "bold",
                                        bgcolor: "#f4f6f8",
                                        borderRadius: "50%",
                                      }}
                                    />
                                  </Box>
                                );
                              }

                              if (state.unreadOnly) {
                                return (
                                  <Box title={t("Unread")} sx={{ display: "flex", alignItems: "center" }}>
                                    <PriorityHighIcon
                                      sx={{
                                        fontSize: 18,
                                        color: state.success ? "green" : state.error ? "red" : "#2196f3",
                                        fontWeight: "bold",
                                      }}
                                    />
                                  </Box>
                                );
                              }

                              if (state.executingOnly) {
                                return (
                                  <Box title={t("Executing")} sx={{ display: "flex", alignItems: "center" }}>
                                    <SyncIcon
                                      sx={{
                                        fontSize: 16,
                                        color: "#2196f3",
                                        ...(state.executingSpin
                                          ? {
                                              animation: "spin 2s linear infinite",
                                              "@keyframes spin": {
                                                "0%": { transform: "rotate(0deg)" },
                                                "100%": { transform: "rotate(360deg)" },
                                              },
                                            }
                                          : {}),
                                      }}
                                    />
                                  </Box>
                                );
                              }

                              if (state.error) {
                                return (
                                  <Box title={t("Last Command Error")} sx={{ display: "flex", alignItems: "center" }}>
                                    <ErrorIcon
                                      sx={{
                                        fontSize: 18,
                                        color: "red",
                                        fontWeight: "bold",
                                      }}
                                    />
                                  </Box>
                                );
                              } else if (state.success) {
                                return (
                                  <Box title={t("Last Command Success")} sx={{ display: "flex", alignItems: "center" }}>
                                    <DoneIcon
                                      sx={{
                                        fontSize: 18,
                                        color: "green",
                                        fontWeight: "bold",
                                      }}
                                    />
                                  </Box>
                                );
                              }

                              const activeState =
                                tab.panes.find((p) => p.id === tab.activePaneId)?.state || "disconnected";
                              const isConnected = activeState === "connected";

                              return (
                                <Box
                                  sx={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    bgcolor: isConnected
                                      ? "success.main"
                                      : activeState.startsWith("connecting")
                                        ? "warning.main"
                                        : "error.main",
                                  }}
                                  title={PaneStateLabels[activeState]}
                                />
                              );
                            })()
                          )}
                        </Box>
                        <span>{tab.title}</span>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                          }}
                          sx={{ ml: 1, p: 0.5 }}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    }
                  />
                );
              })}
            </Tabs>
          </Box>
          <IconButton
            size="small"
            title={t("New Tab") + " (alt+o)"}
            onClick={(e) => {
              if (!e.shiftKey) {
                const [mode] = parseNewTabDialogFilter(getStore().newTabDialogFilter);
                setNewTabDialogFilter(ViewModePrefix[mode]);
              }
              setNewTabDialogOpen(true);
            }}
            sx={{ mr: 1, ml: 0.5, bgcolor: "action.hover", "&:hover": { bgcolor: "action.selected" } }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
          {isMobile && hasSidebarApplet && (
            <IconButton color="inherit" onClick={() => setMobileAppletsOpen((a) => !a)} sx={{ mr: 1 }}>
              <ViewSidebarIcon />
            </IconButton>
          )}
          {searchOpen && (
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 2000,
                bgcolor: "background.paper",
                boxShadow: 3,
                display: "flex",
                alignItems: "center",
                px: 1,
                py: 0.5,
                borderRadius: "0 0 8px 8px",
                border: 1,
                borderColor: "divider",
                borderTop: 0,
              }}
            >
              <TextFieldWithCopy
                id={ID_TERMINAL_SEARCH_INPUT}
                size="small"
                placeholder={t("Find")}
                value={searchQuery}
                autoComplete="off"
                onFocus={(e) => e.target.select()}
                onBlur={() => {
                  const term = __CS_TERMINALS__.current[activePaneId];
                  if (term && "getXterm" in term) {
                    term.clearSearchActiveDecoration();
                  }
                }}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value) {
                    const term = __CS_TERMINALS__.current[activePaneId];
                    if (term && "getXterm" in term) {
                      term.findNext(e.target.value, { incremental: true });
                    }
                  }
                }}
                onKeyDown={(e) => {
                  const kb = getKeyCombination(e);
                  if (kb === "enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    const term = __CS_TERMINALS__.current[activePaneId];
                    if (term && "getXterm" in term) {
                      if (e.shiftKey) {
                        term.findPrevious(searchQuery);
                      } else {
                        term.findNext(searchQuery);
                      }
                    }
                  } else if (e.key === "Escape") {
                    handleCloseSearch();
                  }
                }}
                sx={{
                  width: 200,
                  input: { py: 0 },
                  "& .MuiInputBase-root": { fontSize: "typography.body2.fontSize" },
                }}
              />
              <IconButton
                size="small"
                onClick={() => {
                  const term = __CS_TERMINALS__.current[activePaneId];
                  if (term && "getXterm" in term) {
                    term.findPrevious(searchQuery);
                  }
                }}
                title={t("Previous")}
              >
                <NavigateBeforeIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => {
                  const term = __CS_TERMINALS__.current[activePaneId];
                  if (term && "getXterm" in term) {
                    term.findNext(searchQuery);
                  }
                }}
                title={t("Next")}
              >
                <NavigateNextIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={handleCloseSearch} title={t("Close")}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          <Menu
            id="tab-bar-menu"
            open={!!tabBarContextMenu}
            onClose={() => setTabBarContextMenu(null)}
            anchorReference="anchorPosition"
            anchorPosition={
              tabBarContextMenu
                ? {
                    top: tabBarContextMenu.mouseY,
                    left: tabBarContextMenu.mouseX,
                  }
                : undefined
            }
          >
            <MenuItem
              id="tab-bar-menu-close-all"
              disabled={tabs.length === 0}
              onClick={() => {
                setTabBarContextMenu(null);
                setTabs([]);
              }}
            >
              {t("Close All Tabs")} ({tabs.length})
            </MenuItem>
            <MenuItem
              id="tab-bar-menu-save-all"
              disabled={tabs.length === 0}
              onClick={() => {
                setTabBarContextMenu(null);
                openSaveTabsToButtonDialog();
              }}
            >
              {t("Save All to Button")}
            </MenuItem>
            <ExtraMenu
              extraMenu={extraTabBarMenu}
              // eslint-disable-next-line @typescript-eslint/prefer-as-const
              target={"" as ""}
              before={() => {
                setTabBarContextMenu(null);
              }}
            />
          </Menu>
        </Box>
      )}
    </>
  );
}
