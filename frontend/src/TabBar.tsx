import React, { useEffect } from "react";
import { Box, Tabs, Tab, IconButton, TextField } from "@mui/material";
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

import type { NewTabDialogViewMode, ScratchpadSyncState } from "./common";
import { type TerminalRefMap, setActivePaneId, setActiveTabId, triggerFocus, useStore } from "./store";
import type { AppletData } from "./AppletWrapper";

export interface TabBarProps {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  mobileAppletsOpen: boolean;
  setMobileAppletsOpen: (v: boolean) => void;
  searchOpen: boolean;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  terminalRefs: React.MutableRefObject<TerminalRefMap>;
  unreadTabIds: Set<string>;
  isMobile: boolean;
  applets: AppletData[];
  scratchpadSyncState: ScratchpadSyncState;
  handleContextMenu: (e: React.MouseEvent, tabId: string) => void;
  handleCloseTab: (e: React.MouseEvent, tabId: string) => void;
  handleCloseSearch: () => void;
  setNewTabDialogInitialViewMode: React.Dispatch<React.SetStateAction<NewTabDialogViewMode>>;
  setNewTabDialogOpen: (open: boolean) => void;
}

export default function TabBar({
  mobileOpen,
  setMobileOpen,
  mobileAppletsOpen,
  setMobileAppletsOpen,
  searchOpen,
  searchQuery,
  setSearchQuery,
  terminalRefs,
  unreadTabIds,
  isMobile,
  applets,
  scratchpadSyncState,
  handleContextMenu,
  handleCloseTab,
  handleCloseSearch,
  setNewTabDialogInitialViewMode,
  setNewTabDialogOpen,
}: TabBarProps) {
  const { focusSearchInputTrigger, tabs, activeTabId, activePaneId } = useStore();
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusSearchInputTrigger > 0 && searchOpen) {
      searchInputRef.current?.focus();
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
        >
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={() => setMobileOpen(!mobileOpen)}
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
                  className="tab"
                  data-id={tab.id}
                  key={tab.id}
                  value={tab.id}
                  onContextMenu={(e) => handleContextMenu(e, tab.id)}
                  sx={{ minHeight: 40, py: 0, textTransform: "none", minWidth: "auto" }}
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
                      <IconButton size="small" onClick={(e) => handleCloseTab(e, tab.id)} sx={{ ml: 1, p: 0.5 }}>
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
              setNewTabDialogInitialViewMode("servers");
              setNewTabDialogOpen(true);
            }}
            sx={{ mr: 1, ml: 0.5, bgcolor: "action.hover", "&:hover": { bgcolor: "action.selected" } }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
          {isMobile && applets.filter((a) => a.position === "sidebar").length > 0 && (
            <IconButton color="inherit" onClick={() => setMobileAppletsOpen(!mobileAppletsOpen)} sx={{ mr: 1 }}>
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
              <TextField
                inputRef={searchInputRef}
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
                  if (e.key === "Enter") {
                    e.preventDefault();
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
                  "& .MuiInputBase-root": { height: 32, fontSize: "0.875rem" },
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
        </Box>
      )}
    </>
  );
}
