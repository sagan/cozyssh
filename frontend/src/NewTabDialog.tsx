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

import type { SessionPinned, ButtonData } from "./api";
import {
  BROWSER_STORAGE_KEY_TOKEN,
  BUILTIN_BUTTONS,
  DEFAULT_BUTTON_GROUP,
  HEADER_AUTHORIZATION,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  LOCAL_NAME,
} from "./constants";
import { type ViewMode, filterHosts, searchString } from "./common";
import { getStore, useStore } from "./store";

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
  const activeGroup = useStore((state) => state.activeGroup);
  const newTabDialogInitialViewMode = useStore((state) => state.newTabDialogInitialViewMode);

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
      return [];
    }
    const f = filter.trim();
    if (!f) {
      return hosts.filter((h) => h.is_favourite).sort((a, b) => a.name.localeCompare(b.name));
    }
    return filterHosts(hosts, f).sort((a, b) => {
      if (a.is_favourite && !b.is_favourite) {
        return -1;
      }
      if (!a.is_favourite && b.is_favourite) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [hosts, filter, viewMode]);

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

  const items = useMemo(() => {
    const res: {
      type:
        | "recent"
        | "host"
        | "direct"
        | "local"
        | "tab"
        | "pinned_tab"
        | "button"
        | "other_button"
        | "builtin_button";
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
    }[] = [];

    if (viewMode === "servers") {
      filteredRecents.forEach((r) => {
        const knownHost = hosts.find((h) => h.name === r.host);
        res.push({
          type: "recent",
          value: r.host,
          label: r.host,
          subtitle: knownHost ? `${knownHost.user || "root"}@${knownHost.hostname}` : undefined,
          tooltip: knownHost?.comment,
          tags: knownHost?.tags,
        });
      });

      if (LOCAL_NAME.includes(filter.toLowerCase())) {
        res.push({
          type: "local",
          value: LOCAL_NAME,
          label: "Local Shell",
          subtitle: "Run commands on this machine",
        });
      }

      filteredHosts.forEach((h) => {
        let subtitle = `${h.user || "root"}@${h.hostname}`;
        if (filter && h.comment) {
          const matchedComment = searchString(h.comment, filter);
          if (matchedComment) {
            subtitle += ` // ${matchedComment}`;
          }
        }
        res.push({
          type: "host",
          value: h.name,
          label: h.name,
          subtitle,
          tooltip: h.comment,
          isFav: h.is_favourite,
          tags: h.tags,
        });
      });

      if (directConnect) {
        res.push({
          type: "direct",
          value: directConnect,
          label: `Connect to ${directConnect} (SSH)`,
        });
      }
    } else if (viewMode === "tabs") {
      activeTabsList.forEach((t) => {
        res.push({
          type: "tab",
          id: t.id,
          value: t.id,
          label: t.title,
          subtitle:
            t.type === "scratchpad"
              ? "Scratchpad"
              : `Terminal (${t.panes.length} pane${t.panes.length > 1 ? "s" : ""})`,
        });
      });

      attachablePinnedTabs.forEach((p) => {
        res.push({
          type: "pinned_tab",
          id: p.id,
          value: p.id,
          host: p.host,
          label: p.title || p.host,
          subtitle: `Attach to pinned session`,
          isLocked: p.isLocked,
        });
      });
    } else if (viewMode === "buttons") {
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
        res.push({
          type: "button",
          id: b.id,
          value: b.id,
          label: b.name,
          subtitle,
          tooltip: b.type !== "run_script" ? b.payload : undefined,
          btn: b,
        });
      });
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
        res.push({
          type: "other_button",
          id: b.id,
          value: b.id,
          label: b.name,
          subtitle,
          tooltip: b.type !== "run_script" ? b.payload : undefined,
          btn: b,
        });
      });
      builtinButtons.forEach((b) => {
        res.push({
          type: "builtin_button",
          id: b.id,
          value: b.id,
          label: b.name,
          subtitle: `Built-in | Type: ${b.type} | Payload: ${b.payload}`,
          btn: b,
        });
      });
    }

    return res;
  }, [
    filteredRecents,
    filteredHosts,
    directConnect,
    hosts,
    filter,
    viewMode,
    activeTabsList,
    attachablePinnedTabs,
    activeGroupButtons,
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
      if (e.key === "ArrowDown" || (e.altKey && e.key === "j")) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === "ArrowUp" || (e.altKey && e.key === "k")) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if ((e.key === "ArrowLeft" && !filter) || (e.altKey && e.key === "h")) {
        e.stopPropagation();
        e.preventDefault();
        cycleViewMode("prev");
      } else if ((e.key === "ArrowRight" && !filter) || (e.altKey && e.key === "l")) {
        e.stopPropagation();
        e.preventDefault();
        cycleViewMode("next");
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items[selectedIndex]) {
          handleSelect(items[selectedIndex]);
        }
      } else if (e.key === "Escape") {
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
          onKeyDown={handleKeyDown}
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
          {items.map((item, index) => (
            <React.Fragment key={`${item.type}-${item.value}-${index}`}>
              {index === 0 && item.type === "recent" && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: "action.hover" }} title={item.tooltip}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: "bold" }} color="text.secondary">
                    Recent
                  </Typography>
                </ListItem>
              )}
              {((index === 0 && (item.type === "host" || item.type === "local")) ||
                (index > 0 &&
                  (item.type === "host" || item.type === "local") &&
                  items[index - 1].type === "recent")) && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: "action.hover" }} title={item.tooltip}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: "bold" }} color="text.secondary">
                    {filter === "" ? "Favorites" : "All Servers"}
                  </Typography>
                </ListItem>
              )}
              {item.type === "direct" && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: "action.hover" }} title={item.tooltip}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: "bold" }} color="text.secondary">
                    Direct Connection
                  </Typography>
                </ListItem>
              )}
              {index === 0 && item.type === "tab" && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: "action.hover" }} title={item.tooltip}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: "bold" }} color="text.secondary">
                    Current Browser Tabs
                  </Typography>
                </ListItem>
              )}
              {((index === 0 && item.type === "pinned_tab") ||
                (index > 0 && item.type === "pinned_tab" && items[index - 1].type === "tab")) && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: "action.hover" }} title={item.tooltip}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: "bold" }} color="text.secondary">
                    Attachable Pinned Tabs
                  </Typography>
                </ListItem>
              )}
              {index === 0 && item.type === "button" && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: "action.hover" }} title={item.tooltip}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: "bold" }} color="text.secondary">
                    Active Group ({activeGroup || DEFAULT_BUTTON_GROUP})
                  </Typography>
                </ListItem>
              )}
              {((index === 0 && item.type === "other_button") ||
                (index > 0 && item.type === "other_button" && items[index - 1].type === "button")) && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: "action.hover" }} title={item.tooltip}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: "bold" }} color="text.secondary">
                    Other Groups
                  </Typography>
                </ListItem>
              )}
              {((index === 0 && item.type === "builtin_button") ||
                (index > 0 &&
                  item.type === "builtin_button" &&
                  (items[index - 1].type === "button" || items[index - 1].type === "other_button"))) && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: "action.hover" }} title={item.tooltip}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: "bold" }} color="text.secondary">
                    Built-in Functions
                  </Typography>
                </ListItem>
              )}

              <ListItemButton
                selected={selectedIndex === index}
                ref={selectedIndex === index ? selectedItemRef : null}
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
                <ListItemIcon sx={{ minWidth: 36 }}>{getItemIcon(item, index, selectedIndex)}</ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: item.isFav ? "bold" : "normal",
                          lineHeight: 1.2,
                          color: "inherit",
                          wordBreak: "break-all",
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
                                  fontSize: "0.6rem",
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
