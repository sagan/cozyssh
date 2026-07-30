import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Box,
  Typography,
  Button,
  FormControlLabel,
  Checkbox,
  Menu,
  MenuItem,
  Alert,
  IconButton,
  Chip,
  useTheme,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { liquid } from "@codemirror/lang-liquid";

import type { ButtonData } from "./api";
import {
  CLASS_HIDE_DESKTOP,
  DEFAULT_BUTTON_GROUP,
  ID_INPUT_DIALOG_INPUT,
  LINK_COZYSSH_DOC_SCRIPTS,
  LINK_COZYSSH_PLUGIN_MANAGER,
  LOCAL_NAME,
  METHOD_POST,
} from "./constants";
import {
  type ContextMenu,
  type ToastData,
  getKeyCombination,
  ButtonDataSchema,
  getTemplateVariables,
  liquidEngine,
  openHostInNewWindow,
  apiReqHeaders,
  t,
} from "./common";
import {
  type TabData,
  type PaneData,
  getStore,
  setButtonFormData,
  setEditButton,
  setEditButtonDialogOpen,
  setInitialBtnFormData,
  setInputValue,
  setInputLiquid,
  setSendScope,
  setToasts,
  triggerFocus,
  useStore,
  setAppendNewLine,
  setSearchOpen,
  triggerFocusSearchInput,
  activatePane,
  closeOtherTabs,
  closeRightTabs,
  openInputDialog,
  closeInputDialog,
  setInputDialogDirty,
  openHost,
  cloneSession,
  unpinTab,
  pinTab,
  unlockTab,
  lockTab,
  renameTab,
  saveButton,
  deleteButton,
  moveButton,
  openSaveTabToButtonDialog,
  closeTabOrPane,
  closeTab,
  hideTab,
  getHost,
  getPane,
  openEditHost,
  moveTabLeft,
  moveTabRight,
  setBtnContextMenuOpen,
  unloadButton,
  runScript,
  handleReconnectTab,
} from "./store";
import NewTabDialog from "./NewTabDialog";
import { dialogs } from "./Dialogs";
import FreeTextField from "./components/FreeTextField";
import TextFieldWithCopy from "./components/TextFieldWithCopy";
import ExtraMenu from "./components/ExtraMenu";
import { BUTTPN_TYPES, MISC_FUNCTIONS, TERMINAL_FUNCTIONS } from "./buttons";

export interface DialogManagerProps {
  isMobile: boolean;
  isTouch: boolean;
  groups: string[];
  memoTabId: string | null;
  contextMenu: ContextMenu | null;
  handleCloseMenu: () => void;
  handleToggleFiles: () => void;
  sendParsedString: (s: string, isLiquid?: boolean, userVars?: Record<string, string>) => void;
}

export default function DialogManager({
  isMobile,
  isTouch,
  groups,
  memoTabId,
  contextMenu,
  handleCloseMenu,
  handleToggleFiles,
  sendParsedString,
}: DialogManagerProps) {
  const hosts = useStore((state) => state.hosts);
  const editButton = useStore((state) => state.editButton);
  const toasts = useStore((state) => state.toasts);
  const buttonFormData = useStore((state) => state.buttonFormData);
  const initialBtnFormData = useStore((state) => state.initialBtnFormData);
  const editButtonDialogOpen = useStore((state) => state.editButtonDialogOpen);
  const newTabDialogOpen = useStore((state) => state.newTabDialogOpen);
  const tabs = useStore((state) => state.tabs);
  const activeTabId = useStore((state) => state.activeTabId);
  const inputDialogOpen = useStore((state) => state.inputDialogOpen);
  const inputValue = useStore((state) => state.inputValue);
  const sendScope = useStore((state) => state.sendScope);
  const inputLiquid = useStore((state) => state.inputLiquid);
  const activePaneId = useStore((state) => state.activePaneId);
  const shellIntegrations = useStore((state) => state.shellIntegrations);
  const appendNewLine = useStore((state) => state.appendNewLine);
  const extraTabMenu = useStore((state) => state.extraTabMenu);
  const extraButtonMenu = useStore((state) => state.extraButtonMenu);
  const extraButtonFormMenu = useStore((state) => state.extraButtonFormMenu);
  const btnContextMenuOpen = useStore((state) => state.btnContextMenuOpen);
  const btnContextMenu = useStore((state) => state.btnContextMenu);

  const [titleMenuAnchor, setTitleMenuAnchor] = useState<null | HTMLElement>(null);
  const [importTip, setImportTip] = useState<ToastData | null>(null);

  const [userVars, setUserVars] = useState<Record<string, string>>({});
  const [renderedPreview, setRenderedPreview] = useState("");

  const theme = useTheme();

  const varsList = useMemo(() => {
    if (!inputLiquid) {
      return [];
    }
    return getTemplateVariables(inputValue);
  }, [inputValue, inputLiquid]);

  const editButtonVars = useMemo(() => {
    if (buttonFormData.type !== "send_string" || !buttonFormData.liquidjs) {
      return [];
    }
    return getTemplateVariables(buttonFormData.payload);
  }, [buttonFormData.payload, buttonFormData.type, buttonFormData.liquidjs]);

  useEffect(() => {
    if (!inputLiquid) {
      return;
    }
    Promise.resolve().then(() => {
      setUserVars((prev) => {
        const next = { ...prev };
        // remove keys not in varsList
        for (const key of Object.keys(next)) {
          if (!varsList.includes(key)) {
            delete next[key];
          }
        }
        // add keys in varsList not in prev
        for (const key of varsList) {
          if (!(key in next)) {
            next[key] = "";
          }
        }
        return next;
      });
    });
  }, [varsList, inputLiquid]);

  useEffect(() => {
    if (!inputLiquid) {
      Promise.resolve().then(() => {
        setRenderedPreview("");
      });
      return;
    }
    let active = true;
    const renderTemplate = async () => {
      try {
        const { vars, localVars } = getStore();
        const pane = getPane(activePaneId);
        let clipboard = "";
        try {
          clipboard = await navigator.clipboard.readText();
        } catch {
          // ignore
        }
        const context = {
          shellIntegration: shellIntegrations[activePaneId] || {},
          vars: vars || {},
          localVars: localVars || {},
          host: pane ? getHost(pane.host) : {},
          clipboard,
          ...userVars,
        };
        const rendered = await liquidEngine.parseAndRender(inputValue, context);
        if (active) {
          setRenderedPreview(rendered);
        }
      } catch {
        // Keep last successful or ignore
      }
    };
    renderTemplate();
    return () => {
      active = false;
    };
  }, [inputValue, userVars, inputLiquid, activePaneId, shellIntegrations]);

  const handleCloseInputDialog = useCallback((allowCloseDirty?: boolean) => {
    if (!getStore().inputDialogDirty || allowCloseDirty) {
      closeInputDialog();
    }
  }, []);

  const activeTab: TabData | undefined = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId);
  }, [activeTabId, tabs]);

  const activePane: PaneData | undefined = useMemo(() => {
    return activeTab?.panes.find((p) => p.id === activeTab.activePaneId);
  }, [activeTab]);

  useEffect(() => {
    if (!editButtonDialogOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImportTip(null);
    }
  }, [editButtonDialogOpen]);

  const handleTitleMenuClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    setTitleMenuAnchor(event.currentTarget);
  }, []);

  const handleTitleMenuClose = useCallback(() => {
    setTitleMenuAnchor(null);
  }, []);

  const importFromData = useCallback(async (text: string, filename?: string) => {
    let isJson = false;
    let data: unknown = null;

    try {
      data = JSON.parse(text);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        isJson = true;
      }
    } catch {
      /* empty */
    }

    if (isJson) {
      const result = ButtonDataSchema.safeParse(data);
      if (!result.success) {
        const errorMsg = result.error.issues.map((err) => `${err.path.join(".") || "root"}: ${err.message}`).join(", ");
        setImportTip({
          msg: `Not a valid ButtonData object. Validation errors: ${errorMsg}`,
          severity: "error",
        });
        return;
      }

      const validatedData = result.data;

      if (validatedData.id) {
        const btn = getStore().buttons.find((b) => b.id === validatedData.id);
        if (
          btn &&
          !(await dialogs.confirm(
            t("Same id button already exists.") +
              " " +
              t("Existing button:") +
              ` name=${btn.name}, group=${btn.group}. ` +
              t("Overwrite it?"),
          ))
        ) {
          return;
        }
      }

      setButtonFormData({
        id: validatedData.id,
        name: validatedData.name,
        type: validatedData.type,
        payload: validatedData.payload,
        group: validatedData.group || getStore().buttonFormData.group || DEFAULT_BUTTON_GROUP,
        autorun: validatedData.autorun,
        order: validatedData.order,
        shortcut: validatedData.shortcut,
      });

      setImportTip({
        msg: t("Successfully loaded button data from JSON! Review the fields and click 'Save' to confirm."),
        severity: "success",
      });
    } else {
      // Treat as a direct script/text file URL
      let buttonName = "";
      let buttonId = "";
      let group = "";
      let autorun = 0;
      const jsDocMatch = text.match(/^\s*\/\*\*([\s\S]*?)\*\//);
      if (jsDocMatch) {
        const content = jsDocMatch[1];
        const moduleMatch = content.match(/@module\s+([^\r\n]+)/);
        if (moduleMatch) {
          buttonName = moduleMatch[1].trim();
        }
        const idMatch = content.match(/@id\s+([^\r\n]+)/);
        if (idMatch) {
          buttonId = idMatch[1].trim();
        }
        const groupMatch = content.match(/@group\s+([^\r\n]+)/);
        if (groupMatch) {
          group = groupMatch[1].trim();
        }
        const autorunMatch = content.match(/@autorun\s+([^\r\n]+)/);
        if (autorunMatch && autorunMatch[1].trim() === "1") {
          autorun = 1;
        }
      }

      if (buttonId) {
        const btn = getStore().buttons.find((b) => b.id === buttonId);
        if (
          btn &&
          !(await dialogs.confirm(
            t("Same id button already exists.") +
              " " +
              t("Existing button:") +
              ` name=${btn.name}, group=${btn.group}. ` +
              t("Overwrite it?"),
          ))
        ) {
          return;
        }
      }

      if (!buttonName) {
        if (filename) {
          const pathParts = filename.split("/");
          const lastPart = pathParts[pathParts.length - 1] || "";
          buttonName = lastPart.replace(/\.(ts|tsx|js|jsx|txt)$/i, "");
        }
        buttonName = buttonName || "Imported Script";
      }

      setButtonFormData({
        id: buttonId,
        name: buttonName,
        type: "run_script",
        payload: text,
        group: group || getStore().buttonFormData.group || DEFAULT_BUTTON_GROUP,
        autorun,
        order: getStore().buttonFormData.order || 0,
        shortcut: "",
      });

      setImportTip({
        msg: t("Successfully loaded script data! Review the fields and click 'Save' to confirm."),
        severity: "success",
      });
    }
  }, []);

  const importFromUrl = useCallback(
    async (url: string) => {
      setImportTip(null);

      try {
        new URL(url);
      } catch (e) {
        console.log(e);
        setImportTip({
          msg: "Invalid URL format. Please enter a valid URL (e.g., http://example.com/button.json).",
          severity: "error",
        });
        return;
      }

      let text: string;
      try {
        const res = await csFetch(url);
        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
        text = await res.text();
      } catch (err) {
        setImportTip({
          msg: `Network error or failed to load button data: ${err}`,
          severity: "error",
        });
        return;
      }
      importFromData(text, url);
    },
    [importFromData],
  );

  const handleAddFromUrl = useCallback(async () => {
    const url = await dialogs.prompt(t("Enter URL to load button data from:"));
    if (!url) {
      return;
    }
    await importFromUrl(url);
  }, [importFromUrl]);

  const handleInstallPluginManager = useCallback(async () => {
    await importFromUrl(LINK_COZYSSH_PLUGIN_MANAGER);
  }, [importFromUrl]);

  const buttonFormDirty = useMemo(() => {
    return !!initialBtnFormData && JSON.stringify(buttonFormData) !== JSON.stringify(initialBtnFormData);
  }, [buttonFormData, initialBtnFormData]);

  const buttonFormSubmitDisabled =
    !buttonFormData.name || !buttonFormData.payload || (!!editButton && !buttonFormDirty);

  const handleSaveButton = useCallback(async () => {
    const { editButton, buttonFormData } = getStore();
    const editId = editButton?.id;
    const newBtn = await saveButton(buttonFormData, editId);
    setInitialBtnFormData(null);
    setEditButtonDialogOpen(false);
    if (editId) {
      const cached = !!__CS_MODULECACHE__[editId];
      unloadButton(editId);
      if (cached) {
        runScript({ button: newBtn, background: true });
      }
    }
  }, []);

  const handleEditButtonFormKeyDown = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      const key = getKeyCombination(e);
      if (key === "ctrl+enter" && !buttonFormSubmitDisabled) {
        e.preventDefault();
        e.stopPropagation();
        handleSaveButton();
      }
    },
    [buttonFormSubmitDisabled, handleSaveButton],
  );

  return (
    <>
      <Menu
        id="tab-menu"
        open={contextMenu !== null}
        onClose={handleCloseMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        {memoTabId &&
          (() => {
            const tab = tabs.find((t) => t.id === memoTabId);
            if (!tab) {
              return null;
            }
            return (
              <>
                {tab.type === "terminal" && (
                  <>
                    {Array.from(
                      new Set(
                        tab.panes.map((p) => p.host).filter((h) => h !== LOCAL_NAME && !h.startsWith(LOCAL_NAME + "?")),
                      ),
                    ).map((hostname) => (
                      <MenuItem
                        key={hostname}
                        data-name={hostname}
                        className="tab-menu-edit-host"
                        onClick={() => {
                          handleCloseMenu();
                          openEditHost(hostname);
                        }}
                      >
                        {t("Edit")} {hostname}
                      </MenuItem>
                    ))}
                  </>
                )}
                {tab.type === "terminal" && tab.panes.length === 1 && (
                  <>
                    {tab.isPinned ? (
                      <MenuItem
                        className={CLASS_HIDE_DESKTOP}
                        id="tab-menu-unpin"
                        onClick={() => {
                          handleCloseMenu();
                          unpinTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        {t("Unpin Tab")}
                      </MenuItem>
                    ) : (
                      <MenuItem
                        className={CLASS_HIDE_DESKTOP}
                        id="tab-menu-pin"
                        onClick={() => {
                          handleCloseMenu();
                          pinTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        {t("Pin Tab")}
                      </MenuItem>
                    )}
                    {tab.isLocked ? (
                      <MenuItem
                        id="tab-menu-unlock"
                        onClick={() => {
                          handleCloseMenu();
                          unlockTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        {t("Unlock Tab")}
                      </MenuItem>
                    ) : (
                      <MenuItem
                        id="tab-menu-lock"
                        onClick={() => {
                          handleCloseMenu();
                          lockTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        {t("Lock Tab")}
                      </MenuItem>
                    )}
                    <MenuItem
                      id="tab-menu-hide"
                      onClick={() => {
                        handleCloseMenu();
                        hideTab(memoTabId);
                        triggerFocus();
                      }}
                    >
                      {t("Run in Background")}
                    </MenuItem>
                  </>
                )}
                {tab.type === "terminal" && (
                  <>
                    <MenuItem
                      id="tab-menu-find"
                      onClick={() => {
                        handleCloseMenu();
                        setSearchOpen(true);
                        if (getStore().activeTabId === tab.id) {
                          triggerFocusSearchInput();
                        } else {
                          activatePane(tab.activePaneId, tab.id);
                          setTimeout(() => triggerFocusSearchInput(), 200);
                        }
                      }}
                    >
                      {t("Find")}
                    </MenuItem>
                    <MenuItem
                      id="tab-menu-send-input"
                      onClick={() => {
                        handleCloseMenu();
                        if (getStore().activeTabId == tab.id) {
                          openInputDialog();
                        } else {
                          activatePane(tab.activePaneId, tab.id);
                          setTimeout(() => openInputDialog(), 200);
                        }
                      }}
                    >
                      {t("Send Input")}
                    </MenuItem>
                  </>
                )}
                {tab.panes.length > 1 && (
                  <MenuItem
                    id="tab-menu-close-tab"
                    onClick={() => {
                      handleCloseMenu();
                      closeTab();
                    }}
                  >
                    {t("Close Tab")}
                  </MenuItem>
                )}
                <MenuItem
                  id="tab-menu-close-pane"
                  onClick={() => {
                    handleCloseMenu();
                    closeTabOrPane();
                  }}
                >
                  {t("Close Pane/Tab")}
                </MenuItem>

                {tab.type !== "scratchpad" && (
                  <>
                    <MenuItem
                      id="tab-menu-clone-session"
                      onClick={() => {
                        handleCloseMenu();
                        cloneSession(memoTabId);
                      }}
                    >
                      {t("Clone Session")}
                    </MenuItem>
                    {tab.panes.length < 4 && (
                      <MenuItem
                        id="tab-menu-clone-session-split-screen"
                        onClick={() => {
                          handleCloseMenu();
                          cloneSession(memoTabId, true);
                        }}
                      >
                        {t("Clone Session (Split Screen)")}
                      </MenuItem>
                    )}
                    {tab.panes.length === 1 && (
                      <MenuItem id="tab-menu-toggle-files" onClick={handleToggleFiles}>
                        {tab.showFiles
                          ? t("Close Files")
                          : tab.panes[0]?.host === LOCAL_NAME
                            ? t("Open Files")
                            : t("Open SFTP")}
                      </MenuItem>
                    )}
                  </>
                )}
                {tab.type !== "scratchpad" && (
                  <>
                    <MenuItem
                      id="tab-menu-reconnect"
                      onClick={() => {
                        handleCloseMenu();
                        handleReconnectTab(memoTabId);
                        triggerFocus();
                      }}
                    >
                      {t("Reconnect")}
                    </MenuItem>
                    <MenuItem
                      id="tab-menu-rename"
                      onClick={() => {
                        handleCloseMenu();
                        renameTab(memoTabId);
                      }}
                    >
                      {t("Rename Tab")}
                    </MenuItem>
                    <MenuItem
                      id="tab-menu-save"
                      onClick={() => {
                        handleCloseMenu();
                        openSaveTabToButtonDialog(memoTabId);
                      }}
                    >
                      {t("Save Tab to Button")}
                    </MenuItem>
                  </>
                )}
                <MenuItem
                  id="tab-menu-close-other-tabs"
                  onClick={() => {
                    handleCloseMenu();
                    closeOtherTabs(memoTabId);
                  }}
                >
                  {t("Close Other Tabs")}
                </MenuItem>
                <MenuItem
                  id="tab-menu-close-right-tabs"
                  onClick={() => {
                    handleCloseMenu();
                    closeRightTabs(memoTabId);
                  }}
                >
                  {t("Close Tabs to the Right")}
                </MenuItem>
                {tab.type === "scratchpad" && (
                  <MenuItem
                    id="tab-menu-force-sync"
                    onClick={() => {
                      handleCloseMenu();
                      fetch("/api/scratchpad/reload", { method: METHOD_POST, headers: apiReqHeaders() }).then(() => {
                        // csNotify("Reloading Scratchpad from disk...");
                      });
                    }}
                  >
                    {t("Force sync")}
                  </MenuItem>
                )}
                <ExtraMenu extraMenu={extraTabMenu} target={tab} before={handleCloseMenu} />
                <MenuItem
                  id="tab-menu-move-left"
                  onClick={() => {
                    handleCloseMenu();
                    moveTabLeft(memoTabId);
                  }}
                >
                  {t("Move Tab Left")}
                </MenuItem>
                <MenuItem
                  id="tab-menu-move-right"
                  onClick={() => {
                    handleCloseMenu();
                    moveTabRight(memoTabId);
                  }}
                >
                  {t("Move Tab Right")}
                </MenuItem>
              </>
            );
          })()}
      </Menu>

      <Menu
        id="button-menu"
        anchorEl={btnContextMenu?.element}
        open={btnContextMenuOpen}
        onClose={() => setBtnContextMenuOpen(false)}
      >
        <MenuItem
          id="button-menu-edit"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            const data = {
              id: "",
              name: btnContextMenu.btn.name,
              type: btnContextMenu.btn.type,
              payload: btnContextMenu.btn.payload,
              group: btnContextMenu.btn.group || DEFAULT_BUTTON_GROUP,
              autorun: btnContextMenu.btn.autorun || 0,
              order: btnContextMenu.btn.order || 0,
              shortcut: btnContextMenu.btn.shortcut || "",
              liquidjs: btnContextMenu.btn.liquidjs || 0,
            };
            setEditButton(btnContextMenu.btn);
            setButtonFormData(data);
            setInitialBtnFormData(data);
            setEditButtonDialogOpen(true);
          }}
        >
          {t("Edit")} {btnContextMenu?.btn ? `${btnContextMenu.btn.name} (${btnContextMenu.btn.type})` : t("Button")}
        </MenuItem>
        <MenuItem
          id="button-menu-send"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            openInputDialog({
              inputValue: btnContextMenu.btn.payload,
              inputLiquid: btnContextMenu.btn.liquidjs === 1 || btnContextMenu.btn.liquidjs === 2,
              sendScope: 0,
              appendNewLine: false,
            });
          }}
          sx={{ display: btnContextMenu?.btn.type === "send_string" ? "flex" : "none" }}
        >
          {t("Send")}
        </MenuItem>
        <MenuItem
          id="button-menu-send-all"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            openInputDialog({
              inputValue: btnContextMenu.btn.payload,
              inputLiquid: btnContextMenu.btn.liquidjs === 1 || btnContextMenu.btn.liquidjs === 2,
              sendScope: 2,
              appendNewLine: false,
            });
          }}
          sx={{ display: btnContextMenu?.btn.type === "send_string" ? "flex" : "none" }}
        >
          {t("Send To All")}
        </MenuItem>
        <MenuItem
          id="button-menu-open-new-window"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            openHostInNewWindow(btnContextMenu.btn.payload);
          }}
          sx={{
            display: btnContextMenu?.btn.type === "open_terminal" ? "flex" : "none",
          }}
        >
          {t("Open (New Window)")}
        </MenuItem>
        <MenuItem
          id="button-menu-open-in-current-tab"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            const hosts = btnContextMenu.btn.payload.split(/\s*,\s*/);
            for (const host of hosts) {
              openHost(host, { target: "_self" });
            }
          }}
          sx={{
            display: btnContextMenu?.btn.type === "open_terminal" ? "flex" : "none",
          }}
        >
          {t("Open (In Current Tab)")}
        </MenuItem>
        <MenuItem
          id="button-menu-copy-url"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            navigator.clipboard.writeText(
              `${window.location.origin}/#${encodeURIComponent(btnContextMenu.btn.payload)}`,
            );
          }}
          className={CLASS_HIDE_DESKTOP}
          sx={{
            display: btnContextMenu?.btn.type === "open_terminal" ? "flex" : "none",
          }}
        >
          {t("Copy URL")}
        </MenuItem>
        <MenuItem
          id="button-menu-copy-contents"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            navigator.clipboard.writeText(btnContextMenu.btn.payload);
          }}
          sx={{
            display:
              btnContextMenu?.btn.type === "send_string" ||
              btnContextMenu?.btn.type === "run_script" ||
              btnContextMenu?.btn.type === "open_terminal"
                ? "flex"
                : "none",
          }}
        >
          {t("Copy Contents")}
        </MenuItem>
        <MenuItem
          id="button-menu-copy-button-data"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            navigator.clipboard.writeText(JSON.stringify(btnContextMenu.btn));
          }}
        >
          {t("Copy Button Data")}
        </MenuItem>
        {btnContextMenu && (
          <ExtraMenu
            extraMenu={extraButtonMenu}
            target={btnContextMenu.btn}
            before={() => setBtnContextMenuOpen(false)}
          />
        )}
        <MenuItem
          id="button-menu-move-left"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            moveButton(btnContextMenu.btn.id, -1);
          }}
        >
          {t("Move Button Left")}
        </MenuItem>
        <MenuItem
          id="button-menu-move-right"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            moveButton(btnContextMenu.btn.id, 1);
          }}
        >
          {t("Move Button Right")}
        </MenuItem>
        <MenuItem
          id="button-menu-delete"
          onClick={() => {
            if (!btnContextMenu) {
              return;
            }
            setBtnContextMenuOpen(false);
            deleteButton(btnContextMenu.btn);
          }}
          sx={{ color: "error.main" }}
        >
          {t("Delete Button")}
        </MenuItem>
      </Menu>

      <Dialog
        id="edit-button-dialog"
        disableRestoreFocus
        data-id={editButton?.id || ""}
        open={editButtonDialogOpen}
        onClose={(e, reason) => {
          if (buttonFormDirty && !(reason === "backdropClick" && (e as MouseEvent)?.ctrlKey)) {
            return;
          }
          setEditButtonDialogOpen(false);
        }}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pr: 1.5 }}>
          <span>
            {editButton
              ? t("Edit Button") + " " + editButton.id
              : t("Add Button") + (buttonFormData.id ? " (" + buttonFormData.id + ")" : "")}
          </span>
          <IconButton
            aria-label={t("More")}
            id="edit-button-form-menu-button"
            aria-controls={titleMenuAnchor ? "edit-button-form-menu" : undefined}
            aria-expanded={titleMenuAnchor ? "true" : undefined}
            aria-haspopup="true"
            onClick={handleTitleMenuClick}
            size="small"
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <Menu
          id="edit-button-form-menu"
          anchorEl={titleMenuAnchor}
          open={!!titleMenuAnchor}
          onClose={handleTitleMenuClose}
        >
          <MenuItem
            id="edit-button-form-menu-copy"
            disabled={!buttonFormData.name}
            onClick={async () => {
              handleTitleMenuClose();
              const btn = { ...buttonFormData, id: editButton?.id || "" } satisfies ButtonData;
              navigator.clipboard.writeText(JSON.stringify(btn));
            }}
          >
            {t("Copy Button To Clipboard")}
          </MenuItem>
          <MenuItem
            id="edit-button-form-menu-paste"
            onClick={async () => {
              handleTitleMenuClose();
              const text = await navigator.clipboard.readText();
              importFromData(text);
            }}
          >
            {t("Paste Button From Clipboard")}
          </MenuItem>
          <MenuItem
            id="edit-button-form-menu-add-from-url"
            onClick={() => {
              handleTitleMenuClose();
              handleAddFromUrl();
            }}
            disabled={!!editButton}
          >
            {t("Add From URL")}
          </MenuItem>
          <MenuItem
            id="edit-button-form-menu-add-plugin-manager"
            onClick={() => {
              handleTitleMenuClose();
              handleInstallPluginManager();
            }}
            disabled={!!editButton}
          >
            {t("Add Plugin Manager")}
          </MenuItem>
          <ExtraMenu
            extraMenu={extraButtonFormMenu}
            target={buttonFormData}
            before={() => {
              handleTitleMenuClose();
            }}
          />
          <MenuItem
            id="edit-button-form-menu-reset"
            disabled={!buttonFormDirty}
            onClick={() => {
              handleTitleMenuClose();
              const initialForm = getStore().initialBtnFormData;
              if (initialForm) {
                setButtonFormData(initialForm);
              }
            }}
          >
            {t("Reset Form")}
          </MenuItem>
          <MenuItem
            id="edit-button-form-menu-delete"
            sx={{ color: "error.main" }}
            disabled={!editButton}
            onClick={() => {
              handleTitleMenuClose();
              setEditButtonDialogOpen(false);
              deleteButton(editButton!);
            }}
          >
            {t("Delete Button")}
          </MenuItem>
          <MenuItem
            id="edit-button-form-menu-clear-id"
            disabled={!!editButton || !buttonFormData.id}
            onClick={() => {
              handleTitleMenuClose();
              setButtonFormData({ ...buttonFormData, id: "" });
            }}
          >
            {t("Clear New Button Id")}
          </MenuItem>
        </Menu>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {importTip && (
            <Alert severity={importTip.severity} onClose={() => setImportTip(null)} sx={{ mb: 1 }}>
              {importTip.msg}
            </Alert>
          )}
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1 }}>
            <TextFieldWithCopy
              sx={{ flex: 2 }}
              label={t("Button Name")}
              autoFocus={!editButton}
              autoComplete="off"
              placeholder={t("Ctrl + Enter to submit")}
              size="small"
              required
              value={buttonFormData.name}
              onChange={(e) => setButtonFormData({ ...buttonFormData, name: e.target.value })}
              onKeyDown={handleEditButtonFormKeyDown}
            />
            <FreeTextField
              sx={{ flex: 1 }}
              size="small"
              label={t("Button Group")}
              placeholder={DEFAULT_BUTTON_GROUP}
              options={groups}
              value={buttonFormData.group}
              onChange={(newValue) => setButtonFormData({ ...buttonFormData, group: newValue || "" })}
              onKeyDown={handleEditButtonFormKeyDown}
            />
          </Box>
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
            <TextField
              select
              label={t("Button Type")}
              size="small"
              value={buttonFormData.type}
              onChange={(e) =>
                setButtonFormData({
                  ...buttonFormData,
                  type: e.target.value as ButtonData["type"],
                  payload:
                    e.target.value === "terminal_function"
                      ? "COPY"
                      : e.target.value === "misc"
                        ? "NEXT_BUTTON_GROUP"
                        : e.target.value === "open_terminal"
                          ? LOCAL_NAME
                          : "",
                })
              }
              onKeyDown={handleEditButtonFormKeyDown}
              slotProps={{ select: { native: true } }}
              sx={{ flexGrow: 1 }}
            >
              {Object.entries(BUTTPN_TYPES).map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </TextField>
            <TextFieldWithCopy
              label={t("Order")}
              type="number"
              size="small"
              value={buttonFormData.order}
              onChange={(e) => setButtonFormData({ ...buttonFormData, order: parseInt(e.target.value) || 0 })}
              onKeyDown={handleEditButtonFormKeyDown}
              sx={{ width: 150 }}
            />
          </Box>

          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
            <TextFieldWithCopy
              label={t("Shortcut")}
              type="search"
              size="small"
              autoComplete="off"
              value={buttonFormData.shortcut}
              onChange={(e) => setButtonFormData({ ...buttonFormData, shortcut: e.target.value })}
              placeholder={t("Press keys or input, e.g. 'ctrl+shift+m', modifiers in ctrl,alt,shift,meta order")}
              onKeyDown={(e) => {
                if (e.ctrlKey || e.altKey || e.metaKey || (e.key.length > 1 && e.key !== "Shift")) {
                  e.preventDefault();
                  e.stopPropagation();
                  setButtonFormData({ ...buttonFormData, shortcut: getKeyCombination(e) });
                }
              }}
              sx={{ flexGrow: 1 }}
            />
            <FormControlLabel
              title={t("Enable shortcut only if the button group is currently the active button group")}
              sx={{ flexShrink: 0, mr: 0, ml: 0, whiteSpace: "nowrap" }}
              control={
                <Checkbox
                  checked={buttonFormData.shortcut_scope === 1}
                  onChange={(e) =>
                    setButtonFormData({ ...buttonFormData, shortcut_scope: e.target.checked ? 1 : undefined })
                  }
                  size="small"
                />
              }
              label={<Typography variant="body2">{t("Local shortcut")}</Typography>}
            />
            {(buttonFormData.type === "run_script" || buttonFormData.type === "open_terminal") && (
              <FormControlLabel
                title={
                  buttonFormData.type === "run_script"
                    ? t("Automatically run this script when the page loads")
                    : t("Automatically open this terminal when the page loads")
                }
                sx={{ flexShrink: 0, mr: 0, ml: 0, whiteSpace: "nowrap" }}
                control={
                  <Checkbox
                    checked={buttonFormData.autorun === 1}
                    onChange={(e) => setButtonFormData({ ...buttonFormData, autorun: e.target.checked ? 1 : 0 })}
                    size="small"
                  />
                }
                label={<Typography variant="body2">{t("Autorun")}</Typography>}
              />
            )}
            {buttonFormData.type === "send_string" && (
              <FormControlLabel
                title={t("Treat payload as LiquidJS template and enable Liquid highlight extension")}
                sx={{ flexShrink: 0, mr: 0, ml: 0, whiteSpace: "nowrap" }}
                control={
                  <Checkbox
                    checked={buttonFormData.liquidjs === 1 || buttonFormData.liquidjs === 2}
                    onChange={(e) => setButtonFormData({ ...buttonFormData, liquidjs: e.target.checked ? 1 : 0 })}
                    size="small"
                  />
                }
                label={<Typography variant="body2">LiquidJS</Typography>}
              />
            )}
          </Box>

          {buttonFormData.type === "send_string" ? (
            buttonFormData.liquidjs ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Box
                  sx={{
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    overflow: "hidden",
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <CodeMirror
                    value={buttonFormData.payload}
                    placeholder={t("LiquidJS template. Ctrl + Enter to submit")}
                    height="200px"
                    theme="light"
                    extensions={[liquid(), EditorView.lineWrapping]}
                    onChange={(value) => setButtonFormData({ ...buttonFormData, payload: value })}
                    style={{ fontSize: "12px" }}
                    onKeyDown={handleEditButtonFormKeyDown}
                  />
                </Box>
                <Typography variant="subtitle2" color="text.secondary">
                  {t("Learn more about")}&nbsp;
                  <a
                    href="https://liquidjs.com/tutorials/intro-to-liquid.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: theme.palette.primary.main, textDecoration: "none" }}
                  >
                    {t("Liquid Template")}
                  </a>
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8 }}>
                  <b>{t("Available System Variables")}</b>:&nbsp;
                  <Chip
                    color="success"
                    label="shellIntegration"
                    onClick={() => {
                      setButtonFormData({
                        ...buttonFormData,
                        payload: buttonFormData.payload + " {{shellIntegration | json}}",
                      });
                    }}
                  />
                  <Chip
                    color="success"
                    label="vars"
                    onClick={() => {
                      setButtonFormData({
                        ...buttonFormData,
                        payload: buttonFormData.payload + " {{vars | json}}",
                      });
                    }}
                  />
                  <Chip
                    color="success"
                    label="localVars"
                    onClick={() => {
                      setButtonFormData({
                        ...buttonFormData,
                        payload: buttonFormData.payload + " {{localVars | json}}",
                      });
                    }}
                  />
                  <Chip
                    color="success"
                    label="host"
                    onClick={() => {
                      setButtonFormData({
                        ...buttonFormData,
                        payload: buttonFormData.payload + " {{host | json}}",
                      });
                    }}
                  />
                  <Chip
                    color="success"
                    label="clipboard"
                    onClick={() => {
                      setButtonFormData({
                        ...buttonFormData,
                        payload: buttonFormData.payload + " {{clipboard}}",
                      });
                    }}
                  />
                </Box>
                {editButtonVars.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8 }}>
                    <b>{t("Detected Custom Variables:")}</b>
                    {editButtonVars.map((v) => (
                      <Chip color="secondary" label={v} />
                    ))}
                  </Box>
                )}
              </Box>
            ) : (
              <TextFieldWithCopy
                fullWidth
                label={t("Command / String")}
                size="small"
                required
                multiline
                rows={3}
                value={buttonFormData.payload}
                onChange={(e) => setButtonFormData({ ...buttonFormData, payload: e.target.value })}
                onKeyDown={handleEditButtonFormKeyDown}
                placeholder={t("String to send to terminal, <ctrl-x> style syntax supported. Ctrl + Enter to submit")}
              />
            )
          ) : buttonFormData.type === "terminal_function" ? (
            <TextField
              select
              fullWidth
              label={t("Function")}
              size="small"
              value={buttonFormData.payload}
              onChange={(e) => setButtonFormData({ ...buttonFormData, payload: e.target.value })}
              slotProps={{ select: { native: true } }}
            >
              {TERMINAL_FUNCTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </TextField>
          ) : buttonFormData.type === "misc" ? (
            <TextField
              select
              fullWidth
              label={t("Function")}
              size="small"
              value={buttonFormData.payload}
              onChange={(e) => setButtonFormData({ ...buttonFormData, payload: e.target.value })}
              slotProps={{ select: { native: true } }}
            >
              {MISC_FUNCTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </TextField>
          ) : buttonFormData.type === "open_terminal" ? (
            <Box
              sx={{
                px: 1.5,
                py: 0.5,
                bgcolor: "action.hover",
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <FreeTextField
                fullWidth
                label={t("Server / Address")}
                size="small"
                placeholder={t("e.g. local, production-db, root@192.168.1.1")}
                options={[LOCAL_NAME, ...hosts.map((h) => h.name)]}
                value={buttonFormData.payload}
                onChange={(newValue) => {
                  setButtonFormData({ ...buttonFormData, payload: newValue || "" });
                }}
              />
              <Typography variant="body2" color="text.secondary">
                {t("Server name")} {t("or")} <b>[username[:password]@]hostname[:port]</b>.&nbsp;
                {t("Use `local` for local shell.")}
                <br />
                {t(
                  "Append `?id=abc&title=Local` style (URL Encoded) query string to set optional session-scope parameters:",
                )}
                <br />- <b>id</b> :&nbsp;
                {t("The terminal pane id. If the same id pane exists, switch to it instead of opening a new one.")}
                <br />- <b>sessionId</b> : {t("The terminal session id.")}&nbsp;
                {t(
                  "If the same session id already exists in backend, it will attach the target session instead of creating a new one.",
                )}
                <br />- <b>title</b> : {t("The opened tab title.")}
                <br />- <b>remoteCommand</b> :&nbsp;
                {t("Remote shell command to execute on connected. It works on `local` shell too.")}
                <br />- <b>shellIntegration</b>:&nbsp;
                {t(
                  `Whether to inject shell integration script to the new session: ""(empty string, default) = auto; 0 = disable (don't inject); 1 = enable (inject unless it's detected that the injection may not work); 2 = force enable (always inject).`,
                )}
                <br />- <b>proxyJump</b> : {t("Proxy jump server.")}
                <br />- <b>target</b> :&nbsp;
                {t(
                  "The tab id. If the same id tab exists, the new terminal will be opened in the target tab, use `_self` for current tab.",
                )}
                <br />- <b>exec</b> :&nbsp;
                {t(
                  "Only valid for `local` host. If set to `1`, it treats `remoteCommand` as a single program with args and execute it directly instead of executing it using system shell.",
                )}
                <br />- <b>localForward</b> & <b>remoteForward</b> & <b>dynamicForward</b> :&nbsp;
                {t("OpenSSH syntax SSH tunnel rules. Use \\n to seperate multiple rules.")}
                <br />- <b>env</b> :&nbsp;
                {t(
                  "Environment variables to send to SSH server. Format: `NAME=value`. Use \\n to seperate multiple variables.",
                )}
                <br />- <b>state</b> :&nbsp;
                {t("Set the initial state of the opened terminal session: 0=normal, 1=pinned, 2=locked, 3=hidden.")}
                <br />- <b>tabStyle</b> :&nbsp;
                {t(`JSON Object. Set the terminal tab bar tab CSS style. E.g. '{"background":"red"}'.`)}
                <br />- <b>terminalStyle</b> : {t("JSON Object. Set the terminal area CSS Style.")}
                <br />- <b>tabClass</b> : {t("The class name to add to the terminal tab.")}
                <br />- <b>terminalClass</b> : {t("The class name to add to the terminal wrap element.")}
                <br />
                {t("It's possible to set multiple (up to 4) comma-separated servers to open them in split screen.")}
                <br />
                {t("E.g.")} <b>local?title=Local</b>. {t("More examples:")}
                <br />- <b>local?id=local-abc&title=Local&remoteCommand=tmux attach || tmux new</b>
                <br />- <b>local?remoteCommand=python&title=Python</b> : {t("Start Python REPL.")}
                <br />- <b>192.168.1.1?title=server1,192.168.1.2?title=server2</b> :&nbsp;
                {t("Open two terminals in split screen.")}
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                overflow: "hidden",
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 0.5,
                  bgcolor: "action.hover",
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap" }}
                >
                  <span>
                    {t("Check scripts help:")}&nbsp;
                    <a
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#1976d2" }}
                      href={LINK_COZYSSH_DOC_SCRIPTS}
                    >
                      SCRIPTS
                    </a>
                  </span>
                  <a
                    href="#"
                    style={{ color: "#1976d2" }}
                    onClick={(e) => {
                      e.preventDefault();
                      navigator.clipboard.writeText(buttonFormData.payload);
                    }}
                  >
                    {t("Copy")}
                  </a>
                </Typography>
              </Box>
              <CodeMirror
                value={buttonFormData.payload}
                height="200px"
                theme="light"
                extensions={[javascript({ typescript: true }), EditorView.lineWrapping]}
                onChange={(value) => setButtonFormData({ ...buttonFormData, payload: value })}
                style={{ fontSize: "12px" }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditButtonDialogOpen(false)}>{t("Cancel")}</Button>
          <Button variant="contained" onClick={handleSaveButton} disabled={buttonFormSubmitDisabled}>
            {t("Save")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        id="input-dialog"
        open={inputDialogOpen}
        onClose={(e, reason) => handleCloseInputDialog(reason === "backdropClick" && (e as MouseEvent)?.ctrlKey)}
        disableRestoreFocus
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            {t("Terminal Input")} ({t("Current pane")}: {activePane?.host ?? t("<none>")})
          </span>
          {!inputLiquid && (
            <IconButton disabled={!inputValue} onClick={() => navigator.clipboard.writeText(inputValue)} size="small">
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          )}
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {!inputLiquid ? (
            <TextField
              fullWidth
              multiline
              rows={6}
              variant="outlined"
              id={ID_INPUT_DIALOG_INPUT}
              placeholder={
                t("Type input to send to terminal. <ctrl-x> style syntax supported.") +
                " " +
                (activeTab && activeTab.panes.length > 1
                  ? t("Ctrl + Enter to send; Ctrl + Shift + Enter to send to all tabs")
                  : t(
                      "Ctrl + Enter to send; Ctrl + Shift + Enter to send to all tabs or Ctrl + Alt + Enter to send to all panes",
                    ))
              }
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputDialogDirty(true);
              }}
              onKeyDown={(e) => {
                const key = getKeyCombination(e);
                if (key === "ctrl+enter" || key === "ctrl+shift+enter" || key === "ctrl+alt+enter") {
                  if (key === "ctrl+shift+enter") {
                    setSendScope(2);
                  } else if (key === "ctrl+alt+enter") {
                    setSendScope(1);
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  if (inputValue) {
                    const data = appendNewLine ? inputValue + "\n" : inputValue;
                    sendParsedString(data);
                  }
                  handleCloseInputDialog(true);
                }
              }}
              autoFocus
            />
          ) : (
            <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 3 }}>
              <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Typography variant="subtitle2" color="text.secondary">
                    <a
                      href="https://liquidjs.com/tutorials/intro-to-liquid.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: theme.palette.primary.main, textDecoration: "none" }}
                    >
                      {t("Liquid Template")}
                    </a>
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ py: 0, px: 1, minWidth: 0, fontSize: "typography.caption.fontSize", textTransform: "none" }}
                    onClick={() => navigator.clipboard.writeText(inputValue)}
                  >
                    {t("Copy")}
                  </Button>
                </Box>
                <TextField
                  fullWidth
                  multiline
                  rows={6}
                  variant="outlined"
                  id={ID_INPUT_DIALOG_INPUT}
                  placeholder={
                    t("Type template/input to send to terminal.") +
                    " " +
                    (activeTab && activeTab.panes.length > 1
                      ? t("Ctrl + Enter to send; Ctrl + Shift + Enter to send to all tabs")
                      : t(
                          "Ctrl + Enter to send; Ctrl + Shift + Enter to send to all tabs or Ctrl + Alt + Enter to send to all panes",
                        ))
                  }
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setInputDialogDirty(true);
                  }}
                  onKeyDown={(e) => {
                    const key = getKeyCombination(e);
                    if (key === "ctrl+enter" || key === "ctrl+shift+enter" || key === "ctrl+alt+enter") {
                      if (key === "ctrl+shift+enter") {
                        setSendScope(2);
                      } else if (key === "ctrl+alt+enter") {
                        setSendScope(1);
                      }
                      e.preventDefault();
                      e.stopPropagation();
                      if (inputValue) {
                        const data = appendNewLine ? inputValue + "\n" : inputValue;
                        sendParsedString(data, true, userVars);
                      }
                      handleCloseInputDialog(true);
                    }
                  }}
                  autoFocus={varsList.length === 0}
                  slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: "typography.body2.fontSize" } } }}
                />
                <Typography variant="subtitle2" color="text.secondary">
                  {t("System Variables")}
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8 }}>
                  <Chip
                    color="success"
                    label="shellIntegration"
                    onClick={() => {
                      setInputValue(inputValue + " {{shellIntegration | json}}");
                    }}
                  />
                  <Chip
                    color="success"
                    label="vars"
                    onClick={() => {
                      setInputValue(inputValue + " {{vars | json}}");
                    }}
                  />
                  <Chip
                    color="success"
                    label="localVars"
                    onClick={() => {
                      setInputValue(inputValue + " {{localVars | json}}");
                    }}
                  />
                  <Chip
                    color="success"
                    label="host"
                    onClick={() => {
                      setInputValue(inputValue + " {{host | json}}");
                    }}
                  />
                  <Chip
                    color="success"
                    label="clipboard"
                    onClick={() => {
                      setInputValue(inputValue + " {{clipboard}}");
                    }}
                  />
                </Box>
              </Box>
              <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  {t("Variables")}
                </Typography>
                <Box
                  sx={{
                    flexGrow: 1,
                    minHeight: "100px",
                    maxHeight: "180px",
                    overflowY: "auto",
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    p: 1.5,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1.5,
                    bgcolor: "background.paper",
                  }}
                >
                  {(varsList.length > 0 ? varsList : [""]).map((vname, i) => (
                    <TextFieldWithCopy
                      key={i}
                      sx={{ display: varsList.length > 0 ? "unset" : "none" }}
                      fullWidth
                      label={vname}
                      autoFocus={i === 0 && varsList.length > 0}
                      size="small"
                      type="search"
                      value={userVars[vname] || ""}
                      onChange={(e) => {
                        setUserVars((prev) => ({ ...prev, [vname]: e.target.value }));
                        setInputDialogDirty(true);
                      }}
                      placeholder={
                        activeTab && activeTab.panes.length > 1
                          ? t("Ctrl + Enter to send; +Alt/Shift for all panes/tabs")
                          : t("Ctrl + Enter to send; +Shift for all tabs")
                      }
                      onKeyDown={(e) => {
                        const key = getKeyCombination(e);
                        if (key === "ctrl+enter" || key === "ctrl+shift+enter" || key === "ctrl+alt+enter") {
                          if (key === "ctrl+shift+enter") {
                            setSendScope(2);
                          } else if (key === "ctrl+alt+enter") {
                            setSendScope(1);
                          }
                          e.preventDefault();
                          e.stopPropagation();
                          if (inputValue) {
                            const data = appendNewLine ? inputValue + "\n" : inputValue;
                            sendParsedString(data, true, userVars);
                          }
                          handleCloseInputDialog(true);
                        }
                      }}
                    />
                  ))}
                  {varsList.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", m: "auto" }}>
                      {t("No variables to display")}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      {t("Rendered Preview")}
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      sx={{ py: 0, px: 1, minWidth: 0, fontSize: "typography.caption.fontSize", textTransform: "none" }}
                      onClick={() => {
                        if (renderedPreview) {
                          navigator.clipboard.writeText(renderedPreview);
                        }
                      }}
                    >
                      {t("Copy")}
                    </Button>
                  </Box>
                  <TextField
                    fullWidth
                    multiline
                    rows={6}
                    variant="outlined"
                    disabled={true}
                    value={renderedPreview}
                    sx={{ bgcolor: "action.hover", fontFamily: "monospace", fontSize: "typography.body2.fontSize" }}
                  />
                </Box>
              </Box>
            </Box>
          )}
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1.5 }}>
            <FormControlLabel
              control={
                <Checkbox checked={appendNewLine} onChange={(e) => setAppendNewLine(e.target.checked)} size="small" />
              }
              label={<Typography variant="body2">{t("Append new line (\\n)")}</Typography>}
            />
            {activeTab && activeTab.panes.length > 1 && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sendScope === 1}
                    onChange={(e) => setSendScope(e.target.checked ? 1 : 0)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">{t("Send to all panes")}</Typography>}
              />
            )}
            <FormControlLabel
              control={
                <Checkbox
                  checked={sendScope === 2}
                  onChange={(e) => setSendScope(e.target.checked ? 2 : 0)}
                  size="small"
                />
              }
              label={<Typography variant="body2">{t("Send to all tabs")}</Typography>}
            />
            <FormControlLabel
              control={
                <Checkbox checked={inputLiquid} onChange={(e) => setInputLiquid(e.target.checked)} size="small" />
              }
              label={<Typography variant="body2">LiquidJS</Typography>}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleCloseInputDialog(true)}>{t("Cancel")}</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (inputValue) {
                const data = appendNewLine ? inputValue + "\n" : inputValue;
                sendParsedString(data, inputLiquid, userVars);
              }
              handleCloseInputDialog(true);
            }}
          >
            {t("Send")}
          </Button>
        </DialogActions>
      </Dialog>
      <NewTabDialog isMobile={isMobile} isTouch={isTouch} key={newTabDialogOpen ? "open" : "closed"} />
      <Box
        id="toasts"
        sx={{
          position: "fixed",
          top: 20,
          right: 20,
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          gap: 1,
          alignItems: "flex-end",
        }}
      >
        {toasts.map((t) => (
          <Alert
            key={t.key || t.id}
            severity={t.severity}
            data-severity={t.severity}
            data-msg={t.msg}
            data-key={t.key || ""}
            className="toast"
            variant="filled"
            onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            sx={{
              minWidth: 250,
              boxShadow: 3,
              // Add a simple animation feel
              animation: "slideIn 0.1s cubic-bezier(0.15, 1.15, 0.3, 1) forwards",
              "@keyframes slideIn": {
                "0%": { transform: "translateX(100%)", opacity: 0 },
                "100%": { transform: "translateX(0)", opacity: 1 },
              },
            }}
          >
            {t.msg}
          </Alert>
        ))}
      </Box>
    </>
  );
}
