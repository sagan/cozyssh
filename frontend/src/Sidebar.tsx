import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "react-router";
import {
  Autocomplete,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Drawer,
  Toolbar,
  Typography,
  Box,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  ButtonGroup,
  useTheme,
  Tabs,
  Tab,
  Chip,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Tooltip,
  Collapse,
  FormControlLabel,
  Checkbox,
  InputAdornment,
} from "@mui/material";
import ComputerIcon from "@mui/icons-material/Computer";
import DnsIcon from "@mui/icons-material/Dns";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AddIcon from "@mui/icons-material/Add";
import StarIcon from "@mui/icons-material/Star";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FolderIcon from "@mui/icons-material/Folder";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import { version as PACKAGE_JSON_VERSION } from "../package.json";
import type {
  HostData,
  PasswordUpdateRequest,
  SessionPinned,
  CopyIDRequest,
  CopyIDResponse,
  PasswordsResponse,
  PasswordsUnlockRequest,
  PasswordsRevealRequest,
  PasswordsRevealResponse,
  PasswordsChangeRequest,
  PasswordsDeleteRequest,
  SaveWebdavSettingsRequest,
  SyncDetectionResult,
  WebdavStatus,
  ConfigRequest,
} from "./api";
import {
  METHOD_PUT,
  METHOD_POST,
  METHOD_DELETE,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  HEADER_AUTHORIZATION,
  MIME_JSON,
  HEADER_CONTENT_TYPE,
  BROWSER_STORAGE_KEY_TOKEN,
  APP_NAME,
  LOCAL_NAME,
  ID_SIDEBAR_FILTER,
  DEFAULT_SCROLL_ITEMS,
  VAR_CS_SCROLL_ITEMS,
  BROWSER_STORAGE_KEY_EXPANDED_GROUPS,
  TAG_GROUP_PREFIX,
  TAG_ORDER_PREFIX,
  TAG_FAV,
} from "./constants";
import {
  type HostForm,
  type ServiceWorkerStatus,
  cutPrefix,
  filterHosts,
  forceReload,
  isValidHostname,
  localShellHost,
  openHostInNewWindow,
  remoteCommandOptions,
  searchStringAny,
} from "./common";
import { dialogs } from "./Dialogs";
import {
  fetchActiveTunnels,
  getStore,
  notify,
  setEditHostDialogOpen,
  setEditHostName,
  setHostFormData,
  setInitialHostFormData,
  setMobileOpen,
  setTagsExpanded,
  triggerFocus,
  useStore,
  setGroups,
  openHost,
  openHostsAsSplit,
  logout,
  logoutAll,
  fetchHosts,
  getIntVar,
} from "./store";
import { useShallow } from "zustand/react/shallow";

const drawerWidth = 260;

interface GroupNode {
  id: string;
  type: "group";
  name: string;
  path: string;
  children: TreeNode[];
}

interface ServerNode {
  id: string;
  type: "server";
  name: string;
  host: HostData;
}

type TreeNode = GroupNode | ServerNode;

interface SelectableGroupItem {
  id: string;
  type: "group";
  path: string;
  name: string;
}

interface SelectableServerItem {
  id: string;
  type: "server";
  section: "fav" | "tree" | "auto";
  host: HostData;
}

type SelectableItem = SelectableGroupItem | SelectableServerItem;

const PASSWORD_PLACEHOLDER = "***";

export default function Sidebar({
  isMobile,
  isTouch,
  onSavePasswordChange,
  onOpenScratchpad,
  onAttach,
  onRefresh,
}: {
  isMobile: boolean;
  isTouch: boolean;
  onSavePasswordChange: (val: ConfigRequest["save_password"]) => void;
  onOpenScratchpad: () => void;
  onAttach: (id: string, host: string, title: string, isLocked: boolean) => void;
  onRefresh: () => void;
}) {
  const appVersion = useStore((state) => state.sysinfo.version);
  const savePassword = useStore((state) => state.sysinfo.savePassword);
  const sysHostname = useStore((state) => state.sysinfo.hostname);
  const activeSessionIds = useStore(
    useShallow((state) =>
      state.tabs.flatMap((t) => t.panes.filter((p) => p.state !== "stolen").map((p) => p.sessionId || p.id)),
    ),
  );
  const mobileOpen = useStore((state) => state.mobileOpen);
  const hostFormData = useStore((state) => state.hostFormData);
  const hosts = useStore((state) => state.hosts);
  const groups = useStore((state) => state.groups);
  const shells = useStore((state) => state.shells);
  const tagsExpanded = useStore((state) => state.tagsExpanded);

  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  // Settings State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pinnedSessions, setPinnedSessions] = useState<SessionPinned[]>([]);
  const [dialogTab, setDialogTab] = useState(0);
  const [dialogAppPassword, setDialogAppPassword] = useState<string | null>(null);
  const [passwordsState, setPasswordsState] = useState<PasswordsResponse>({ locked: true, keys: [] });
  const [revealedPasswords, setRevealedPasswords] = useState<{ [key: string]: string }>({});
  const activeTunnels = useStore((state) => state.activeTunnels);

  const [swStatus, setSwStatus] = useState<ServiceWorkerStatus>("unknown");

  useEffect(() => {
    if (settingsOpen && dialogTab === 1) {
      fetchActiveTunnels();
      const interval = setInterval(fetchActiveTunnels, 3000);
      return () => clearInterval(interval);
    }
  }, [settingsOpen, dialogTab]);

  useEffect(() => {
    if (settingsOpen && dialogTab === 2) {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistration()
          .then((reg) => {
            if (!reg) {
              setSwStatus("unregistered");
            } else if (reg.active) {
              setSwStatus("active");
            } else if (reg.waiting) {
              setSwStatus("waiting");
            } else if (reg.installing) {
              setSwStatus("installing");
            }
          })
          .catch(() => setSwStatus("error"));
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSwStatus("unsupported");
      }
    }
  }, [settingsOpen, dialogTab]);

  useEffect(() => {
    if (settingsOpen) {
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      fetch("/api/sessions/pinned", {
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      })
        .then((r) => r.json() as Promise<SessionPinned[]>)
        .then((data) => setPinnedSessions(data || []))
        .catch((e) => console.error(e));
    }
  }, [settingsOpen]);

  // WebDAV settings state
  const [currentWebdavUrl, setCurrentWebdavUrl] = useState("");
  const [currentWebdavUser, setCurrentWebdavUser] = useState("");
  const [currentWebdavPassword, setCurrentWebdavPassword] = useState("");
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavPassword, setWebdavPassword] = useState("");
  const [webdavEnabled, setWebdavEnabled] = useState(false);
  const [syncStatus, setSyncStatus] = useState<WebdavStatus["syncStatus"]>("idle");
  const [syncError, setSyncError] = useState("");
  const [syncTime, setSyncTime] = useState<number | null>(null);
  const [isTestingWebdav, setIsTestingWebdav] = useState(false);
  const [webdavEncrypted, setWebdavEncrypted] = useState(false);
  const [useEncryption, setUseEncryption] = useState(false);
  const [masterKey, setMasterKey] = useState("");
  const [currentMasterKey, setCurrentMasterKey] = useState("");

  const fetchWebdavStatus = useCallback(async (onlyStatus = false) => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      const r = await fetch("/api/settings/webdav/status", {
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });

      const data = (await r.json()) as WebdavStatus;

      if (data) {
        if (!onlyStatus) {
          setWebdavUrl(data.webdavUrl);
          setCurrentWebdavUrl(data.webdavUrl);
          setWebdavUser(data.webdavUser);
          setCurrentWebdavUser(data.webdavUser);
          setWebdavEnabled(!!data.webdavEnabled);
          setWebdavPassword(data.webdavPassword);
          setCurrentWebdavPassword(data.webdavPassword);
          setUseEncryption(!!data.webdavEncrypted);
          setMasterKey(data.masterKey || "");
          setCurrentMasterKey(data.masterKey || "");
        }
        setSyncStatus(data.syncStatus);
        setSyncError(data.syncError);
        setSyncTime(data.syncTime);
        setWebdavEncrypted(!!data.webdavEncrypted);
      }
    } catch (e) {
      console.error("failed to fetch sync status", e);
    }
  }, []);

  useEffect(() => {
    if (settingsOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchWebdavStatus(false);
    }
  }, [settingsOpen, fetchWebdavStatus]);

  useEffect(() => {
    if (settingsOpen && dialogTab === 4) {
      const interval = setInterval(() => fetchWebdavStatus(true), 3000);
      return () => clearInterval(interval);
    }
  }, [settingsOpen, dialogTab, fetchWebdavStatus]);

  const handleToggleWebdavEnabled = async () => {
    const nextEnabled = !webdavEnabled;
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);

    try {
      const res = await fetch("/api/settings/webdav", {
        method: METHOD_POST,
        headers: {
          [HEADER_CONTENT_TYPE]: MIME_JSON,
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
        body: JSON.stringify({
          url: currentWebdavUrl,
          user: currentWebdavUser,
          password: "",
          enabled: nextEnabled,
          useEncryption: useEncryption,
          masterKey: masterKey,
        }),
      });

      if (res.ok) {
        notify(nextEnabled ? "Sync enabled" : "Sync disabled", "success");
        setWebdavEnabled(nextEnabled);
        fetchWebdavStatus(false);
      } else {
        const t = await res.text();
        notify("Failed to toggle sync: " + t, "error");
      }
    } catch (e: unknown) {
      notify(`Failed to toggle sync: ${e}`, "error");
    }
  };

  const urlChanged = webdavUrl.trim() !== currentWebdavUrl;
  const isCleared = !webdavUrl.trim() && !webdavUser.trim() && !webdavPassword.trim();

  const handleSaveWebdav = async () => {
    setIsTestingWebdav(true);
    if (
      isCleared &&
      !(await dialogs.confirm(
        "Are you sure you want to clear WebDAV settings?",
        `It will not remove any existing files from WebDAV server.` +
          (webdavEncrypted
            ? ` The WebDAV remote directory is encrypted with key ${masterKey}.` +
              ` If you proceed, the master key will be deleted from CozySSH server. Make sure you have a backup of it.`
            : ""),
        webdavEncrypted,
      ))
    ) {
      setIsTestingWebdav(false);
      return;
    }
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);

    try {
      if (isCleared) {
        const res = await fetch("/api/settings/webdav", {
          method: METHOD_POST,
          headers: {
            [HEADER_CONTENT_TYPE]: MIME_JSON,
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
          body: JSON.stringify({
            url: "",
            user: "",
            password: "",
            enabled: false,
            useEncryption: false,
            masterKey: "",
          } satisfies SaveWebdavSettingsRequest),
        });

        if (res.ok) {
          notify("WebDAV settings cleared successfully", "success");
          setWebdavUrl("");
          setCurrentWebdavUrl("");
          setWebdavUser("");
          setCurrentWebdavUser("");
          setWebdavPassword("");
          setCurrentWebdavPassword("");
          setWebdavEnabled(false);
          setUseEncryption(false);
          setMasterKey("");
          setCurrentMasterKey("");
          fetchWebdavStatus(false);
        } else {
          const text = await res.text();
          notify("Failed to clear WebDAV settings: " + text, "error");
        }
        return;
      }

      let localMasterKey = masterKey;
      let finalUseEncryption = useEncryption;

      if (urlChanged || useEncryption !== webdavEncrypted || masterKey !== currentMasterKey) {
        const detectRes = await fetch("/api/settings/webdav/detect", {
          method: METHOD_POST,
          headers: {
            [HEADER_CONTENT_TYPE]: MIME_JSON,
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
          body: JSON.stringify({
            url: webdavUrl,
            user: webdavUser,
            password: webdavPassword,
            enabled: webdavEnabled,
            useEncryption: useEncryption,
            masterKey: localMasterKey,
          } satisfies SaveWebdavSettingsRequest),
        });

        if (!detectRes.ok) {
          const text = await detectRes.text();
          throw new Error(text || "Failed to verify WebDAV connection");
        }

        let data = (await detectRes.json()) as SyncDetectionResult;

        if (data.encrypted && (data.keyRequired || data.keyInvalid)) {
          const keyInput = await dialogs.prompt(
            "Encrypted WebDAV Session Detected. " + data.keyInvalid
              ? "The master key you entered is invalid. Please enter the correct master key:"
              : "This WebDAV server is encrypted. Please enter the master key to unlock and sync:",
          );
          if (keyInput === null) {
            return;
          }
          localMasterKey = keyInput;
          setMasterKey(keyInput);

          const retryRes = await fetch("/api/settings/webdav/detect", {
            method: METHOD_POST,
            headers: {
              [HEADER_CONTENT_TYPE]: MIME_JSON,
              [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
            },
            body: JSON.stringify({
              url: webdavUrl,
              user: webdavUser,
              password: webdavPassword,
              enabled: webdavEnabled,
              useEncryption: true,
              masterKey: localMasterKey,
            } satisfies SaveWebdavSettingsRequest),
          });

          if (!retryRes.ok) {
            const text = await retryRes.text();
            throw new Error(text || "Failed to verify WebDAV connection with the provided key");
          }

          const retryData = (await retryRes.json()) as SyncDetectionResult;
          if (retryData.keyInvalid) {
            throw new Error("Invalid master key provided");
          }
          data = retryData;
          finalUseEncryption = true;
          setUseEncryption(true);
        }

        let msg = "";
        let detail = "";
        if (data.brandNew) {
          msg = "WebDAV server connection ready";
          detail =
            `The server ${webdavUrl} is brand-new and contains no CozySSH data. ` +
            `Your local data (buttons, vars, scratchpad) will be uploaded to it when synchronization is triggered.` +
            (finalUseEncryption
              ? "\n\nEnd-to-End Encryption (E2EE) is enabled. A new 32-byte master key will be automatically generated and saved if you don't specify one."
              : "");
        } else {
          msg = "WebDAV server connection successful!";
          detail =
            `The server ${webdavUrl} contains existing CozySSH data. ` +
            `If sync is enabled, the following changes will be applied during sync:\n` +
            `• ${data.uploadCount} local changes will be uploaded to the server\n` +
            `• ${data.downloadCount} remote changes will be downloaded and applied locally\n` +
            `• ${data.deleteLocalCount} local items will be deleted\n` +
            `• ${data.deleteRemoteCount} remote items will be deleted from the server` +
            (data.encrypted ? "\n\nEnd-to-End Encryption (E2EE) is active on this server." : "");
        }

        const confirmed = await dialogs.confirm(
          msg,
          detail + "\n\nDo you want to save these settings and enable WebDAV sync?",
        );
        if (!confirmed) {
          return;
        }
      }

      const saveRes = await fetch("/api/settings/webdav", {
        method: METHOD_POST,
        headers: {
          [HEADER_CONTENT_TYPE]: MIME_JSON,
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
        body: JSON.stringify({
          url: webdavUrl,
          user: webdavUser,
          password: webdavPassword,
          enabled: urlChanged || finalUseEncryption !== webdavEncrypted ? true : webdavEnabled,
          useEncryption: finalUseEncryption,
          masterKey: localMasterKey,
        } satisfies SaveWebdavSettingsRequest),
      });

      if (saveRes.ok) {
        notify("WebDAV settings saved successfully", "success");
        setCurrentWebdavUrl(webdavUrl.trim());
        setCurrentWebdavUser(webdavUser);
        setCurrentWebdavPassword(webdavPassword);
        fetchWebdavStatus(false);
      } else {
        const text = await saveRes.text();
        notify("Failed to save WebDAV settings: " + text, "error");
      }
    } catch (e: unknown) {
      notify(`WebDAV verification failed: ${e}`, "error");
    } finally {
      setIsTestingWebdav(false);
    }
  };

  const handleSyncNow = async () => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    setSyncStatus("syncing");

    try {
      const res = await fetch("/api/settings/webdav/sync", {
        method: METHOD_POST,
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });

      if (res.ok) {
        notify("Sync triggered", "success");
        setTimeout(() => fetchWebdavStatus(true), 500);
      } else {
        notify("Failed to trigger sync", "error");
      }
    } catch (e: unknown) {
      notify(`Failed to trigger sync: ${e}`, "error");
    }
  };

  const [startupParams] = useSearchParams();
  const [filterStr, setFilterStr] = useState(startupParams.get("filter") || "");
  const [showTagsToggle, setShowTagsToggle] = useState(false);
  const tagsContainerRef = useRef<HTMLDivElement | null>(null);
  const localShellRef = useRef<HTMLLIElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const editHostDialogOpen = useStore((state) => state.editHostDialogOpen);
  const editHostName = useStore((state) => state.editHostName);

  // Context Menu State
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [localShellContextMenuOpen, setLocalShellContextMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    element: Element;
    target: HostData;
    section: "fav" | "tree" | "auto";
  } | null>(null);
  const [tagContextMenuOpen, setTagContextMenuOpen] = useState(false);
  const [tagContextMenu, setTagContextMenu] = useState<{ element: Element; tag: string } | null>(null);

  // Expanded state of folders in Tree View
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(BROWSER_STORAGE_KEY_EXPANDED_GROUPS);
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch (e) {
      console.error(e);
    }
    return new Set<string>();
  });

  const toggleGroupExpanded = (path: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      localStorage.setItem(BROWSER_STORAGE_KEY_EXPANDED_GROUPS, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const [favExpanded, setFavExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("cozyssh_section_expanded_favourites");
      return saved !== "false";
    } catch (e) {
      console.error(e);
    }
    return true;
  });

  const [allExpanded, setAllExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("cozyssh_section_expanded_all_servers");
      return saved !== "false";
    } catch (e) {
      console.error(e);
    }
    return true;
  });

  const [autoExpanded, setAutoExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("cozyssh_section_expanded_auto_servers");
      return saved !== "false";
    } catch (e) {
      console.error(e);
    }
    return true;
  });

  const toggleFavExpanded = useCallback(() => {
    setFavExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("cozyssh_section_expanded_favourites", String(next));
      return next;
    });
  }, []);

  const toggleAllExpanded = useCallback(() => {
    setAllExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("cozyssh_section_expanded_all_servers", String(next));
      return next;
    });
  }, []);

  const toggleAutoExpanded = useCallback(() => {
    setAutoExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("cozyssh_section_expanded_auto_servers", String(next));
      return next;
    });
  }, []);

  // Group context menu states
  const [groupContextMenuOpen, setGroupContextMenuOpen] = useState(false);
  const [groupContextMenu, setGroupContextMenu] = useState<{ element: Element; path: string } | null>(null);

  // Drag and Drop States
  const [draggedItem, setDraggedItem] = useState<
    { type: "group"; path: string } | { type: "server"; name: string } | null
  >(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ id: string; effect: "before" | "inside" } | null>(null);

  // Helper functions for tree view
  const getHostOrder = useCallback((host: HostData): number => {
    if (!host.tags) return Infinity;
    for (const tag of host.tags) {
      if (tag.startsWith(TAG_ORDER_PREFIX)) {
        const order = parseInt(tag.substring(2));
        if (!isNaN(order)) return order;
      }
    }
    return Infinity;
  }, []);

  const getHostGroupPath = useCallback((host: HostData): string | null => {
    if (!host.tags) return null;
    for (const tag of host.tags) {
      if (tag.startsWith(TAG_GROUP_PREFIX)) {
        return tag.slice(TAG_GROUP_PREFIX.length);
      }
    }
    return null;
  }, []);

  const getGroupOrder = useCallback(
    (path: string): number => {
      const idx = groups.indexOf(path);
      return idx === -1 ? Infinity : idx;
    },
    [groups],
  );

  // Server move function (drag & drop)
  const moveServer = useCallback(
    async (serverName: string, destGroupPath: string | null, beforeServerName: string | null) => {
      const host = hosts.find((h) => h.name === serverName);
      if (!host) return;

      const siblingHosts = hosts.filter(
        (h) => !h.is_auto && h.name !== serverName && getHostGroupPath(h) === destGroupPath,
      );
      siblingHosts.sort((a, b) => {
        const orderA = getHostOrder(a);
        const orderB = getHostOrder(b);
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });

      const newSortedList = [...siblingHosts];
      if (beforeServerName) {
        const idx = newSortedList.findIndex((h) => h.name === beforeServerName);
        if (idx !== -1) {
          newSortedList.splice(idx, 0, host);
        } else {
          newSortedList.push(host);
        }
      } else {
        newSortedList.push(host);
      }

      const updatedHosts: HostData[] = [];
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      for (let i = 0; i < newSortedList.length; i++) {
        const h = newSortedList[i];
        const newOrder = (i + 1) * 10;
        const newGroupTag = destGroupPath ? `g-${destGroupPath}` : null;

        let tagsChanged = false;
        const newTags = h.tags
          ? h.tags.filter((t) => !t.startsWith(TAG_ORDER_PREFIX) && !t.startsWith(TAG_GROUP_PREFIX))
          : [];

        const oldGroupTag = h.tags ? h.tags.find((t) => t.startsWith(TAG_GROUP_PREFIX)) : null;
        const expectedGroupTag = newGroupTag;
        if (oldGroupTag !== expectedGroupTag) {
          tagsChanged = true;
        }
        if (newGroupTag) {
          newTags.push(newGroupTag);
        }

        const oldOrder = getHostOrder(h);
        if (oldOrder !== newOrder) {
          tagsChanged = true;
        }
        newTags.push(`o-${newOrder}`);

        if (h.name === serverName || tagsChanged) {
          const updatedHost = {
            ...h,
            tags: newTags,
          };
          updatedHosts.push(updatedHost);
        }
      }

      for (const h of updatedHosts) {
        const url = h.source === "config" ? `/api/hosts/${h.name}` : `/api/hosts`;
        const method = h.source === "config" ? METHOD_PUT : METHOD_POST;
        await fetch(url, {
          method,
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
            [HEADER_CONTENT_TYPE]: MIME_JSON,
          },
          body: JSON.stringify(h),
        });
      }

      fetchHosts();
    },
    [hosts, getHostGroupPath, getHostOrder],
  );

  // Group move/reorder function (drag & drop)
  const moveGroup = useCallback(
    async (srcPath: string, beforeSiblingPath: string) => {
      const draggedGroupList = groups.filter((g) => g === srcPath || g.startsWith(srcPath + "/"));
      const remainingGroups = groups.filter((g) => g !== srcPath && !g.startsWith(srcPath + "/"));

      const idx = remainingGroups.indexOf(beforeSiblingPath);
      const nextGroups = [...remainingGroups];
      if (idx !== -1) {
        nextGroups.splice(idx, 0, ...draggedGroupList);
      } else {
        nextGroups.push(...draggedGroupList);
      }

      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      const res = await fetch("/api/groups", {
        method: METHOD_POST,
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          [HEADER_CONTENT_TYPE]: MIME_JSON,
        },
        body: JSON.stringify(nextGroups),
      });
      if (res.ok) {
        setGroups(nextGroups);
      } else {
        dialogs.alert("Failed to save group order");
      }
    },
    [groups],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loading && hosts.length > 0) setLoading(false);
  }, [hosts, loading]);

  useEffect(() => {
    window.csSetSidebarFilter = setFilterStr;
    return () => {
      delete (window as Partial<typeof globalThis>).csSetSidebarFilter;
    };
  }, []);

  const fetchPasswords = useCallback(async () => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      const r = await fetch("/api/passwords", {
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });
      if (r.ok) {
        const data = (await r.json()) as PasswordsResponse;
        setPasswordsState(data);
      }
    } catch (e) {
      console.error("Failed to fetch passwords:", e);
    }
  }, []);

  const handleLock = useCallback(async () => {
    setDialogAppPassword(null);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      const res = await fetch("/api/passwords/lock", {
        method: METHOD_POST,
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });
      if (res.ok) {
        setRevealedPasswords({});
        fetchPasswords();
      } else {
        dialogs.alert("Failed to lock password store");
      }
    } catch (e) {
      console.error(e);
      dialogs.alert("Failed to lock password store");
    }
  }, [fetchPasswords]);

  useEffect(() => {
    if (settingsOpen && dialogTab === 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchPasswords();
    }
  }, [settingsOpen, dialogTab, fetchPasswords]);

  useEffect(() => {
    if (!settingsOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDialogAppPassword(null);
      setRevealedPasswords({});
    }
  }, [settingsOpen]);

  const handleReveal = useCallback(
    async (key: string) => {
      let pwd = dialogAppPassword;
      if (!pwd) {
        const entered = await dialogs.promptPassword("Enter App Password to confirm:");
        if (entered === null) {
          return;
        }
        const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
        try {
          const verifyRes = await fetch("/api/passwords/unlock", {
            method: METHOD_POST,
            headers: {
              [HEADER_CONTENT_TYPE]: MIME_JSON,
              [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
            },
            body: JSON.stringify({ app_password: entered } satisfies PasswordsUnlockRequest),
          });
          if (!verifyRes.ok) {
            dialogs.alert("Incorrect app password");
            return;
          }
          pwd = entered;
          setDialogAppPassword(entered);
          setPasswordsState((prev) => ({ ...prev, locked: false }));
        } catch (e) {
          console.error(e);
          dialogs.alert("Verification failed");
          return;
        }
      }

      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      try {
        const res = await fetch("/api/passwords/reveal", {
          method: METHOD_POST,
          headers: {
            [HEADER_CONTENT_TYPE]: MIME_JSON,
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
          body: JSON.stringify({ key } satisfies PasswordsRevealRequest),
        });
        if (res.ok) {
          const data = (await res.json()) as PasswordsRevealResponse;
          setRevealedPasswords((prev) => ({ ...prev, [key]: data.password }));
        } else {
          dialogs.alert("Failed to reveal password");
        }
      } catch (e) {
        console.error(e);
        dialogs.alert("Failed to reveal password");
      }
    },
    [dialogAppPassword],
  );

  const handleCopyPassword = useCallback(
    async (key: string) => {
      let pwd = revealedPasswords[key];
      if (!pwd) {
        let appPwd = dialogAppPassword;
        if (!appPwd) {
          const entered = await dialogs.promptPassword("Enter App Password to confirm:");
          if (entered === null) {
            return;
          }
          const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
          try {
            const verifyRes = await fetch("/api/passwords/unlock", {
              method: METHOD_POST,
              headers: {
                [HEADER_CONTENT_TYPE]: MIME_JSON,
                [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
              },
              body: JSON.stringify({ app_password: entered } satisfies PasswordsUnlockRequest),
            });
            if (!verifyRes.ok) {
              dialogs.alert("Incorrect app password");
              return;
            }
            appPwd = entered;
            setDialogAppPassword(entered);
            setPasswordsState((prev) => ({ ...prev, locked: false }));
          } catch (e) {
            console.error(e);
            dialogs.alert("Verification failed");
            return;
          }
        }

        const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
        try {
          const res = await fetch("/api/passwords/reveal", {
            method: METHOD_POST,
            headers: {
              [HEADER_CONTENT_TYPE]: MIME_JSON,
              [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
            },
            body: JSON.stringify({ key } satisfies PasswordsRevealRequest),
          });
          if (res.ok) {
            const data = (await res.json()) as PasswordsRevealResponse;
            pwd = data.password;
          } else {
            dialogs.alert("Failed to retrieve password");
            return;
          }
        } catch (e) {
          console.error(e);
          dialogs.alert("Failed to retrieve password");
          return;
        }
      }

      if (pwd) {
        try {
          await navigator.clipboard.writeText(pwd);
        } catch (err) {
          console.error("Failed to copy password:", err);
        }
      }
    },
    [dialogAppPassword, revealedPasswords],
  );

  const handleChangePassword = useCallback(
    async (key: string) => {
      const isLocked = passwordsState.locked && !dialogAppPassword;
      if (isLocked) {
        const entered = await dialogs.promptPassword("Enter App Password to confirm:");
        if (entered === null) {
          return;
        }
        const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
        try {
          const verifyRes = await fetch("/api/passwords/unlock", {
            method: METHOD_POST,
            headers: {
              [HEADER_CONTENT_TYPE]: MIME_JSON,
              [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
            },
            body: JSON.stringify({ app_password: entered } satisfies PasswordsUnlockRequest),
          });
          if (!verifyRes.ok) {
            dialogs.alert("Incorrect app password");
            return;
          }
          setDialogAppPassword(entered);
          setPasswordsState((prev) => ({ ...prev, locked: false }));
        } catch (e) {
          console.error(e);
          dialogs.alert("Verification failed");
          return;
        }
      }

      const newPwd = await dialogs.promptPassword(`Enter new password for ${key}:`);
      if (newPwd === null) {
        return;
      }

      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      try {
        const res = await fetch("/api/passwords/change", {
          method: METHOD_POST,
          headers: {
            [HEADER_CONTENT_TYPE]: MIME_JSON,
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
          body: JSON.stringify({ key, password: newPwd } satisfies PasswordsChangeRequest),
        });
        if (res.ok) {
          setRevealedPasswords((prev) => {
            if (key in prev) {
              return { ...prev, [key]: newPwd };
            }
            return prev;
          });
          dialogs.alert("Password updated successfully");
        } else {
          dialogs.alert("Failed to update password");
        }
      } catch (e) {
        console.error(e);
        dialogs.alert("Failed to update password");
      }
    },
    [passwordsState.locked, dialogAppPassword],
  );

  const handleDeletePassword = useCallback(
    async (key: string) => {
      if (!(await dialogs.confirm(`Are you sure you want to delete the password for ${key}?`))) {
        return;
      }
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      try {
        const res = await fetch("/api/passwords/delete", {
          method: METHOD_POST,
          headers: {
            [HEADER_CONTENT_TYPE]: MIME_JSON,
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
          body: JSON.stringify({ key } satisfies PasswordsDeleteRequest),
        });
        if (res.ok) {
          fetchPasswords();
          setRevealedPasswords((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        } else {
          dialogs.alert("Failed to delete password");
        }
      } catch (e) {
        console.error(e);
        dialogs.alert("Failed to delete password");
      }
    },
    [fetchPasswords],
  );

  const handleSavePassword = useCallback(async () => {
    if (newPwd !== confirmPwd) {
      dialogs.alert("Passwords don't match");
      return;
    }
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const res = await fetch("/api/settings/password", {
      method: METHOD_POST,
      headers: {
        [HEADER_CONTENT_TYPE]: MIME_JSON,
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
      body: JSON.stringify({ new_password: newPwd, force: false } satisfies PasswordUpdateRequest),
    });

    if (res.status === 403) {
      const text = await res.text();
      if (text.includes("Saved passwords are locked")) {
        const action = await dialogs.confirm(
          "Saved passwords are locked. Would you like to enter your old app password to unlock and re-encrypt them? (Selecting Cancel will let you choose to Force Update instead.)",
        );

        if (action) {
          const oldPwd = await dialogs.promptPassword("Enter old app password to unlock:");
          if (!oldPwd) {
            return;
          }

          const loginRes = await fetch("/api/login", {
            method: METHOD_POST,
            headers: {
              [HEADER_CONTENT_TYPE]: MIME_JSON,
            },
            body: JSON.stringify({ password: oldPwd }),
          });

          if (loginRes.ok) {
            const loginData = (await loginRes.json()) as { token: string };
            const newToken = loginData.token;
            localStorage.setItem(BROWSER_STORAGE_KEY_TOKEN, newToken);

            const retryRes = await fetch("/api/settings/password", {
              method: METHOD_POST,
              headers: {
                [HEADER_CONTENT_TYPE]: MIME_JSON,
                [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + newToken,
              },
              body: JSON.stringify({ new_password: newPwd, force: false } satisfies PasswordUpdateRequest),
            });

            if (retryRes.ok) {
              await dialogs.alert("Password updated! You will be logged out.");
              logout();
              return;
            } else {
              const retryErr = await retryRes.text();
              dialogs.alert("Failed to update password after unlocking: " + (retryErr || retryRes.statusText));
              return;
            }
          } else {
            dialogs.alert("Incorrect app password.");
            return;
          }
        } else {
          const forceConfirm = await dialogs.confirm(
            "Force updating the app password will permanently discard/wipe all saved SSH passwords. Are you sure you want to proceed?",
          );
          if (forceConfirm) {
            const forceRes = await fetch("/api/settings/password", {
              method: METHOD_POST,
              headers: {
                [HEADER_CONTENT_TYPE]: MIME_JSON,
                [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
              },
              body: JSON.stringify({ new_password: newPwd, force: true } satisfies PasswordUpdateRequest),
            });

            if (forceRes.ok) {
              dialogs.alert("App password updated and saved passwords wiped! You will be logged out.");
              logout();
              return;
            } else {
              const forceErr = await forceRes.text();
              dialogs.alert("Failed to force update password: " + (forceErr || forceRes.statusText));
              return;
            }
          }
        }
        return;
      }
    }

    if (res.ok) {
      await dialogs.alert("Password updated! You will be logged out.");
      logout();
    } else {
      const errText = await res.text();
      dialogs.alert("Failed to update password: " + (errText || res.statusText));
    }
  }, [confirmPwd, newPwd]);

  const handleClearCache = useCallback(async () => {
    if (!(await dialogs.confirm("This will unregister the Service Worker, clear all caches and reload. Proceed?"))) {
      return;
    }
    forceReload();
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent, host: HostData, section: "fav" | "tree" | "auto") => {
      e.preventDefault();
      setContextMenu({ element: e.currentTarget, target: host, section });
      setContextMenuOpen(true);
    },
    [],
  );

  const handleTagContextMenu = useCallback((e: React.MouseEvent, tag: string) => {
    e.preventDefault();
    setTagContextMenu({ element: e.currentTarget, tag });
    setTagContextMenuOpen(true);
  }, []);

  const handleOpenAllServersInNewWindow = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    const tag = tagContextMenu.tag;
    setTagContextMenuOpen(false);
    openHostInNewWindow(`#${tag}`);
  }, [tagContextMenu]);

  const handleOpenAllServers = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    const tag = tagContextMenu.tag;
    setTagContextMenuOpen(false);
    setFilterStr(`#${tag} `);
    const targets = hosts.filter((h) => h.tags && h.tags.includes(tag));
    targets.forEach((h) => openHost(h.name));
    setMobileOpen(false);
  }, [hosts, tagContextMenu]);

  const handleOpenSplitServers = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    const tag = tagContextMenu.tag;
    setTagContextMenuOpen(false);
    const filtered = hosts.filter((h) => h.tags && h.tags.includes(tag));

    const nameSorter = (a: HostData, b: HostData) => a.name.localeCompare(b.name);
    const hostNameSorter = (a: HostData, b: HostData) => {
      if (a.hostname === b.hostname) {
        return a.name.localeCompare(b.name);
      }
      return a.hostname.localeCompare(b.hostname);
    };

    const favs = filtered.filter((h) => h.is_favourite).sort(nameSorter);
    const normals = filtered.filter((h) => !h.is_favourite && !h.is_auto).sort(nameSorter);
    const autos = filtered.filter((h) => !h.is_favourite && h.is_auto).sort(hostNameSorter);

    const targets = [...favs, ...normals, ...autos].slice(0, 4);
    if (targets.length > 0) {
      openHostsAsSplit(
        tag,
        targets.map((h) => h.name),
      );
      setMobileOpen(false);
    }
  }, [hosts, tagContextMenu]);

  const handleCopyTagUrl = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    const tag = tagContextMenu.tag;
    setTagContextMenuOpen(false);
    const url = `${window.location.origin}/##${tag}`;
    navigator.clipboard.writeText(url);
  }, [tagContextMenu]);

  const handleAddOpen = useCallback(() => {
    const data: HostForm = {
      name: "",
      hostname: "",
      user: "root",
      port: "22",
      source: "",
      identity_file: "",
      proxy_jump: "",
      remote_command: "",
      address_family: "",
      user_known_hosts_file: "",
      strict_host_key_checking: "",
      host_key_algorithms: "",
      local_forward: "",
      remote_forward: "",
      tags: "",
      comment: "",
      password: "",
      password_exists: false,
      clear_password: false,
    };
    setEditHostName("");
    setHostFormData(data);
    setInitialHostFormData(data);
    setEditHostDialogOpen(true);
  }, []);

  const handleEditOpen = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    const target = contextMenu.target;
    setContextMenuOpen(false);
    const isAuto = target.source === "known_hosts";
    const data: HostForm = {
      name: isAuto ? target.hostname : target.name,
      hostname: target.hostname,
      user: target.user || "root",
      port: target.port || "22",
      source: "",
      identity_file: target.identity_file || "",
      proxy_jump: target.proxy_jump || "",
      remote_command: target.remote_command || "",
      address_family: target.address_family || "",
      user_known_hosts_file: target.user_known_hosts_file || "",
      strict_host_key_checking: target.strict_host_key_checking || "",
      host_key_algorithms: target.host_key_algorithms || "",
      local_forward: target.local_forward || "",
      remote_forward: target.remote_forward || "",
      tags: target.tags ? target.tags.join(" ") : "",
      comment: target.comment || "",
      password: target.password_exists ? PASSWORD_PLACEHOLDER : "",
      password_exists: target.password_exists,
      clear_password: false,
    };
    setEditHostName(isAuto ? "" : target.name);
    setHostFormData(data);
    setInitialHostFormData(data);
    setEditHostDialogOpen(true);
  }, [contextMenu]);

  const closeMobileSidebar = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const target = contextMenu.target;
    setContextMenuOpen(false);
    if (await dialogs.confirm(`Are you extremely certain you want to permanently delete "${target.name}"?`)) {
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      await fetch(`/api/hosts/${target.name}`, {
        method: METHOD_DELETE,
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });
      fetchHosts();
    }
  }, [contextMenu]);

  const handleToggleFavourite = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const target = contextMenu.target;
    setContextMenuOpen(false);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);

    let newTags = target.tags ? [...target.tags] : [];
    if (target.is_favourite) {
      newTags = newTags.filter((t) => t !== TAG_FAV);
    } else {
      if (!newTags.includes(TAG_FAV)) {
        newTags.push(TAG_FAV);
      }
    }

    const payload: HostData = {
      name: target.source === "known_hosts" ? target.hostname : target.name,
      hostname: target.hostname,
      user: target.user || "root",
      port: target.port || "22",
      identity_file: target.identity_file || "",
      proxy_jump: target.proxy_jump || "",
      remote_command: target.remote_command || "",
      source: target.source || "",
      comment: target.comment || "",
      tags: newTags,
    };

    const url = target.source === "config" ? `/api/hosts/${target.name}` : `/api/hosts`;
    const method = target.source === "config" ? METHOD_PUT : METHOD_POST;

    await fetch(url, {
      method,
      headers: {
        [HEADER_CONTENT_TYPE]: MIME_JSON,
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
      body: JSON.stringify(payload),
    });
    fetchHosts();
  }, [contextMenu]);

  const handleRunCopyID = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const target = contextMenu.target;
    setContextMenuOpen(false);

    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const headers = {
      [HEADER_CONTENT_TYPE]: MIME_JSON,
      [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
    };

    let passwordInput: string | undefined = undefined;
    let expected_fingerprint: string | undefined = undefined;

    while (true) {
      try {
        const payload: CopyIDRequest = {
          name: target.name,
          password: passwordInput,
          expected_fingerprint,
        };

        const res = await fetch("/api/hosts/copy-id", {
          method: METHOD_POST,
          headers,
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const text = await res.text();
          dialogs.alert(`ssh-copy-id "${payload.name}": Error copying SSH key: ${text || res.statusText}`);
          break;
        }

        const data = (await res.json()) as CopyIDResponse;
        if (data.status === "success") {
          dialogs.alert(`ssh-copy-id "${payload.name}": ${data.message}`);
          break;
        } else if (data.status === "need_app_password") {
          const appPwd = await dialogs.promptPassword(
            `ssh-copy-id "${payload.name}": ${
              data.message || "The password store is locked. Enter your CozySSH app password to unlock it:"
            }`,
          );
          if (!appPwd) {
            break;
          }
          const loginRes = await fetch("/api/login", {
            method: METHOD_POST,
            headers: {
              [HEADER_CONTENT_TYPE]: MIME_JSON,
            },
            body: JSON.stringify({ password: appPwd }),
          });
          if (loginRes.ok) {
            const loginData = (await loginRes.json()) as { token: string };
            const newToken = loginData.token;
            localStorage.setItem(BROWSER_STORAGE_KEY_TOKEN, newToken);
            headers[HEADER_AUTHORIZATION] = HEADER_AUTHORIZATION_BEARER_PREFIX + newToken;
          } else {
            dialogs.alert(
              `ssh-copy-id "${payload.name}": Invalid CozySSH app password. Failed to unlock password store.`,
            );
            break;
          }
        } else if (data.status === "need_password") {
          const promptMsg = `ssh-copy-id "${payload.name}": ${
            data.message || `Enter password for ${target.user || "root"}@${target.hostname}:`
          }`;
          const pwd = await dialogs.promptPassword(promptMsg);
          if (pwd === null) {
            break;
          }
          passwordInput = pwd;
        } else if (data.status === "need_hostkey_confirm") {
          if (
            !(await dialogs.confirm(
              `ssh-copy-id "${payload.name}": host key isn't trusted: ${data.message}. ` +
                `New host key finterprint: ${data.fingerprint}. Accept it?`,
              "",
              true,
            ))
          ) {
            return;
          }
          if (!data.fingerprint) {
            break;
          }
          expected_fingerprint = data.fingerprint;
        } else {
          dialogs.alert(`ssh-copy-id "${payload.name}": Error: ${data.message}`);
          break;
        }
      } catch (err: unknown) {
        dialogs.alert(`ssh-copy-id "${target.name}": Error: ${err}`);
        break;
      }
    }
  }, [contextMenu]);

  const handleOpenGroupAll = useCallback(() => {
    setGroupContextMenuOpen(false);
    if (!groupContextMenu) {
      return;
    }
    const targets = hosts.filter((h) => h.tags && h.tags.includes(TAG_GROUP_PREFIX + groupContextMenu.path));
    targets.forEach((h) => openHost(h.name));
    setMobileOpen(false);
  }, [groupContextMenu, hosts]);

  const handleOpenGroupAllInNewWindow = useCallback(() => {
    setGroupContextMenuOpen(false);
    if (!groupContextMenu) {
      return;
    }
    openHostInNewWindow("#" + TAG_GROUP_PREFIX + groupContextMenu.path);
  }, [groupContextMenu]);

  const handleOpenGroupAllSplitScreen = useCallback(() => {
    setGroupContextMenuOpen(false);
    if (!groupContextMenu) {
      return;
    }
    const filtered = hosts.filter((h) => h.tags && h.tags.includes(TAG_GROUP_PREFIX + groupContextMenu.path));
    const targets = filtered.slice(0, 4);
    if (targets.length > 0) {
      openHostsAsSplit(
        groupContextMenu.path,
        targets.map((h) => h.name),
      );
      setMobileOpen(false);
    }
  }, [groupContextMenu, hosts]);

  const handleAddSubGroupClick = useCallback(async () => {
    setGroupContextMenuOpen(false);
    if (!groupContextMenu) {
      return;
    }
    const parentPath = groupContextMenu.path;
    const name = await dialogs.prompt("Enter sub-group name:", "", {
      validate: function (str: string): string | undefined {
        if (str.includes(" ") || str.includes("/")) {
          return "Group name cannot contain spaces or slashes (/)";
        }
        return undefined;
      },
    });
    if (!name) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.includes(" ") || trimmed.includes("/")) {
      dialogs.alert("Group name cannot contain spaces or slashes (/).");
      return;
    }
    const newPath = `${parentPath}/${trimmed}`;
    if (groups.includes(newPath)) {
      dialogs.alert("Sub-group already exists.");
      return;
    }
    const nextGroups = [...groups, newPath];
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const res = await fetch("/api/groups", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(nextGroups),
    });
    if (res.ok) {
      setGroups(nextGroups);
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.add(parentPath);
        localStorage.setItem(BROWSER_STORAGE_KEY_EXPANDED_GROUPS, JSON.stringify(Array.from(next)));
        return next;
      });
    } else {
      dialogs.alert("Failed to save group");
    }
  }, [groupContextMenu, groups]);

  const handleAddTopLevelGroupClick = useCallback(async () => {
    setGroupContextMenuOpen(false);
    setContextMenuOpen(false);
    const name = await dialogs.prompt("Enter top-level group name:");
    if (!name) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.includes(" ") || trimmed.includes("/")) {
      dialogs.alert("Group name cannot contain spaces or slashes (/).");
      return;
    }
    if (groups.includes(trimmed)) {
      dialogs.alert("Group already exists.");
      return;
    }
    const nextGroups = [...groups, trimmed];
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const res = await fetch("/api/groups", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(nextGroups),
    });
    if (res.ok) {
      setGroups(nextGroups);
    } else {
      dialogs.alert("Failed to save group");
    }
  }, [groups]);

  const handleDeleteGroupClick = useCallback(async () => {
    setGroupContextMenuOpen(false);
    if (!groupContextMenu) return;
    const G = groupContextMenu.path;
    if (
      !(await dialogs.confirm(
        `Are you sure you want to delete the group "${G}"? Belonging servers will be relocated to parent group or ungrouped.`,
      ))
    ) {
      return;
    }

    const parts = G.split("/");
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : null;

    const updatedHosts: HostData[] = [];
    for (const host of hosts) {
      const gp = getHostGroupPath(host);
      if (gp === G || (gp && gp.startsWith(G + "/"))) {
        let newGp: string | null = null;
        if (gp === G) {
          newGp = parentPath;
        } else {
          const rel = gp.substring(G.length + 1);
          newGp = parentPath ? `${parentPath}/${rel}` : rel;
        }
        const newTags = host.tags ? host.tags.filter((t) => !t.startsWith(TAG_GROUP_PREFIX)) : [];
        if (newGp) {
          newTags.push(`g-${newGp}`);
        }
        updatedHosts.push({
          ...host,
          tags: newTags,
        });
      }
    }

    const nextGroups = groups
      .filter((g) => g !== G)
      .map((g) => {
        if (g.startsWith(G + "/")) {
          const rel = g.substring(G.length + 1);
          return parentPath ? `${parentPath}/${rel}` : rel;
        }
        return g;
      });

    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);

    const groupsRes = await fetch("/api/groups", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(nextGroups),
    });

    if (groupsRes.ok) {
      setGroups(nextGroups);
    }

    for (const h of updatedHosts) {
      const url = h.source === "config" ? `/api/hosts/${h.name}` : `/api/hosts`;
      const method = h.source === "config" ? METHOD_PUT : METHOD_POST;
      await fetch(url, {
        method,
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          [HEADER_CONTENT_TYPE]: MIME_JSON,
        },
        body: JSON.stringify(h),
      });
    }

    fetchHosts();
  }, [groupContextMenu, groups, hosts, getHostGroupPath, fetchHosts]);

  const handleRenameGroupClick = useCallback(async () => {
    setGroupContextMenuOpen(false);
    if (!groupContextMenu) return;
    const G = groupContextMenu.path;

    const parts = G.split("/");
    const lastPart = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : null;

    const name = await dialogs.prompt(`Rename group "${lastPart}" to:`, lastPart, {
      validate: function (str: string): string | undefined {
        if (!str.trim()) {
          return "Group name cannot be empty";
        }
        if (str.includes(" ") || str.includes("/")) {
          return "Group name cannot contain spaces or slashes (/)";
        }
        return undefined;
      },
    });

    if (!name) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed === lastPart) {
      return;
    }

    const newG = parentPath ? `${parentPath}/${trimmed}` : trimmed;

    // Check if new group already exists in the same level
    if (groups.includes(newG)) {
      dialogs.alert("A group with that name already exists.");
      return;
    }

    const nextGroups = groups.map((g) => {
      if (g === G) {
        return newG;
      }
      if (g.startsWith(G + "/")) {
        return newG + g.substring(G.length);
      }
      return g;
    });

    // Just in case, ensure no duplicate paths overall
    if (new Set(nextGroups).size !== nextGroups.length) {
      dialogs.alert("A group with that name already exists.");
      return;
    }

    const updatedHosts: HostData[] = [];
    for (const host of hosts) {
      const gp = getHostGroupPath(host);
      if (gp === G || (gp && gp.startsWith(G + "/"))) {
        let newGp: string;
        if (gp === G) {
          newGp = newG;
        } else {
          newGp = newG + gp.substring(G.length);
        }
        const newTags = host.tags ? host.tags.filter((t) => !t.startsWith(TAG_GROUP_PREFIX)) : [];
        newTags.push(`g-${newGp}`);
        updatedHosts.push({
          ...host,
          tags: newTags,
        });
      }
    }

    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);

    // Save next groups
    const groupsRes = await fetch("/api/groups", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(nextGroups),
    });

    if (groupsRes.ok) {
      setGroups(nextGroups);

      // Update expanded groups state
      setExpandedGroups((prev) => {
        const next = new Set<string>();
        for (const path of prev) {
          if (path === G) {
            next.add(newG);
          } else if (path.startsWith(G + "/")) {
            next.add(newG + path.substring(G.length));
          } else {
            next.add(path);
          }
        }
        localStorage.setItem(BROWSER_STORAGE_KEY_EXPANDED_GROUPS, JSON.stringify(Array.from(next)));
        return next;
      });
    } else {
      dialogs.alert("Failed to save renamed group");
      return;
    }

    // Save each updated host in backend
    for (const h of updatedHosts) {
      const url = h.source === "config" ? `/api/hosts/${h.name}` : `/api/hosts`;
      const method = h.source === "config" ? METHOD_PUT : METHOD_POST;
      await fetch(url, {
        method,
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          [HEADER_CONTENT_TYPE]: MIME_JSON,
        },
        body: JSON.stringify(h),
      });
    }

    fetchHosts();
  }, [groupContextMenu, groups, hosts, getHostGroupPath, fetchHosts]);

  const handleSaveHost = useCallback(async () => {
    const { hostFormData } = getStore();
    if (!hostFormData.hostname) {
      return;
    }
    const finalName = hostFormData.name.trim() || hostFormData.hostname.trim();
    let token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const { editHostName: editingHostName } = getStore();
    const url = editingHostName ? `/api/hosts/${editingHostName}` : `/api/hosts`;
    const method = editingHostName ? METHOD_PUT : METHOD_POST;

    const parsedTags = hostFormData.tags
      .replace(/,/g, " ")
      .split(/\s+/)
      .filter((t) => t.trim() !== "");

    let clearPassword = hostFormData.clear_password;
    let passwordVal = hostFormData.password;

    if (hostFormData.password_exists) {
      if (hostFormData.password === "") {
        clearPassword = true;
        passwordVal = "";
      } else if (hostFormData.password === PASSWORD_PLACEHOLDER) {
        passwordVal = "";
      }
    }

    const payload: HostData = {
      ...hostFormData,
      name: finalName,
      tags: parsedTags,
      password: passwordVal,
      clear_password: clearPassword,
    };

    if (!isValidHostname(payload.name) || !isValidHostname(payload.hostname)) {
      dialogs.alert("Invalid hostname or name");
      return;
    }

    const res = await fetch(url, {
      method,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 403) {
      const text = await res.text();
      if (text.includes("encryption key not set")) {
        const appPwd = await dialogs.promptPassword(
          "The password store is locked. Enter your CozySSH app password to unlock and save the host password:",
        );
        if (!appPwd) {
          return;
        }

        const loginRes = await fetch("/api/login", {
          method: METHOD_POST,
          headers: {
            [HEADER_CONTENT_TYPE]: MIME_JSON,
          },
          body: JSON.stringify({ password: appPwd }),
        });

        if (loginRes.ok) {
          const loginData = (await loginRes.json()) as { token: string };
          token = loginData.token;
          localStorage.setItem(BROWSER_STORAGE_KEY_TOKEN, token);

          const retryRes = await fetch(url, {
            method,
            headers: {
              [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
              [HEADER_CONTENT_TYPE]: MIME_JSON,
            },
            body: JSON.stringify(payload),
          });

          if (retryRes.ok) {
            setInitialHostFormData(null);
            setEditHostDialogOpen(false);
            fetchHosts();
            return;
          } else {
            const retryErr = await retryRes.text();
            dialogs.alert("Failed to save host details after unlocking: " + (retryErr || retryRes.statusText));
          }
        } else {
          dialogs.alert("Incorrect app password. Host was not saved.");
        }
        return;
      }
    }

    if (!res.ok) {
      const text = await res.text();
      dialogs.alert("Failed to save host: " + (text || res.statusText));
      return;
    }

    setInitialHostFormData(null); // Reset dirty state on successful save
    setEditHostDialogOpen(false);
    fetchHosts();
  }, []);

  const handleCloseHostDialog = useCallback((_e: unknown, reason: string) => {
    const { hostFormData, initialHostFormData } = getStore();
    const isDirty = initialHostFormData && JSON.stringify(hostFormData) !== JSON.stringify(initialHostFormData);
    if (isDirty && (reason === "backdropClick" || reason === "escapeKeyDown")) {
      return;
    }
    setEditHostDialogOpen(false);
  }, []);

  const filteredHosts = useMemo(() => {
    const filteredAll = filterHosts(hosts, filterStr);

    const favs = filteredAll.filter((h) => h.is_favourite);
    const nameSorter = (a: HostData, b: HostData) => a.name.localeCompare(b.name);
    const sortedFavs = favs.sort(nameSorter);

    const autos = filteredAll.filter((h) => !h.is_favourite && h.is_auto);
    const hostNameSorter = (a: HostData, b: HostData) => {
      if (a.hostname === b.hostname) {
        return a.name.localeCompare(b.name);
      }
      return a.hostname.localeCompare(b.hostname);
    };
    const sortedAutos = autos.sort(hostNameSorter);

    const treeHosts = filteredAll.filter((h) => !h.is_auto);

    const allGroupPaths = new Set<string>();
    for (const g of groups) {
      const parts = g.split("/");
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        allGroupPaths.add(current);
      }
    }
    for (const host of treeHosts) {
      const gp = getHostGroupPath(host);
      if (gp) {
        const parts = gp.split("/");
        let current = "";
        for (const part of parts) {
          current = current ? `${current}/${part}` : part;
          allGroupPaths.add(current);
        }
      }
    }

    const nodesMap = new Map<string, GroupNode>();
    for (const gp of allGroupPaths) {
      const parts = gp.split("/");
      const name = parts[parts.length - 1];
      nodesMap.set(gp, {
        id: `group:${gp}`,
        type: "group",
        name,
        path: gp,
        children: [],
      });
    }

    const topLevelGroups: GroupNode[] = [];
    for (const [gp, node] of nodesMap.entries()) {
      const parts = gp.split("/");
      if (parts.length === 1) {
        topLevelGroups.push(node);
      } else {
        const parentPath = parts.slice(0, -1).join("/");
        const parentNode = nodesMap.get(parentPath);
        if (parentNode) {
          parentNode.children.push(node);
        }
      }
    }

    const topLevelServers: ServerNode[] = [];
    for (const host of treeHosts) {
      const gp = getHostGroupPath(host);
      const serverNode: ServerNode = {
        id: `server:${host.name}`,
        type: "server",
        name: host.name,
        host,
      };
      if (gp) {
        const parentNode = nodesMap.get(gp);
        if (parentNode) {
          parentNode.children.push(serverNode);
        } else {
          topLevelServers.push(serverNode);
        }
      } else {
        topLevelServers.push(serverNode);
      }
    }

    for (const node of nodesMap.values()) {
      const subGroups = node.children.filter((c) => c.type === "group") as GroupNode[];
      const subServers = node.children.filter((c) => c.type === "server") as ServerNode[];

      subGroups.sort((a, b) => {
        const orderA = getGroupOrder(a.path);
        const orderB = getGroupOrder(b.path);
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });

      subServers.sort((a, b) => {
        const orderA = getHostOrder(a.host);
        const orderB = getHostOrder(b.host);
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });

      node.children = [...subGroups, ...subServers];
    }

    topLevelGroups.sort((a, b) => {
      const orderA = getGroupOrder(a.path);
      const orderB = getGroupOrder(b.path);
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });

    topLevelServers.sort((a, b) => {
      const orderA = getHostOrder(a.host);
      const orderB = getHostOrder(b.host);
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });

    const rawTree = [...topLevelGroups, ...topLevelServers];
    const pruneTree = (nodes: TreeNode[]): TreeNode[] => {
      return nodes
        .map((node) => {
          if (node.type === "group") {
            const prunedChildren = pruneTree(node.children);
            return {
              ...node,
              children: prunedChildren,
            };
          }
          return node;
        })
        .filter((node) => {
          if (node.type === "group") {
            if (!filterStr.trim()) return true;
            return node.children.length > 0 || node.name.toLowerCase().includes(filterStr.toLowerCase());
          }
          return true;
        });
    };
    const prunedTree = pruneTree(rawTree);

    return {
      favourite: sortedFavs,
      auto: sortedAutos,
      treeNodes: prunedTree,
    };
  }, [hosts, groups, filterStr, getHostGroupPath, getGroupOrder, getHostOrder]);

  const [flatList, flatListIds] = useMemo(() => {
    const list: SelectableItem[] = [];
    const ids: string[] = [];

    if (favExpanded) {
      for (const host of filteredHosts.favourite) {
        const item: SelectableItem = {
          id: `sidebar-fav-${host.name}`,
          type: "server",
          section: "fav",
          host,
        };
        list.push(item);
        ids.push(item.id);
      }
    }

    if (allExpanded) {
      const traverseTree = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (node.type === "group") {
            const item: SelectableItem = {
              id: `sidebar-tree-group-${node.path}`,
              type: "group",
              path: node.path,
              name: node.name,
            };
            list.push(item);
            ids.push(item.id);

            if (expandedGroups.has(node.path)) {
              traverseTree(node.children);
            }
          } else {
            const item: SelectableItem = {
              id: `sidebar-tree-server-${node.host.name}`,
              type: "server",
              section: "tree",
              host: node.host,
            };
            list.push(item);
            ids.push(item.id);
          }
        }
      };
      traverseTree(filteredHosts.treeNodes);
    }

    if (autoExpanded) {
      for (const host of filteredHosts.auto) {
        const item: SelectableItem = {
          id: `sidebar-auto-${host.name}`,
          type: "server",
          section: "auto",
          host,
        };
        list.push(item);
        ids.push(item.id);
      }
    }

    return [list, ids];
  }, [filteredHosts, expandedGroups, favExpanded, allExpanded, autoExpanded]);

  const lastSelectedItemId = useRef<string | null>(null);
  const lastFilterStr = useRef(filterStr);

  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < flatList.length) {
      lastSelectedItemId.current = flatList[selectedIndex].id;
    } else {
      lastSelectedItemId.current = null;
    }
  }, [selectedIndex, flatList]);

  useEffect(() => {
    if (filterStr !== lastFilterStr.current) {
      lastFilterStr.current = filterStr;
      if (filterStr.trim() !== "" && flatList.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedIndex(0);
      } else {
        setSelectedIndex(-1);
      }
      return;
    }

    if (lastSelectedItemId.current) {
      const idx = flatListIds.indexOf(lastSelectedItemId.current);
      if (idx !== -1) {
        setSelectedIndex(idx);
        return;
      }
    }

    if (selectedIndex >= flatList.length) {
      setSelectedIndex(flatList.length - 1);
    }
  }, [flatList, flatListIds, filterStr, selectedIndex]);

  const handleFilterKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "arrowdown" || (e.altKey && key === "j")) {
        const step = (key === "j" ? e.shiftKey : e.altKey)
          ? e.ctrlKey
            ? flatList.length
            : getIntVar(VAR_CS_SCROLL_ITEMS, DEFAULT_SCROLL_ITEMS)
          : 1;
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.min(prev + step, flatList.length - 1));
      } else if (key === "arrowup" || (e.altKey && key === "k")) {
        const step = (key === "k" ? e.shiftKey : e.altKey)
          ? e.ctrlKey
            ? flatList.length
            : getIntVar(VAR_CS_SCROLL_ITEMS, DEFAULT_SCROLL_ITEMS)
          : 1;
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.max(prev - step, 0));
      } else if (key === "enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.altKey) {
          const el = document.getElementById(flatListIds[selectedIndex]);
          if (el) {
            el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
          }
        } else {
          if (selectedIndex >= 0 && selectedIndex < flatList.length) {
            const selectedItem = flatList[selectedIndex];
            if (selectedItem.type === "group") {
              toggleGroupExpanded(selectedItem.path);
            } else {
              openHost(selectedItem.host.name);
              document.getElementById(ID_SIDEBAR_FILTER)?.blur();
            }
          }
        }
      }
    },
    [flatListIds, flatList, selectedIndex],
  );

  const uniqueTags = useMemo(() => {
    const set = new Set<string>();
    hosts.forEach((h) => {
      if (h.tags) {
        h.tags.forEach((t) => {
          if (t !== TAG_FAV && !t.startsWith(TAG_GROUP_PREFIX) && !t.startsWith(TAG_ORDER_PREFIX)) {
            set.add(t);
          }
        });
      }
    });
    return Array.from(set).sort();
  }, [hosts]);

  useEffect(() => {
    setTimeout(() => {
      if (tagsContainerRef.current) {
        setShowTagsToggle(tagsContainerRef.current.scrollHeight > 60);
      }
    }, 0);
  }, [uniqueTags, filterStr]);

  const renderTreeNode = (node: TreeNode, level: number): React.ReactNode => {
    if (node.type === "group") {
      const groupItemIdx = flatList.findIndex((item) => item.type === "group" && item.path === node.path);
      const isSelected = selectedIndex >= 0 && selectedIndex < flatList.length && selectedIndex === groupItemIdx;
      return (
        <React.Fragment key={node.id}>
          <TreeGroupItem
            node={node}
            level={level}
            isSelected={isSelected}
            isMobile={isMobile}
            isTouch={isTouch}
            expandedGroups={expandedGroups}
            toggleGroupExpanded={toggleGroupExpanded}
            setDraggedItem={setDraggedItem}
            draggedItem={draggedItem}
            dragOverTarget={dragOverTarget}
            setDragOverTarget={setDragOverTarget}
            moveServer={moveServer}
            moveGroup={moveGroup}
            setGroupContextMenu={setGroupContextMenu}
            setGroupContextMenuOpen={setGroupContextMenuOpen}
          />
          <Collapse in={expandedGroups.has(node.path)} timeout="auto" unmountOnExit>
            <List disablePadding>{node.children.map((child) => renderTreeNode(child, level + 1))}</List>
          </Collapse>
        </React.Fragment>
      );
    } else {
      const serverItemIdx = flatList.findIndex(
        (item) => item.type === "server" && item.section === "tree" && item.host.name === node.host.name,
      );
      const isSelected = selectedIndex >= 0 && selectedIndex < flatList.length && selectedIndex === serverItemIdx;
      return (
        <TreeServerItem
          key={node.id}
          node={node}
          level={level}
          isSelected={isSelected}
          isMobile={isMobile}
          isTouch={isTouch}
          filterStr={filterStr}
          draggedItem={draggedItem}
          dragOverTarget={dragOverTarget}
          setDraggedItem={setDraggedItem}
          setDragOverTarget={setDragOverTarget}
          moveServer={moveServer}
          getHostGroupPath={getHostGroupPath}
          handleContextMenu={handleContextMenu}
        />
      );
    }
  };

  const handleRootDragOver = (e: React.DragEvent) => {
    if (!draggedItem) return;
    e.preventDefault();
    setDragOverTarget({ id: "root", effect: "inside" });
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTarget(null);
    if (!draggedItem) return;

    if (draggedItem.type === "server") {
      await moveServer(draggedItem.name, null, null);
    }
    setDraggedItem(null);
  };

  return (
    <Drawer
      id="sidebar"
      variant={isMobile ? "temporary" : "permanent"}
      open={isMobile ? mobileOpen : true}
      onClose={closeMobileSidebar}
      ModalProps={{ keepMounted: true }}
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: "border-box" },
      }}
    >
      <Toolbar sx={{ justifyContent: "space-between", pr: 1 }}>
        <Typography variant="h6" noWrap sx={{ fontWeight: "bold" }}>
          <span>{APP_NAME}</span>&nbsp;
          <span title={sysHostname}>{sysHostname}</span>
        </Typography>
        <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
          <MoreVertIcon />
        </IconButton>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          <MenuItem
            id="refresh-menu-item"
            onClick={() => {
              setAnchorEl(null);
              onRefresh();
            }}
          >
            Refresh
          </MenuItem>
          <MenuItem
            id="dashboard-menu-item"
            onClick={() => {
              setAnchorEl(null);
              setSettingsOpen(true);
              if (isMobile) {
                closeMobileSidebar();
              }
            }}
          >
            Dashboard
          </MenuItem>
          <MenuItem
            id="open-scratchpad-menu-item"
            onClick={() => {
              setAnchorEl(null);
              onOpenScratchpad();
            }}
          >
            Open Scratchpad
          </MenuItem>
          <MenuItem
            id="logout-menu-item"
            className="hide-desktop"
            onClick={async () => {
              setAnchorEl(null);
              if (
                await dialogs.confirm("Log out of current device?", "All data stored in this browser will be cleared.")
              ) {
                logout();
              }
            }}
          >
            Logout
          </MenuItem>
          <MenuItem
            id="logout-all-menu-item"
            className="hide-desktop"
            onClick={async () => {
              setAnchorEl(null);
              if (
                await dialogs.confirm(
                  "Log out of all browser sessions?",
                  "This will invalidate all active sessions and require you to sign in again on all devices." +
                    " All data stored in this browser will be cleared.",
                )
              ) {
                logoutAll();
              }
            }}
          >
            Logout All
          </MenuItem>
        </Menu>
      </Toolbar>

      <Box sx={{ px: 2, pb: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <TextField
            size="small"
            type="search"
            id="sidebar-filter"
            placeholder="Filter hosts or #tag..."
            title="<Alt + I>"
            value={filterStr}
            onChange={(e) => setFilterStr(e.target.value)}
            onKeyDownCapture={handleFilterKeyDown}
            sx={{ flexGrow: 1 }}
          />
          <IconButton
            size="small"
            title="New Server"
            onClick={handleAddOpen}
            sx={{ bgcolor: "action.hover", border: "1px solid #ccc" }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>

        {uniqueTags.length > 0 && (
          <Box sx={{ position: "relative" }}>
            <Box
              id="sidebar-tags"
              ref={tagsContainerRef}
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: 0.75,
                maxHeight: tagsExpanded ? "none" : "60px",
                overflow: "hidden",
                px: 0.5,
                py: 0.5,
              }}
            >
              {uniqueTags.map((tag) => {
                const tagLower = tag.toLowerCase();
                const filterStrLower = filterStr.toLowerCase().trim();
                const isActive = filterStrLower.includes(`#${tagLower} `) || filterStrLower.endsWith(`#${tagLower}`);
                return (
                  <Chip
                    key={tag}
                    label={`#${tag}`}
                    data-tag={tag}
                    size="small"
                    className="sidebar-tag"
                    color={isActive ? "primary" : "default"}
                    variant={isActive ? "filled" : "outlined"}
                    onClick={() => {
                      if (isActive && filterStr.trim() === `#${tag}`) {
                        setFilterStr("");
                      } else {
                        setFilterStr(`#${tag} `);
                      }
                      document.getElementById(ID_SIDEBAR_FILTER)?.focus();
                    }}
                    onContextMenu={(e) => handleTagContextMenu(e, tag)}
                    sx={{
                      borderRadius: "6px",
                      fontWeight: isActive ? 600 : 400,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      "&:hover": {
                        backgroundColor: isActive ? "primary.dark" : "action.hover",
                      },
                    }}
                  />
                );
              })}
            </Box>
            {showTagsToggle && (
              <Box sx={{ textAlign: "center", mt: -0.5 }}>
                <IconButton size="small" onClick={() => setTagsExpanded(+!tagsExpanded)} sx={{ p: 0 }}>
                  {tagsExpanded ? (
                    <Typography variant="caption" color="text.secondary">
                      ▲
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      ▼
                    </Typography>
                  )}
                </IconButton>
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Box sx={{ overflow: "auto", display: "flex", flexDirection: "column" }}>
        {loading ? (
          <Box sx={{ p: 2, alignSelf: "center" }}>
            <CircularProgress size={24} />
          </Box>
        ) : null}
        <List>
          <ListItem
            ref={localShellRef}
            onContextMenu={(e) => {
              e.preventDefault();
              setLocalShellContextMenuOpen(true);
            }}
            id="sidebar-host-local"
            className="sidebar-host"
            disablePadding
            data-name={LOCAL_NAME}
          >
            <ListItemButton
              onClick={(e) => {
                if (e.ctrlKey) {
                  openHostInNewWindow(LOCAL_NAME);
                } else {
                  openHost(LOCAL_NAME);
                  setMobileOpen(false);
                }
              }}
            >
              <ListItemIcon>
                <ComputerIcon />
              </ListItemIcon>
              <ListItemText primary="Local Shell" />
            </ListItemButton>
          </ListItem>

          {(filteredHosts.favourite.length > 0 ||
            filteredHosts.treeNodes.length > 0 ||
            filteredHosts.auto.length > 0) && <Divider sx={{ my: 1 }} />}

          {filteredHosts.favourite.length > 0 && (
            <>
              <Box
                onClick={toggleFavExpanded}
                sx={{
                  px: 2,
                  py: 0.5,
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                  userSelect: "none",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                {favExpanded ? (
                  <ExpandMoreIcon fontSize="small" sx={{ mr: 0.5, opacity: 0.7 }} />
                ) : (
                  <ChevronRightIcon fontSize="small" sx={{ mr: 0.5, opacity: 0.7 }} />
                )}
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: "0.08em" }}
                >
                  FAVOURITES
                </Typography>
              </Box>
              <Collapse in={favExpanded} timeout={0} unmountOnExit>
                <List disablePadding>
                  {filteredHosts.favourite.map((host) => {
                    const itemIdx = flatList.findIndex((item) => item.id === `sidebar-fav-${host.name}`);
                    return (
                      <HostListItem
                        section="fav"
                        key={`fav-${host.name}`}
                        id={`sidebar-fav-${host.name}`}
                        filter={filterStr}
                        host={host}
                        onContextMenu={handleContextMenu}
                        isSelected={selectedIndex === itemIdx}
                      />
                    );
                  })}
                </List>
              </Collapse>
              <Divider sx={{ my: 1 }} />
            </>
          )}

          <Box
            onClick={toggleAllExpanded}
            sx={{
              px: 2,
              py: 0.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
              userSelect: "none",
              "&:hover": { bgcolor: "action.hover" },
              "&:hover .add-group-btn": { opacity: 1 },
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setGroupContextMenu({ element: e.currentTarget, path: "" });
              setGroupContextMenuOpen(true);
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center" }}>
              {allExpanded ? (
                <ExpandMoreIcon fontSize="small" sx={{ mr: 0.5, opacity: 0.7 }} />
              ) : (
                <ChevronRightIcon fontSize="small" sx={{ mr: 0.5, opacity: 0.7 }} />
              )}
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: "0.08em" }}>
                ALL
              </Typography>
            </Box>
            <IconButton
              className="add-group-btn"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleAddTopLevelGroupClick();
              }}
              sx={{ p: 0, opacity: 0.6, transition: "opacity 0.2s", "&:hover": { opacity: 1 } }}
              title="Add Group"
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>

          <Collapse in={allExpanded} timeout={0} unmountOnExit>
            <Box
              onDragOver={handleRootDragOver}
              onDrop={handleRootDrop}
              sx={{
                minHeight: 40,
                bgcolor: dragOverTarget?.id === "root" ? "action.selected" : "transparent",
                borderRadius: 1,
                transition: "background-color 0.2s",
                border: dragOverTarget?.id === "root" ? "1px dashed" : "none",
                borderColor: "primary.main",
              }}
            >
              {filteredHosts.treeNodes.length > 0 && filteredHosts.treeNodes.map((node) => renderTreeNode(node, 0))}
            </Box>
          </Collapse>

          {filteredHosts.auto.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Box
                onClick={toggleAutoExpanded}
                sx={{
                  px: 2,
                  py: 0.5,
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                  userSelect: "none",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                {autoExpanded ? (
                  <ExpandMoreIcon fontSize="small" sx={{ mr: 0.5, opacity: 0.7 }} />
                ) : (
                  <ChevronRightIcon fontSize="small" sx={{ mr: 0.5, opacity: 0.7 }} />
                )}
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: "0.08em" }}
                >
                  AUTO
                </Typography>
              </Box>
              <Collapse in={autoExpanded} timeout={0} unmountOnExit>
                <List disablePadding>
                  {filteredHosts.auto.map((host) => {
                    const itemIdx = flatList.findIndex((item) => item.id === `sidebar-auto-${host.name}`);
                    return (
                      <HostListItem
                        section="auto"
                        key={`auto-${host.name}`}
                        id={`sidebar-auto-${host.name}`}
                        filter={filterStr}
                        host={host}
                        onContextMenu={handleContextMenu}
                        isSelected={selectedIndex === itemIdx}
                      />
                    );
                  })}
                </List>
              </Collapse>
            </>
          )}
        </List>
      </Box>

      <Menu
        open={localShellContextMenuOpen}
        onClose={() => setLocalShellContextMenuOpen(false)}
        anchorEl={() => localShellRef.current}
      >
        {shells.map((shell, idx) => (
          <MenuItem
            key={idx}
            onClick={() => {
              setLocalShellContextMenuOpen(false);
              openHost(idx > 0 ? localShellHost(shell) : LOCAL_NAME);
              setMobileOpen(false);
            }}
          >
            {shell.name + (idx === 0 ? " (Default)" : idx === 1 ? " (Alternative)" : "")}
          </MenuItem>
        ))}
      </Menu>

      {/* Host Context Menu */}
      <Menu open={contextMenuOpen} onClose={() => setContextMenuOpen(false)} anchorEl={contextMenu?.element}>
        <MenuItem onClick={handleEditOpen}>Edit {contextMenu?.target.name}</MenuItem>
        <MenuItem
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            setContextMenuOpen(false);
            openHostInNewWindow(target.name);
          }}
        >
          Open (New Window)
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            setContextMenuOpen(false);
            openHost(target.name, { target: "_self" });
            setMobileOpen(false);
          }}
        >
          Open (In Current Tab)
        </MenuItem>
        <MenuItem
          className="hide-desktop"
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            setContextMenuOpen(false);
            const url = `${window.location.origin}/#${
              target.source !== "known_hosts" ? target.name : `${target.user || "root"}@${target.hostname}`
            }`;
            navigator.clipboard.writeText(url);
          }}
        >
          Copy URL
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            setContextMenuOpen(false);
            let command = `ssh`;
            if (target.identity_file) {
              command += ` -i "${target.identity_file}"`;
            }
            if (target.proxy_jump) {
              const jumpServers = target.proxy_jump.split(",").map((name) => {
                name = name.trim();
                const server = hosts.find((h) => h.name === name);
                if (!server) {
                  return name;
                }
                if (server.port !== "22") {
                  return `${server.user}@${server.hostname}:${server.port}`;
                }
                return `${server.user}@${server.hostname}`;
              });
              command += ` -J ${jumpServers.join(",")}`;
            }
            if (target.remote_command) {
              if (/\b(?:sudo|vim|vi|nano|top|htop|btop|tmux|screen)\b/.test(target.remote_command)) {
                command += ` -t`;
              }
              command += ` -o "RemoteCommand=${target.remote_command}"`;
            }
            if (target.address_family) {
              command += ` -o "AddressFamily=${target.address_family}"`;
            }
            if (target.user_known_hosts_file) {
              command += ` -o "UserKnownHostsFile=${target.user_known_hosts_file}"`;
            }
            if (target.strict_host_key_checking) {
              command += ` -o "StrictHostKeyChecking=${target.strict_host_key_checking}"`;
            }
            if (target.host_key_algorithms) {
              command += ` -o "HostKeyAlgorithms=${target.host_key_algorithms}"`;
            }
            if (target.local_forward) {
              const forwards = target.local_forward
                .split(/[\r\n]+/)
                .map((forward) => forward.trim())
                .filter((forward) => forward && !forward.startsWith("#"))
                .map((forward) => ` -L "${forward.split(/\s+/).join(":")}"`);
              command += forwards.join("");
            }
            if (target.remote_forward) {
              const forwards = target.remote_forward
                .split(/[\r\n]+/)
                .map((forward) => forward.trim())
                .filter((forward) => forward && !forward.startsWith("#"))
                .map((forward) => ` -R "${forward.split(/\s+/).join(":")}"`);
              command += forwards.join("");
            }
            if (target.port && target.port !== "22") {
              command += ` -p ${target.port}`;
            }
            command += ` ${target.user}@${target.hostname}`;
            navigator.clipboard.writeText(command);
          }}
        >
          Copy SSH Command
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            setContextMenuOpen(false);
            let command = `ssh-copy-id`;
            if (target.identity_file) {
              command += ` -i "${target.identity_file}"`;
            }
            if (target.port !== "22") {
              command += ` -p ${target.port}`;
            }
            command += ` ${target.user}@${target.hostname}`;
            navigator.clipboard.writeText(command);
          }}
        >
          Copy ssh-copy-id Command
        </MenuItem>
        <MenuItem onClick={handleRunCopyID}>Run ssh-copy-id</MenuItem>
        <MenuItem onClick={handleToggleFavourite}>
          {contextMenu?.target.is_favourite ? "Remove From Favourite" : "Add To Favourite"}
        </MenuItem>
        {contextMenu?.target.source === "config" && (
          <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
            Delete Host
          </MenuItem>
        )}
        {contextMenu && contextMenu.section === "tree" && getHostGroupPath(contextMenu.target) === null && (
          <MenuItem onClick={handleAddTopLevelGroupClick}>Add Top-Level Group</MenuItem>
        )}
      </Menu>

      <Menu open={tagContextMenuOpen} onClose={() => setTagContextMenuOpen(false)} anchorEl={tagContextMenu?.element}>
        <MenuItem onClick={handleOpenAllServers}>Open All ({tagContextMenu?.tag})</MenuItem>
        <MenuItem onClick={handleOpenSplitServers}>Open All (Split Screen)</MenuItem>
        <MenuItem onClick={handleOpenAllServersInNewWindow}>Open All (New Window)</MenuItem>
        <MenuItem onClick={handleCopyTagUrl}>Copy URL</MenuItem>
      </Menu>

      {/* Group Context Menu */}
      <Menu
        open={groupContextMenuOpen}
        onClose={() => setGroupContextMenuOpen(false)}
        anchorEl={groupContextMenu?.element}
      >
        <MenuItem onClick={handleOpenGroupAll}>Open All ({groupContextMenu?.path})</MenuItem>
        <MenuItem onClick={handleOpenGroupAllInNewWindow}>Open All (New Window)</MenuItem>
        <MenuItem onClick={handleOpenGroupAllSplitScreen}>Open All (Split Screen)</MenuItem>
        <MenuItem onClick={handleAddSubGroupClick}>Add Sub-Group</MenuItem>
        <MenuItem onClick={handleAddTopLevelGroupClick}>Add Top-Level Group</MenuItem>
        {groupContextMenu?.path && <MenuItem onClick={handleRenameGroupClick}>Rename Group</MenuItem>}
        <MenuItem onClick={handleDeleteGroupClick} sx={{ color: "error.main" }}>
          Delete Group
        </MenuItem>
      </Menu>

      {/* Dashboard Dialog */}
      <Dialog
        id="dashboard-dialog"
        open={settingsOpen}
        disableRestoreFocus
        onClose={() => {
          setSettingsOpen(false);
          triggerFocus();
        }}
        fullWidth
        maxWidth="lg"
        sx={{ "& .MuiDialog-paper": { overflow: "hidden" } }}
      >
        <DialogTitle>Dashboard</DialogTitle>
        <Box sx={{ borderBottom: 1, borderColor: "divider", px: 3 }}>
          <Tabs
            value={dialogTab}
            onChange={(_, newVal) => setDialogTab(newVal)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            <Tab label="Sessions" />
            <Tab label="Tunnels" />
            <Tab label="Passwords" />
            <Tab label="Settings" />
            <Tab label="Sync" />
            <Tab label="Shortcuts" />
            <Tab label="About" />
          </Tabs>
        </Box>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ p: 3, pt: 1, minWidth: 0 }}>
            {dialogTab === 0 && (
              <List dense sx={{ border: "1px solid #ddd", borderRadius: 1 }}>
                {pinnedSessions.map((ps) => {
                  const canAttach = !activeSessionIds.includes(ps.id);
                  return (
                    <ListItem key={ps.id} divider>
                      <ListItemText primary={ps.title} secondary={`${ps.host} (Listeners: ${ps.listenerCount})`} />
                      {canAttach && (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => onAttach(ps.id, ps.host, ps.title, ps.isLocked)}
                        >
                          Attach
                        </Button>
                      )}
                    </ListItem>
                  );
                })}
                {pinnedSessions.length === 0 && (
                  <ListItem>
                    <ListItemText primary="No pinned sessions" />
                  </ListItem>
                )}
              </List>
            )}

            {dialogTab === 1 && (
              <>
                <Typography variant="subtitle2" sx={{ fontSize: "1rem", fontWeight: "bold", mb: 2 }}>
                  Active Port Forwarding Tunnels
                </Typography>
                {activeTunnels.length > 0 ? (
                  <TableContainer
                    component={Paper}
                    sx={{
                      maxHeight: 350,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      boxShadow: "none",
                    }}
                  >
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: "bold" }}>SSH Host</TableCell>
                          <TableCell sx={{ fontWeight: "bold" }}>Type</TableCell>
                          <TableCell sx={{ fontWeight: "bold" }}>Local Address</TableCell>
                          <TableCell sx={{ fontWeight: "bold" }}>Remote Host:Port</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {activeTunnels.map((tunnel, idx) => (
                          <TableRow key={idx} hover>
                            <TableCell>{tunnel.hostName}</TableCell>
                            <TableCell>
                              <Chip
                                label={tunnel.type.toUpperCase()}
                                size="small"
                                color={tunnel.type === "local" ? "primary" : "secondary"}
                                variant="outlined"
                                sx={{ fontWeight: "bold" }}
                              />
                            </TableCell>
                            <TableCell sx={{ fontFamily: "monospace" }}>
                              {tunnel.bindAddr}:{tunnel.bindPort}
                            </TableCell>
                            <TableCell sx={{ fontFamily: "monospace" }}>
                              {tunnel.remoteHost}:{tunnel.remotePort}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Box
                    sx={{ py: 4, textAlign: "center", border: "1px dashed", borderColor: "divider", borderRadius: 1 }}
                  >
                    <Typography color="text.secondary">No active port forwarding tunnels.</Typography>
                  </Box>
                )}
              </>
            )}

            {dialogTab === 2 && (
              <>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontSize: "1rem", fontWeight: "bold" }}>
                    Saved Passwords
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {!passwordsState.locked && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="warning"
                        onClick={handleLock}
                        sx={{
                          py: 0.25,
                          px: 1,
                          minWidth: 0,
                          textTransform: "none",
                          fontSize: "typography.caption.fontSize",
                          height: 24,
                        }}
                      >
                        Lock
                      </Button>
                    )}
                    <Chip
                      icon={passwordsState.locked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
                      label={passwordsState.locked ? "Locked" : "Unlocked"}
                      color={passwordsState.locked ? "warning" : "success"}
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                </Box>
                {passwordsState.keys.length > 0 ? (
                  <TableContainer
                    component={Paper}
                    sx={{
                      maxHeight: 350,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      boxShadow: "none",
                    }}
                  >
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: "bold" }}>Key</TableCell>
                          <TableCell sx={{ fontWeight: "bold" }}>Password</TableCell>
                          <TableCell align="right" sx={{ fontWeight: "bold" }}>
                            Actions
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {passwordsState.keys.map((key) => {
                          const isRevealed = key in revealedPasswords;
                          const displayVal = isRevealed ? revealedPasswords[key] : PASSWORD_PLACEHOLDER;
                          return (
                            <TableRow key={key} hover>
                              <TableCell sx={{ fontFamily: "monospace" }}>{key}</TableCell>
                              <TableCell sx={{ fontFamily: "monospace" }}>{displayVal}</TableCell>
                              <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                                <Tooltip title={isRevealed ? "Hide" : "Reveal"}>
                                  <IconButton
                                    size="small"
                                    onClick={() => {
                                      if (isRevealed) {
                                        setRevealedPasswords((prev) => {
                                          const next = { ...prev };
                                          delete next[key];
                                          return next;
                                        });
                                      } else {
                                        handleReveal(key);
                                      }
                                    }}
                                  >
                                    {isRevealed ? (
                                      <VisibilityOffIcon fontSize="small" />
                                    ) : (
                                      <VisibilityIcon fontSize="small" />
                                    )}
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Copy Password">
                                  <IconButton size="small" onClick={() => handleCopyPassword(key)}>
                                    <ContentCopyIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Change">
                                  <IconButton size="small" color="primary" onClick={() => handleChangePassword(key)}>
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Delete">
                                  <IconButton size="small" color="error" onClick={() => handleDeletePassword(key)}>
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Box
                    sx={{ py: 4, textAlign: "center", border: "1px dashed", borderColor: "divider", borderRadius: 1 }}
                  >
                    <Typography color="text.secondary">No passwords saved in the store.</Typography>
                  </Box>
                )}
              </>
            )}

            {dialogTab === 3 && (
              <>
                <Typography variant="subtitle2" gutterBottom>
                  Service Worker & Cache
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Status:
                  </Typography>
                  <Chip
                    label={swStatus}
                    size="small"
                    color={swStatus === "active" ? "success" : "default"}
                    variant="outlined"
                    sx={{ fontWeight: "bold" }}
                  />
                </Box>
                <Button variant="outlined" color="error" size="small" onClick={handleClearCache} sx={{ mt: 1 }}>
                  Force Clear Cache & Unregister SW
                </Button>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Save Password Setting
                </Typography>
                <ButtonGroup fullWidth size="small" sx={{ mt: 1, mb: 1 }}>
                  <Button
                    variant={savePassword === "ask" ? "contained" : "outlined"}
                    onClick={() => onSavePasswordChange("ask")}
                  >
                    ask (default)
                  </Button>
                  <Button
                    variant={savePassword === "always" ? "contained" : "outlined"}
                    onClick={() => onSavePasswordChange("always")}
                  >
                    always
                  </Button>
                  <Button
                    variant={savePassword === "never" ? "contained" : "outlined"}
                    onClick={() => onSavePasswordChange("never")}
                  >
                    never
                  </Button>
                </ButtonGroup>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Change App Password
                </Typography>
                <TextField
                  fullWidth
                  label="New Password"
                  type="password"
                  size="small"
                  margin="dense"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                />
                <TextField
                  fullWidth
                  label="Confirm Password"
                  type="password"
                  size="small"
                  margin="dense"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                />
                <Button
                  variant="contained"
                  onClick={handleSavePassword}
                  disabled={!newPwd}
                  sx={{ mt: 2 }}
                  disableElevation
                >
                  Save Password
                </Button>
              </>
            )}

            {dialogTab === 4 && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1, mt: -1 }}>
                  <b>WebDAV Synchronization</b>: Sync CozySSH data (buttons, vars, scratchpad) with a custom WebDAV
                  directory.
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1.5,
                    mt: 1,
                    p: 2,
                    bgcolor: "action.hover",
                    borderRadius: 1,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 1.5,
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: "bold" }}>
                        Sync Status:
                      </Typography>
                      <Chip
                        label={syncStatus.toUpperCase()}
                        size="small"
                        color={
                          !webdavEnabled
                            ? "default"
                            : syncStatus === "success"
                              ? "success"
                              : syncStatus === "syncing"
                                ? "info"
                                : syncStatus === "error"
                                  ? "error"
                                  : "default"
                        }
                        sx={{ fontWeight: "bold" }}
                      />
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Button
                        variant={webdavEnabled ? "contained" : "outlined"}
                        color={webdavEnabled ? "success" : "primary"}
                        size="small"
                        onClick={handleToggleWebdavEnabled}
                        disabled={!currentWebdavUrl}
                        sx={{ textTransform: "none" }}
                      >
                        {webdavEnabled ? "Disable Sync" : "Enable Sync"}
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={handleSyncNow}
                        disabled={!webdavEnabled || syncStatus === "syncing"}
                        size="small"
                        sx={{ textTransform: "none" }}
                      >
                        {syncStatus === "syncing" ? "Syncing..." : "Sync Now"}
                      </Button>
                    </Box>
                  </Box>
                  {syncError && webdavEnabled && (
                    <Box
                      sx={{
                        p: 1.5,
                        bgcolor: "error.light",
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: "error.main",
                      }}
                    >
                      <Typography variant="body2" color="error.contrastText">
                        {syncError}
                      </Typography>
                    </Box>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    Last Synced: {syncTime ? new Date(syncTime).toLocaleString() : "Never"}
                  </Typography>
                </Box>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: "bold" }}>
                  WebDAV Server Configuration
                </Typography>
                <TextField
                  fullWidth
                  label="Current Server URL"
                  size="small"
                  margin="dense"
                  value={currentWebdavUrl || "(Not configured)"}
                  slotProps={{ input: { readOnly: true } }}
                  disabled
                />
                <TextField
                  fullWidth
                  label="WebDAV Server URL"
                  size="small"
                  margin="dense"
                  placeholder="https://example.com/dav/"
                  value={webdavUrl}
                  onChange={(e) => setWebdavUrl(e.target.value)}
                  disabled={isTestingWebdav}
                />
                <TextField
                  fullWidth
                  label="WebDAV Username"
                  size="small"
                  margin="dense"
                  value={webdavUser}
                  onChange={(e) => setWebdavUser(e.target.value)}
                  disabled={isTestingWebdav}
                />
                <TextField
                  fullWidth
                  label="WebDAV Password"
                  size="small"
                  margin="dense"
                  placeholder="WebDAV password"
                  value={webdavPassword}
                  onChange={(e) => setWebdavPassword(e.target.value)}
                  disabled={isTestingWebdav}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={useEncryption}
                      onChange={(e) => setUseEncryption(e.target.checked)}
                      disabled={isTestingWebdav || !!currentWebdavUrl}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">Enable End-to-End Encryption (E2EE)</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Encrypt data before uploading to WebDAV server.
                      </Typography>
                    </Box>
                  }
                  sx={{ mt: 1, mb: 1, alignItems: "flex-start" }}
                />
                {useEncryption && (
                  <TextField
                    fullWidth
                    label="WebDAV Master Key (Base64)"
                    size="small"
                    margin="dense"
                    placeholder="Auto-generated if left blank for new servers"
                    value={masterKey}
                    onChange={(e) => setMasterKey(e.target.value)}
                    disabled={isTestingWebdav || !!currentWebdavUrl}
                    helperText="Keep this key safe! You will need it to unlock your encrypted sync session on other devices."
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton disabled={!masterKey} onClick={() => navigator.clipboard.writeText(masterKey)}>
                              <ContentCopyIcon fontSize="small" />
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                )}
                <Typography>
                  <Button
                    variant="contained"
                    onClick={handleSaveWebdav}
                    disabled={
                      isTestingWebdav ||
                      (webdavUrl === currentWebdavUrl &&
                        webdavUser === currentWebdavUser &&
                        webdavPassword === currentWebdavPassword &&
                        useEncryption === webdavEncrypted &&
                        masterKey === currentMasterKey) ||
                      (!!currentWebdavUrl && !webdavUrl && (!!webdavUser || !!webdavPassword))
                    }
                    sx={{ mt: 1, textTransform: "none" }}
                    disableElevation
                  >
                    {isTestingWebdav
                      ? "Verifying & Saving..."
                      : isCleared && currentWebdavUrl
                        ? "Clear Sync Settings"
                        : urlChanged
                          ? "Verify & Save Sync Settings"
                          : "Save Sync Settings"}
                  </Button>
                </Typography>
              </>
            )}

            {dialogTab === 5 && (
              <>
                <Typography variant="subtitle2" gutterBottom>
                  Keyboard Shortcuts
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
                  <b>Alt + O</b> : Open new tab dialog, use <b>← →</b> (or <b>Alt + H/L</b>) to switch view,&nbsp;
                  <b>↓ ↑</b> (or <b>Alt + J/K</b>) to select, <b>Enter</b> to open, <b>Alt + Enter</b> to open in
                  current tab. Use <b>Alt + ↓↑</b> (or&nbsp;
                  <b>Alt + Shift + J/K</b>) to jump through items quickly; Hold <b>Ctrl</b> to jump to top/bottom
                  <br />
                  <b>Alt + A</b> : Open new tab dialog - tabs view
                  <br />
                  <b>Alt + E / Ctrl + Shift + P</b> : Open new tab dialog - buttons view
                  <br />
                  <b>Alt + P</b> : Open new tab dialog - tags view
                  <br />
                  <b>Alt + :</b> : Open new tab dialog - tunnels view
                  <br />
                  <b>Alt + ?</b> : Open new tab dialog - all view
                  <br />
                  <b>Alt + N</b> : Open new default local shell tab
                  <br />
                  <b>Alt + Shift + N</b> : Open new alternative local shell tab
                  <br />
                  <b>Alt + S</b> : Open scratchpad
                  <br />
                  <b>Alt + H / Alt + L</b> : Switch to previous / next pane
                  <br />
                  <b>Alt + Shift + H / Alt + Shift + L</b> : Switch to previous / next tab
                  <br />
                  <b>Alt + 1-9,0</b> : Switch to tab 1-9, last tab
                  <br />
                  <b>Alt + C</b> : Clone active pane in new tab
                  <br />
                  <b>Alt + Shift + C</b> : Clone active pane in same tab (Max 4 panes per tab)
                  <br />
                  <b>Alt + W</b> : Close active pane
                  <br />
                  <b>Alt + Shift + W</b> : Close active tab
                  <br />
                  <b>Ctrl + Alt + Shift + W</b> : Close other tabs
                  <br />
                  <b>Alt + I</b> : Focus sidebar search filter, use <b>↑ ↓</b> to select, <b>Enter</b> to open or&nbsp;
                  <b>Alt + Enter</b> to open context menu.
                  <br />
                  <b>Alt + Shift + I</b> : Focus sidebar search filter and clear current value
                  <br />
                  <b>Alt + G</b> : Focus active terminal session
                  <br />
                  <b>Alt + Shift + G</b> : Focus the first pane of the active tab
                  <br />
                  <b>Alt + Q</b> : Open input dialog
                  <br />
                  <b>Alt + V / Alt + Shift + V</b> : Switch to next / previous group in button bar. Hold <b>Ctrl</b> to
                  include hidden groups
                  <br />
                  <b>Alt + Shift + 1-9,0</b> : Click the button in button bar
                  <br />
                  <b>Alt + J / Alt + K</b> : Scroll terminal down / up by a few lines
                  <br />
                  <b>Alt + Shift + J / Alt + Shift + K</b> : Scroll terminal down / up by a page
                  <br />
                  <b>Ctrl + Alt + Shift + J / Ctrl + Alt + Shift + K</b> : Scroll terminal to bottom / top
                  <br />
                  <b>Alt + Enter</b> : Toggle fullscreen of main terminal area
                  <br />
                  <b>Alt + Backquote</b> : Close any modal (Dialog / Menu / Popover). Similar to <b>Escape</b> but works
                  even if terminal is in fullscreen mode
                  <br />
                  <b>Alt + Shift + Backquote</b> : Force close all modals. Also close all toasts.
                  <br />
                  <b>Alt + - / Alt + +</b> : Decrease / increase terminal font size
                  <br />
                  <b>Alt + Shift + - / Alt + Shift + +</b> : Decrease / increase global & terminal font size
                  <br />
                  <b>Ctrl + Alt + 0</b> : Reset to default global / terminal font size (14 / 15px)
                  <br />
                  <b>Ctrl + Shift + F</b> : Open terminal search box
                  <br />
                  <b>Ctrl + Shift + R</b> : Reconnect current terminal
                  <br />
                  <b>Ctrl + Shift + C</b> : Copy selected text in terminal
                  <br />
                  <b>Ctrl + Shift + V (Windows) / Cmd + V (Mac)</b> : Paste into terminal
                  <br />
                  <b>Ctrl + Alt + Shift + R</b> : Force clear service worker, cache and reload
                  <br />
                  <b>Mouse Select</b> in terminal to copy
                  <br />
                  <b>Mouse Right Click</b> in terminal to paste
                  <br />
                  <b>Alt + Mouse Wheel</b> in terminal to fast scroll up / down
                </Typography>
              </>
            )}

            {dialogTab === 6 && (
              <Box sx={{ textAlign: "center", mt: 4 }}>
                <Typography variant="h5" gutterBottom sx={{ fontWeight: "bold" }}>
                  CozySSH
                </Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  Version: <b>{appVersion}</b>
                  <br />
                  Frontend: <b>{PACKAGE_JSON_VERSION}</b>
                </Typography>
                <Typography variant="body2" sx={{ mt: 3 }}>
                  <a
                    href="https://github.com/sagan/cozyssh"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: theme.palette.primary.main, textDecoration: "none" }}
                  >
                    GitHub Repository
                  </a>
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Host CRUD Dialog */}
      <Dialog
        id="edit-host-dialog"
        data-name={editHostName}
        open={editHostDialogOpen}
        disableRestoreFocus
        onClose={handleCloseHostDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editHostName ? `Edit Host ${editHostName}` : "Add Host"}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              fullWidth
              label="Alias Name"
              size="small"
              type="search"
              value={hostFormData.name}
              onChange={(e) => setHostFormData({ ...hostFormData, name: e.target.value })}
              placeholder={hostFormData.hostname || "e.g. production-database"}
            />
            <TextField
              fullWidth
              label="HostName (IP / Domain)"
              size="small"
              type="search"
              value={hostFormData.hostname}
              onChange={(e) => setHostFormData({ ...hostFormData, hostname: e.target.value })}
              required
              autoFocus={!hostFormData.hostname}
            />
            <Autocomplete
              freeSolo
              options={["root", "ubuntu", "administrator"]}
              value={hostFormData.user}
              onChange={(_event, newValue) => {
                setHostFormData({ ...hostFormData, user: newValue || "" });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  fullWidth
                  label="User"
                  size="small"
                  placeholder="leave empty to use backend current user"
                />
              )}
            />
            <Autocomplete
              freeSolo
              options={["22", "222", "2222"]}
              value={hostFormData.port || ""}
              onChange={(_event, newValue) => {
                setHostFormData({ ...hostFormData, port: newValue || "" });
              }}
              renderInput={(params) => <TextField {...params} fullWidth label="Port" size="small" placeholder="22" />}
            />
            <TextField
              fullWidth
              label="Tags (Optional)"
              size="small"
              type="search"
              value={hostFormData.tags}
              onChange={(e) => setHostFormData({ ...hostFormData, tags: e.target.value })}
              placeholder="e.g. production web"
            />
            <TextField
              fullWidth
              label="IdentityFile (Optional)"
              size="small"
              type="search"
              value={hostFormData.identity_file}
              onChange={(e) => setHostFormData({ ...hostFormData, identity_file: e.target.value })}
              placeholder="~/.ssh/id_ed25519"
            />
            <TextField
              fullWidth
              label="Password (Optional)"
              size="small"
              type="password"
              value={hostFormData.password || ""}
              onChange={(e) => {
                let val = e.target.value;
                if (hostFormData.password === PASSWORD_PLACEHOLDER && val !== PASSWORD_PLACEHOLDER) {
                  if (val.includes("*")) {
                    val = val.replace(/\*/g, "");
                  }
                }
                setHostFormData({ ...hostFormData, password: val });
              }}
              onFocus={(e) => {
                if (hostFormData.password === PASSWORD_PLACEHOLDER) {
                  e.target.select();
                }
              }}
              placeholder="Optional SSH server password"
            />
            <TextField
              fullWidth
              label="ProxyJump (Optional)"
              size="small"
              type="search"
              value={hostFormData.proxy_jump}
              onChange={(e) => setHostFormData({ ...hostFormData, proxy_jump: e.target.value })}
              placeholder="e.g. server-foo,server-bar"
            />
            <Autocomplete
              options={["any", "inet", "inet6"]}
              value={hostFormData.address_family || ""}
              onChange={(_event, newValue) => {
                setHostFormData({ ...hostFormData, address_family: (newValue as "any" | "inet" | "inet6") || "" });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  fullWidth
                  label="AddressFamily (Optional)"
                  size="small"
                  placeholder="any / inet / inet6"
                />
              )}
            />
            <Autocomplete
              freeSolo
              fullWidth
              options={["/dev/null", "NUL"]}
              value={hostFormData.user_known_hosts_file || ""}
              onInputChange={(_event, newValue) =>
                setHostFormData({ ...hostFormData, user_known_hosts_file: newValue || "" })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  fullWidth
                  label="UserKnownHostsFile (Optional)"
                  size="small"
                  placeholder="e.g. ~/.ssh/known_hosts_custom"
                />
              )}
            />
            <Autocomplete
              options={["ask", "yes", "no"]}
              value={hostFormData.strict_host_key_checking || ""}
              onChange={(_event, newValue) => {
                setHostFormData({
                  ...hostFormData,
                  strict_host_key_checking: (newValue as "ask" | "yes" | "no") || "",
                });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  fullWidth
                  label="StrictHostKeyChecking (Optional)"
                  size="small"
                  placeholder="ask / yes / no"
                />
              )}
            />
            <Autocomplete
              freeSolo
              fullWidth
              options={["+ssh-rsa"]}
              value={hostFormData.host_key_algorithms || ""}
              onInputChange={(_event, newValue) =>
                setHostFormData({ ...hostFormData, host_key_algorithms: newValue || "" })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  fullWidth
                  label="HostKeyAlgorithms (Optional)"
                  size="small"
                  placeholder="e.g. +ssh-rsa"
                />
              )}
            />
            <Autocomplete
              freeSolo
              options={remoteCommandOptions}
              value={hostFormData.remote_command}
              onInputChange={(_event, newValue) => {
                setHostFormData({ ...hostFormData, remote_command: newValue });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  fullWidth
                  label="RemoteCommand (Optional)"
                  size="small"
                  placeholder="Use %i for session id"
                />
              )}
            />
            <TextField
              fullWidth
              label="LocalForward (Optional)"
              size="small"
              multiline
              rows={2}
              value={hostFormData.local_forward || ""}
              onChange={(e) => setHostFormData({ ...hostFormData, local_forward: e.target.value })}
              placeholder="e.g. 8080 localhost:80&#10;One rule per line"
            />
            <TextField
              fullWidth
              label="RemoteForward (Optional)"
              size="small"
              multiline
              rows={2}
              value={hostFormData.remote_forward || ""}
              onChange={(e) => setHostFormData({ ...hostFormData, remote_forward: e.target.value })}
              placeholder="e.g. 8080 localhost:80&#10;One rule per line"
            />
            <TextField
              fullWidth
              label="DynamicForward (Optional)"
              size="small"
              multiline
              rows={2}
              value={hostFormData.dynamic_forward || ""}
              onChange={(e) => setHostFormData({ ...hostFormData, dynamic_forward: e.target.value })}
              placeholder="e.g. 1080&#10;or 127.0.0.1:1080&#10;One port per line"
            />
            <TextField
              fullWidth
              label="Comment (Optional)"
              size="small"
              multiline
              rows={2}
              value={hostFormData.comment}
              onChange={(e) => setHostFormData({ ...hostFormData, comment: e.target.value })}
              placeholder="Host description..."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditHostDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveHost} disabled={!hostFormData.hostname}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
}

function HostListItem({
  id,
  section,
  filter,
  host,
  onContextMenu,
  isSelected,
}: {
  id: string;
  section: "fav" | "tree" | "auto";
  filter: string;
  host: HostData;
  onContextMenu: (e: React.MouseEvent, host: HostData, section: "fav" | "tree" | "auto") => void;
  isSelected?: boolean;
}) {
  const itemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: "auto",
        block: "nearest",
      });
    }
  }, [isSelected]);

  const isFavourite = host.is_favourite;
  let secondaryText = `${host.user && host.user !== "root" ? host.user + "@" : ""}${host.hostname}`;
  if (filter && host.comment) {
    const matchedComment = searchStringAny(host.comment, filter);
    if (matchedComment) {
      secondaryText += ` // ${matchedComment}`;
    }
  }
  return (
    <ListItem
      {...(id ? { id } : {})}
      ref={itemRef}
      disablePadding
      onContextMenu={(e) => onContextMenu(e, host, section)}
      data-name={host.name}
      data-tags={host.tags?.join(" ") ?? ""}
      className="sidebar-host"
      sx={{
        bgcolor: isSelected ? "action.hover" : isFavourite ? "action.selected" : "transparent",
        "&:hover": {
          bgcolor: isSelected ? "action.hover" : isFavourite ? "action.focus" : "action.hover",
        },
        mb: 0.2,
        outline: isSelected ? "1px solid" : "none",
        outlineColor: "primary.main",
        outlineOffset: "-1px",
        borderRadius: 1,
      }}
    >
      <ListItemButton
        title={host.comment || ""}
        onClick={(e) => {
          if (e.ctrlKey) {
            openHostInNewWindow(host.name);
          } else {
            openHost(host.name);
            setMobileOpen(false);
          }
        }}
        sx={{ py: 0.5 }}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          {isFavourite ? (
            <StarIcon
              fontSize="small"
              sx={{
                color: "primary.main",
                filter: "drop-shadow(0 0 2px rgba(25, 118, 210, 0.3))",
              }}
            />
          ) : (
            <DnsIcon fontSize="small" color="action" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: isFavourite ? 700 : 500,
                  lineHeight: 1.2,
                  color: isFavourite ? "primary.main" : "text.primary",
                }}
              >
                {section === "auto" ? cutPrefix(host.name, "root@")[0] : host.name}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 0.25 }}>
                {host.tags &&
                  host.tags
                    .filter((t) => t !== TAG_FAV && !t.startsWith(TAG_GROUP_PREFIX) && !t.startsWith(TAG_ORDER_PREFIX))
                    .map((tag) => (
                      <Typography
                        key={tag}
                        variant="caption"
                        sx={{
                          color: "primary.main",
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
            (!host.is_auto || host.name !== `${host.user || "root"}@${host.hostname}`) && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", fontSize: "typography.caption.fontSize" }}
              >
                {secondaryText}
              </Typography>
            )
          }
        />
      </ListItemButton>
    </ListItem>
  );
}

function TreeGroupItem({
  node,
  level,
  isSelected,
  isMobile,
  isTouch,
  expandedGroups,
  toggleGroupExpanded,
  setDraggedItem,
  draggedItem,
  dragOverTarget,
  setDragOverTarget,
  moveServer,
  moveGroup,
  setGroupContextMenu,
  setGroupContextMenuOpen,
}: {
  node: GroupNode;
  level: number;
  isSelected: boolean;
  isMobile: boolean;
  isTouch: boolean;
  expandedGroups: Set<string>;
  toggleGroupExpanded: (path: string) => void;
  setDraggedItem: (item: { type: "group"; path: string } | { type: "server"; name: string } | null) => void;
  draggedItem: { type: "group"; path: string } | { type: "server"; name: string } | null;
  dragOverTarget: { id: string; effect: "before" | "inside" } | null;
  setDragOverTarget: (item: { id: string; effect: "before" | "inside" } | null) => void;
  moveServer: (serverName: string, destGroupPath: string | null, beforeServerName: string | null) => Promise<void>;
  moveGroup: (sourceGroupPath: string, destGroupPath: string) => Promise<void>;
  setGroupContextMenu: (item: { element: Element; path: string; type: "group" } | null) => void;
  setGroupContextMenuOpen: (open: boolean) => void;
}) {
  const itemRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: "auto",
        block: "nearest",
      });
    }
  }, [isSelected]);

  const isExpanded = expandedGroups.has(node.path);
  const isDragOver = dragOverTarget?.id === node.id;

  return (
    <ListItem
      ref={itemRef}
      id={`sidebar-tree-group-${node.path}`}
      disablePadding
      draggable={!isMobile && !isTouch}
      onDragStart={(e) => {
        setDraggedItem({ type: "group", path: node.path });
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!draggedItem) return;
        if (draggedItem.type === "group") {
          if (node.path === draggedItem.path || node.path.startsWith(draggedItem.path + "/")) {
            return;
          }
        }
        e.preventDefault();
        e.stopPropagation();
        setDragOverTarget({ id: node.id, effect: "before" });
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        setDragOverTarget(null);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverTarget(null);
        if (!draggedItem) return;
        if (draggedItem.type === "server") {
          await moveServer(draggedItem.name, node.path, null);
        } else if (draggedItem.type === "group") {
          await moveGroup(draggedItem.path, node.path);
        }
        setDraggedItem(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setGroupContextMenu({ element: e.currentTarget, path: node.path, type: "group" });
        setGroupContextMenuOpen(true);
      }}
      sx={{
        pl: level * 2.5 + 2,
        bgcolor: isSelected ? "action.hover" : isDragOver ? "action.selected" : "transparent",
        borderTop: isDragOver && dragOverTarget?.effect === "before" ? "2px solid" : "none",
        borderTopColor: "primary.main",
        "&:hover": {
          bgcolor: "action.hover",
        },
        mb: 0.2,
        outline: isSelected ? "1px solid" : "none",
        outlineColor: "primary.main",
        outlineOffset: "-1px",
        borderRadius: 1,
        cursor: "grab",
      }}
    >
      <ListItemButton onClick={() => toggleGroupExpanded(node.path)} sx={{ py: 0.25, px: 1 }}>
        <ListItemIcon sx={{ minWidth: 24 }}>
          {isExpanded ? (
            <ExpandMoreIcon fontSize="small" sx={{ color: "text.secondary" }} />
          ) : (
            <ChevronRightIcon fontSize="small" sx={{ color: "text.secondary" }} />
          )}
        </ListItemIcon>
        <ListItemIcon sx={{ minWidth: 28, ml: -0.5 }}>
          <FolderIcon fontSize="small" sx={{ color: "warning.main" }} />
        </ListItemIcon>
        <ListItemText
          primary={
            <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
              {node.name}
            </Typography>
          }
        />
      </ListItemButton>
    </ListItem>
  );
}

function TreeServerItem({
  node,
  level,
  isSelected,
  isMobile,
  isTouch,
  filterStr,
  draggedItem,
  dragOverTarget,
  setDraggedItem,
  setDragOverTarget,
  moveServer,
  getHostGroupPath,
  handleContextMenu,
}: {
  node: ServerNode;
  level: number;
  isSelected: boolean;
  isMobile: boolean;
  isTouch: boolean;
  filterStr: string;
  draggedItem: { type: "group"; path: string } | { type: "server"; name: string } | null;
  dragOverTarget: { id: string; effect: "before" | "inside" } | null;
  setDraggedItem: (item: { type: "group"; path: string } | { type: "server"; name: string } | null) => void;
  setDragOverTarget: (item: { id: string; effect: "before" | "inside" } | null) => void;
  moveServer: (serverName: string, destGroupPath: string | null, beforeServerName: string | null) => Promise<void>;
  getHostGroupPath: (host: HostData) => string | null;
  handleContextMenu: (
    e: React.MouseEvent | React.KeyboardEvent,
    host: HostData,
    section: "fav" | "tree" | "auto",
  ) => void;
}) {
  const itemRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: "auto",
        block: "nearest",
      });
    }
  }, [isSelected]);

  const host = node.host;
  const isDragOver = dragOverTarget?.id === node.id;
  const isFavourite = host.is_favourite;
  let secondaryText = `${host.user && host.user !== "root" ? host.user + "@" : ""}${host.hostname}`;
  if (filterStr && host.comment) {
    const matchedComment = searchStringAny(host.comment, filterStr);
    if (matchedComment) {
      secondaryText += ` // ${matchedComment}`;
    }
  }

  return (
    <ListItem
      ref={itemRef}
      id={`sidebar-tree-server-${host.name}`}
      disablePadding
      draggable={!isMobile && !isTouch}
      onDragStart={(e) => {
        setDraggedItem({ type: "server", name: host.name });
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!draggedItem) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOverTarget({ id: node.id, effect: "before" });
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        setDragOverTarget(null);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverTarget(null);
        if (!draggedItem) return;
        if (draggedItem.type === "server") {
          const targetGroup = getHostGroupPath(host);
          await moveServer(draggedItem.name, targetGroup, host.name);
        }
        setDraggedItem(null);
      }}
      onContextMenu={(e) => handleContextMenu(e, host, "tree")}
      data-name={host.name}
      className="sidebar-host"
      sx={{
        pl: level * 2.5 + 2,
        bgcolor: isSelected ? "action.hover" : isFavourite ? "action.selected" : "transparent",
        borderTop: isDragOver ? "2px solid" : "none",
        borderTopColor: "primary.main",
        "&:hover": {
          bgcolor: isSelected ? "action.hover" : isFavourite ? "action.focus" : "action.hover",
        },
        mb: 0.2,
        outline: isSelected ? "1px solid" : "none",
        outlineColor: "primary.main",
        outlineOffset: "-1px",
        borderRadius: 1,
        cursor: "grab",
      }}
    >
      <ListItemButton
        title={host.comment || ""}
        onClick={(e) => {
          if (e.ctrlKey) {
            openHostInNewWindow(host.name);
          } else {
            openHost(host.name);
            setMobileOpen(false);
          }
        }}
        sx={{ py: 0.5, px: 1 }}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          {isFavourite ? (
            <StarIcon
              fontSize="small"
              sx={{
                color: "primary.main",
                filter: "drop-shadow(0 0 2px rgba(25, 118, 210, 0.3))",
              }}
            />
          ) : (
            <DnsIcon fontSize="small" color="action" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: isFavourite ? 700 : 500,
                  lineHeight: 1.2,
                  color: isFavourite ? "primary.main" : "text.primary",
                }}
              >
                {host.name}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 0.25 }}>
                {host.tags &&
                  host.tags
                    .filter((t) => t !== TAG_FAV && !t.startsWith(TAG_GROUP_PREFIX) && !t.startsWith(TAG_ORDER_PREFIX))
                    .map((tag) => (
                      <Typography
                        key={tag}
                        variant="caption"
                        sx={{
                          color: "primary.main",
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
            (!host.is_auto || host.name !== `${host.user || "root"}@${host.hostname}`) && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", fontSize: "typography.caption.fontSize" }}
              >
                {secondaryText}
              </Typography>
            )
          }
        />
      </ListItemButton>
    </ListItem>
  );
}
