import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
  IconButton,
  InputAdornment,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import ComputerIcon from "@mui/icons-material/Computer";
import DnsIcon from "@mui/icons-material/Dns";
import HistoryIcon from "@mui/icons-material/History";
import SendIcon from "@mui/icons-material/Send";
import StarIcon from "@mui/icons-material/Star";
import TabIcon from "@mui/icons-material/Tab";
import PushPinIcon from "@mui/icons-material/PushPin";
import SmartButtonIcon from "@mui/icons-material/SmartButton";

import type { SessionPinned, ButtonData, HostData } from "./api";
import {
  BROWSER_STORAGE_KEY_TOKEN,
  BUILTIN_BUTTONS,
  DEFAULT_BUTTON_GROUP,
  HEADER_AUTHORIZATION,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  DEFAULT_SCROLL_ITEMS,
  LOCAL_NAME,
  VAR_CS_SCROLL_ITEMS,
} from "./constants";
import { type ViewMode, filterHosts, getIntVar, localShellHost, searchString } from "./common";
import { getStore, useStore } from "./store";

interface DialogItem {
  type: "recent" | "host" | "direct" | "local" | "tab" | "pinned_tab" | "button" | "other_button" | "builtin_button";
  value: string;
  label: string;
  subtitle?: string;
  tooltip?: string;
  isFav?: boolean;
  id?: string;
  host?: string;
  isLocked?: boolean;
  btn?: Pick<ButtonData, "id" | "name" | "type" | "payload" | "liquidjs">;
  tags?: string[];
  flatIndex: number;
}

interface DialogSection {
  title: string;
  items: DialogItem[];
}

interface NewTabDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (host: string) => void;
  onSelectTab: (tabId: string) => void;
  onAttachPinned: (id: string, host: string, title: string, isLocked: boolean) => void;
  onExecuteButton: (btn: Pick<ButtonData, "id" | "name" | "type" | "payload" | "liquidjs">) => void;
}

export default function NewTabDialog({
  open,
  onClose,
  onSelect,
  onSelectTab,
  onAttachPinned,
  onExecuteButton,
}: NewTabDialogProps) {
  const tabs = useStore((state) => state.tabs);
  const hosts = useStore((state) => state.hosts);
  const buttons = useStore((state) => state.buttons);
  const shells = useStore((state) => state.shells);
  const activeGroup = useStore((state) => state.activeGroup);
  const newTabDialogInitialViewMode = useStore((state) => state.newTabDialogInitialViewMode);

  const defaultShell = shells[0];
  const alternativeShell = shells[1];
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(newTabDialogInitialViewMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const [localPinned, setLocalPinned] = useState<SessionPinned[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewMode(newTabDialogInitialViewMode);
  }, [newTabDialogInitialViewMode]);

  useEffect(() => {
    if (open) {
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      fetch("/api/sessions/pinned", {
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      })
        .then((r) => r.json() as Promise<SessionPinned[]>)
        .then((data) => setLocalPinned(data || []))
        .catch((e) => console.error(e));
    }
  }, [open]);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isTouch = useMediaQuery("(pointer: coarse)");

  const filteredRecents = useMemo(() => {
    if (viewMode !== "servers") {
      return [];
    }
    const f = filter.toLowerCase();
    return getStore()
      .recents.filter((r) => r.host.toLowerCase().includes(f))
      .sort((a, b) => b.last_used - a.last_used)
      .slice(0, 5);
  }, [filter, viewMode]);

  const filteredHosts = useMemo(() => {
    if (viewMode !== "servers") {
      return { favourite: [], normal: [], auto: [] };
    }
    const f = filter.trim();
    const filtered = filterHosts(hosts, f);

    const favs = filtered.filter((h) => h.is_favourite);
    const normals = filtered.filter((h) => !h.is_favourite && !h.is_auto);
    const autos = filtered.filter((h) => !h.is_favourite && h.is_auto);

    const nameSorter = (a: HostData, b: HostData) => a.name.localeCompare(b.name);
    const hostNameSorter = (a: HostData, b: HostData) => {
      if (a.hostname === b.hostname) {
        return a.name.localeCompare(b.name);
      }
      return a.hostname.localeCompare(b.hostname);
    };

    return {
      favourite: favs.sort(nameSorter),
      normal: normals.sort(nameSorter),
      auto: autos.sort(hostNameSorter),
    };
  }, [hosts, filter, viewMode]);

  const filteredShells = useMemo(() => {
    if (viewMode !== "servers") {
      return [];
    }
    const f = filter.toLowerCase().trim();
    if (!f) {
      return shells;
    }
    return shells.filter((s) => s.name.toLowerCase().includes(f));
  }, [shells, filter, viewMode]);

  const directConnect = useMemo(() => {
    if (viewMode !== "servers") {
      return null;
    }
    if (!filter || (!filter.includes(".") && !filter.includes(":") && filter !== "localhost")) {
      return null;
    }
    return filter;
  }, [filter, viewMode]);

  const activeTabsList = useMemo(() => {
    if (viewMode !== "tabs") {
      return [];
    }
    const f = filter.toLowerCase();
    return tabs.filter(
      (t) =>
        t.title.toLowerCase().includes(f) ||
        (t.type === "terminal" && t.panes.some((p) => p.host.toLowerCase().includes(f))),
    );
  }, [tabs, filter, viewMode]);

  const attachablePinnedTabs = useMemo(() => {
    if (viewMode !== "tabs") {
      return [];
    }
    const f = filter.toLowerCase();
    return localPinned.filter(
      (p) =>
        !tabs.some((t) => t.panes.some((pane) => (pane.sessionId || pane.id) === p.id && pane.state !== "stolen")) &&
        (p.title?.toLowerCase().includes(f) || p.host?.toLowerCase().includes(f)),
    );
  }, [localPinned, tabs, filter, viewMode]);

  const allFilteredButtons = useMemo(() => {
    if (viewMode !== "buttons") {
      return { matchedUser: [], matchedBuiltin: [] };
    }
    const f = filter.toLowerCase();

    const matchedUser = buttons.filter(
      (b) =>
        b.name.toLowerCase().includes(f) ||
        (b.type !== "run_script" && b.payload && b.payload.toLowerCase().includes(f)),
    );

    const matchedBuiltin = BUILTIN_BUTTONS.filter(
      (b) => b.name.toLowerCase().includes(f) || b.payload.toLowerCase().includes(f),
    );

    return { matchedUser, matchedBuiltin };
  }, [buttons, filter, viewMode]);

  const activeGroupButtons = useMemo(() => {
    if (viewMode !== "buttons") {
      return [];
    }
    return allFilteredButtons.matchedUser.filter(
      (b) => (b.group || DEFAULT_BUTTON_GROUP) === (activeGroup || DEFAULT_BUTTON_GROUP),
    );
  }, [allFilteredButtons, activeGroup, viewMode]);

  const otherGroupButtons = useMemo(() => {
    if (viewMode !== "buttons") {
      return [];
    }
    return allFilteredButtons.matchedUser.filter(
      (b) => (b.group || DEFAULT_BUTTON_GROUP) !== (activeGroup || DEFAULT_BUTTON_GROUP),
    );
  }, [allFilteredButtons, activeGroup, viewMode]);

  const builtinButtons = useMemo(() => {
    if (viewMode !== "buttons") {
      return [];
    }
    return allFilteredButtons.matchedBuiltin;
  }, [allFilteredButtons, viewMode]);

  const { sections, items } = useMemo(() => {
    const sections: DialogSection[] = [];
    const items: DialogItem[] = [];
    let flatIndex = 0;

    const addSection = (title: string, rawItems: Omit<DialogItem, "flatIndex">[]) => {
      if (rawItems.length === 0) return;
      const sectionItems = rawItems.map((item) => {
        const dialogItem = { ...item, flatIndex: flatIndex++ };
        items.push(dialogItem);
        return dialogItem;
      });
      sections.push({ title, items: sectionItems });
    };

    if (viewMode === "servers") {
      // 1. Recents
      const recentList: Omit<DialogItem, "flatIndex">[] = [];
      filteredRecents.forEach((r) => {
        const knownHost = hosts.find((h) => h.name === r.host);
        recentList.push({
          type: "recent",
          value: r.host,
          label: r.host,
          subtitle: knownHost ? `${knownHost.user || "root"}@${knownHost.hostname}` : undefined,
          tooltip: knownHost?.comment,
          tags: knownHost?.tags,
        });
      });
      addSection("Recents", recentList);

      // 2. Favourite servers
      const favList: Omit<DialogItem, "flatIndex">[] = [];
      filteredHosts.favourite.forEach((h) => {
        let subtitle = `${h.user || "root"}@${h.hostname}`;
        if (filter && h.comment) {
          const matchedComment = searchString(h.comment, filter);
          if (matchedComment) {
            subtitle += ` // ${matchedComment}`;
          }
        }
        favList.push({
          type: "host",
          value: h.name,
          label: h.name,
          subtitle,
          tooltip: h.comment,
          isFav: h.is_favourite,
          tags: h.tags,
        });
      });
      addSection("Favourite Servers", favList);

      // 3. Local shells
      const localList: Omit<DialogItem, "flatIndex">[] = [];
      filteredShells.forEach((shell) => {
        localList.push({
          type: "local",
          value: shell !== defaultShell ? localShellHost(shell) : LOCAL_NAME,
          label:
            shell.name + (shell === defaultShell ? " (Default)" : shell === alternativeShell ? " (Alternative)" : ""),
          subtitle: `Local Shell - ` + shell.path,
        });
      });
      addSection("Local Shells", localList);

      // 4. Normal servers
      const normalList: Omit<DialogItem, "flatIndex">[] = [];
      filteredHosts.normal.forEach((h) => {
        let subtitle = `${h.user || "root"}@${h.hostname}`;
        if (filter && h.comment) {
          const matchedComment = searchString(h.comment, filter);
          if (matchedComment) {
            subtitle += ` // ${matchedComment}`;
          }
        }
        normalList.push({
          type: "host",
          value: h.name,
          label: h.name,
          subtitle,
          tooltip: h.comment,
          isFav: h.is_favourite,
          tags: h.tags,
        });
      });
      addSection("Normal Servers", normalList);

      // 5. Auto servers
      const autoList: Omit<DialogItem, "flatIndex">[] = [];
      filteredHosts.auto.forEach((h) => {
        let subtitle = `${h.user || "root"}@${h.hostname}`;
        if (filter && h.comment) {
          const matchedComment = searchString(h.comment, filter);
          if (matchedComment) {
            subtitle += ` // ${matchedComment}`;
          }
        }
        autoList.push({
          type: "host",
          value: h.name,
          label: h.name,
          subtitle,
          tooltip: h.comment,
          isFav: h.is_favourite,
          tags: h.tags,
        });
      });
      addSection("Auto Servers", autoList);

      // 6. Direct Connection
      if (directConnect) {
        addSection("Direct Connection", [
          {
            type: "direct",
            value: directConnect,
            label: `Connect to ${directConnect} (SSH)`,
          },
        ]);
      }
    } else if (viewMode === "tabs") {
      const activeTabsItems: Omit<DialogItem, "flatIndex">[] = activeTabsList.map((t) => ({
        type: "tab",
        id: t.id,
        value: t.id,
        label: t.title,
        subtitle:
          t.type === "scratchpad" ? "Scratchpad" : `Terminal (${t.panes.length} pane${t.panes.length > 1 ? "s" : ""})`,
      }));
      addSection("Current Browser Tabs", activeTabsItems);

      const pinnedTabsItems: Omit<DialogItem, "flatIndex">[] = attachablePinnedTabs.map((p) => ({
        type: "pinned_tab",
        id: p.id,
        value: p.id,
        host: p.host,
        label: p.title || p.host,
        subtitle: `Attach to pinned session`,
        isLocked: p.isLocked,
      }));
      addSection("Attachable Pinned Tabs", pinnedTabsItems);
    } else if (viewMode === "buttons") {
      const activeGroupList: Omit<DialogItem, "flatIndex">[] = [];
      activeGroupButtons.forEach((b) => {
        let subtitle = `Group: ${b.group || DEFAULT_BUTTON_GROUP} | Type: ${b.type}${
          b.type !== "send_string" && b.type !== "run_script" ? " | Payload: " + b.payload : ""
        }`;
        if (filter && b.type === "send_string" && b.payload) {
          const matchedPayload = searchString(b.payload, filter);
          if (matchedPayload) {
            subtitle += ` // ${matchedPayload}`;
          }
        }
        activeGroupList.push({
          type: "button",
          id: b.id,
          value: b.id,
          label: b.name,
          subtitle,
          tooltip: b.type !== "run_script" ? b.payload : undefined,
          btn: b,
        });
      });
      addSection(`Active Group (${activeGroup || DEFAULT_BUTTON_GROUP})`, activeGroupList);

      const otherGroupList: Omit<DialogItem, "flatIndex">[] = [];
      otherGroupButtons.forEach((b) => {
        let subtitle = `Group: ${b.group || DEFAULT_BUTTON_GROUP} | Type: ${b.type}${
          b.type !== "send_string" && b.type !== "run_script" ? " | Payload: " + b.payload : ""
        }`;
        if (filter && b.type === "send_string" && b.payload) {
          const matchedPayload = searchString(b.payload, filter);
          if (matchedPayload) {
            subtitle += ` // ${matchedPayload}`;
          }
        }
        otherGroupList.push({
          type: "other_button",
          id: b.id,
          value: b.id,
          label: b.name,
          subtitle,
          tooltip: b.type !== "run_script" ? b.payload : undefined,
          btn: b,
        });
      });
      addSection("Other Groups", otherGroupList);

      const builtinList: Omit<DialogItem, "flatIndex">[] = [];
      builtinButtons.forEach((b) => {
        builtinList.push({
          type: "builtin_button",
          id: b.id,
          value: b.id,
          label: b.name,
          subtitle: `Built-in | Type: ${b.type} | Payload: ${b.payload}`,
          btn: b,
        });
      });
      addSection("Built-in Functions", builtinList);
    }

    return { sections, items };
  }, [
    viewMode,
    filteredRecents,
    filteredHosts.favourite,
    filteredHosts.normal,
    filteredHosts.auto,
    filteredShells,
    directConnect,
    hosts,
    filter,
    defaultShell,
    alternativeShell,
    activeTabsList,
    attachablePinnedTabs,
    activeGroupButtons,
    activeGroup,
    otherGroupButtons,
    builtinButtons,
  ]);

  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex]);

  const cycleViewMode = useCallback((direction: "next" | "prev") => {
    const modes: ViewMode[] = ["servers", "tabs", "buttons"];
    setViewMode((prev) => {
      const idx = modes.indexOf(prev);
      if (direction === "next") {
        return modes[(idx + 1) % modes.length];
      } else {
        return modes[(idx - 1 + modes.length) % modes.length];
      }
    });
    setSelectedIndex(0);
  }, []);

  const handleSelect = useCallback(
    (item: (typeof items)[number]) => {
      if (item.type === "tab") {
        onSelectTab(item.id!);
        onClose();
      } else if (item.type === "pinned_tab") {
        onAttachPinned(item.id!, item.host!, item.label, !!item.isLocked);
        onClose();
      } else if (item.type === "button" || item.type === "other_button" || item.type === "builtin_button") {
        onExecuteButton(item.btn!);
        onClose();
      } else {
        onSelect(item.value);
        onClose();
      }
    },
    [onAttachPinned, onClose, onExecuteButton, onSelect, onSelectTab],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "arrowdown" || (e.altKey && key === "j")) {
        const step = (key === "j" ? e.shiftKey : e.altKey) ? getIntVar(VAR_CS_SCROLL_ITEMS, DEFAULT_SCROLL_ITEMS) : 1;
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.min(prev + step, items.length - 1));
      } else if (key === "arrowup" || (e.altKey && key === "k")) {
        const step = (key === "k" ? e.shiftKey : e.altKey) ? getIntVar(VAR_CS_SCROLL_ITEMS, DEFAULT_SCROLL_ITEMS) : 1;
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.max(prev - step, 0));
      } else if ((key === "arrowleft" && !filter) || (e.altKey && key === "h")) {
        e.stopPropagation();
        e.preventDefault();
        cycleViewMode("prev");
      } else if ((key === "arrowright" && !filter) || (e.altKey && key === "l")) {
        e.stopPropagation();
        e.preventDefault();
        cycleViewMode("next");
      } else if (key === "enter" && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        if (items[selectedIndex]) {
          handleSelect(items[selectedIndex]);
        }
      } else if (key === "escape") {
        onClose();
      }
    },
    [cycleViewMode, filter, handleSelect, items, onClose, selectedIndex],
  );

  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "o" || e.key === "a" || e.key === "e")) {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isTouch || !isMobile) {
        return;
      }
      const touch = e.touches[0];
      swipeStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    },
    [isMobile, isTouch],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!isTouch || !isMobile || !swipeStartRef.current) {
        return;
      }
      const touch = e.changedTouches[0];
      const diffX = touch.clientX - swipeStartRef.current.x;
      const diffY = touch.clientY - swipeStartRef.current.y;
      const diffTime = Date.now() - swipeStartRef.current.time;

      swipeStartRef.current = null;

      if (Math.abs(diffX) > 100 && Math.abs(diffX) > Math.abs(diffY) * 2 && diffTime < 500) {
        if (diffX > 0) {
          cycleViewMode("prev");
        } else {
          cycleViewMode("next");
        }
      }
    },
    [cycleViewMode, isMobile, isTouch],
  );

  const getItemIcon = (item: (typeof items)[number], index: number, selectedIndex: number) => {
    // Use 'as const' so TS knows these are exact literal values, not generic strings
    const baseProps = {
      fontSize: "small" as const,
    };
    const activeProps = {
      ...baseProps,
      color: "primary" as const,
      sx: { color: selectedIndex === index ? "white" : "primary.main" },
    };
    switch (item.type) {
      case "recent":
        return <HistoryIcon {...baseProps} />;
      case "direct":
        return <SendIcon {...baseProps} />;
      case "local":
        return <ComputerIcon {...baseProps} />;
      case "tab":
        return <TabIcon {...activeProps} />;
      case "pinned_tab":
        return <PushPinIcon {...activeProps} />;
      case "button":
      case "other_button":
      case "builtin_button":
        return <SmartButtonIcon {...activeProps} />;
      default:
        if (item.isFav) {
          return <StarIcon {...activeProps} />;
        }
        return <DnsIcon {...baseProps} />;
    }
  };

  return (
    <Dialog
      id="new-tab-dialog"
      data-view={viewMode}
      open={open}
      onClose={onClose}
      disableRestoreFocus
      fullWidth
      maxWidth="sm"
      sx={{
        "& .MuiDialog-container": {
          alignItems: "flex-start",
        },
      }}
      slotProps={{
        paper: {
          sx: {
            mt: "10dvh",
            minHeight: "200px",
            maxHeight: "80dvh",
            borderRadius: 2,
          },
        },
      }}
    >
      <DialogTitle sx={{ p: 1.5, pb: 1 }}>
        <TextField
          autoFocus
          fullWidth
          variant="outlined"
          placeholder={
            viewMode === "servers"
              ? "Search for a server or type an address..."
              : viewMode === "tabs"
                ? "Search opened tabs..."
                : "Search buttons..."
          }
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDownCapture={handleKeyDown}
          inputRef={inputRef}
          size="small"
          autoComplete="off"
          type="search"
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => {
                      cycleViewMode("next");
                      inputRef.current?.focus();
                    }}
                    color={viewMode !== "servers" ? "primary" : "default"}
                    title={`Toggle View (Currently: ${viewMode}) (←, →) (or Alt+H / Alt+L)`}
                  >
                    {viewMode === "servers" ? <DnsIcon /> : viewMode === "tabs" ? <TabIcon /> : <SmartButtonIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
      </DialogTitle>
      <DialogContent sx={{ p: 0 }} dividers onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <List sx={{ pt: 0, pb: 0 }}>
          {sections.map((section) => (
            <React.Fragment key={section.title}>
              {section.title && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: "action.hover" }}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: "bold" }} color="text.secondary">
                    {section.title}
                  </Typography>
                </ListItem>
              )}
              {section.items.map((item) => (
                <ListItemButton
                  key={item.flatIndex}
                  selected={selectedIndex === item.flatIndex}
                  ref={selectedIndex === item.flatIndex ? selectedItemRef : null}
                  onClick={() => handleSelect(item)}
                  title={item.tooltip}
                  data-type={item.type}
                  data-value={item.value}
                  className="new-tab-dialog-item"
                  sx={{
                    py: 0.5,
                    "&.Mui-selected": {
                      bgcolor: "primary.main",
                      color: "white",
                      "& .MuiListItemIcon-root, & .MuiListItemText-secondary": {
                        color: "white",
                      },
                      "&:hover": {
                        bgcolor: "primary.dark",
                        color: "white",
                        "& .MuiListItemIcon-root, & .MuiListItemText-secondary": {
                          color: "white",
                        },
                      },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>{getItemIcon(item, item.flatIndex, selectedIndex)}</ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: item.isFav ? "bold" : "normal",
                            lineHeight: 1.2,
                            color: "inherit",
                          }}
                        >
                          {item.label}
                        </Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 0.25 }}>
                          {item.tags &&
                            item.tags
                              .filter((t) => t !== "fav")
                              .map((tag) => (
                                <Typography
                                  key={tag}
                                  variant="caption"
                                  sx={{
                                    color: "inherit",
                                    fontSize: "typography.caption.fontSize",
                                    fontWeight: 600,
                                    opacity: 0.8,
                                  }}
                                >
                                  #{tag}
                                </Typography>
                              ))}
                        </Box>
                      </Box>
                    }
                    secondary={
                      item.subtitle ? (
                        <Typography
                          variant="caption"
                          sx={{
                            color: "inherit",
                            opacity: 0.8,
                            display: "block",
                            mt: -0.2,
                          }}
                        >
                          {item.subtitle}
                        </Typography>
                      ) : undefined
                    }
                  />
                </ListItemButton>
              ))}
            </React.Fragment>
          ))}
          {items.length === 0 && (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">
                No matching {viewMode} found
              </Typography>
            </Box>
          )}
        </List>
      </DialogContent>
    </Dialog>
  );
}
