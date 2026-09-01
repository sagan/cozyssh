import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
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
  Autocomplete,
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
  type DialogProps,
} from "@mui/material";
import ComputerIcon from "@mui/icons-material/Computer";
import DnsIcon from "@mui/icons-material/Dns";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AddIcon from "@mui/icons-material/Add";
import StarIcon from "@mui/icons-material/Star";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import PushPinIcon from "@mui/icons-material/PushPin";
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
  Session,
  PasswordsResponse,
  PasswordsRevealRequest,
  PasswordsRevealResponse,
  PasswordsChangeRequest,
  PasswordsDeleteRequest,
  SaveWebdavSettingsRequest,
  SyncDetectionResult,
  WebdavStatus,
  LoginResponse,
  RevealAppPasswordResponse,
} from "./api";
import {
  METHOD_PUT,
  METHOD_POST,
  METHOD_DELETE,
  MIME_JSON,
  HEADER_CONTENT_TYPE,
  BROWSER_STORAGE_KEY_TOKEN,
  APP_NAME,
  LOCAL_NAME,
  ID_SIDEBAR_FILTER,
  DEFAULT_SCROLL_ITEMS,
  VAR_CS_SCROLL_ITEMS,
  TAG_GROUP_PREFIX,
  TAG_ORDER_PREFIX,
  TAG_FAV,
  TOAST_KEY_PASTE_SSH_CONFIG_BLOCK,
  TOAST_KEY_SYNC,
  LINK_COZYSSH_GITHUB,
  LINK_COZYSSH_DOC_DATA,
  CLASS_HIDE_DESKTOP,
  SETTINGS_TAB_IDX_SETTINGS,
  SETTINGS_TAB_IDX_PASSWORDS,
  SETTINGS_TAB_IDX_SESSIONS,
  SETTINGS_TAB_IDX_TUNNELS,
  SETTINGS_TAB_IDX_SYNC,
  SETTINGS_TAB_IDX_IMPORT,
  SETTINGS_TAB_IDX_EXPORT,
  SETTINGS_TAB_IDX_SHORTCUTS,
  SETTINGS_TAB_IDX_ABOUT,
  ID_SIDEBAR,
  ID_SIDEBAR_MAIN,
  VAR_CS_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  TAG_FLAG_PREFIX,
  TAG_FLAG_SHELL_INTEGRATION_DISABLED,
  TAG_FLAG_SHELL_INTEGRATION_ENABLED,
  TAG_FLAG_SHELL_INTEGRATION_FORCE_ENABLED,
  TAG_FLAG_SHELL_INTEGRATION_ASH,
  TAG_FLAG_SHELL_INTEGRATION_BASH,
  TAG_FLAG_SHELL_INTEGRATION_ZSH,
  TAG_FLAG_ENV_TERM_VT100,
  TAG_FLAG_ENV_TERM_LINUX,
  TAG_FLAG_ENV_TERM_TMUX_256COLOR,
} from "./constants";
import {
  AM_1_ALT,
  AM_2_SHIFT,
  AM_3_CTRL,
  AM_6_CTRL_SHIFT,
  type ServiceWorkerStatus,
  apiReqHeaders,
  cutString,
  filterHosts,
  forceReload,
  getAddAuthorizedKeyCmd,
  getAltMode,
  getHostFlags,
  getHostGroupPath,
  getHostOrder,
  getKeyCombination,
  getSSHCommand,
  getSSHConfigBlock,
  getSSHCopyIdCommand,
  getTagTip,
  hostLabel,
  hostSorter,
  isModifier,
  isValidHostname,
  localShellHost,
  openHostInNewWindow,
  parseSSHConfigBlock,
  remoteCommandOptions,
  searchStringAny,
  t,
} from "./common";
import { dialogs } from "./Dialogs";
import {
  fetchActiveTunnels,
  getStore,
  notify,
  setEditHostDialogOpen,
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
  moveServer,
  moveGroup,
  fetchSessions,
  updateConfig,
  setAllExpanded,
  setAutoExpanded,
  setFavExpanded,
  setExpandedGroups,
  toggleGroupExpanded,
  setFilterStr,
  openAddHostDialog,
  toggleExpandAllGroups,
  sshCopyId,
  openEditHostDialog,
  setSettingsOpen,
  setSettingsTab,
  deleteHost,
  reorderFavourites,
  updateTabTitles,
} from "./store";
import { useShallow } from "zustand/react/shallow";
import FreeTextField from "./components/FreeTextField";
import SSHImportTab from "./SSHImportTab";
import SSHExportTab from "./SSHExportTab";
import ChipCopy from "./components/ChipCopy";
import TextFieldWithCopy from "./components/TextFieldWithCopy";
import ExtraMenu from "./components/ExtraMenu";
import CopyButton from "./components/CopyButton";

type Section = "fav" | "tree" | "auto";

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
  section: Section;
  host: HostData;
}

type SelectableItem = SelectableGroupItem | SelectableServerItem;

const PASSWORD_PLACEHOLDER = "***";

export default function Sidebar({
  isMobile,
  isTouch,
  onOpenScratchpad,
  onAttach,
  onRefresh,
}: {
  isMobile: boolean;
  isTouch: boolean;
  onOpenScratchpad: () => void;
  onAttach: (s: Session) => void;
  onRefresh: () => void;
}) {
  const appVersion = useStore((state) => state.sysinfo.version);
  const savePassword = useStore((state) => state.sysinfo.savePassword);
  const useKeyring = useStore((state) => state.sysinfo.useKeyring);
  const sysUsername = useStore((state) => state.sysinfo.username);
  const sysSitename = useStore((state) => state.sysinfo.sitename);
  const sysConfigDir = useStore((state) => state.sysinfo.configDir);
  const sysSshDir = useStore((state) => state.sysinfo.sshDir);
  const sysDefaultIdentityPath = useStore((state) => state.sysinfo.defaultIdentityPath);
  const sysDefaultIdentityPublicKey = useStore((state) => state.sysinfo.defaultIdentityPublicKey);
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
  const settingsOpen = useStore((state) => state.settingsOpen);
  const settingsTab = useStore((state) => state.settingsTab);
  const extraHostMenu = useStore((state) => state.extraHostMenu);
  const extraGroupMenu = useStore((state) => state.extraGroupMenu);
  const extraTagMenu = useStore((state) => state.extraTagMenu);
  const extraHostFormMenu = useStore((state) => state.extraHostFormMenu);
  const extraMainMenu = useStore((state) => state.extraMainMenu);

  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  // Settings State
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pinnedSessions, setPinnedSessions] = useState<Session[]>([]);
  const [dialogAppPassword, setDialogAppPassword] = useState<string>("");
  const [passwordsState, setPasswordsState] = useState<PasswordsResponse>({ locked: true, keys: [] });
  const [revealedPasswords, setRevealedPasswords] = useState<{ [key: string]: string }>({});
  const activeTunnels = useStore((state) => state.activeTunnels);
  const favExpanded = useStore((state) => state.favExpanded);
  const allExpanded = useStore((state) => state.allExpanded);
  const autoExpanded = useStore((state) => state.autoExpanded);
  const expandedGroups = useStore((state) => state.expandedGroups);
  const filterStr = useStore((state) => state.filterStr);
  const initialHostFormData = useStore((state) => state.initialHostFormData);

  const [swStatus, setSwStatus] = useState<ServiceWorkerStatus>("unknown");

  useEffect(() => {
    if (settingsOpen && settingsTab === SETTINGS_TAB_IDX_TUNNELS) {
      fetchActiveTunnels();
      const interval = setInterval(fetchActiveTunnels, 3000);
      return () => clearInterval(interval);
    }
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    if (settingsOpen && settingsTab === SETTINGS_TAB_IDX_SETTINGS) {
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
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    if (settingsOpen) {
      fetchSessions(true)
        .then((data) => setPinnedSessions(data))
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
  const [uploadSSHData, setUploadSSHData] = useState(false);
  const [currentUploadSSHData, setCurrentUploadSSHData] = useState(false);
  const [passwordsFilter, setPasswordsFilter] = useState("");

  const fetchWebdavStatus = useCallback(async (onlyStatus = false) => {
    try {
      const r = await fetch("/api/settings/webdav/status", { headers: apiReqHeaders() });

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
          setUploadSSHData(!!data.webdavUploadSSHData);
          setCurrentUploadSSHData(!!data.webdavUploadSSHData);
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
    if (settingsOpen && settingsTab === SETTINGS_TAB_IDX_SYNC) {
      const interval = setInterval(() => fetchWebdavStatus(true), 3000);
      return () => clearInterval(interval);
    }
  }, [settingsOpen, settingsTab, fetchWebdavStatus]);

  const handleToggleWebdavEnabled = async () => {
    const nextEnabled = !webdavEnabled;

    try {
      const res = await fetch("/api/settings/webdav", {
        method: METHOD_POST,
        headers: apiReqHeaders(),
        body: JSON.stringify({
          url: currentWebdavUrl,
          user: currentWebdavUser,
          password: "",
          enabled: nextEnabled,
          useEncryption: useEncryption,
          masterKey: masterKey,
          uploadSSHData: uploadSSHData,
        }),
      });
      if (!res.ok) {
        throw new Error(`status=${res.status}, msg=${await res.text()}`);
      }
      notify(nextEnabled ? t("Sync enabled") : t("Sync disabled"), "success", TOAST_KEY_SYNC);
      setWebdavEnabled(nextEnabled);
      fetchWebdavStatus(false);
    } catch (err: unknown) {
      notify(t("Failed to toggle sync:") + ` ${err}`, "error", TOAST_KEY_SYNC);
    }
  };

  const urlChanged = webdavUrl.trim() !== currentWebdavUrl;
  const isCleared = !webdavUrl.trim() && !webdavUser.trim() && !webdavPassword.trim();

  const handleSaveWebdav = useCallback(async () => {
    setIsTestingWebdav(true);

    try {
      if (isCleared) {
        const res = await fetch("/api/settings/webdav", {
          method: METHOD_POST,
          headers: apiReqHeaders(),
          body: JSON.stringify({
            url: "",
            user: "",
            password: "",
            enabled: false,
            useEncryption: false,
            masterKey: "",
          } satisfies SaveWebdavSettingsRequest),
        });

        if (!res.ok) {
          throw new Error(`status=${res.status}, msg=${await res.text()}`);
        }
        notify(t("WebDAV settings cleared successfully"), "success", TOAST_KEY_SYNC);
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
        return;
      }

      let localMasterKey = masterKey;
      let finalUseEncryption = useEncryption;

      if (
        urlChanged ||
        useEncryption !== webdavEncrypted ||
        masterKey !== currentMasterKey ||
        uploadSSHData !== currentUploadSSHData
      ) {
        const detectRes = await fetch("/api/settings/webdav/detect", {
          method: METHOD_POST,
          headers: apiReqHeaders(),
          body: JSON.stringify({
            url: webdavUrl,
            user: webdavUser,
            password: webdavPassword,
            enabled: webdavEnabled,
            useEncryption: useEncryption,
            masterKey: localMasterKey,
            uploadSSHData: uploadSSHData,
          } satisfies SaveWebdavSettingsRequest),
        });

        if (!detectRes.ok) {
          throw new Error(
            t("Failed to verify WebDAV connection:") + ` status=${detectRes.status}, msg=${await detectRes.text()}`,
          );
        }

        let data = (await detectRes.json()) as SyncDetectionResult;

        if (data.encrypted && (data.keyRequired || data.keyInvalid)) {
          const keyInput = await dialogs.prompt(
            t("Encrypted WebDAV Session Detected. ") + data.keyInvalid
              ? t("The master key you entered is invalid. Please enter the correct master key:")
              : t("This WebDAV server is encrypted. Please enter the master key to unlock and sync:"),
          );
          if (keyInput === null) {
            return;
          }
          localMasterKey = keyInput;
          setMasterKey(keyInput);

          const retryRes = await fetch("/api/settings/webdav/detect", {
            method: METHOD_POST,
            headers: apiReqHeaders(),
            body: JSON.stringify({
              url: webdavUrl,
              user: webdavUser,
              password: webdavPassword,
              enabled: webdavEnabled,
              useEncryption: true,
              masterKey: localMasterKey,
              uploadSSHData: uploadSSHData,
            } satisfies SaveWebdavSettingsRequest),
          });

          if (!retryRes.ok) {
            throw new Error(
              t("Failed to verify WebDAV connection with the provided key:") +
                ` status=${retryRes.status}, msg=${await retryRes.text()}`,
            );
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
          msg = t("WebDAV server connection ready");
          detail =
            `The server ${webdavUrl} is brand-new and contains no CozySSH data. ` +
            `Your local data (buttons, vars, scratchpad) will be uploaded to it when synchronization is triggered.` +
            (finalUseEncryption
              ? "\n\nEnd-to-End Encryption (E2EE) is enabled. A new 32-byte master key will be automatically generated and saved if you don't specify one."
              : "");
        } else {
          msg = t("WebDAV server connection successful!");
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
          detail + "\n\n" + t("Do you want to save these settings and enable WebDAV sync?"),
        );
        if (!confirmed) {
          return;
        }
      }

      const saveRes = await fetch("/api/settings/webdav", {
        method: METHOD_POST,
        headers: apiReqHeaders(),
        body: JSON.stringify({
          url: webdavUrl,
          user: webdavUser,
          password: webdavPassword,
          enabled: urlChanged || finalUseEncryption !== webdavEncrypted ? true : webdavEnabled,
          useEncryption: finalUseEncryption,
          masterKey: localMasterKey,
          uploadSSHData: uploadSSHData,
        } satisfies SaveWebdavSettingsRequest),
      });
      if (!saveRes.ok) {
        throw new Error(`status=${saveRes.status}, msg=${await saveRes.text()}`);
      }
      notify(t("WebDAV settings saved successfully"), "success", TOAST_KEY_SYNC);
      setCurrentWebdavUrl(webdavUrl.trim());
      setCurrentWebdavUser(webdavUser);
      setCurrentWebdavPassword(webdavPassword);
      fetchWebdavStatus(false);
    } catch (err: unknown) {
      notify(t("Failed to save WebDAV settings:") + ` ${err}`, "error", TOAST_KEY_SYNC);
    } finally {
      setIsTestingWebdav(false);
    }
  }, [
    currentMasterKey,
    currentUploadSSHData,
    fetchWebdavStatus,
    isCleared,
    masterKey,
    uploadSSHData,
    urlChanged,
    useEncryption,
    webdavEnabled,
    webdavEncrypted,
    webdavPassword,
    webdavUrl,
    webdavUser,
  ]);

  const handleClearWebdav = useCallback(async () => {
    setIsTestingWebdav(true);
    if (
      !(await dialogs.confirm(
        t("Are you sure you want to clear WebDAV settings?"),
        t("It will not remove any existing files from WebDAV server.") +
          (webdavEncrypted
            ? " " +
              t("The WebDAV remote directory is encrypted with master key:") +
              " " +
              masterKey +
              ". " +
              t("If you proceed, the master key will be deleted from CozySSH server.") +
              " " +
              t("Make sure you have a backup of it.")
            : ""),
        webdavEncrypted,
      ))
    ) {
      setIsTestingWebdav(false);
      return;
    }

    try {
      const res = await fetch("/api/settings/webdav", {
        method: METHOD_POST,
        headers: apiReqHeaders(),
        body: JSON.stringify({
          url: "",
          user: "",
          password: "",
          enabled: false,
          useEncryption: false,
          masterKey: "",
        } satisfies SaveWebdavSettingsRequest),
      });

      if (!res.ok) {
        throw new Error(`status=${res.status}, msg=${await res.text()}`);
      }
      notify(t("WebDAV settings cleared successfully"), "success", TOAST_KEY_SYNC);
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
      return;
    } catch (err: unknown) {
      notify(t("Failed to clear WebDAV settings:") + ` ${err}`, "error", TOAST_KEY_SYNC);
    } finally {
      setIsTestingWebdav(false);
    }
  }, [fetchWebdavStatus, masterKey, webdavEncrypted]);

  const handleSyncNow = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      const res = await fetch("/api/settings/webdav/sync", { method: METHOD_POST, headers: apiReqHeaders() });
      if (!res.ok) {
        throw new Error(`status=${res.status}`);
      }
      notify(t("Sync triggered"), "success", TOAST_KEY_SYNC);
      setTimeout(() => fetchWebdavStatus(true), 500, TOAST_KEY_SYNC);
    } catch (err: unknown) {
      notify(t("Failed to trigger sync:") + ` ${err}`, "error");
    }
  }, [fetchWebdavStatus]);

  const [showTagsToggle, setShowTagsToggle] = useState(false);
  const tagsContainerRef = useRef<HTMLDivElement | null>(null);
  const localShellRef = useRef<HTMLLIElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const editHostDialogOpen = useStore((state) => state.editHostDialogOpen);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    setTagInput("");
  }, [editHostDialogOpen]);

  const handleDeleteTag = useCallback(
    (tagToDelete: string) => {
      const tagsList = (hostFormData.tags || "")
        .replace(/,/g, " ")
        .split(/\s+/)
        .filter((t) => t.trim() !== "" && t !== tagToDelete);
      setHostFormData({ ...hostFormData, tags: tagsList.join(" ") });
    },
    [hostFormData],
  );

  const handleAddTag = useCallback(
    (tagToAdd: string) => {
      const newTags = tagToAdd
        .replace(/,/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t !== "");
      if (newTags.length === 0) {
        return;
      }

      let currentTags = (hostFormData.tags || "")
        .replace(/,/g, " ")
        .split(/\s+/)
        .filter((t) => t.trim() !== "");

      const tagsToAdd = newTags.filter((t) => !currentTags.includes(t));
      if (tagsToAdd.length > 0) {
        currentTags = currentTags.filter((t) => {
          if (t.startsWith("$")) {
            const key = cutString(t, "=")[0];
            return !tagsToAdd.some((t) => cutString(t, "=")[0] === key);
          } else if (t.startsWith(TAG_ORDER_PREFIX)) {
            return !tagsToAdd.some((t) => t.startsWith(TAG_ORDER_PREFIX));
          } else if (t.startsWith(TAG_GROUP_PREFIX)) {
            return !tagsToAdd.some((t) => t.startsWith(TAG_GROUP_PREFIX));
          }
          return true;
        });
        setHostFormData({
          ...hostFormData,
          tags: [...currentTags, ...tagsToAdd].join(" "),
        });
      }
    },
    [hostFormData],
  );

  const parsedTags = useMemo(() => {
    return (hostFormData.tags || "").split(/\s+/).filter(Boolean);
  }, [hostFormData.tags]);
  const editHostName = useStore((state) => state.editHostName);

  // Context Menu State
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [localShellContextMenuOpen, setLocalShellContextMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    element: Element;
    target: HostData;
    section: Section;
  } | null>(null);
  const [tagContextMenuOpen, setTagContextMenuOpen] = useState(false);
  const [tagContextMenu, setTagContextMenu] = useState<{ element: Element; tag: string } | null>(null);

  // Group context menu states
  const [groupContextMenuOpen, setGroupContextMenuOpen] = useState(false);
  const [groupContextMenu, setGroupContextMenu] = useState<{ element: Element; path: string } | null>(null);

  const [hostTitleMenuAnchor, setHostTitleMenuAnchor] = useState<null | HTMLElement>(null);

  const filterStrLower = filterStr.toLowerCase().trim();

  const closeContextMenus = useCallback(() => {
    setContextMenuOpen(false);
    setGroupContextMenuOpen(false);
    setTagContextMenuOpen(false);
    setLocalShellContextMenuOpen(false);
    setAnchorEl(null);
    setTimeout(() => {
      const activeEl = document.activeElement;
      if (!activeEl || (activeEl.tagName !== "INPUT" && activeEl.tagName !== "TEXTAREA")) {
        triggerFocus();
      }
    }, 0);
  }, []);

  const handleHostTitleMenuClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    setHostTitleMenuAnchor(event.currentTarget);
  }, []);

  const handleHostTitleMenuClose = useCallback(() => {
    setHostTitleMenuAnchor(null);
  }, []);

  const handleCopySSHCommand = useCallback(() => {
    setHostTitleMenuAnchor(null);
    navigator.clipboard.writeText(getSSHCommand(getStore().hostFormData));
  }, []);

  const handleCopySshConfigBlock = useCallback(() => {
    setHostTitleMenuAnchor(null);
    navigator.clipboard.writeText(getSSHConfigBlock(getStore().hostFormData));
  }, []);

  const handleCopyUploadIdentityCommand = useCallback(() => {
    setHostTitleMenuAnchor(null);
    navigator.clipboard.writeText(
      getSSHCopyIdCommand(
        getStore().hostFormData,
        getStore().sysinfo.defaultIdentityPath,
        getStore().sysinfo.defaultIdentityPublicKey,
      ),
    );
  }, []);

  const handleCopySSHCopyIdCommand = useCallback(() => {
    setHostTitleMenuAnchor(null);
    navigator.clipboard.writeText(getSSHCopyIdCommand(getStore().hostFormData, getStore().sysinfo.defaultIdentityPath));
  }, []);

  const handleRunSSHCopyId = useCallback(() => {
    setHostTitleMenuAnchor(null);
    sshCopyId(getStore().hostFormData);
  }, []);

  const handlePasteSshConfigBlock = useCallback(async () => {
    setHostTitleMenuAnchor(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        notify(t("Clipboard is empty"), "warning", TOAST_KEY_PASTE_SSH_CONFIG_BLOCK);
        return;
      }
      const host = parseSSHConfigBlock(text);
      setHostFormData({ ...host, tags: host.tags?.join(" ") || "" });
      notify(
        t("Successfully imported Host settings from SSH config block"),
        "success",
        TOAST_KEY_PASTE_SSH_CONFIG_BLOCK,
      );
    } catch (err: unknown) {
      notify(
        t("Failed to read clipboard or parse config block:") + ` ${err}`,
        "error",
        TOAST_KEY_PASTE_SSH_CONFIG_BLOCK,
      );
    }
  }, []);

  // Drag and Drop States
  const [draggedItem, setDraggedItem] = useState<
    { type: "group"; path: string } | { type: "server"; name: string } | { type: "fav"; name: string } | null
  >(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ id: string; effect: "before" | "inside" | "after" } | null>(
    null,
  );

  const getGroupOrder = useCallback((path: string): number => {
    const idx = getStore().groups.indexOf(path);
    return idx === -1 ? Infinity : idx;
  }, []);

  useEffect(() => {
    if (loading && hosts.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
    }
  }, [hosts, loading]);

  const fetchPasswords = useCallback(async () => {
    try {
      const res = await fetch("/api/passwords", { headers: apiReqHeaders() });
      if (!res.ok) {
        throw new Error(`status=${res.status}`);
      }
      const data = (await res.json()) as PasswordsResponse;
      setPasswordsState(data);
    } catch (e: unknown) {
      console.error("Failed to fetch passwords", e);
    }
  }, []);

  const handleLock = useCallback(async () => {
    setDialogAppPassword("");
    setRevealedPasswords({});
    try {
      const res = await fetch("/api/passwords/lock", { method: METHOD_POST, headers: apiReqHeaders() });
      if (!res.ok) {
        throw new Error(`status=${res.status}`);
      }
      fetchPasswords();
    } catch (err: unknown) {
      dialogs.alert(t("Failed to lock password store:") + ` ${err}`);
    }
  }, [fetchPasswords]);

  useEffect(() => {
    if (settingsOpen && settingsTab === SETTINGS_TAB_IDX_PASSWORDS) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchPasswords();
    }
  }, [settingsOpen, settingsTab, fetchPasswords]);

  useEffect(() => {
    if (!settingsOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDialogAppPassword("");
      setRevealedPasswords({});
    }
  }, [settingsOpen]);

  const handleReveal = useCallback(
    async (key: string) => {
      const useKeyring = getStore().sysinfo.useKeyring;
      let appPassword = dialogAppPassword;
      if (!useKeyring && !appPassword) {
        const entered = await dialogs.promptPassword(t("Enter App Password to confirm:"));
        if (!entered) {
          return;
        }
        appPassword = entered;
      }
      try {
        const res = await fetch("/api/passwords/reveal", {
          method: METHOD_POST,
          headers: apiReqHeaders(),
          body: JSON.stringify({ key, appPassword } satisfies PasswordsRevealRequest),
        });
        if (!res.ok) {
          throw new Error(`status=${res.status}, msg=${await res.text()}`);
        }
        const data = (await res.json()) as PasswordsRevealResponse;
        setRevealedPasswords((prev) => ({ ...prev, [key]: data.password }));
        setPasswordsState({ ...passwordsState, locked: false });
        if (!useKeyring) {
          setDialogAppPassword(appPassword);
        }
      } catch (err: unknown) {
        dialogs.alert(t("Failed to reveal password"), `${err}`);
      }
    },
    [dialogAppPassword, passwordsState],
  );

  const handleCopyPassword = useCallback(
    async (key: string) => {
      const useKeyring = getStore().sysinfo.useKeyring;
      let pwd = revealedPasswords[key];
      if (!pwd) {
        let appPassword = dialogAppPassword;
        if (!useKeyring && !appPassword) {
          const entered = await dialogs.promptPassword(t("Enter App Password to confirm:"));
          if (!entered) {
            return;
          }
          appPassword = entered;
        }
        try {
          const res = await fetch("/api/passwords/reveal", {
            method: METHOD_POST,
            headers: apiReqHeaders(),
            body: JSON.stringify({ key, appPassword } satisfies PasswordsRevealRequest),
          });
          if (!res.ok) {
            throw new Error(`status=${res.status}`);
          }
          const data = (await res.json()) as PasswordsRevealResponse;
          pwd = data.password;
          if (!useKeyring) {
            setDialogAppPassword(appPassword);
          }
          setPasswordsState({ ...passwordsState, locked: false });
        } catch (err: unknown) {
          dialogs.alert(t("Failed to retrieve password"), `${err}`);
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
    [dialogAppPassword, revealedPasswords, passwordsState],
  );

  const handleChangePassword = useCallback(
    async (key: string) => {
      const useKeyring = getStore().sysinfo.useKeyring;
      let appPassword = dialogAppPassword;
      if (!useKeyring && !appPassword) {
        const entered = await dialogs.promptPassword(t("Enter App Password to confirm:"));
        if (!entered) {
          return;
        }
        appPassword = entered;
      }
      const newPwd = await dialogs.promptPassword(t("Enter new password for the key:") + " " + key);
      if (newPwd === null) {
        return;
      }
      try {
        const res = await fetch("/api/passwords/change", {
          method: METHOD_POST,
          headers: apiReqHeaders(),
          body: JSON.stringify({ key, appPassword, password: newPwd } satisfies PasswordsChangeRequest),
        });
        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
        setRevealedPasswords((prev) => {
          if (key in prev) {
            return { ...prev, [key]: newPwd };
          }
          return prev;
        });
        if (!useKeyring) {
          setDialogAppPassword(appPassword);
        }
      } catch (err: unknown) {
        dialogs.alert(t("Failed to update password"), `${err}`);
      }
    },
    [dialogAppPassword],
  );

  const handleDeletePassword = useCallback(
    async (key: string) => {
      if (
        !(await dialogs.confirm(t("Will delete the password of this key:") + " " + key + ". " + t("Are you sure?")))
      ) {
        return;
      }
      try {
        const res = await fetch("/api/passwords/delete", {
          method: METHOD_POST,
          headers: apiReqHeaders(),
          body: JSON.stringify({ key } satisfies PasswordsDeleteRequest),
        });
        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
        fetchPasswords();
        setRevealedPasswords((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } catch (err: unknown) {
        dialogs.alert(t("Failed to delete password"), `${err}`);
      }
    },
    [fetchPasswords],
  );

  const handleChangeSitename = useCallback(async () => {
    const sitename = await dialogs.prompt(t("New sitename:"), getStore().sysinfo.sitename);
    if (!sitename || sitename === getStore().sysinfo.sitename) {
      return;
    }
    updateConfig({ sitename });
  }, []);

  const handleSavePassword = useCallback(async () => {
    if (newPwd !== confirmPwd) {
      dialogs.alert(t("Passwords don't match"));
      return;
    }
    const res = await fetch("/api/settings/password", {
      method: METHOD_POST,
      headers: apiReqHeaders(),
      body: JSON.stringify({ new_password: newPwd, force: false } satisfies PasswordUpdateRequest),
    });

    if (res.status === 403) {
      const text = await res.text();
      if (text.includes("Saved passwords are locked")) {
        const action = await dialogs.confirm(
          t("Saved passwords are locked.") +
            " " +
            t("Would you like to enter your old app password to unlock and re-encrypt them?") +
            " (" +
            t("Selecting Cancel will let you choose to Force Update instead.") +
            ")",
        );

        if (action) {
          const oldPwd = await dialogs.promptPassword(t("Enter old app password to unlock:"));
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
            const loginData = (await loginRes.json()) as LoginResponse;
            localStorage.setItem(BROWSER_STORAGE_KEY_TOKEN, loginData.token);

            const retryRes = await fetch("/api/settings/password", {
              method: METHOD_POST,
              headers: apiReqHeaders(),
              body: JSON.stringify({ new_password: newPwd, force: false } satisfies PasswordUpdateRequest),
            });

            if (retryRes.ok) {
              await dialogs.alert(t("Password updated! You will be logged out."));
              logout(false, true);
            } else {
              dialogs.alert(
                t("Failed to update password after unlocking"),
                `status=${retryRes.status}, msg=${await retryRes.text()}`,
              );
            }
            return;
          } else {
            dialogs.alert(t("Incorrect app password"));
            return;
          }
        } else {
          const forceConfirm = await dialogs.confirm(
            t("Force updating the app password will permanently discard/wipe all saved SSH passwords.") +
              " " +
              t("Are you sure you want to proceed?"),
          );
          if (forceConfirm) {
            const forceRes = await fetch("/api/settings/password", {
              method: METHOD_POST,
              headers: apiReqHeaders(),
              body: JSON.stringify({ new_password: newPwd, force: true } satisfies PasswordUpdateRequest),
            });

            if (forceRes.ok) {
              dialogs.alert(t("App password updated and saved passwords wiped! You will be logged out."));
              logout(false, true);
            } else {
              dialogs.alert(
                t("Failed to force update password"),
                `status=${forceRes.status}, msg=${await forceRes.text()}`,
              );
            }
            return;
          }
        }
        return;
      }
    }

    if (res.ok) {
      await dialogs.alert(t("Password updated! You will be logged out."));
      logout(false, true);
    } else {
      dialogs.alert(t("Failed to update password"), `status=${res.status}, msg=${await res.text()}`);
    }
  }, [confirmPwd, newPwd]);

  const handleClearCache = useCallback(async () => {
    if (!(await dialogs.confirm(t("This will unregister the Service Worker, clear all caches and reload. Proceed?")))) {
      return;
    }
    forceReload();
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent, host: HostData, section: Section) => {
      e.preventDefault();
      setContextMenu({ element: e.currentTarget, target: host, section });
      setContextMenuOpen(true);
    },
    [],
  );

  const handleTagClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const tag = (e.currentTarget as HTMLElement).dataset.tag!;
      const tagLower = tag.toLowerCase();
      const isActive = filterStrLower.includes(`#${tagLower} `) || filterStrLower.endsWith(`#${tagLower}`);
      if (isActive && filterStr.trim() === `#${tag}`) {
        setFilterStr("");
      } else {
        setFilterStr(`#${tag} `);
      }
      document.getElementById(ID_SIDEBAR_FILTER)?.focus();
    },
    [filterStr, filterStrLower],
  );

  const handleTagContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setTagContextMenu({ element: e.currentTarget, tag: (e.currentTarget as HTMLElement).dataset.tag! });
    setTagContextMenuOpen(true);
  }, []);

  const handleOpenAllServersInNewWindow = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    closeContextMenus();
    const tag = tagContextMenu.tag;
    openHostInNewWindow(`#${tag}`);
  }, [tagContextMenu, closeContextMenus]);

  const handleOpenAllServers = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    closeContextMenus();
    const tag = tagContextMenu.tag;
    setFilterStr(`#${tag} `);
    const { hosts } = getStore();
    const targets = hosts.filter((h) => h.tags && h.tags.includes(tag));
    targets.forEach((h) => openHost(h.name));
    setMobileOpen(false);
  }, [tagContextMenu, closeContextMenus]);

  const handleOpenSplitServers = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    closeContextMenus();
    const tag = tagContextMenu.tag;
    const { hosts } = getStore();
    const filtered = hosts.filter((h) => h.tags && h.tags.includes(tag));

    const nameSorter = (a: HostData, b: HostData) => a.name.localeCompare(b.name);
    const hostNameSorter = (a: HostData, b: HostData) => {
      if (a.hostname === b.hostname) {
        return a.name.localeCompare(b.name);
      }
      return a.hostname.localeCompare(b.hostname);
    };

    const favs = filtered.filter((h) => h.isFavourite).sort(nameSorter);
    const normals = filtered.filter((h) => !h.isFavourite && !h.isAuto).sort(nameSorter);
    const autos = filtered.filter((h) => !h.isFavourite && h.isAuto).sort(hostNameSorter);

    const targets = [...favs, ...normals, ...autos].slice(0, 4);
    if (targets.length > 0) {
      openHostsAsSplit(
        tag,
        targets.map((h) => h.name),
      );
      setMobileOpen(false);
    }
  }, [tagContextMenu, closeContextMenus]);

  const handleCopyTagUrl = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    closeContextMenus();
    const tag = tagContextMenu.tag;
    const url = `${window.location.origin}/##${tag}`;
    navigator.clipboard.writeText(url);
  }, [tagContextMenu, closeContextMenus]);

  const handleEditOpen = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    closeContextMenus();
    const target = contextMenu.target;
    openEditHostDialog(target);
  }, [contextMenu, closeContextMenus]);

  const closeMobileSidebar = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    closeContextMenus();
    const target = contextMenu.target;
    deleteHost(target.name);
  }, [contextMenu, closeContextMenus]);

  const handleDeleteKnownHost = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const target = contextMenu.target;
    closeContextMenus();
    if (
      await dialogs.confirm(
        t("Will delete this host from known_hosts:") + " " + target.hostname + ". " + t("Are you sure?"),
      )
    ) {
      const port = target.port || "22";
      const res = await fetch(`/api/known_hosts/${target.hostname}?port=${port}`, {
        method: METHOD_DELETE,
        headers: apiReqHeaders(),
      });
      if (res.ok) {
        notify(t("Successfully removed entry from known_hosts"), "success");
        fetchHosts();
      } else {
        notify(t("Failed to delete known_host entry:") + ` status=${res.status}, msg=${await res.text()}`, "error");
      }
    }
  }, [contextMenu, closeContextMenus]);

  const handleToggleFavourite = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    closeContextMenus();
    const target = contextMenu.target;

    let newTags = target.tags ? [...target.tags] : [];
    if (target.isFavourite) {
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
      identityFile: target.identityFile || "",
      proxyJump: target.proxyJump || "",
      remoteCommand: target.remoteCommand || "",
      source: target.source || "",
      comment: target.comment || "",
      tags: newTags,
    };

    await fetch("/api/hosts", {
      method: METHOD_PUT,
      headers: apiReqHeaders(),
      body: JSON.stringify([payload]),
    });
    fetchHosts();
  }, [contextMenu, closeContextMenus]);

  const handleRunCopyID = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const target = contextMenu.target;
    closeContextMenus();
    sshCopyId(target);
  }, [closeContextMenus, contextMenu]);

  const handleToggleExpandAll = useCallback(() => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    if (groupContextMenu.path) {
      toggleGroupExpanded(groupContextMenu.path, true);
    } else {
      // "All" right click
      if (!getStore().allExpanded) {
        toggleExpandAllGroups(true);
        setAllExpanded(1);
      } else {
        toggleExpandAllGroups();
      }
    }
  }, [closeContextMenus, groupContextMenu]);

  const handleOpenGroupAll = useCallback(() => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    const { hosts } = getStore();
    const targets = hosts.filter((h) => h.tags && h.tags.includes(TAG_GROUP_PREFIX + groupContextMenu.path));
    targets.forEach((h) => openHost(h.name));
    setMobileOpen(false);
  }, [groupContextMenu, closeContextMenus]);

  const handleOpenGroupAllInNewWindow = useCallback(() => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    openHostInNewWindow("#" + TAG_GROUP_PREFIX + groupContextMenu.path);
  }, [groupContextMenu, closeContextMenus]);

  const handleOpenGroupAllSplitScreen = useCallback(() => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    const { hosts } = getStore();
    const filtered = hosts.filter((h) => h.tags && h.tags.includes(TAG_GROUP_PREFIX + groupContextMenu.path));
    const targets = filtered.slice(0, 4);
    if (targets.length > 0) {
      openHostsAsSplit(
        groupContextMenu.path,
        targets.map((h) => h.name),
      );
      setMobileOpen(false);
    }
  }, [groupContextMenu, closeContextMenus]);

  const handleGroupCopyUrl = useCallback(async () => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    const url = `${window.location.origin}/##${TAG_GROUP_PREFIX}${groupContextMenu.path}`;
    navigator.clipboard.writeText(url);
  }, [groupContextMenu, closeContextMenus]);

  const handleAddGroupHostClick = useCallback(async () => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    openAddHostDialog({ tags: [TAG_GROUP_PREFIX + groupContextMenu.path] });
  }, [groupContextMenu, closeContextMenus]);

  const handleAddSubGroupClick = useCallback(async () => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    const parentPath = groupContextMenu.path;
    const name = await dialogs.prompt(
      t("Create new sub-group") + ` (${t("Parent group:")} ${parentPath}). ` + t("Enter sub-group name:"),
      "",
      {
        validate: function (str: string): string | undefined {
          if (str.includes(" ") || str.includes("/")) {
            return t("Group name cannot contain spaces or slashes (/)");
          }
          return undefined;
        },
      },
    );
    if (!name) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.includes(" ") || trimmed.includes("/")) {
      dialogs.alert(t("Group name cannot contain spaces or slashes (/)."));
      return;
    }
    const { groups } = getStore();
    const newPath = `${parentPath}/${trimmed}`;
    if (groups.includes(newPath)) {
      dialogs.alert(t("Sub-group already exists."));
      return;
    }
    const nextGroups = [...groups, newPath];
    const res = await fetch("/api/groups", {
      method: METHOD_POST,
      headers: apiReqHeaders(),
      body: JSON.stringify(nextGroups),
    });
    if (res.ok) {
      setGroups(nextGroups);
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.add(parentPath);
        return next;
      });
    } else {
      dialogs.alert(t("Failed to save group"));
    }
  }, [groupContextMenu, closeContextMenus]);

  const handleAddTopLevelGroupClick = useCallback(async () => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    const name = await dialogs.prompt(t("Enter top-level group name:"));
    if (!name) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.includes(" ") || trimmed.includes("/")) {
      dialogs.alert(t("Group name cannot contain spaces or slashes (/)."));
      return;
    }
    const { groups } = getStore();
    if (groups.includes(trimmed)) {
      dialogs.alert(t("Group already exists."));
      return;
    }
    const nextGroups = [...groups, trimmed];
    const res = await fetch("/api/groups", {
      method: METHOD_POST,
      headers: apiReqHeaders(),
      body: JSON.stringify(nextGroups),
    });
    if (res.ok) {
      setGroups(nextGroups);
    } else {
      dialogs.alert(t("Failed to save group"));
    }
  }, [closeContextMenus, groupContextMenu]);

  const handleDeleteGroupClick = useCallback(async () => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    const G = groupContextMenu.path;
    if (
      !(await dialogs.confirm(
        t("Will delete this group:") +
          " " +
          G +
          ". " +
          t("Are you sure?") +
          " " +
          t("Belonging servers will be relocated to parent group or ungrouped."),
      ))
    ) {
      return;
    }

    const { hosts, groups } = getStore();
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

    const groupsRes = await fetch("/api/groups", {
      method: METHOD_POST,
      headers: apiReqHeaders(),
      body: JSON.stringify(nextGroups),
    });

    if (groupsRes.ok) {
      setGroups(nextGroups);
    }

    await fetch("/api/hosts", {
      method: METHOD_PUT,
      headers: apiReqHeaders(),
      body: JSON.stringify(updatedHosts),
    });

    fetchHosts();
  }, [closeContextMenus, groupContextMenu]);

  const handleRenameGroupClick = useCallback(async () => {
    if (!groupContextMenu) {
      return;
    }
    closeContextMenus();
    const G = groupContextMenu.path;

    const parts = G.split("/");
    const lastPart = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : null;

    const name = await dialogs.prompt(
      t("Rename group") + ` "${lastPart}"${parentPath ? ` (${G})` : ""}. ` + t("Enter new name:") + " ",
      lastPart,
      {
        validate: function (str: string): string | undefined {
          if (!str.trim()) {
            return t("Group name cannot be empty");
          }
          if (str.includes(" ") || str.includes("/")) {
            return t("Group name cannot contain spaces or slashes (/)");
          }
          return undefined;
        },
      },
    );

    if (!name) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed === lastPart) {
      return;
    }

    const newG = parentPath ? `${parentPath}/${trimmed}` : trimmed;

    const { hosts, groups } = getStore();
    // Check if new group already exists in the same level
    if (groups.includes(newG)) {
      dialogs.alert(t("A group with that name already exists."));
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
      dialogs.alert(t("A group with that name already exists."));
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

    // Save next groups
    const groupsRes = await fetch("/api/groups", {
      method: METHOD_POST,
      headers: apiReqHeaders(),
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
        return next;
      });
    } else {
      dialogs.alert(t("Failed to save renamed group"));
      return;
    }

    await fetch("/api/hosts", {
      method: METHOD_PUT,
      headers: apiReqHeaders(),
      body: JSON.stringify(updatedHosts),
    });

    fetchHosts();
  }, [closeContextMenus, groupContextMenu]);

  const handleSaveHost = useCallback(async () => {
    const { editHostName, hostFormData } = getStore();
    if (!hostFormData.hostname) {
      return;
    }
    const finalName = hostFormData.name.trim() || hostFormData.hostname.trim();

    const parsedTags = hostFormData.tags
      .replace(/,/g, " ")
      .split(/\s+/)
      .filter((t) => t.trim() !== "");

    let clearPassword = hostFormData.clearPassword;
    let passwordVal = hostFormData.password;

    if (hostFormData.passwordExists) {
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
      clearPassword,
    };

    if (!isValidHostname(payload.name) || !isValidHostname(payload.hostname)) {
      dialogs.alert(t("Invalid hostname or name"));
      return;
    }

    if (
      !editHostName &&
      getStore().hosts.find((h) => (h.name || h.hostname) === (payload.name || payload.hostname)) &&
      !(await dialogs.confirm(
        t(
          "The same name host already exists. If you continue the new added host will override the existing one. Are you sure?",
        ) + ` (${payload.name || payload.hostname})`,
      ))
    ) {
      return;
    }

    const res = await fetch("/api/hosts" + (editHostName ? "/" + editHostName : ""), {
      method: METHOD_POST,
      headers: apiReqHeaders(),
      body: JSON.stringify(payload),
    });

    if (res.status === 403) {
      const text = await res.text();
      if (text.includes("encryption key not set")) {
        const appPwd = await dialogs.promptPassword(
          t("The password store is locked. Enter your CozySSH app password to unlock and save the host password:"),
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
          localStorage.setItem(BROWSER_STORAGE_KEY_TOKEN, loginData.token);

          const retryRes = await fetch("/api/hosts", {
            method: METHOD_PUT,
            headers: apiReqHeaders(),
            body: JSON.stringify([payload]),
          });

          if (retryRes.ok) {
            setInitialHostFormData(null);
            setEditHostDialogOpen(false);
            fetchHosts();
            return;
          } else {
            dialogs.alert(
              t("Failed to save host details after unlocking"),
              `status=${retryRes.status},msg=${retryRes.text()}`,
            );
          }
        } else {
          dialogs.alert(t("Incorrect app password. Host was not saved."));
        }
        return;
      }
    }
    if (!res.ok) {
      dialogs.alert(t("Failed to save host"), `status=${res.status}, msg=${await res.text()}`);
      return;
    }
    setInitialHostFormData(null); // Reset dirty state on successful save
    setEditHostDialogOpen(false);
    await fetchHosts();
    updateTabTitles(payload.name);
  }, []);

  const hostFormDirty = useMemo(() => {
    return !!initialHostFormData && JSON.stringify(hostFormData) !== JSON.stringify(initialHostFormData);
  }, [hostFormData, initialHostFormData]);

  const hostFormSubmitDisabled = !hostFormData.hostname || (!!editHostName && !hostFormDirty);

  const handleEditHostFormKeyDown = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      const key = getKeyCombination(e);
      if (key === "ctrl+enter" && !hostFormSubmitDisabled) {
        e.preventDefault();
        e.stopPropagation();
        handleSaveHost();
      }
    },
    [hostFormSubmitDisabled, handleSaveHost],
  );

  const handleCloseHostDialog: DialogProps["onClose"] = useCallback(
    (e, reason) => {
      if (hostFormDirty && !(reason === "backdropClick" && isModifier(e as MouseEvent, "ctrl"))) {
        return;
      }
      setEditHostDialogOpen(false);
    },
    [hostFormDirty],
  );

  const [allFavs, allNormals] = useMemo(() => {
    const allFavs: HostData[] = [];
    const allNormals: HostData[] = [];
    for (const host of hosts) {
      if (host.isFavourite) {
        allFavs.push(host);
      } else {
        allNormals.push(host);
      }
    }
    return [allFavs, allNormals];
  }, [hosts]);

  const filteredHosts = useMemo(() => {
    const filteredAll = filterHosts(hosts, filterStr);
    const favs = filteredAll.filter((h) => h.isFavourite);
    const sortedFavs = favs.sort(hostSorter);

    const autos = filteredAll.filter((h) => !h.isFavourite && h.isAuto);
    const sortedAutos = autos.sort(hostSorter);

    const treeHosts = filteredAll.filter((h) => !h.isAuto);

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
      const name = parts[parts.length - 1]!;
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
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.name.localeCompare(b.name);
      });

      subServers.sort((a, b) => {
        const orderA = getHostOrder(a.host);
        const orderB = getHostOrder(b.host);
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.name.localeCompare(b.name);
      });

      node.children = [...subGroups, ...subServers];
    }

    topLevelGroups.sort((a, b) => {
      const orderA = getGroupOrder(a.path);
      const orderB = getGroupOrder(b.path);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.name.localeCompare(b.name);
    });

    topLevelServers.sort((a, b) => {
      const orderA = getHostOrder(a.host);
      const orderB = getHostOrder(b.host);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
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
            if (!filterStr.trim()) {
              return true;
            }
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
  }, [hosts, groups, filterStr, getGroupOrder]);

  const groupHostCounts = useMemo(() => {
    const counts: Record<string, number> = { "": 0 };
    const process = (node: TreeNode) => {
      if (node.type === "group") {
        for (const child of node.children) {
          process(child);
        }
      } else {
        const gp = getHostGroupPath(node.host);
        counts[""]!++;
        if (gp) {
          counts[gp] = (counts[gp] || 0) + 1;
        }
      }
    };
    for (const node of filteredHosts.treeNodes) {
      process(node);
    }
    return counts;
  }, [filteredHosts.treeNodes]);

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
      lastSelectedItemId.current = flatList[selectedIndex]!.id;
    } else {
      lastSelectedItemId.current = null;
    }
  }, [selectedIndex, flatList]);

  useEffect(() => {
    if (filterStr !== lastFilterStr.current) {
      lastFilterStr.current = filterStr;
      if (filterStr.trim() !== "" && flatList.length > 0) {
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

  useEffect(() => {
    if (selectedIndex === 0) {
      const el = document.getElementById(ID_SIDEBAR_MAIN);
      if (el) {
        el.scrollTop = 0;
      }
    }
  }, [selectedIndex]);

  const handleFilterKeyDown = useCallback(
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
          ? flatList.length
          : (keycb.endsWith("+j") ? e.shiftKey : isModifier(e, "alt"))
            ? getIntVar(VAR_CS_SCROLL_ITEMS, DEFAULT_SCROLL_ITEMS)
            : 1;
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.min(prev + step, flatList.length - 1));
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
          ? flatList.length
          : (keycb.endsWith("+k") ? e.shiftKey : isModifier(e, "alt"))
            ? getIntVar(VAR_CS_SCROLL_ITEMS, DEFAULT_SCROLL_ITEMS)
            : 1;
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.max(prev - step, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (selectedIndex >= 0 && selectedIndex < flatList.length) {
          const selectedItem = flatList[selectedIndex]!;
          const altMode = getAltMode(e);
          if (altMode === AM_6_CTRL_SHIFT) {
            // ctrl + shift
            const el = document.getElementById(flatListIds[selectedIndex]!);
            if (el) {
              el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
            }
          } else if (selectedItem.type === "group") {
            toggleGroupExpanded(selectedItem.path, altMode === AM_3_CTRL);
          } else {
            if (altMode === AM_3_CTRL) {
              openHostInNewWindow(selectedItem.host.name);
            } else if (altMode === AM_2_SHIFT) {
              openEditHostDialog(selectedItem.host);
            } else {
              openHost(selectedItem.host.name, {
                target: altMode === AM_1_ALT ? "_self" : undefined,
                options: { ...getHostFlags(selectedItem.host) },
              });
            }
            document.getElementById(ID_SIDEBAR_FILTER)?.blur();
          }
        }
      }
    },
    [flatList, flatListIds, selectedIndex],
  );

  const uniqueTags = useMemo(() => {
    const set = new Set<string>();
    hosts.forEach((h) => {
      if (h.tags) {
        h.tags.forEach((t) => {
          if (
            t !== TAG_FAV &&
            !t.startsWith(TAG_GROUP_PREFIX) &&
            !t.startsWith(TAG_ORDER_PREFIX) &&
            !t.startsWith(TAG_FLAG_PREFIX)
          ) {
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
        // 60px + padding top (4) + padding bottom(4)
        setShowTagsToggle(tagsContainerRef.current.scrollHeight > 68);
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
            groupHostCounts={groupHostCounts}
            setDraggedItem={setDraggedItem}
            draggedItem={draggedItem}
            dragOverTarget={dragOverTarget}
            setDragOverTarget={setDragOverTarget}
            setGroupContextMenu={setGroupContextMenu}
            setGroupContextMenuOpen={setGroupContextMenuOpen}
          />
          <Collapse in={expandedGroups.has(node.path)} timeout={0} unmountOnExit>
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
          handleContextMenu={handleContextMenu}
        />
      );
    }
  };

  const handleRootDragOver = (e: React.DragEvent) => {
    if (!draggedItem) {
      return;
    }
    e.preventDefault();
    setDragOverTarget({ id: "root", effect: "inside" });
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTarget(null);
    if (!draggedItem) {
      return;
    }
    if (draggedItem.type === "server") {
      await moveServer(draggedItem.name, null, null);
    }
    setDraggedItem(null);
  };

  const sidebarWidth = getIntVar(VAR_CS_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH);

  return (
    <Drawer
      id={ID_SIDEBAR}
      variant={isMobile ? "temporary" : "permanent"}
      open={isMobile ? mobileOpen : true}
      onClose={closeMobileSidebar}
      ModalProps={{ keepMounted: true }}
      sx={{
        width: sidebarWidth,
        flexShrink: 0,
        [`& .MuiDrawer-paper`]: { width: sidebarWidth, boxSizing: "border-box" },
      }}
    >
      <Toolbar sx={{ justifyContent: "space-between", pr: 1 }}>
        <Typography variant="h6" noWrap sx={{ fontWeight: "bold" }}>
          <span>{APP_NAME}</span>&nbsp;
          <span title={sysSitename}>{sysSitename}</span>
        </Typography>
        <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
          <MoreVertIcon />
        </IconButton>
        <Menu id="main-menu" anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeContextMenus}>
          <MenuItem
            id="main-menu-refresh"
            onClick={() => {
              closeContextMenus();
              onRefresh();
            }}
          >
            {t("Refresh")} (ctrl+alt+r)
          </MenuItem>
          <MenuItem
            id="main-menu-open-scratchpad"
            onClick={() => {
              closeContextMenus();
              onOpenScratchpad();
            }}
          >
            {t("Open Scratchpad")} (alt+s)
          </MenuItem>
          <MenuItem
            id="main-menu-dashboard"
            onClick={() => {
              closeContextMenus();
              setSettingsOpen(true);
              if (isMobile) {
                closeMobileSidebar();
              }
            }}
          >
            {t("Dashboard")}
          </MenuItem>
          <ExtraMenu
            extraMenu={extraMainMenu}
            // eslint-disable-next-line @typescript-eslint/prefer-as-const
            target={"" as ""}
            before={closeContextMenus}
          />
          <MenuItem
            id="main-menu-logout"
            className={CLASS_HIDE_DESKTOP}
            onClick={() => {
              closeContextMenus();
              logout(true);
            }}
          >
            {t("Logout")}
          </MenuItem>
          <MenuItem
            id="main-menu-logout-all"
            className={CLASS_HIDE_DESKTOP}
            onClick={() => {
              closeContextMenus();
              logoutAll(true);
            }}
          >
            {t("Logout All")}
          </MenuItem>
        </Menu>
      </Toolbar>

      <Box sx={{ px: 2, pb: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <TextFieldWithCopy
            size="small"
            autoComplete="off"
            type="search"
            id="sidebar-filter"
            placeholder={t("Filter hosts or #tag...")}
            title="<Alt + I>"
            value={filterStr}
            onChange={(e) => setFilterStr(e.target.value)}
            onKeyDownCapture={handleFilterKeyDown}
            sx={{ flexGrow: 1 }}
          />
          <IconButton
            size="small"
            title={t("New Server")}
            onClick={() => openAddHostDialog()}
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
                    onClick={handleTagClick}
                    onContextMenu={handleTagContextMenu}
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
                <IconButton size="small" onClick={() => setTagsExpanded()} sx={{ p: 0 }}>
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

      <Box id={ID_SIDEBAR_MAIN} sx={{ overflow: "auto", display: "flex", flexDirection: "column" }}>
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
                if (isModifier(e, "ctrl")) {
                  openHostInNewWindow(LOCAL_NAME);
                } else {
                  openHost(LOCAL_NAME, { target: isModifier(e, "alt") ? "_self" : undefined });
                  setMobileOpen(false);
                }
              }}
            >
              <ListItemIcon>
                <ComputerIcon />
              </ListItemIcon>
              <ListItemText primary={t("Local Shell")} />
            </ListItemButton>
          </ListItem>

          {(filteredHosts.favourite.length > 0 ||
            filteredHosts.treeNodes.length > 0 ||
            filteredHosts.auto.length > 0) && <Divider sx={{ my: 1 }} />}

          {filteredHosts.favourite.length > 0 && (
            <>
              <Box
                onClick={() => setFavExpanded()}
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
                  {t("FAVOURITES")}
                  {filteredHosts.favourite.length > 0 && ` (${filteredHosts.favourite.length})`}
                </Typography>
              </Box>
              <Collapse in={!!favExpanded} timeout={0} unmountOnExit>
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
                        isMobile={isMobile}
                        isTouch={isTouch}
                        draggedItem={draggedItem}
                        dragOverTarget={dragOverTarget}
                        setDraggedItem={setDraggedItem}
                        setDragOverTarget={setDragOverTarget}
                      />
                    );
                  })}
                </List>
              </Collapse>
              <Divider sx={{ my: 1 }} />
            </>
          )}

          <Box
            onClick={(e) => {
              const currentExpanded = getStore().allExpanded;
              setAllExpanded(+!currentExpanded);
              if (isModifier(e, "ctrl")) {
                toggleExpandAllGroups(!currentExpanded);
              }
            }}
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
                {t("ALL")}
                {groupHostCounts[""]! > 0 && ` (${groupHostCounts[""]})`}
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
              title={t("Add Group")}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>

          <Collapse in={!!allExpanded} timeout={0} unmountOnExit>
            {filteredHosts.treeNodes.length > 0 && (
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
                {filteredHosts.treeNodes.map((node) => renderTreeNode(node, 0))}
              </Box>
            )}
          </Collapse>

          {filteredHosts.auto.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Box
                onClick={() => setAutoExpanded()}
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
                  {t("AUTO")}
                  {filteredHosts.auto.length > 0 && ` (${filteredHosts.auto.length})`}
                </Typography>
              </Box>
              <Collapse in={!!autoExpanded} timeout={0} unmountOnExit>
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

      <Menu open={localShellContextMenuOpen} onClose={closeContextMenus} anchorEl={() => localShellRef.current}>
        {shells.map((shell, idx) => (
          <>
            <MenuItem
              key={idx}
              onClick={(e) => {
                closeContextMenus();
                if (isModifier(e, "ctrl")) {
                  openHostInNewWindow(idx > 0 ? localShellHost(shell) : LOCAL_NAME);
                } else {
                  openHost(idx > 0 ? localShellHost(shell) : LOCAL_NAME, {
                    target: isModifier(e, "alt") ? "_self" : undefined,
                  });
                }
                setMobileOpen(false);
              }}
            >
              {shell.name +
                (idx === 0
                  ? " " + t("(Default)") + " (alt+n)"
                  : idx === 1
                    ? " " + t("(Alternative)") + " (alt+shift+n)"
                    : "")}
            </MenuItem>
            {idx === 0 && (
              <MenuItem
                key="default-newtab"
                onClick={(e) => {
                  closeContextMenus();
                  if (isModifier(e, "ctrl")) {
                    openHostInNewWindow(LOCAL_NAME);
                  } else {
                    openHost(LOCAL_NAME, { target: "_self" });
                  }
                  setMobileOpen(false);
                }}
              >
                {`${shell.name} ${t("(Default)")} (${t("In Current Tab")}) (ctrl+alt+n)`}
              </MenuItem>
            )}
            {idx === 1 && (
              <MenuItem
                key="alternative-newtab"
                onClick={(e) => {
                  closeContextMenus();
                  if (isModifier(e, "ctrl")) {
                    openHostInNewWindow(localShellHost(shell));
                  } else {
                    openHost(localShellHost(shell), { target: "_self" });
                  }
                  setMobileOpen(false);
                }}
              >
                {`${shell.name} ${t("(Alternative)")} (${t("In Current Tab")}) (ctrl+alt+shift+n)`}
              </MenuItem>
            )}
          </>
        ))}
      </Menu>

      {/* Host Context Menu */}
      <Menu id="host-menu" open={contextMenuOpen} onClose={closeContextMenus} anchorEl={contextMenu?.element}>
        <MenuItem id="host-menu-edit" onClick={handleEditOpen}>
          {t("Edit")}
          {contextMenu ? " " + contextMenu.target.name : ""} (shift+click)
        </MenuItem>
        <MenuItem
          id="host-menu-open-new-window"
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            closeContextMenus();
            openHostInNewWindow(target.name);
          }}
        >
          {t("Open (New Window)")} (ctrl+click)
        </MenuItem>
        <MenuItem
          id="host-menu-open-current-tab"
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            closeContextMenus();
            openHost(target.name, { target: "_self" });
            setMobileOpen(false);
          }}
        >
          {t("Open (In Current Tab)")} (alt+click)
        </MenuItem>
        {__CS_ENV__ === 0 && (
          <MenuItem
            id="host-menu-copy-url"
            onClick={() => {
              if (!contextMenu) {
                return;
              }
              const target = contextMenu.target;
              closeContextMenus();
              const url = `${window.location.origin}/#${
                target.source !== "known_hosts" ? target.name : hostLabel(target, true)
              }`;
              navigator.clipboard.writeText(url);
            }}
          >
            {t("Copy URL")}
          </MenuItem>
        )}
        <MenuItem
          id="host-menu-copy-ssh-command"
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            closeContextMenus();
            navigator.clipboard.writeText(getSSHCommand(target));
          }}
        >
          {t("Copy SSH Command")}
        </MenuItem>
        <MenuItem
          id="host-menu-copy-upload-identity-command"
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            closeContextMenus();
            navigator.clipboard.writeText(
              getSSHCopyIdCommand(
                target,
                getStore().sysinfo.defaultIdentityPath,
                getStore().sysinfo.defaultIdentityPublicKey,
              ),
            );
          }}
        >
          {t("Copy Upload Identity Command")}
        </MenuItem>
        <MenuItem
          id="host-menu-copy-ssh-config-block"
          onClick={() => {
            if (!contextMenu) {
              return;
            }
            const target = contextMenu.target;
            closeContextMenus();
            navigator.clipboard.writeText(getSSHConfigBlock(target));
          }}
        >
          {t("Copy SSH Config Block")}
        </MenuItem>
        <MenuItem id="host-menu-run-ssh-copy-id" onClick={handleRunCopyID}>
          {t("Run ssh-copy-id")}
        </MenuItem>
        <MenuItem id="host-menu-favourite" onClick={handleToggleFavourite}>
          {contextMenu?.target.isFavourite ? t("Remove From Favourite") : t("Add To Favourite")}
        </MenuItem>
        {contextMenu?.section === "tree" && (
          <MenuItem
            id="host-menu-move-to-group"
            onClick={async () => {
              if (!contextMenu) {
                return;
              }
              const target = contextMenu.target;
              closeContextMenus();
              const groups = getStore().groups;
              const currentGroup = getHostGroupPath(target);
              const dstGroup = await dialogs.prompt(
                t("Move server to new group. ") +
                  t("Server:") +
                  " " +
                  target.name +
                  "; " +
                  t("Current group:") +
                  " " +
                  (currentGroup || t("<none>")) +
                  ". " +
                  t("Select new group:") +
                  " ",
                currentGroup || "",
                {
                  options: [{ value: "", label: t("(no group)") }, ...groups],
                },
              );
              if (dstGroup === null) {
                return;
              }
              if ((dstGroup || null) === currentGroup) {
                return;
              }
              await moveServer(target.name, dstGroup || null, null);
            }}
          >
            {t("Move to Group")}
          </MenuItem>
        )}
        {contextMenu?.target && (
          <ExtraMenu extraMenu={extraHostMenu} target={contextMenu.target} before={closeContextMenus} />
        )}
        {contextMenu?.target.source === "config" && (
          <MenuItem id="host-menu-delete" onClick={handleDelete} sx={{ color: "error.main" }}>
            {t("Delete Host")}
          </MenuItem>
        )}
        {contextMenu?.target.source === "known_hosts" && (
          <MenuItem id="host-menu-delete" onClick={handleDeleteKnownHost} sx={{ color: "error.main" }}>
            {t("Delete Known Host")}
          </MenuItem>
        )}
      </Menu>

      <Menu id="tag-menu" open={tagContextMenuOpen} onClose={closeContextMenus} anchorEl={tagContextMenu?.element}>
        <MenuItem id="tag-menu-open-all" onClick={handleOpenAllServers}>
          {t("Open All")} ({tagContextMenu?.tag})
        </MenuItem>
        <MenuItem id="tag-menu-open-split" onClick={handleOpenSplitServers}>
          {t("Open All (Split Screen)")}
        </MenuItem>
        <MenuItem id="tag-menu-open-new-window" onClick={handleOpenAllServersInNewWindow}>
          {t("Open All (New Window)")}
        </MenuItem>
        <MenuItem id="tag-menu-copy-url" className={CLASS_HIDE_DESKTOP} onClick={handleCopyTagUrl}>
          {t("Copy URL")}
        </MenuItem>
        {!!tagContextMenu && (
          <ExtraMenu extraMenu={extraTagMenu} target={tagContextMenu.tag} before={closeContextMenus} />
        )}
      </Menu>

      {/* Group Context Menu */}
      <Menu
        id="group-menu"
        open={groupContextMenuOpen}
        onClose={closeContextMenus}
        anchorEl={groupContextMenu?.element}
      >
        {!!groupContextMenu?.path && (
          <>
            <MenuItem id="group-menu-open-all" onClick={handleOpenGroupAll}>
              {t("Open All")} ({groupContextMenu?.path})
            </MenuItem>
            <MenuItem id="group-menu-open-new-window" onClick={handleOpenGroupAllInNewWindow}>
              {t("Open All (New Window)")}
            </MenuItem>
            <MenuItem id="group-menu-open-split" onClick={handleOpenGroupAllSplitScreen}>
              {t("Open All (Split Screen)")}
            </MenuItem>
            {__CS_ENV__ === 0 && (
              <MenuItem id="group-menu-copy-url" onClick={handleGroupCopyUrl}>
                {t("Copy URL")}
              </MenuItem>
            )}
          </>
        )}
        <MenuItem id="group-menu-expand-collapse-all" onClick={handleToggleExpandAll}>
          {t("Expand/Collapse All")} (ctrl+click)
        </MenuItem>
        {!!groupContextMenu?.path && (
          <>
            <MenuItem id="group-menu-add-host" onClick={handleAddGroupHostClick}>
              {t("Add Host")}
            </MenuItem>
            <MenuItem id="group-menu-add-sub-group" onClick={handleAddSubGroupClick}>
              {t("Add Sub-Group")}
            </MenuItem>
            <MenuItem id="group-menu-rename-group" onClick={handleRenameGroupClick}>
              {t("Rename Group")}
            </MenuItem>
            <ExtraMenu extraMenu={extraGroupMenu} target={groupContextMenu.path} before={closeContextMenus} />
            <MenuItem id="group-menu-delete" onClick={handleDeleteGroupClick} sx={{ color: "error.main" }}>
              {t("Delete Group")}
            </MenuItem>
          </>
        )}
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
        <DialogTitle>{t("Dashboard")}</DialogTitle>
        <Box sx={{ borderBottom: 1, borderColor: "divider", px: 3 }}>
          <Tabs
            value={settingsTab}
            onChange={(_, newVal) => setSettingsTab(newVal)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            <Tab label={t("Sessions")} />
            <Tab label={t("Tunnels")} />
            <Tab label={t("Passwords")} />
            <Tab label={t("Settings")} />
            <Tab label={t("Sync")} />
            <Tab label={t("Import")} />
            <Tab label={t("Export")} />
            <Tab label={t("Shortcuts")} />
            <Tab label={t("About")} />
          </Tabs>
        </Box>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ p: 3, pt: 1, minWidth: 0 }}>
            {settingsTab === SETTINGS_TAB_IDX_SESSIONS && (
              <List dense sx={{ border: "1px solid #ddd", borderRadius: 1 }}>
                {pinnedSessions.map((ps) => {
                  const canAttach = !activeSessionIds.includes(ps.id);
                  return (
                    <ListItem key={ps.id} divider>
                      <ListItemIcon>
                        {ps.isHidden ? (
                          <VisibilityOffIcon />
                        ) : ps.isLocked ? (
                          <LockIcon />
                        ) : ps.isPinned ? (
                          <PushPinIcon />
                        ) : (
                          <ComputerIcon />
                        )}
                      </ListItemIcon>
                      <ListItemText primary={ps.title} secondary={`${ps.host} (Listeners: ${ps.listenerCount})`} />
                      {canAttach && (
                        <Button size="small" variant="outlined" onClick={() => onAttach(ps)}>
                          {t("Attach")}
                        </Button>
                      )}
                    </ListItem>
                  );
                })}
                {pinnedSessions.length === 0 && (
                  <ListItem>
                    <ListItemText primary={t("No pinned sessions")} />
                  </ListItem>
                )}
              </List>
            )}

            {settingsTab === SETTINGS_TAB_IDX_TUNNELS && (
              <>
                <Typography
                  variant="subtitle2"
                  gutterBottom
                  sx={{ fontSize: "typography.body1.fontSize", fontWeight: "bold" }}
                >
                  {t("Active Port Forwarding Tunnels")}
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
                          <TableCell sx={{ fontWeight: "bold" }}>{t("SSH Host")}</TableCell>
                          <TableCell sx={{ fontWeight: "bold" }}>{t("Type")}</TableCell>
                          <TableCell sx={{ fontWeight: "bold" }}>{t("Local Address")}</TableCell>
                          <TableCell sx={{ fontWeight: "bold" }}>{t("Remote Host:Port")}</TableCell>
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
                    <Typography color="text.secondary">{t("No active port forwarding tunnels.")}</Typography>
                  </Box>
                )}
              </>
            )}

            {settingsTab === SETTINGS_TAB_IDX_PASSWORDS && (
              <>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontSize: "typography.body1.fontSize", fontWeight: "bold" }}>
                    {t("Saved Passwords")}
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {!passwordsState.locked && !useKeyring && (
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
                        {t("Lock")}
                      </Button>
                    )}
                    <Chip
                      icon={passwordsState.locked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
                      label={passwordsState.locked ? "Locked" : useKeyring ? t("Unlocked (Keyring)") : t("Unlocked")}
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
                          <TableCell sx={{ fontWeight: "bold" }}>
                            {t("Identifier")}&nbsp;
                            <TextFieldWithCopy
                              size="small"
                              autoComplete="off"
                              autoFocus={true}
                              type="search"
                              id="passwords-filter"
                              placeholder={t("Filter")}
                              value={passwordsFilter}
                              onChange={(e) => setPasswordsFilter(e.target.value)}
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: "bold" }}>{t("Password")}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: "bold" }}>
                            {t("Actions")}
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(passwordsFilter
                          ? passwordsState.keys.filter((k) => k.toLowerCase().includes(passwordsFilter.toLowerCase()))
                          : passwordsState.keys
                        ).map((key) => {
                          const isRevealed = key in revealedPasswords;
                          const displayVal = isRevealed ? revealedPasswords[key] : PASSWORD_PLACEHOLDER;
                          return (
                            <TableRow key={key} hover>
                              <TableCell sx={{ fontFamily: "monospace" }}>{key}</TableCell>
                              <TableCell sx={{ fontFamily: "monospace" }}>{displayVal}</TableCell>
                              <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                                <Tooltip title={isRevealed ? t("Hide") : t("Reveal")}>
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
                                <Tooltip title={t("Copy Password")}>
                                  <IconButton size="small" onClick={() => handleCopyPassword(key)}>
                                    <ContentCopyIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title={t("Change")}>
                                  <IconButton size="small" color="primary" onClick={() => handleChangePassword(key)}>
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title={t("Delete")}>
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
                    <Typography color="text.secondary">{t("No passwords saved in the store.")}</Typography>
                  </Box>
                )}
              </>
            )}

            {settingsTab === SETTINGS_TAB_IDX_SETTINGS && (
              <>
                <Typography variant="subtitle2" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} gutterBottom>
                  <code>Service Worker:</code>
                  <Chip label={swStatus} color={swStatus === "active" ? "success" : "default"} variant="outlined" />
                  <Button variant="outlined" color="error" size="small" onClick={handleClearCache}>
                    {t("Force Update")} (ctrl+alt+shift+r)
                  </Button>
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} gutterBottom>
                  <code>{t("Config Dir")}:</code>
                  <ChipCopy label={sysConfigDir} />
                </Typography>
                <Typography variant="subtitle2" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} gutterBottom>
                  <code>{t("SSH Dir")}:</code>
                  <ChipCopy label={sysSshDir} />
                </Typography>
                <Typography variant="subtitle2" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} gutterBottom>
                  <code>{t("Default Identity Path")}:</code>
                  {sysDefaultIdentityPath ? (
                    <ChipCopy label={sysDefaultIdentityPath} />
                  ) : (
                    <>
                      {t("(none)")}. {t("Generate one use:")} <ChipCopy label="ssh-keygen -t ed25519" />
                    </>
                  )}
                </Typography>
                <Typography variant="subtitle2" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} gutterBottom>
                  <code>{t("Default Identity Public Key")}:</code>
                  <ChipCopy label={sysDefaultIdentityPublicKey} />
                </Typography>
                {!!sysDefaultIdentityPublicKey && (
                  <Typography variant="subtitle2" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} gutterBottom>
                    <code>{t("Copy Add Public Key to authorized_keys Command")}:</code>
                    <CopyButton
                      variant="text"
                      size="small"
                      data={() => getAddAuthorizedKeyCmd(sysDefaultIdentityPublicKey)}
                    >
                      {t("Linux version")}
                    </CopyButton>
                    <CopyButton
                      variant="text"
                      size="small"
                      data={() => getAddAuthorizedKeyCmd(sysDefaultIdentityPublicKey, true)}
                    >
                      {t("Windows version (PowerShell)")}
                    </CopyButton>
                  </Typography>
                )}
                <Typography variant="subtitle2" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} gutterBottom>
                  <code>{t("OS Username")}:</code>
                  <ChipCopy label={sysUsername} />
                </Typography>
                <Typography variant="subtitle2" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} gutterBottom>
                  <code>{t("Sitename")}:</code>
                  <ChipCopy label={sysSitename} />
                  <Button variant="text" size="small" onClick={handleChangeSitename}>
                    {t("Change")}
                  </Button>
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" gutterBottom>
                  {t("Save Password Setting")}
                </Typography>
                <ButtonGroup fullWidth size="small" sx={{ mt: 1, mb: 1 }}>
                  <Button
                    variant={savePassword === "ask" ? "contained" : "outlined"}
                    onClick={() => updateConfig({ savePassword: "ask" })}
                  >
                    {t("ask")} ({t("default")})
                  </Button>
                  <Button
                    variant={savePassword === "always" ? "contained" : "outlined"}
                    onClick={() => updateConfig({ savePassword: "always" })}
                  >
                    {t("always")}
                  </Button>
                  <Button
                    variant={savePassword === "never" ? "contained" : "outlined"}
                    onClick={() => updateConfig({ savePassword: "never" })}
                  >
                    {t("never")}
                  </Button>
                </ButtonGroup>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} gutterBottom>
                  <code title={t("Use system keyring to save app password")}>{t("Use System Keyring")}:</code>
                  <Chip color={useKeyring ? "success" : "default"} label={useKeyring ? t("Enabled") : t("Disabled")} />
                  <Button
                    variant="text"
                    size="small"
                    onClick={async () => {
                      let appPassword: string;
                      if (useKeyring) {
                        const res = await fetch("/api/settings/reveal_app_password", {
                          method: METHOD_POST,
                          headers: apiReqHeaders(),
                        });
                        if (!res.ok) {
                          throw new Error(`Can't get app password, status=${res.status}`);
                        }
                        appPassword = ((await res.json()) as RevealAppPasswordResponse).appPassword;
                        if (
                          !(await dialogs.confirm(
                            t("Disable system keyring"),
                            t("It will remove the saved app password from system keyring.") +
                              " " +
                              t("You MUST save your app password manually before proceeding.") +
                              " " +
                              t("Otherwise all your saved SSH passwords will be lost.") +
                              " " +
                              t("Your app password is: ") +
                              appPassword +
                              ". " +
                              t("To continue, enter the above app password below:"),
                            appPassword,
                          ))
                        ) {
                          return;
                        }
                      } else {
                        // current app password may already exists in keyring
                        // in which case we don't need to ask user to provide it.
                        const ok = await updateConfig({ useKeyring: true });
                        if (ok) {
                          return;
                        }
                        const pass = await dialogs.promptPassword(
                          t("It will enable system keyring and stores the app password in it.") +
                            " " +
                            t("Enter current app password to continue:") +
                            " ",
                        );
                        if (!pass) {
                          return;
                        }
                        appPassword = pass;
                      }
                      updateConfig({ appPassword, useKeyring: !useKeyring });
                    }}
                  >
                    {useKeyring ? t("Toggle Off") : t("Toggle On")}
                  </Button>
                </Typography>
                <Typography variant="subtitle2" gutterBottom>
                  {t("Change App Password")}
                </Typography>
                <TextField
                  fullWidth
                  label={t("New Password")}
                  type="password"
                  size="small"
                  margin="dense"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                />
                <TextField
                  fullWidth
                  label={t("Confirm Password")}
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
                  {t("Save Password")}
                </Button>
              </>
            )}

            {settingsTab === SETTINGS_TAB_IDX_SYNC && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1, mt: -1 }}>
                  <b>{t("WebDAV Synchronization")}</b>:&nbsp;
                  {t("Sync CozySSH data (buttons, vars, scratchpad) with a custom WebDAV directory.")}
                  <br />
                  <b>{t("Note")}</b>:&nbsp;
                  {t(`OpenSSH hosts data sync is opt-in and semi-automatic.`) +
                    " " +
                    t(`You must manually import other device's hosts from "Import" page.`) +
                    " " +
                    t("OpenSSH private keys and saved passwords will NOT be uploaded.")}
                  &nbsp;
                  {t("Reference link:")}&nbsp;
                  <a target="_blank" rel="noopener noreferrer" href={LINK_COZYSSH_DOC_DATA + "#sync"}>
                    {t("CozySSH Data doccument")}
                  </a>
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
                        {t("Sync Status")}:
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
                        {webdavEnabled ? t("Disable Sync") : t("Enable Sync")}
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={handleSyncNow}
                        disabled={!webdavEnabled || syncStatus === "syncing"}
                        size="small"
                        sx={{ textTransform: "none" }}
                      >
                        {syncStatus === "syncing" ? t("Syncing...") : t("Sync Now")}
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
                    {t("Last Synced")} {syncTime ? new Date(syncTime).toLocaleString() : t("Never")}
                  </Typography>
                </Box>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: "bold" }}>
                  {t("WebDAV Server Configuration")}
                </Typography>
                <TextFieldWithCopy
                  fullWidth
                  label={t("Current Server URL")}
                  size="small"
                  margin="dense"
                  value={currentWebdavUrl || "(" + t("Not configured") + ")"}
                  disabled
                  copyDisabled={!currentWebdavUrl}
                />
                <TextFieldWithCopy
                  fullWidth
                  label={t("WebDAV Server URL")}
                  size="small"
                  margin="dense"
                  placeholder="https://example.com/dav/"
                  value={webdavUrl}
                  onChange={(e) => setWebdavUrl(e.target.value)}
                  disabled={isTestingWebdav}
                />
                <TextFieldWithCopy
                  fullWidth
                  label={t("WebDAV Username")}
                  size="small"
                  margin="dense"
                  value={webdavUser}
                  onChange={(e) => setWebdavUser(e.target.value)}
                  disabled={isTestingWebdav}
                />
                <TextFieldWithCopy
                  fullWidth
                  label={t("WebDAV Password")}
                  size="small"
                  margin="dense"
                  placeholder={t("WebDAV password")}
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
                      <Typography variant="body2">{t("Enable End-to-End Encryption (E2EE)")}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t("Encrypt data before uploading to WebDAV server.")}
                      </Typography>
                    </Box>
                  }
                  sx={{ mt: 1, mb: 1, alignItems: "flex-start" }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={uploadSSHData}
                      onChange={(e) => setUploadSSHData(e.target.checked)}
                      disabled={isTestingWebdav}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{t("Upload local SSH data")}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t("Allow uploading this device's local SSH config and known_hosts.")}
                      </Typography>
                    </Box>
                  }
                  sx={{ mt: 1, mb: 1, alignItems: "flex-start" }}
                />
                {useEncryption && !!masterKey && (
                  <TextFieldWithCopy
                    fullWidth
                    label={t("WebDAV Master Key (Base64)")}
                    size="small"
                    margin="dense"
                    value={masterKey}
                    onChange={(e) => setMasterKey(e.target.value)}
                    disabled={true}
                    helperText={t("Save this key. You will need it to setup encrypted sync session on other devices.")}
                  />
                )}
                <Typography sx={{ display: "flex", gap: 1 }}>
                  <Button
                    variant="contained"
                    onClick={handleSaveWebdav}
                    disabled={
                      isTestingWebdav ||
                      !webdavUrl ||
                      (webdavUrl === currentWebdavUrl &&
                        webdavUser === currentWebdavUser &&
                        webdavPassword === currentWebdavPassword &&
                        masterKey === currentMasterKey &&
                        uploadSSHData === currentUploadSSHData)
                    }
                    sx={{ mt: 1, textTransform: "none" }}
                    disableElevation
                  >
                    {isTestingWebdav
                      ? t("Verifying & Saving...")
                      : urlChanged
                        ? t("Verify & Save Sync Settings")
                        : t("Save Sync Settings")}
                  </Button>
                  <Button
                    variant="contained"
                    onClick={handleClearWebdav}
                    disabled={isTestingWebdav || !currentWebdavUrl}
                    sx={{ mt: 1, textTransform: "none" }}
                    disableElevation
                  >
                    {t("Clear Sync Settings")}
                  </Button>
                </Typography>
              </>
            )}

            {settingsTab === SETTINGS_TAB_IDX_IMPORT && <SSHImportTab />}

            {settingsTab === SETTINGS_TAB_IDX_EXPORT && <SSHExportTab />}

            {settingsTab === SETTINGS_TAB_IDX_SHORTCUTS && (
              <>
                <Typography variant="subtitle2" gutterBottom>
                  {t("Keyboard Shortcuts")} (
                  {t(
                    "Note: in Mac, by default `Command` key (JavaScript KeyboardEvent `ev.metaKey`) is recognized as `Alt` (Originally the `Option` key); and vice versa",
                  )}
                  )
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }} gutterBottom>
                  <b>Alt + O</b> : {t("Open new tab dialog.")}&nbsp;
                  {t("In dialog:")}&nbsp;
                  <b>← →</b> {t("or")} <b>Alt + H/L</b>: {t("switch view")};&nbsp;
                  <b>↓ ↑</b> {t("or")} <b>Alt + J/K</b>: {t("select item")};&nbsp;
                  <b>Enter</b>: {t("open")};&nbsp;
                  <b>Alt + Enter</b>: {t("open in current tab")};&nbsp;
                  <b>Ctrl + Enter</b>: {t("open in new window")};&nbsp;
                  <b>Shift + Enter</b>: {t("edit selected host")};&nbsp;
                  <b>Alt + Shift + Enter</b>: {t("input selected host into filter")};&nbsp;
                  <b>Ctrl + Shift + Enter</b>: {t("Open context menu")};&nbsp;
                  <b>Alt + D</b>: {t("delete a recent item")};&nbsp;
                  <b>Alt + Backspace</b>: {t("clear the filter")};&nbsp;
                  <b>Alt + ↓↑</b> {t("or")} <b>Alt + Shift + J/K</b>: {t("jump through items quickly")};&nbsp;
                  <b>Ctrl + Alt + J/K</b>: {t("jump to top/bottom")};&nbsp;
                  <b>Ctrl/Alt/Shift + Mouse Click</b>: {t("the same as `Ctrl/Alt/Shift + Enter`")}
                  <br />
                  <b>Alt + A</b> : {t("Open new tab dialog - tabs view")}
                  <br />
                  <b>Alt + E / Ctrl + Shift + P</b> : {t("Open new tab dialog - buttons view")}
                  <br />
                  <b>Alt + P</b> : {t("Open new tab dialog - tags view")}
                  <br />
                  <b>Alt + :</b> : {t("Open new tab dialog - tunnels view")}
                  <br />
                  <b>Alt + ?</b> : {t("Open new tab dialog - all view")}
                  <br />
                  <b>Alt + Shift + O/A/E/P/:/?</b> :&nbsp;
                  {t("Same as `Alt + O/A/E/P/:/?` but preserve last input filter value")}
                  <br />
                  <b>Alt + N</b> : {t("Open new default local shell tab")}; <b>Ctrl + Alt + N</b>:&nbsp;
                  {t("Open default shell in current tab")}
                  <br />
                  <b>Alt + Shift + N</b> : {t("Open new alternative local shell tab")}; <b>Ctrl + Alt + Shift + N</b>
                  :&nbsp;
                  {t("Open alternative shell in current tab")}
                  <br />
                  <b>Alt + S</b> : {t("Open scratchpad")}
                  <br />
                  <b>Alt + H / Alt + L</b> : {t("Switch to previous / next pane")}
                  <br />
                  <b>Alt + Shift + H / Alt + Shift + L</b> : {t("Switch to previous / next tab")}
                  <br />
                  <b>Alt + 1-9,0</b> : {t("Switch to tab 1-9, last tab")}
                  <br />
                  <b>Alt + C</b> : {t("Clone active pane in new tab")}
                  <br />
                  <b>Alt + Shift + C</b> : {t("Clone active pane in same tab (Max 4 panes per tab)")}
                  <br />
                  <b>Alt + W</b> : {t("Close active pane")}
                  <br />
                  <b>Alt + Shift + W</b> : {t("Close active tab")}
                  <br />
                  <b>Ctrl + Alt + Shift + W</b> : {t("Close other tabs")}
                  <br />
                  <b>Ctrl + Alt + Shift + L</b> : {t("Toggle Lock/Unlock current tab")}
                  <br />
                  <b>Alt + I</b> : {t("Focus sidebar search filter and clear current value.")}&nbsp;
                  {t("When the search filter is focused:")}&nbsp;
                  <b>↑ ↓</b>: {t("select item")};&nbsp;
                  <b>Enter</b>: {t("open (or toggle group expandness)")};&nbsp;
                  <b>Alt + Enter</b>: {t("open in current tab")};&nbsp;
                  <b>Ctrl + Enter</b>: {t("open in new window (or toggle group and all sub-groups expandness)")};&nbsp;
                  <b>Shift + Enter</b>: {t("edit selected host")};&nbsp;
                  <b>Ctrl + Shift + Enter</b>: {t("open context menu")};&nbsp;
                  <b>Ctrl/Alt/Shift + Mouse Click</b>: {t("the same as `Ctrl/Alt/Shift + Enter`")}
                  <br />
                  <b>Alt + Shift + I</b> : {t("Focus sidebar search filter but preserve current value")}
                  <br />
                  <b>Ctrl + Alt + Backquote</b> : {t("Toggle sidebar tags section expandness")}
                  <br />
                  <b>Ctrl + Alt + 1/2/3</b> : {t("Toggle sidebar fav/all/auto section expandness")}
                  <br />
                  <b>Ctrl + Alt + G</b> : {t("Toggle sidebar all groups expandness")}
                  <br />
                  <b>Alt + G</b> : {t("Focus active terminal session")}
                  <br />
                  <b>Alt + Shift + G</b> : {t("Focus the first pane of the active tab")}
                  <br />
                  <b>Alt + Q</b> : {t("Open input dialog")}
                  <br />
                  <b>Alt + Shift + Q</b> : {t("Open input dialog and preserve last form values")}
                  <br />
                  <b>Alt + V / Alt + Shift + V</b> : {t("Switch to next / previous group in button bar")}
                  <br />
                  <b>Ctrl + Alt + V / Ctrl + Alt + Shift + V</b> :&nbsp;
                  {t("Switch to next / previous group in button bar, include hidden groups")}
                  <br />
                  <b>Alt + Shift + 1-9,0</b> : {t("Click the button in button bar")}
                  <br />
                  <b>Alt + J / Alt + K</b> : {t("Scroll terminal down / up by a few lines")}
                  <br />
                  <b>Alt + Shift + J / Alt + Shift + K</b> : {t("Scroll terminal down / up by a page")}
                  <br />
                  <b>Ctrl + Alt + J / Ctrl + Alt + K</b> : {t("Scroll terminal to bottom / top")}
                  <br />
                  <b>Alt + Enter</b> : {t("Toggle fullscreen of main terminal area")}
                  <br />
                  <b>Alt + Backquote</b> : {t("Close any modal (Dialog / Menu / Popover).")}&nbsp;
                  {t("Similar to `Escape` but works even if terminal is in fullscreen mode")}
                  <br />
                  <b>Alt + Shift + Backquote</b> : {t("Force close all modals. Also close all toasts.")}
                  <br />
                  <b>Alt + - / Alt + +</b> : {t("Decrease / increase terminal font size")}
                  <br />
                  <b>Alt + Shift + - / Alt + Shift + +</b> : {t("Decrease / increase global & terminal font size")}
                  <br />
                  <b>Ctrl + Alt + 0</b> : {t("Reset to default global / terminal font size (14 / 15px)")}
                  <br />
                  <b>Ctrl + Shift + F</b> : {t("Open terminal search box")}
                  <br />
                  <b>Ctrl + Shift + R</b> : {t("Reconnect current terminal")}
                  <br />
                  <b>Ctrl + Shift + C</b> : {t("Copy selected text in terminal")}
                  <br />
                  <b>Ctrl + Shift + V (Windows) / Cmd + V (Mac)</b> : {t("Paste into terminal")}
                  <br />
                  <b>Ctrl + Alt + R</b> : {t("Refresh data from backend")}
                  <br />
                  <b>Ctrl + Alt + Shift + R</b> : {t("Force clear service worker, cache and reload")}
                  <br />
                  <b>Mouse Select</b> {t("in terminal")} : {t("copy")}
                  <br />
                  <b>Mouse Right Click</b> {t("in terminal")} : {t("paste")}
                  <br />
                  <b>Mouse Middle Click</b> {t("on a tab")} : {t("close it")}
                  <br />
                  <b>Alt + Mouse Click</b> {t("in terminal")} : {t("Move cursor to mouse position")}
                  <br />
                  <b>Alt + Mouse Wheel</b> {t("in terminal")} : {t("fast scroll up / down")}
                  <br />
                  <b>Shift + Mouse Click</b> {t("on a button in button bar")} : {t("edit it")};&nbsp;
                  <b>Ctrl/Alt + Mouse Click</b> {t("on a 'Open Terminal' type button")} :&nbsp;
                  {t("open it in new window / current tab")};&nbsp;
                  <b>Ctrl + Mouse Click</b> {t("on a 'Send String' type button")} :&nbsp;
                  {t("open it in 'Terminal Input' dialog")};&nbsp;
                  <b>Alt + Mouse Click</b> {t("on a 'Send String' type button")} : {t("copy contents to clipboard")}
                  <br />
                  <b>Ctrl + Mouse Click</b> {t("on backdrop of modal dialog")} : {t("force close it")}
                  <br />
                  <b>Ctrl + Shift + M</b> : {t("Toggle Mark Mode")}. {t("In mark mode:")}&nbsp;
                  <b>Arrow keys</b> {t("or")} <b>h/j/k/l</b>:&nbsp;
                  {t("move cursor (horizontally by char, vertically by line)")};&nbsp;
                  <b>Shift + Arrow keys</b> {t("or")} <b>Shift + h/j/k/l</b>:&nbsp;
                  {t("extend selection in the choosed direction")};&nbsp;
                  <b>g / G</b>: {t("move cursor to top / bottom of buffer")};&nbsp;
                  <b>0 or ^ / $</b>: {t("move cursor to the line start / end")};&nbsp;
                  <b>w / b / e</b>:&nbsp;
                  {t("move cursor to next word start / prev word start / current word end (same as vim)")};&nbsp;
                  <b>W / B / E</b>: {t("extend selection by a word in the choosed direction")};&nbsp;
                  <b>Ctrl + U/D</b>: {t("move cursor up/down by half page")};&nbsp;
                  <b>Ctrl + Shift + U/D</b>: {t("extend selection up/down by half page")};&nbsp;
                  <b>Ctrl + F/B</b>: {t("move cursor up/down by one page")};&nbsp;
                  <b>Ctrl + Shift + F/B</b>: {t("extend selection up/down by one page")};&nbsp;
                  <b>Space / Ctrl + Space</b>:&nbsp;
                  {t("move cursor forward / backward to the next / previous boundary of a non-space & space character")}
                  ;&nbsp;
                  <b>Shift + Space / Ctrl + Shift + Space</b>:&nbsp;
                  {t(
                    "extend selection forward / backward to the next / previous boundary of a non-space & space character",
                  )}
                  ;&nbsp;
                  <b>Enter</b> {t("or")} <b>y</b>: {t("copy selection to clipboard and exit mark mode")};&nbsp;
                  <b>Esc</b> {t("or")} <b>Ctrl + [</b> : {t("exit mark mode without copying")}
                </Typography>
                {__CS_ENV__ === 1 && (
                  <>
                    <Typography variant="subtitle2" gutterBottom>
                      {t("Windows App Keyboard Shortcuts (Same as Browser)")}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }} gutterBottom>
                      <b>Ctl + -</b> & <b>Ctrl + +</b> : {t("Change zoom level")}
                      <br />
                      <b>Alt + F4</b> : {t("Close window")}
                      <br />
                      <b>F5</b> : {t("Refresh page")}
                      <br />
                      <b>F11</b> : {t("Toggle full screen")}
                      <br />
                      <b>F12</b> : {t("Open Web DevTools")}
                      <br />
                      <b>Ctrl + Tab / Ctrl + Shift + Tab</b> : {t("Next / prev tab (only works in desktop app)")}
                    </Typography>
                  </>
                )}
              </>
            )}

            {settingsTab === SETTINGS_TAB_IDX_ABOUT && (
              <Box sx={{ textAlign: "center", mt: 4 }}>
                <Typography variant="h5" gutterBottom sx={{ fontWeight: "bold" }}>
                  CozySSH
                </Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  {t("Version:")} <b>v{PACKAGE_JSON_VERSION}</b>
                  <br />
                  {t("Backend:")} <b>v{appVersion}</b>
                </Typography>
                <Typography variant="body2" sx={{ mt: 3 }}>
                  <a
                    href={LINK_COZYSSH_GITHUB}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: theme.palette.primary.main, textDecoration: "none" }}
                  >
                    {t("GitHub Repository")}
                  </a>
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>{t("Close")}</Button>
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
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pr: 1.5 }}>
          <span>{editHostName ? t("Edit Host") + " " + editHostName : t("Add Host")}</span>
          <IconButton
            aria-label={t("More")}
            id="edit-button-form-menu-button"
            aria-controls={hostTitleMenuAnchor ? "edit-host-form-menu" : undefined}
            aria-expanded={hostTitleMenuAnchor ? "true" : undefined}
            aria-haspopup="true"
            onClick={handleHostTitleMenuClick}
            size="small"
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <Menu
          id="edit-host-form-menu"
          anchorEl={hostTitleMenuAnchor}
          open={!!hostTitleMenuAnchor}
          onClose={handleHostTitleMenuClose}
        >
          <MenuItem
            id="edit-host-form-menu-copy-ssh-command"
            disabled={!hostFormData.hostname}
            onClick={handleCopySSHCommand}
          >
            {t("Copy SSH Command")}
          </MenuItem>
          <MenuItem
            id="edit-host-form-menu-copy-upload-identity-command"
            disabled={!hostFormData.hostname}
            onClick={handleCopyUploadIdentityCommand}
          >
            {t("Copy Upload Identity Command")}
          </MenuItem>
          <MenuItem
            id="edit-host-form-menu-copy-ssh-copy-id-command"
            disabled={!hostFormData.hostname}
            onClick={handleCopySSHCopyIdCommand}
          >
            {t("Copy ssh-copy-id Command")}
          </MenuItem>
          <MenuItem
            id="edit-host-form-menu-copy-ssh-config-block"
            disabled={!hostFormData.hostname}
            onClick={handleCopySshConfigBlock}
          >
            {t("Copy SSH Config Block")}
          </MenuItem>
          <MenuItem
            id="edit-host-form-menu-run-ssh-copy-id"
            disabled={!hostFormData.hostname}
            onClick={handleRunSSHCopyId}
          >
            {t("Run ssh-copy-id")}
          </MenuItem>
          <MenuItem id="edit-host-form-menu-paste-ssh-config-block" onClick={handlePasteSshConfigBlock}>
            {t("Paste SSH Config Block")}
          </MenuItem>
          <ExtraMenu
            extraMenu={extraHostFormMenu}
            target={hostFormData}
            before={() => {
              setHostTitleMenuAnchor(null);
            }}
          />
          <MenuItem
            id="edit-host-form-menu-delete"
            sx={{ color: "error.main" }}
            disabled={!editHostName}
            onClick={() => {
              setHostTitleMenuAnchor(null);
              setEditHostDialogOpen(false);
              deleteHost(editHostName);
            }}
          >
            {t("Delete Host")}
          </MenuItem>
          <MenuItem
            id="edit-host-form-menu-reset"
            disabled={!hostFormDirty}
            onClick={() => {
              setHostTitleMenuAnchor(null);
              const initialForm = getStore().initialHostFormData;
              if (initialForm) {
                setHostFormData(initialForm);
              }
            }}
          >
            {t("Reset Form")}
          </MenuItem>
        </Menu>
        <DialogContent>
          <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <TextFieldWithCopy
              fullWidth
              label={t("Alias Name")}
              autoComplete="off"
              size="small"
              type="search"
              value={hostFormData.name}
              onKeyDown={handleEditHostFormKeyDown}
              onChange={(e) => setHostFormData({ ...hostFormData, name: e.target.value })}
              placeholder={hostFormData.hostname || "e.g. production-database"}
            />
            <TextFieldWithCopy
              fullWidth
              label={t("HostName (IP / Domain)")}
              size="small"
              type="search"
              placeholder={t("Ctrl + Enter to submit")}
              onKeyDown={handleEditHostFormKeyDown}
              value={hostFormData.hostname}
              onChange={(e) => setHostFormData({ ...hostFormData, hostname: e.target.value })}
              required
              autoFocus={!hostFormData.hostname}
            />
            <FreeTextField
              fullWidth
              label={t("User")}
              size="small"
              placeholder={t("leave empty to use backend current user")}
              options={["root", "ubuntu", "user", "admin", "administrator"]}
              onKeyDown={handleEditHostFormKeyDown}
              value={hostFormData.user}
              onChange={(newValue) => {
                setHostFormData({ ...hostFormData, user: newValue });
              }}
            />
            <FreeTextField
              fullWidth
              label={t("Port")}
              size="small"
              placeholder="22"
              options={["22", "222", "2222", "22222"]}
              value={hostFormData.port || ""}
              onKeyDown={handleEditHostFormKeyDown}
              onChange={(newValue) => {
                setHostFormData({ ...hostFormData, port: newValue || "" });
              }}
            />
            <TextFieldWithCopy
              fullWidth
              label={t("Tags (Optional)")}
              size="small"
              type="search"
              value={hostFormData.tags}
              onChange={(e) => setHostFormData({ ...hostFormData, tags: e.target.value })}
              onKeyDown={handleEditHostFormKeyDown}
              placeholder={t("e.g. production web")}
            />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
              {parsedTags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  onDelete={() => handleDeleteTag(tag)}
                  slotProps={{
                    label: {
                      title: getTagTip(tag),
                    },
                  }}
                />
              ))}
              <Autocomplete
                freeSolo
                size="small"
                options={[
                  TAG_FAV,
                  ...uniqueTags,
                  TAG_FLAG_SHELL_INTEGRATION_DISABLED,
                  TAG_FLAG_SHELL_INTEGRATION_ENABLED,
                  TAG_FLAG_SHELL_INTEGRATION_FORCE_ENABLED,
                  TAG_FLAG_SHELL_INTEGRATION_BASH,
                  TAG_FLAG_SHELL_INTEGRATION_ZSH,
                  TAG_FLAG_SHELL_INTEGRATION_ASH,
                  TAG_FLAG_ENV_TERM_VT100,
                  TAG_FLAG_ENV_TERM_LINUX,
                  TAG_FLAG_ENV_TERM_TMUX_256COLOR,
                ].filter((t) => !parsedTags.includes(t))}
                value={tagInput}
                onChange={(_, newValue) => {
                  if (newValue) {
                    handleAddTag(newValue);
                    setTagInput("");
                  }
                }}
                inputValue={tagInput}
                onInputChange={(_, newInputValue) => {
                  setTagInput(newInputValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t("Add Tag")}
                    placeholder={t("Select tag or type new one and press Enter")}
                    size="small"
                  />
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleAddTag(tagInput);
                    setTagInput("");
                  }
                }}
                sx={{ flexGrow: 1 }}
              />
            </Box>
            <TextFieldWithCopy
              fullWidth
              label={t("IdentityFile (Optional)")}
              size="small"
              type="search"
              value={hostFormData.identityFile}
              onChange={(e) => setHostFormData({ ...hostFormData, identityFile: e.target.value })}
              onKeyDown={handleEditHostFormKeyDown}
              placeholder="~/.ssh/id_ed25519"
            />
            <TextField
              fullWidth
              label={t("Password (Optional)")}
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
              onKeyDown={handleEditHostFormKeyDown}
              onFocus={(e) => {
                if (hostFormData.password === PASSWORD_PLACEHOLDER) {
                  e.target.select();
                }
              }}
              placeholder={t("Optional SSH server password")}
            />
            <FreeTextField
              fullWidth
              label={t("ProxyJump (Optional)")}
              size="small"
              type="search"
              value={hostFormData.proxyJump || ""}
              options={[...allFavs.map((h) => h.name), ...allNormals.map((h) => h.name)]}
              onChange={(newValue) => setHostFormData({ ...hostFormData, proxyJump: newValue })}
              onKeyDown={handleEditHostFormKeyDown}
              placeholder="e.g. server-foo,server-bar"
            />
            <FreeTextField
              fullWidth
              label={t("AddressFamily (Optional)")}
              size="small"
              placeholder="any / inet / inet6"
              options={["any", "inet", "inet6"]}
              value={hostFormData.addressFamily || ""}
              onChange={(newValue) => {
                setHostFormData({ ...hostFormData, addressFamily: (newValue as "any" | "inet" | "inet6") || "" });
              }}
              onKeyDown={handleEditHostFormKeyDown}
            />
            <FreeTextField
              fullWidth
              label={t("UserKnownHostsFile (Optional)")}
              size="small"
              placeholder="e.g. ~/.ssh/known_hosts_custom"
              options={["/dev/null", "NUL"]}
              value={hostFormData.userKnownHostsFile || ""}
              onChange={(newValue) => setHostFormData({ ...hostFormData, userKnownHostsFile: newValue || "" })}
              onKeyDown={handleEditHostFormKeyDown}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        disabled={!hostFormData.userKnownHostsFile}
                        onClick={() => navigator.clipboard.writeText(hostFormData.userKnownHostsFile!)}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <FreeTextField
              fullWidth
              label={t("StrictHostKeyChecking (Optional)")}
              size="small"
              placeholder="ask / yes / no"
              options={["ask", "yes", "no"]}
              value={hostFormData.strictHostKeyChecking || ""}
              onChange={(newValue) => {
                setHostFormData({
                  ...hostFormData,
                  strictHostKeyChecking: (newValue as "ask" | "yes" | "no") || "",
                });
              }}
              onKeyDown={handleEditHostFormKeyDown}
            />
            <FreeTextField
              fullWidth
              label={t("HostKeyAlgorithms (Optional)")}
              size="small"
              placeholder="e.g. +ssh-rsa"
              options={["+ssh-rsa"]}
              value={hostFormData.hostKeyAlgorithms || ""}
              onChange={(newValue) => setHostFormData({ ...hostFormData, hostKeyAlgorithms: newValue || "" })}
              onKeyDown={handleEditHostFormKeyDown}
            />
            <FreeTextField
              fullWidth
              label={t("VerifyHostKeyDNS (Optional)")}
              size="small"
              placeholder="ask / yes / no"
              helperText={t("Verify host key fingerprint via DNSSEC SSHFP records (RFC 4255)")}
              options={["ask", "yes", "no"]}
              value={hostFormData.verifyHostKeyDns || ""}
              onChange={(newValue) => {
                setHostFormData({
                  ...hostFormData,
                  verifyHostKeyDns: (newValue as "ask" | "yes" | "no") || "",
                });
              }}
              onKeyDown={handleEditHostFormKeyDown}
            />
            <FreeTextField
              fullWidth
              label={t("SendEnv (Optional)")}
              size="small"
              placeholder="LANG LC_* COLORTERM NO_COLOR"
              helperText={t("Send environment variables to remote host")}
              options={["LANG LC_* COLORTERM NO_COLOR"]}
              value={hostFormData.sendEnv || ""}
              onChange={(newValue) => setHostFormData({ ...hostFormData, sendEnv: newValue || "" })}
              onKeyDown={handleEditHostFormKeyDown}
            />
            <FreeTextField
              fullWidth
              label={t("RemoteCommand (Optional)")}
              size="small"
              placeholder={t("Use %i for session id")}
              options={remoteCommandOptions}
              value={hostFormData.remoteCommand || ""}
              onChange={(newValue) => {
                setHostFormData({ ...hostFormData, remoteCommand: newValue });
              }}
              onKeyDown={handleEditHostFormKeyDown}
            />
            <TextFieldWithCopy
              fullWidth
              label={t("LocalForward (Optional)")}
              size="small"
              multiline
              rows={2}
              value={hostFormData.localForward || ""}
              onChange={(e) => setHostFormData({ ...hostFormData, localForward: e.target.value })}
              onKeyDown={handleEditHostFormKeyDown}
              placeholder={t("e.g. 8080 localhost:80\nOne rule per line")}
            />
            <TextFieldWithCopy
              fullWidth
              label={t("RemoteForward (Optional)")}
              size="small"
              multiline
              rows={2}
              value={hostFormData.remoteForward || ""}
              onChange={(e) => setHostFormData({ ...hostFormData, remoteForward: e.target.value })}
              onKeyDown={handleEditHostFormKeyDown}
              placeholder={t("e.g. 8080 localhost:80\nOne rule per line")}
            />
            <TextFieldWithCopy
              fullWidth
              label={t("DynamicForward (Optional)")}
              size="small"
              multiline
              rows={2}
              value={hostFormData.dynamicForward || ""}
              onChange={(e) => setHostFormData({ ...hostFormData, dynamicForward: e.target.value })}
              onKeyDown={handleEditHostFormKeyDown}
              placeholder={t("e.g. 1080 or 127.0.0.1:1080\nOne port per line")}
            />
            <TextFieldWithCopy
              fullWidth
              label={t("Comment (Optional)")}
              size="small"
              multiline
              rows={2}
              value={hostFormData.comment}
              onChange={(e) => setHostFormData({ ...hostFormData, comment: e.target.value })}
              onKeyDown={handleEditHostFormKeyDown}
              placeholder={t("Host description...")}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditHostDialogOpen(false)}>{t("Cancel")}</Button>
          <Button variant="contained" onClick={handleSaveHost} disabled={hostFormSubmitDisabled}>
            {t("Save")}
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
  isMobile,
  isTouch,
  draggedItem,
  dragOverTarget,
  setDraggedItem,
  setDragOverTarget,
}: {
  id: string;
  section: Section;
  filter: string;
  host: HostData;
  onContextMenu: (e: React.MouseEvent, host: HostData, section: Section) => void;
  isSelected?: boolean;
  isMobile?: boolean;
  isTouch?: boolean;
  draggedItem?:
    { type: "group"; path: string } | { type: "server"; name: string } | { type: "fav"; name: string } | null;
  dragOverTarget?: { id: string; effect: "before" | "inside" | "after" } | null;
  setDraggedItem?: (
    item: { type: "group"; path: string } | { type: "server"; name: string } | { type: "fav"; name: string } | null,
  ) => void;
  setDragOverTarget?: (item: { id: string; effect: "before" | "inside" | "after" } | null) => void;
}) {
  const itemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!isSelected) {
      return;
    }
    if (itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: "auto",
        block: "nearest",
      });
    }
  }, [isSelected]);

  const isFavourite = host.isFavourite;
  let secondaryText = hostLabel(host);
  if (filter && host.comment) {
    const matchedComment = searchStringAny(host.comment, filter);
    if (matchedComment) {
      secondaryText += ` // ${matchedComment}`;
    }
  }

  const isDragOver = dragOverTarget?.id === id;

  const dragProps =
    section === "fav" && !isMobile && !isTouch && setDraggedItem && setDragOverTarget
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            setDraggedItem({ type: "fav", name: host.name });
            e.dataTransfer.effectAllowed = "move";
          },
          onDragEnd: () => {
            setDraggedItem(null);
            setDragOverTarget(null);
          },
          onDragOver: (e: React.DragEvent) => {
            if (!draggedItem || draggedItem.type !== "fav" || draggedItem.name === host.name) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            const rect = e.currentTarget.getBoundingClientRect();
            const position = e.clientY > rect.top + rect.height / 2 ? "after" : "before";
            if (!dragOverTarget || dragOverTarget.id !== id || dragOverTarget.effect !== position) {
              setDragOverTarget({ id, effect: position });
            }
          },
          onDragLeave: (e: React.DragEvent) => {
            e.stopPropagation();
            if (dragOverTarget?.id === id) {
              setDragOverTarget(null);
            }
          },
          onDrop: async (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!draggedItem || draggedItem.type !== "fav" || draggedItem.name === host.name) {
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            const position = e.clientY > rect.top + rect.height / 2 ? "after" : "before";
            setDragOverTarget(null);
            setDraggedItem(null);
            await reorderFavourites(draggedItem.name, host.name, position);
          },
        }
      : {};

  return (
    <ListItem
      {...(id ? { id } : {})}
      className={`sidebar-host ${draggedItem?.type === "fav" && host.name === draggedItem.name ? "dragging" : ""}`}
      ref={itemRef}
      disablePadding
      onContextMenu={(e) => onContextMenu(e, host, section)}
      data-name={host.name}
      data-tags={host.tags?.join(" ") ?? ""}
      {...dragProps}
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
        borderTop: isDragOver && dragOverTarget?.effect === "before" ? "2px solid" : "none",
        borderTopColor: "primary.main",
        borderBottom: isDragOver && dragOverTarget?.effect === "after" ? "2px solid" : "none",
        borderBottomColor: "primary.main",
        opacity: draggedItem?.type === "fav" && draggedItem.name === host.name ? 0.4 : 1,
        transition: "opacity 0.2s, border-color 0.1s",
        cursor: section === "fav" && !isMobile && !isTouch ? "grab" : "inherit",
      }}
    >
      <ListItemButton
        title={host.comment || ""}
        onClick={(e) => {
          if (isModifier(e, "ctrl")) {
            openHostInNewWindow(host.name);
          } else if (e.shiftKey) {
            openEditHostDialog(host);
            setMobileOpen(false);
          } else {
            openHost(host.name, { target: isModifier(e, "alt") ? "_self" : undefined });
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
                {section === "auto" ? hostLabel(host) : host.name}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 0.25 }}>
                {host.tags &&
                  host.tags
                    .filter(
                      (t) =>
                        t !== TAG_FAV &&
                        !t.startsWith(TAG_GROUP_PREFIX) &&
                        !t.startsWith(TAG_ORDER_PREFIX) &&
                        !t.startsWith(TAG_FLAG_PREFIX),
                    )
                    .map((tag) => (
                      <Typography
                        key={tag}
                        variant="body2"
                        sx={{
                          color: "primary.main",
                          fontWeight: 600,
                          lineHeight: 1.2,
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
            (!host.isAuto || host.name !== `${host.user || "root"}@${host.hostname}`) && (
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
  groupHostCounts,
  setDraggedItem,
  draggedItem,
  dragOverTarget,
  setDragOverTarget,
  setGroupContextMenu,
  setGroupContextMenuOpen,
}: {
  node: GroupNode;
  level: number;
  isSelected: boolean;
  isMobile: boolean;
  isTouch: boolean;
  expandedGroups: Set<string>;
  groupHostCounts: Record<string, number>;
  setDraggedItem: (
    item: { type: "group"; path: string } | { type: "server"; name: string } | { type: "fav"; name: string } | null,
  ) => void;
  draggedItem:
    { type: "group"; path: string } | { type: "server"; name: string } | { type: "fav"; name: string } | null;
  dragOverTarget: { id: string; effect: "before" | "inside" | "after" } | null;
  setDragOverTarget: (item: { id: string; effect: "before" | "inside" | "after" } | null) => void;
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
      className={`sidebar-group ${draggedItem?.type === "group" && node.path === draggedItem.path ? "dragging" : ""}`}
      disablePadding
      draggable={!isMobile && !isTouch}
      onDragStart={(e) => {
        setDraggedItem({ type: "group", path: node.path });
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!draggedItem) {
          return;
        }
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
        if (!draggedItem) {
          return;
        }
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
      <ListItemButton onClick={(e) => toggleGroupExpanded(node.path, isModifier(e, "ctrl"))} sx={{ py: 0.25, px: 1 }}>
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
              {groupHostCounts[node.path]! > 0 && ` (${groupHostCounts[node.path]})`}
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
  handleContextMenu,
}: {
  node: ServerNode;
  level: number;
  isSelected: boolean;
  isMobile: boolean;
  isTouch: boolean;
  filterStr: string;
  draggedItem:
    { type: "group"; path: string } | { type: "server"; name: string } | { type: "fav"; name: string } | null;
  dragOverTarget: { id: string; effect: "before" | "inside" | "after" } | null;
  setDraggedItem: (
    item: { type: "group"; path: string } | { type: "server"; name: string } | { type: "fav"; name: string } | null,
  ) => void;
  setDragOverTarget: (item: { id: string; effect: "before" | "inside" | "after" } | null) => void;
  handleContextMenu: (e: React.MouseEvent | React.KeyboardEvent, host: HostData, section: Section) => void;
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
  const isFavourite = host.isFavourite;
  let secondaryText = hostLabel(host);
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
      className={`sidebar-host ${draggedItem?.type === "server" && host.name === draggedItem.name ? "dragging" : ""}`}
      disablePadding
      draggable={!isMobile && !isTouch}
      onDragStart={(e) => {
        setDraggedItem({ type: "server", name: host.name });
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!draggedItem) {
          return;
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
        if (!draggedItem) {
          return;
        }
        if (draggedItem.type === "server") {
          const targetGroup = getHostGroupPath(host);
          await moveServer(draggedItem.name, targetGroup, host.name);
        }
        setDraggedItem(null);
      }}
      onContextMenu={(e) => handleContextMenu(e, host, "tree")}
      data-name={host.name}
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
          if (isModifier(e, "ctrl")) {
            openHostInNewWindow(host.name);
          } else if (e.shiftKey) {
            openEditHostDialog(host);
            setMobileOpen(false);
          } else {
            openHost(host.name, { target: isModifier(e, "alt") ? "_self" : undefined });
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
                    .filter(
                      (t) =>
                        t !== TAG_FAV &&
                        !t.startsWith(TAG_GROUP_PREFIX) &&
                        !t.startsWith(TAG_ORDER_PREFIX) &&
                        !t.startsWith(TAG_FLAG_PREFIX),
                    )
                    .map((tag) => (
                      <Typography
                        key={tag}
                        variant="body2"
                        sx={{
                          color: "primary.main",
                          fontWeight: 600,
                          lineHeight: 1.2,
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
            !host.isAuto && (
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
