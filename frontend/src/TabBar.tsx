import React, { useEffect, useState } from "react";
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

import {
  type CSEventDetailTerminalChange,
  type ScratchpadSyncState,
  CS_EVENT_TERMINAL_CHANGE,
  getKeyCombination,
} from "./common";
import {
  type TerminalRefMap,
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
} from "./store";
import { APP_NAME, ID_TERMINAL_SEARCH_INPUT, LOCAL_NAME } from "./constants";
import TextFieldWithCopy from "./components/TextFieldWithCopy";
import ExtraMenu from "./components/ExtraMenu";

export interface TabBarProps {
  terminalRefs: React.MutableRefObject<TerminalRefMap>;
  isMobile: boolean;
  isTouch: boolean;
  hasSidebarApplet: boolean;
  scratchpadSyncState: ScratchpadSyncState;
  handleContextMenu: (e: React.MouseEvent, tabId: string) => void;
  handleCloseSearch: () => void;
}

export default function TabBar({
  terminalRefs,
  isMobile,
  isTouch,
  hasSidebarApplet,
  scratchpadSyncState,
  handleContextMenu,
  handleCloseSearch,
}: TabBarProps) {
  const focusSearchInputTrigger = useStore((state) => state.focusSearchInputTrigger);
  const tabs = useStore((state) => state.tabs);
  const activeTabId = useStore((state) => state.activeTabId);
  const activePaneId = useStore((state) => state.activePaneId);
  const unreadTabIds = useStore((state) => state.unreadTabIds);
  const sysSitename = useStore((state) => state.sysinfo.sitename);
  const searchOpen = useStore((state) => state.searchOpen);
  const extraTabBarMenu = useStore((state) => state.extraTabBarMenu);

  const [searchQuery, setSearchQuery] = useState("");
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<{ id: string; position: "before" | "after" } | null>(null);

  const [tabBarContextMenu, setTabBarContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);

  const reorderTabs = (draggedId: string, targetId: string, position: "before" | "after") => {
    const draggedIndex = tabs.findIndex((t) => t.id === draggedId);
    const targetIndex = tabs.findIndex((t) => t.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const newTabs = [...tabs];
    const [removed] = newTabs.splice(draggedIndex, 1);

    // After removing the dragged tab, we need to find the new index of the target tab
    const newTargetIndex = newTabs.findIndex((t) => t.id === targetId);
    const insertIndex = position === "before" ? newTargetIndex : newTargetIndex + 1;

    newTabs.splice(insertIndex, 0, removed);
    setTabs(newTabs);
  };

  useEffect(() => {
    if (unreadTabIds.has(activeTabId)) {
      deleteUnreadTabId(activeTabId);
    }
  }, [activeTabId, unreadTabIds]);

  useEffect(() => {
    const active = tabs.find((t) => t.id === activeTabId);
    if (!active || active.title === LOCAL_NAME) {
      document.title = APP_NAME + " " + sysSitename;
    } else {
      document.title = `${active.title} - ${APP_NAME} ${sysSitename}`;
    }
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
            aria-label="open drawer"
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
              {tabs.map((tab) => (
                <Tab
                  className={`tab ${tab.id === activeTabId ? "active" : ""} ${
                    unreadTabIds.has(tab.id) ? "unread" : ""
                  } ${tab.panes[0]?.options?.tabClass || ""} ${tab.id === draggedTabId ? "dragging" : ""}`}
                  data-id={tab.id}
                  data-type={tab.type}
                  data-is-pinned={tab.isPinned ? "1" : "0"}
                  data-is-locked={tab.isLocked ? "1" : "0"}
                  key={tab.id}
                  value={tab.id}
                  title={tab.type === "terminal" ? `Hosts: ${tab.panes.map((p) => p.host).join(", ")}` : "Scratchpad"}
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
                      <Box sx={{ width: 16, mr: 0.5, display: "flex", justifyContent: "center", alignItems: "center" }}>
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
                            const state = tab.panes.find((p) => p.id === tab.activePaneId)?.state || "disconnected";
                            const isConnected = state === "connected";
                            const isUnread = unreadTabIds.has(tab.id);

                            if (isConnected && isUnread) {
                              return <PriorityHighIcon sx={{ fontSize: 18, color: "#2196f3", fontWeight: "bold" }} />;
                            }

                            return (
                              <Box
                                sx={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  bgcolor: isConnected
                                    ? "success.main"
                                    : state.startsWith("connecting")
                                      ? "warning.main"
                                      : "error.main",
                                }}
                                title={state}
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
              ))}
            </Tabs>
          </Box>
          <IconButton
            size="small"
            title="New Tab (Alt+O)"
            onClick={() => {
              setNewTabDialogFilter(getStore().newTabDialogFilter.slice(0, 1)); // preserve mode (if any)
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
                placeholder="Find"
                value={searchQuery}
                autoComplete="off"
                onFocus={(e) => e.target.select()}
                onBlur={() => {
                  const term = terminalRefs.current[activePaneId];
                  if (term && "getXterm" in term) {
                    term.clearSearchActiveDecoration();
                  }
                }}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value) {
                    const term = terminalRefs.current[activePaneId];
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
                    const term = terminalRefs.current[activePaneId];
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
                  const term = terminalRefs.current[activePaneId];
                  if (term && "getXterm" in term) {
                    term.findPrevious(searchQuery);
                  }
                }}
                title="Previous"
              >
                <NavigateBeforeIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => {
                  const term = terminalRefs.current[activePaneId];
                  if (term && "getXterm" in term) {
                    term.findNext(searchQuery);
                  }
                }}
                title="Next"
              >
                <NavigateNextIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={handleCloseSearch} title="Close">
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
              Close All Tabs ({tabs.length})
            </MenuItem>
            <MenuItem
              id="tab-bar-menu-save-all"
              disabled={tabs.length === 0}
              onClick={() => {
                setTabBarContextMenu(null);
                openSaveTabsToButtonDialog();
              }}
            >
              Save All to Button
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
