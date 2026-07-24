import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
  Menu,
  MenuItem,
} from "@mui/material";
import ComputerIcon from "@mui/icons-material/Computer";
import CloseIcon from "@mui/icons-material/Close";
import DnsIcon from "@mui/icons-material/Dns";
import HelpIcon from "@mui/icons-material/Help";
import HistoryIcon from "@mui/icons-material/History";
import SendIcon from "@mui/icons-material/Send";
import StarIcon from "@mui/icons-material/Star";
import TabIcon from "@mui/icons-material/Tab";
import ShortcutIcon from "@mui/icons-material/Shortcut";
import PushPinIcon from "@mui/icons-material/PushPin";
import LockIcon from "@mui/icons-material/Lock";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import LinkIcon from "@mui/icons-material/Link";
import TagIcon from "@mui/icons-material/Tag";
import SmartButtonIcon from "@mui/icons-material/SmartButton";

import { version as PACKAGE_JSON_VERSION } from "../package.json";
import type { Session, ButtonData, HostData } from "./api";
import {
  BUILTIN_BUTTONS,
  DEFAULT_BUTTON_GROUP,
  DEFAULT_SCROLL_ITEMS,
  LOCAL_NAME,
  VAR_CS_SCROLL_ITEMS,
  ID_NEW_TAB_DIALOG_INPUT,
  TAG_ORDER_PREFIX,
  TOAST_KEY_COPY_TUNNEL_ENTRYPOINT,
  LINK_COZYSSH_GITHUB,
  LINK_COZYSSH_DOC_SCRIPTS,
  LINK_COZYSSH_DOC_PLUGINS,
  ID_NEW_TAB_DIALOG_LIST,
  ID_NEW_TAB_DIALOG_CONTENT,
  RECENT_BUTTON_ID_PREFIX_CUSTOM_SHORTCUT,
} from "./constants";
import {
  assertUnreachable,
  cutString,
  filterArrayByText,
  filterHosts,
  forceReload,
  getKeyCombination,
  isModifier,
  isValidHostname,
  localShellHost,
  matchButton,
  parseHostName,
  searchStringAny,
  shortcutLabel,
} from "./common";
import {
  type NtdItem,
  changeNewTabDialogViewMode,
  deleteRecent,
  fetchActiveTunnels,
  notify,
  parseNewTabDialogFilter,
  removeRecentButtonId,
  setNewTabDialogFilter,
  updateRecentButtonId,
  useStore,
  getIntVar,
  fetchSessions,
  getHost,
  logout,
  logoutAll,
  type NtdItemAction,
  type NtdItemHost,
  type NtdItemTab,
  type NtdItemPinnedTab,
  type NtdItemButton,
  type NtdItemTunnel,
  type NtdItemTag,
  type NtdItemHelp,
  type NtdItemCustomShortcut,
} from "./store";
import TextFieldWithCopy from "./components/TextFieldWithCopy";
import ExtraMenu from "./components/ExtraMenu";

interface DialogSection {
  title: string;
  items: NtdItem[];
}

interface NewTabDialogProps {
  isMobile: boolean;
  isTouch: boolean;
  open: boolean;
  onClose: () => void;
  onSelect: (host: string, altMode?: AltMode) => void;
  onSelectTab: (tabId: string) => void;
  onAttachPinned: (session: Session, altMode?: AltMode) => void;
  onExecuteButton: (btn: Pick<ButtonData, "id" | "name" | "type" | "payload" | "liquidjs">, altMode?: AltMode) => void;
}

const modes = [
  { type: "servers", icon: <DnsIcon fontSize="small" />, label: "Servers", shortcut: "alt+o" },
  {
    type: "buttons",
    icon: <SmartButtonIcon fontSize="small" />,
    label: "Buttons",
    shortcut: "alt+e",
  },
  { type: "tabs", icon: <TabIcon fontSize="small" />, label: "Tabs", shortcut: "alt+a" },
  { type: "tags", icon: <TagIcon fontSize="small" />, label: "Tags", shortcut: "alt+p" },
  {
    type: "tunnels",
    icon: <ShortcutIcon fontSize="small" />,
    label: "Tunnels",
    shortcut: "alt+:",
  },
  { type: "help", icon: <HelpIcon fontSize="small" />, label: "Help", shortcut: "alt+?" },
] as const;

const helpOptions: NtdItemHelp[] = [
  {
    type: "help",
    value: "",
    label: "Servers / Connections",
    subtitle: "Connect to saved servers, local shells, or a direct SSH address",
    tag: "alt+o",
  },
  {
    type: "help",
    value: ">",
    label: "> Buttons (Commands)",
    subtitle: "Execute custom buttons, scripts, or built-in functions",
    tag: "alt+e / ctrl+shift+p",
  },
  {
    type: "help",
    value: "@",
    label: "@ Tabs",
    subtitle: "Switch to active browser tabs or attach pinned sessions",
    tag: "alt+a",
  },
  {
    type: "help",
    value: "#",
    label: "# Tag",
    tag: "alt+p",
    subtitle: "Filter servers by tag",
  },
  {
    type: "help",
    value: ":",
    label: ": Tunnels",
    tag: "alt+:",
    subtitle: "Display active SSH tunnels",
  },
  {
    type: "help",
    value: "?",
    label: "? Help",
    tag: "alt+?",
    subtitle: "Show help guide for command palette prefixes",
  },
] as const;

const helpLinks: NtdItem[] = [
  {
    type: "link",
    value: LINK_COZYSSH_DOC_SCRIPTS,
    label: "Scripts Docoment",
    subtitle: "CozySSH custom scripts guide",
  },
  {
    type: "link",
    value: LINK_COZYSSH_DOC_SCRIPTS,
    label: "Data Docoment",
    subtitle: "CozySSH data storage document",
  },
  {
    type: "link",
    value: LINK_COZYSSH_DOC_PLUGINS,
    label: "Plugin",
    subtitle: "CozySSH official plugins repository",
  },
  ...(__CS_ENV__ === 0
    ? ([
        {
          type: "action",
          label: "Logout",
          value: "logout",
          subtitle: "Logout of current device",
          action: () => logout(true),
        } as NtdItemAction,
        {
          type: "action",
          label: "Logout All",
          value: "logout_all",
          subtitle: "Logout of all devices",
          action: () => logoutAll(true),
        } as NtdItemAction,
      ] as const)
    : []),
  {
    type: "action",
    action: forceReload,
    value: "force_reload",
    label: "Force Reload",
    subtitle: "Unregister the Service Worker, clear all caches and reload",
    tag: "ctrl+alt+shift+r",
  } as NtdItemAction,
] as const;

/*
 * Return the label of a open action of a item.
 * It return empty string if the item doesn't support the corresponding alternativeMode.
 * All items support altMode = 0.
 */
function itemLabel(item: NtdItem, altMode: AltMode): string {
  switch (item.type) {
    case "recent":
    case "host":
    case "direct":
    case "local":
      switch (altMode) {
        case 0:
          return "Open";
        case 1:
          return "Open In Current Tab";
        case 2:
          return "Edit";
        case 3:
          return "Open In New Window";
      }
      break;
    case "builtin_button":
    case "other_button":
    case "button":
      switch (altMode) {
        case 0:
          return "Execute";
        case 1:
          if (item.btn.type === "send_string") {
            return "Copy";
          }
          return "";
        case 2:
          return "Edit";
        case 3:
          if (item.btn.type === "send_string") {
            return "Send"; // open Terminal Input dialog to send
          }
          return "";
      }
      break;
    case "pinned_tab":
      return altMode === 0 ? "Attach" : "";
    case "tab":
      return altMode === 0 ? "Switch To" : "";
    case "tunnel":
      return altMode === 0 ? "Copy Entrypoint" : "";
    case "action":
    case "custom_shortcut":
      return altMode === 0 ? "Execute" : "";
  }
  return altMode === 0 ? "Open" : "";
}

function itemIcon(item: NtdItem, selectedIndex: number) {
  // Use 'as const' so TS knows these are exact literal values, not generic strings
  const baseProps = {
    fontSize: "small" as const,
  };
  const activeProps = {
    ...baseProps,
    color: "primary" as const,
    sx: { color: selectedIndex === item.flatIndex ? "white" : "primary.main" },
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
      return item.session.isHidden ? (
        <VisibilityOffIcon {...activeProps} />
      ) : item.session.isLocked ? (
        <LockIcon {...activeProps} />
      ) : (
        <PushPinIcon {...activeProps} />
      );
    case "button":
    case "other_button":
    case "builtin_button":
    case "custom_shortcut":
      return <SmartButtonIcon {...activeProps} />;
    case "tunnel":
      return <ShortcutIcon {...activeProps} />;
    case "link":
      return <LinkIcon {...activeProps} />;
    case "help":
      if (item.value === ">") {
        return <SmartButtonIcon {...activeProps} />;
      } else if (item.value === "@") {
        return <TabIcon {...activeProps} />;
      } else if (item.value === "?") {
        return <HelpIcon {...activeProps} />;
      } else if (item.value === "#") {
        return <TagIcon {...activeProps} />;
      } else {
        return <DnsIcon {...baseProps} />;
      }
    case "host":
      if (item.isFav) {
        return <StarIcon {...activeProps} />;
      }
      return <DnsIcon {...baseProps} />;
      break;
    case "action":
    case "tag":
      return <DnsIcon {...baseProps} />;
    default:
      assertUnreachable(item);
  }
}

export default function NewTabDialog({
  isMobile,
  isTouch,
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
  const recentButtonIds = useStore((state) => state.recentButtonIds);
  const newTabDialogFilter = useStore((state) => state.newTabDialogFilter);
  const activeTunnels = useStore((state) => state.activeTunnels);
  const recents = useStore((state) => state.recents);
  const appVersion = useStore((state) => state.sysinfo.version);
  const extraNtdMenu = useStore((state) => state.extraNtdMenu);

  const defaultShell = shells[0];
  const alternativeShell = shells[1];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const [localPinned, setLocalPinned] = useState<Session[]>([]);

  const [contextMenuOpen, setContextMenuOpen] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; item: NtdItem } | null>(null);

  const aboutLink: NtdItem = useMemo(() => {
    return {
      type: "link",
      value: LINK_COZYSSH_GITHUB,
      label: "About (GitHub)",
      subtitle: `CozySSH ${PACKAGE_JSON_VERSION} (Backend: ${appVersion})`,
      tag: PACKAGE_JSON_VERSION,
    };
  }, [appVersion]);

  const uniqueTags: { tag: string; count: number }[] = useMemo(() => {
    const set = new Map<string, number>();
    hosts.forEach((h) => {
      h.tags?.filter((t) => !t.startsWith(TAG_ORDER_PREFIX)).forEach((t) => set.set(t, (set.get(t) || 0) + 1));
    });
    return Array.from(set.entries())
      .map(([t, count]) => ({ tag: t, count }))
      .sort();
  }, [hosts]);

  const [viewMode, f] = useMemo(() => {
    // eslint-disable-next-line prefer-const
    let [viewMode, f] = parseNewTabDialogFilter(newTabDialogFilter);
    f = f.trim();
    const [before, after, found] = cutString(f, "?");
    if (found) {
      return [viewMode, before.toLowerCase() + "?" + after];
    }
    return [viewMode, f.toLowerCase()];
  }, [newTabDialogFilter]);

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }
    const value = inputRef.current.value;
    if (value && !value.startsWith("#")) {
      if (viewMode === "servers") {
        inputRef.current.select();
      } else {
        inputRef.current.setSelectionRange(1, value.length);
      }
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode === "tunnels") {
      fetchActiveTunnels();
      const interval = setInterval(fetchActiveTunnels, 3000);
      return () => clearInterval(interval);
    }
  }, [viewMode]);

  useEffect(() => {
    if (open) {
      fetchSessions(true)
        .then((data) => setLocalPinned(data))
        .catch((e) => console.error(e));
    }
  }, [open]);

  const filteredActiveTunnels = useMemo(() => {
    if (viewMode !== "tunnels") {
      return [];
    }
    return activeTunnels.filter(
      (t) =>
        t.bindAddr.toLowerCase().includes(f) ||
        t.bindPort.toLowerCase().includes(f) ||
        (t.remoteHost || "").toLowerCase().includes(f) ||
        (t.remotePort || "").toLowerCase().includes(f) ||
        t.hostName.toLowerCase().includes(f),
    );
  }, [activeTunnels, f, viewMode]);

  const [filteredRecents, filteredOlderRecents] = useMemo(() => {
    if (viewMode !== "servers") {
      return [[], []];
    }
    const matchedRecents = recents
      .filter((r) => r.host.toLowerCase().includes(f))
      .sort((a, b) => b.last_used - a.last_used);

    if (f) {
      return [matchedRecents.slice(0, 5), []];
    }
    return [matchedRecents.slice(0, 5), matchedRecents.slice(5)];
  }, [f, viewMode, recents]);

  const filteredHosts = useMemo(() => {
    if (viewMode !== "servers") {
      return { favourite: [], normal: [], auto: [] };
    }
    const filtered = filterHosts(hosts, f);

    const favs = filtered.filter((h) => h.isFavourite);
    const normals = filtered.filter((h) => !h.isFavourite && !h.isAuto);
    const autos = filtered.filter((h) => !h.isFavourite && h.isAuto);

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
  }, [hosts, f, viewMode]);

  const filteredTags = useMemo(() => {
    if (viewMode !== "tags") {
      return [];
    }
    if (!f) {
      return uniqueTags;
    }
    return uniqueTags.filter((t) => t.tag.toLowerCase().includes(f));
  }, [uniqueTags, f, viewMode]);

  const filteredShells = useMemo(() => {
    if (viewMode !== "servers") {
      return [];
    }
    if (!f) {
      return shells;
    }
    return shells.filter((s) => s.name.toLowerCase().includes(f));
  }, [shells, f, viewMode]);

  const directConnect = useMemo(() => {
    if (viewMode !== "servers") {
      return null;
    }
    const [host, , found] = cutString(f, "?");
    // If has query parames, always allow direct connect
    if (isValidHostname(parseHostName(host).hostname, found)) {
      return f;
    }
    return null;
  }, [f, viewMode]);

  const attachablePinnedTabs = useMemo(() => {
    if (viewMode !== "tabs") {
      return [];
    }
    return localPinned.filter(
      (p) =>
        !tabs.some((t) => t.panes.some((pane) => (pane.sessionId || pane.id) === p.id && pane.state !== "stolen")) &&
        (p.title?.toLowerCase().includes(f) || p.host?.toLowerCase().includes(f)),
    );
  }, [localPinned, tabs, f, viewMode]);

  const allFilteredButtons = useMemo(() => {
    if (viewMode !== "buttons") {
      return { matchedUser: [], matchedBuiltin: [] };
    }
    const matchedUser = filterArrayByText(buttons, f, matchButton);
    const matchedBuiltin = filterArrayByText(BUILTIN_BUTTONS, f, matchButton);
    return { matchedUser, matchedBuiltin };
  }, [buttons, f, viewMode]);

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

  const filteredShortcuts: NtdItemCustomShortcut[] = useMemo(() => {
    if (viewMode !== "buttons") {
      return [];
    }
    const shortcuts: NtdItemCustomShortcut[] = [];
    for (const shortcut of Object.values(__CS_CUSTOM_SHORTCUTS__)) {
      if (f && !shortcut.name?.toLowerCase().includes(f) && !shortcut.shortcut.includes(f)) {
        continue;
      }
      shortcuts.push({
        type: "custom_shortcut",
        value: "",
        label: shortcut.name || shortcut.shortcut,
        tag: shortcut.shortcut,
        subtitle: `Custom Shortcut | ${shortcut.name || shortcut.shortcut}`,
        shortcut,
      });
    }
    return shortcuts;
  }, [viewMode, f]);

  const recentButtons: readonly (NtdItemButton | NtdItemCustomShortcut)[] = useMemo(() => {
    if (viewMode !== "buttons") {
      return [];
    }
    const list: (NtdItemButton | NtdItemCustomShortcut)[] = [];
    for (const id of recentButtonIds) {
      if (id.startsWith(RECENT_BUTTON_ID_PREFIX_CUSTOM_SHORTCUT)) {
        const kc = id.substring(RECENT_BUTTON_ID_PREFIX_CUSTOM_SHORTCUT.length);
        const shortcut = __CS_CUSTOM_SHORTCUTS__[kc];
        if (shortcut) {
          list.push({
            type: "custom_shortcut",
            shortcut,
            label: shortcut.name || shortcut.shortcut,
            tag: shortcut.shortcut,
            subtitle: `Custom Shortcut | ${shortcut.name || shortcut.shortcut}`,
            value: id,
            isDeletable: true,
          });
        }
      } else {
        const btn = buttons.find((b) => b.id === id);
        if (btn) {
          list.push({
            type: "button",
            value: id,
            label: btn.name,
            subtitle: `Group: ${btn.group || DEFAULT_BUTTON_GROUP} | Type: ${btn.type}${
              btn.type !== "send_string" && btn.type !== "run_script" ? " | Payload: " + btn.payload : ""
            }`,
            tooltip: btn.type !== "run_script" ? btn.payload : undefined,
            btn: btn,
            tag:
              !btn.shortcut_scope || (btn.group || DEFAULT_BUTTON_GROUP) === activeGroup
                ? shortcutLabel(btn.shortcut)
                : undefined,
            isDeletable: true,
          });
        } else {
          const btn = BUILTIN_BUTTONS.find((b) => b.id === id);
          if (btn) {
            list.push({
              type: "builtin_button",
              value: id,
              label: btn.name,
              subtitle: `Built-in Button | Type: ${btn.type}`,
              tooltip: undefined,
              btn: btn,
              tag: btn.shortcut ? shortcutLabel(btn.shortcut) : undefined,
              isDeletable: true,
            });
          }
        }
      }
    }
    if (!f) {
      return list;
    }
    return filterArrayByText(
      list,
      f,
      function (item: NtdItemButton | NtdItemCustomShortcut, searchText: string): boolean {
        if (item.type === "custom_shortcut") {
          return (
            item.shortcut.name?.toLowerCase().includes(searchText.toLowerCase()) ||
            item.shortcut.shortcut.includes(searchText.toLowerCase())
          );
        } else {
          return matchButton(item.btn, searchText);
        }
      },
    );
  }, [viewMode, f, recentButtonIds, buttons, activeGroup]);

  const { sections, items } = useMemo(() => {
    const sections: DialogSection[] = [];
    const items: NtdItem[] = [];
    let flatIndex = 0;

    const addSection = (title: string, rawItems: readonly NtdItem[]) => {
      if (rawItems.length === 0) {
        return;
      }
      const sectionItems = rawItems.map((item) => {
        const dialogItem = { ...item, flatIndex: flatIndex++ };
        items.push(dialogItem);
        return dialogItem;
      });
      sections.push({ title, items: sectionItems });
    };

    if (viewMode === "servers") {
      // Recents
      const recentList: NtdItemHost[] = [];
      filteredRecents.forEach((r) => {
        const knownHost = getHost(r.host);
        recentList.push({
          type: "recent",
          value: r.host,
          label: r.host,
          subtitle: knownHost ? `${knownHost.user || "root"}@${knownHost.hostname}` : undefined,
          tooltip: knownHost?.comment,
          tag: knownHost?.tags
            ?.filter((t) => !t.startsWith(TAG_ORDER_PREFIX))
            .map((t) => "#" + t)
            .join(" "),
          isDeletable: true,
        });
      });
      addSection("Recents", recentList);

      // Local shells
      const localList: NtdItemHost[] = [];
      filteredShells.forEach((shell) => {
        localList.push({
          type: "local",
          value: shell !== defaultShell ? localShellHost(shell) : LOCAL_NAME,
          label:
            shell.name + (shell === defaultShell ? " (Default)" : shell === alternativeShell ? " (Alternative)" : ""),
          subtitle: `Local Shell - ` + shell.path,
          tag: shell === defaultShell ? "alt+n" : shell === alternativeShell ? "alt+shift+n" : "",
        });
      });
      addSection("Local Shells", localList);

      // Older recents
      const olderRecentList: NtdItemHost[] = [];
      filteredOlderRecents.forEach((r) => {
        const knownHost = getHost(r.host);
        olderRecentList.push({
          type: "recent",
          value: r.host,
          label: r.host,
          subtitle: knownHost ? `${knownHost.user || "root"}@${knownHost.hostname}` : undefined,
          tooltip: knownHost?.comment,
          tag: knownHost?.tags
            ?.filter((t) => !t.startsWith(TAG_ORDER_PREFIX))
            .map((t) => "#" + t)
            .join(" "),
          isDeletable: true,
        });
      });
      addSection("Older Recents", olderRecentList);

      // Favourite servers
      const favList: NtdItemHost[] = [];
      filteredHosts.favourite.forEach((h) => {
        let subtitle = `${h.user || "root"}@${h.hostname}`;
        if (f && h.comment) {
          const matchedComment = searchStringAny(h.comment, f);
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
          isFav: h.isFavourite,
          tag: h.tags
            ?.filter((t) => !t.startsWith(TAG_ORDER_PREFIX))
            .map((t) => "#" + t)
            .join(" "),
        });
      });
      addSection("Favourite Servers", favList);

      // 4. Normal servers
      const normalList: NtdItemHost[] = [];
      filteredHosts.normal.forEach((h) => {
        let subtitle = `${h.user || "root"}@${h.hostname}`;
        if (f && h.comment) {
          const matchedComment = searchStringAny(h.comment, f);
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
          isFav: h.isFavourite,
          tag: h.tags
            ?.filter((t) => !t.startsWith(TAG_ORDER_PREFIX))
            .map((t) => "#" + t)
            .join(" "),
        });
      });
      addSection("Normal Servers", normalList);

      // 5. Auto servers
      const autoList: NtdItemHost[] = [];
      filteredHosts.auto.forEach((h) => {
        let subtitle = `${h.user || "root"}@${h.hostname}`;
        if (f && h.comment) {
          const matchedComment = searchStringAny(h.comment, f);
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
          isFav: h.isFavourite,
          tag: h.tags
            ?.filter((t) => !t.startsWith(TAG_ORDER_PREFIX))
            .map((t) => "#" + t)
            .join(" "),
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
      const activeTabsItems: NtdItemTab[] = [];
      tabs.forEach((tab, idx) => {
        if (
          !f ||
          tab.title.toLowerCase().includes(f) ||
          (tab.type === "terminal" && tab.panes.some((p) => p.host.toLowerCase().includes(f)))
        ) {
          activeTabsItems.push({
            type: "tab",
            tab: tab,
            value: tab.id,
            label: tab.title,
            subtitle: tab.type === "scratchpad" ? "Scratchpad" : `Terminal: ${tab.panes.map((p) => p.host).join(", ")}`,
            tag: idx < 9 ? `alt+${idx + 1}` : idx === tabs.length - 1 ? "alt+0" : "",
          });
        }
      });
      addSection("Current Browser Tabs", activeTabsItems);

      const pinnedTabsItems: NtdItemPinnedTab[] = attachablePinnedTabs.map((p) => ({
        type: "pinned_tab",
        value: p.id,
        label: p.title || p.host,
        subtitle: "Terminal: " + p.host,
        session: p,
      }));
      addSection("Attachable Pinned Tabs", pinnedTabsItems);
    } else if (viewMode === "buttons") {
      addSection("Recently used", recentButtons);

      const activeGroupList: NtdItemButton[] = [];
      activeGroupButtons.forEach((b, idx) => {
        let subtitle = `Group: ${b.group || DEFAULT_BUTTON_GROUP} | Type: ${b.type}${
          b.type !== "send_string" && b.type !== "run_script" ? " | Payload: " + b.payload : ""
        }`;
        if (f && b.type === "send_string" && b.payload) {
          const matchedPayload = searchStringAny(b.payload, f);
          if (matchedPayload) {
            subtitle += ` // ${matchedPayload}`;
          }
        }
        activeGroupList.push({
          type: "button",
          value: b.id,
          label: b.name,
          subtitle,
          tooltip: b.type !== "run_script" ? b.payload : undefined,
          btn: b,
          tag:
            shortcutLabel(b.shortcut) +
            (idx < 10
              ? (b.shortcut ? " " : "") +
                (idx < 9 ? shortcutLabel(`alt+shift+${idx + 1}`) : shortcutLabel("alt+shift+0"))
              : ""),
        });
      });
      addSection(`Active Group (${activeGroup || DEFAULT_BUTTON_GROUP})`, activeGroupList);

      const otherGroupList: NtdItemButton[] = [];
      otherGroupButtons.forEach((b) => {
        let subtitle = `Group: ${b.group || DEFAULT_BUTTON_GROUP} | Type: ${b.type}${
          b.type !== "send_string" && b.type !== "run_script" ? " | Payload: " + b.payload : ""
        }`;
        if (f && b.type === "send_string" && b.payload) {
          const matchedPayload = searchStringAny(b.payload, f);
          if (matchedPayload) {
            subtitle += ` // ${matchedPayload}`;
          }
        }
        otherGroupList.push({
          type: "other_button",
          value: b.id,
          label: b.name,
          subtitle,
          tooltip: b.type !== "run_script" ? b.payload : undefined,
          btn: b,
          tag: !b.shortcut_scope ? shortcutLabel(b.shortcut) : undefined,
        });
      });
      addSection("Other Groups", otherGroupList);

      addSection("Custom Shortcuts", filteredShortcuts);

      const builtinList: NtdItemButton[] = builtinButtons.map((b) => ({
        type: "builtin_button",
        value: b.id,
        label: b.name,
        subtitle: `Built-in | Type: ${b.type} | Payload: ${b.payload}`,
        btn: b,
        tag: b.shortcut ? shortcutLabel(b.shortcut) : undefined,
      }));
      addSection("Built-in Functions", builtinList);
    } else if (viewMode === "tunnels") {
      const tunnelItems: NtdItemTunnel[] = filteredActiveTunnels.map((t) => ({
        type: "tunnel",
        value:
          t.type === "dynamic"
            ? `${t.bindAddr || "127.0.0.1"}:${t.bindPort}`
            : t.type === "local"
              ? `${t.bindAddr || "127.0.0.1"}:${t.bindPort}`
              : `${t.remoteHost || "127.0.0.1"}:${t.remotePort}`,
        label:
          t.type === "dynamic"
            ? `SOCKS5 proxy ${t.bindAddr}:${t.bindPort} (via ${t.hostName})`
            : t.type === "local"
              ? `local ${t.bindAddr}:${t.bindPort} -> ${t.remoteHost}:${t.remotePort}`
              : `remote ${t.remoteHost}:${t.remotePort} -> ${t.bindAddr}:${t.bindPort}`,
        subtitle: `Type: ${t.type === "dynamic" ? "SOCKS5" : t.type} | Server: ${t.hostName}`,
      }));
      addSection("Active SSH Tunnels", tunnelItems);
    } else if (viewMode === "tags") {
      const tagItems: NtdItemTag[] = filteredTags.map((t) => ({
        type: "tag",
        value: t.tag,
        label: "#" + t.tag,
        subtitle: `${t.count} servers`,
      }));
      addSection("Tags", tagItems);
    } else if (viewMode === "help") {
      const filteredHelp = helpOptions.filter(
        (o) => o.label.toLowerCase().includes(f) || o.subtitle?.toLowerCase().includes(f) || o.value.includes(f),
      );
      addSection("Command Palette Prefix Guide", filteredHelp);
      addSection("Help", [aboutLink, ...helpLinks]);
    }

    return { sections, items };
  }, [
    viewMode,
    filteredRecents,
    filteredShells,
    filteredOlderRecents,
    filteredHosts.favourite,
    filteredHosts.normal,
    filteredHosts.auto,
    directConnect,
    defaultShell,
    alternativeShell,
    f,
    tabs,
    attachablePinnedTabs,
    recentButtons,
    activeGroupButtons,
    activeGroup,
    otherGroupButtons,
    filteredShortcuts,
    builtinButtons,
    filteredActiveTunnels,
    filteredTags,
    aboutLink,
  ]);

  useEffect(() => {
    if (selectedIndex === 0) {
      const el = document.getElementById(ID_NEW_TAB_DIALOG_CONTENT);
      if (el) {
        el.scrollTop = 0;
        return;
      }
    }
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: "auto",
        block: "nearest",
      });
    }
  }, [selectedIndex]);

  const handleDeleteItem = useCallback((item: (typeof items)[number]) => {
    if (!item.isDeletable) {
      return;
    }
    if (item.type === "recent") {
      deleteRecent(item.value);
    } else if (["button", "other_button", "builtin_button", "custom_shortcut"].includes(item.type) && item.value) {
      removeRecentButtonId(item.value);
    }
    // Keep the dialog open; adjust selection if needed
    setSelectedIndex((prev) => Math.max(0, prev - 1));
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, []);

  const handleSelect = useCallback(
    (item: (typeof items)[number], altMode: AltMode = 0) => {
      switch (item.type) {
        case "tab":
          onSelectTab(item.tab.id);
          onClose();
          break;
        case "pinned_tab":
          onAttachPinned(item.session, altMode);
          onClose();
          break;
        case "button":
        case "other_button":
        case "builtin_button":
          if (item.btn.id && altMode === 0) {
            updateRecentButtonId(item.btn.id);
          }
          onExecuteButton(item.btn, altMode);
          onClose();
          break;
        case "tag":
          setNewTabDialogFilter("#" + item.value + " ");
          setSelectedIndex(0);
          setTimeout(() => {
            inputRef.current?.focus();
          }, 0);
          break;
        case "help":
          setNewTabDialogFilter(item.value);
          setSelectedIndex(0);
          setTimeout(() => {
            inputRef.current?.focus();
          }, 0);
          break;
        case "tunnel":
          navigator.clipboard
            .writeText(item.value)
            .then(() =>
              notify(`Tunnel entrypoint "${item.value}" copied to clipboard`, "info", TOAST_KEY_COPY_TUNNEL_ENTRYPOINT),
            )
            .catch(() => {});
          onClose();
          break;
        case "link":
          window.open(item.value);
          onClose();
          break;
        case "action":
          item.action();
          onClose();
          break;
        case "host":
        case "recent":
        case "local":
        case "direct":
          onSelect(item.value, altMode);
          onClose();
          break;
        case "custom_shortcut":
          updateRecentButtonId(RECENT_BUTTON_ID_PREFIX_CUSTOM_SHORTCUT + item.shortcut.shortcut);
          item.shortcut.action(item.shortcut);
          onClose();
          break;
        default:
          assertUnreachable(item);
      }
    },
    [onAttachPinned, onClose, onExecuteButton, onSelect, onSelectTab],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const keycb = getKeyCombination(e);
      if (
        keycb === "arrowdown" ||
        keycb === "alt+arrowdown" ||
        keycb === "shift+arrowdown" ||
        keycb === "ctrl+arrowdown" ||
        keycb === "tab" ||
        keycb === "alt+j" ||
        keycb === "ctrl+alt+j" ||
        keycb === "alt+shift+j"
      ) {
        const step = isModifier(e, "ctrl")
          ? items.length
          : (keycb.endsWith("+j") ? e.shiftKey : isModifier(e, "alt"))
            ? getIntVar(VAR_CS_SCROLL_ITEMS, DEFAULT_SCROLL_ITEMS)
            : 1;
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.min(prev + step, items.length - 1));
      } else if (
        keycb === "arrowup" ||
        keycb === "alt+arrowup" ||
        keycb === "shift+arrowup" ||
        keycb === "ctrl+arrowup" ||
        keycb === "alt+k" ||
        keycb === "ctrl+alt+k" ||
        keycb === "alt+shift+k"
      ) {
        const step = isModifier(e, "ctrl")
          ? items.length
          : (keycb.endsWith("+k") ? e.shiftKey : isModifier(e, "alt"))
            ? getIntVar(VAR_CS_SCROLL_ITEMS, DEFAULT_SCROLL_ITEMS)
            : 1;
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.max(prev - step, 0));
      } else if ((keycb === "arrowleft" && !f) || keycb === "alt+h") {
        e.stopPropagation();
        e.preventDefault();
        changeNewTabDialogViewMode(true);
      } else if ((keycb === "arrowright" && !f) || keycb === "alt+l") {
        e.stopPropagation();
        e.preventDefault();
        changeNewTabDialogViewMode();
      } else if (keycb === "enter" || keycb === "ctrl+enter" || keycb === "shift+enter" || keycb === "alt+enter") {
        e.preventDefault();
        e.stopPropagation();
        if (items[selectedIndex]) {
          handleSelect(items[selectedIndex], isModifier(e, "ctrl") ? 3 : e.shiftKey ? 2 : isModifier(e, "alt") ? 1 : 0);
        }
      } else if (keycb === "delete" || keycb === "alt+d") {
        // Remove from recents only when:
        //   - the selected item is deletable AND
        //   - the cursor is at end-of-input (or input is empty) so normal Delete editing still works
        const input = inputRef.current;
        const atEndOrEmpty = !input || input.value === "" || input.selectionStart === input.value.length;
        const item = items[selectedIndex];
        if (atEndOrEmpty && item?.isDeletable) {
          e.preventDefault();
          e.stopPropagation();
          handleDeleteItem(item);
        }
      } else if (keycb === "escape") {
        onClose();
      }
    },
    [f, handleDeleteItem, handleSelect, items, onClose, selectedIndex],
  );

  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if (isModifier(e, "alt") && (e.key === "o" || e.key === "a" || e.key === "e")) {
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
          changeNewTabDialogViewMode(true);
        } else {
          changeNewTabDialogViewMode();
        }
      }
    },
    [isMobile, isTouch],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const item = items[parseInt((e.currentTarget as HTMLElement).dataset.index!)];
      if (!item) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, item });
      setContextMenuOpen(true);
    },
    [items],
  );

  const itemMenus = useMemo(() => {
    if (!contextMenu) {
      return null;
    }
    const item = contextMenu.item;
    const elements: React.ReactNode[] = [];
    const altModes: AltMode[] = ["recent", "host", "direct", "local"].includes(item.type) ? [0, 1, 3, 2] : [0, 1, 2, 3];
    for (const altMode of altModes) {
      const label = itemLabel(item, altMode);
      if (!label) {
        continue;
      }
      elements.push(
        <MenuItem
          id={`ntdm-open-${altMode}`}
          data-type={item.type}
          data-value={item.value}
          className={item.className}
          onClick={() => {
            setContextMenuOpen(false);
            handleSelect(item, altMode);
          }}
        >
          {label}
          {altMode === 0 ? ` (${item.label})` : ""}
          &nbsp;({altMode === 0 ? "enter" : altMode === 1 ? "alt+enter" : altMode === 2 ? "shift+enter" : "ctrl+enter"})
        </MenuItem>,
      );
    }
    return <>{elements}</>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu?.item, handleSelect]);

  return (
    <Dialog
      id="new-tab-dialog"
      data-view={viewMode}
      open={open}
      onClose={onClose}
      disableRestoreFocus
      fullWidth
      maxWidth="md"
      sx={{
        "& .MuiDialog-container": {
          alignItems: "flex-start",
        },
      }}
      slotProps={{
        paper: {
          sx: {
            mt: "5dvh",
            minHeight: "200px",
            maxHeight: "85dvh",
            borderRadius: 2,
          },
        },
      }}
    >
      <DialogTitle sx={{ p: 1.5, pb: 1 }}>
        {/* View mode selector row */}
        <Box
          sx={{
            display: "flex",
            gap: 0.5,
            mb: 1,
            overflowX: "auto",
            "&::-webkit-scrollbar": { display: "none" },
            scrollbarWidth: "none",
          }}
        >
          {modes.map(({ type, icon, label, shortcut }) => (
            <Box
              key={type}
              onClick={() => {
                changeNewTabDialogViewMode(type);
                inputRef.current?.focus();
              }}
              title={`${label} (${shortcut})`}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.25,
                px: 1,
                py: 0.5,
                cursor: "pointer",
                borderRadius: 1,
                flex: "1 0 auto",
                color: viewMode === type ? "primary.main" : "text.secondary",
                bgcolor: viewMode === type ? "action.selected" : "transparent",
                borderBottom: viewMode === type ? 2 : 2,
                borderColor: viewMode === type ? "primary.main" : "transparent",
                transition: "all 0.15s ease",
                "&:hover": {
                  bgcolor: "action.hover",
                  color: viewMode === type ? "primary.main" : "text.primary",
                },
              }}
            >
              {icon}
              <Typography
                variant="caption"
                sx={{
                  fontSize: "typography.caption.fontSize",
                  lineHeight: 1,
                  fontWeight: 400,
                  userSelect: "none",
                }}
              >
                {label}
              </Typography>
            </Box>
          ))}
        </Box>
        <TextFieldWithCopy
          id={ID_NEW_TAB_DIALOG_INPUT}
          autoFocus
          fullWidth
          variant="outlined"
          placeholder="Search server. ? for help. Hold Alt/Ctrl to open in current tab / new window"
          value={newTabDialogFilter}
          onChange={(e) => {
            setNewTabDialogFilter(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDownCapture={handleKeyDown}
          inputRef={inputRef}
          size="small"
          autoComplete="off"
          type="search"
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
        />
      </DialogTitle>
      <DialogContent
        sx={{ p: 0 }}
        id={ID_NEW_TAB_DIALOG_CONTENT}
        dividers
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <List sx={{ pt: 0, pb: 0 }} id={ID_NEW_TAB_DIALOG_LIST}>
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
                  onContextMenu={handleContextMenu}
                  selected={selectedIndex === item.flatIndex}
                  ref={selectedIndex === item.flatIndex ? selectedItemRef : null}
                  onClick={(e) =>
                    handleSelect(item, isModifier(e, "ctrl") ? 3 : e.shiftKey ? 2 : isModifier(e, "alt") ? 1 : 0)
                  }
                  title={item.tooltip}
                  data-type={item.type}
                  data-label={item.label}
                  data-value={item.value}
                  data-index={item.flatIndex}
                  className={`new-tab-dialog-item ${item.className ?? ""}`}
                  sx={{
                    py: 0.5,
                    // Show the delete button when this row is selected or hovered
                    "& .ntd-delete-btn": { opacity: 0 },
                    "&.Mui-selected .ntd-delete-btn, &:hover .ntd-delete-btn": { opacity: 1 },
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
                  <ListItemIcon sx={{ minWidth: 36 }}>{itemIcon(item, selectedIndex)}</ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: "isFav" in item && item.isFav ? "bold" : "normal",
                            lineHeight: 1.2,
                            color: "inherit",
                          }}
                        >
                          {item.label}
                        </Typography>
                        {item.tag && (
                          <Typography
                            variant="body2"
                            sx={{
                              color: "inherit",
                              lineHeight: 1.2,
                              fontSize: "typography.caption.fontSize",
                              fontWeight: 600,
                              opacity: 0.8,
                            }}
                          >
                            {item.tag}
                          </Typography>
                        )}
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
                  {item.isDeletable && (
                    <Box
                      component="span"
                      className="ntd-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(item);
                      }}
                      title="Remove from recents (delete / alt+d)"
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        ml: 0.5,
                        p: 0.5,
                        borderRadius: 1,
                        cursor: "pointer",
                        flexShrink: 0,
                        transition: "opacity 0.1s ease",
                        "&:hover": {
                          bgcolor: "rgba(255,255,255,0.15)",
                        },
                      }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </Box>
                  )}
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
        <Menu
          id="ntdm"
          open={contextMenuOpen}
          onClose={() => {
            setContextMenuOpen(false);
          }}
          anchorReference="anchorPosition"
          anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
        >
          {!!contextMenu && (
            <>
              {itemMenus}
              <ExtraMenu
                extraMenu={extraNtdMenu}
                target={contextMenu.item}
                before={() => {
                  setContextMenuOpen(false);
                }}
                after={onClose}
              />
              {contextMenu.item.isDeletable && (
                <MenuItem
                  id="ntdm-delete"
                  data-type={contextMenu.item.type}
                  data-value={contextMenu.item.value}
                  className={contextMenu.item.className}
                  onClick={() => {
                    setContextMenuOpen(false);
                    handleDeleteItem(contextMenu.item);
                  }}
                >
                  Delete (alt+d)
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      </DialogContent>
    </Dialog>
  );
}
