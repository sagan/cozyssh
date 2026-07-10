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
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { liquid } from "@codemirror/lang-liquid";

import type { HostData, ButtonData } from "./api";
import {
  DEFAULT_BUTTON_GROUP,
  ID_INPUT_DIALOG_INPUT,
  LOCAL_NAME,
  METHOD_POST,
  MISC_FUNCTIONS,
  TERMINAL_FUNCTIONS,
} from "./constants";
import {
  type ContextMenu,
  type ToastData,
  getKeyCombination,
  ButtonDataSchema,
  parseHostName,
  getCanonicalHostString,
  getTemplateVariables,
  liquidEngine,
  openHostInNewWindow,
  cutString,
  cutSuffix,
  apiReqHeaders,
} from "./common";
import {
  type TabData,
  getStore,
  setActivePaneId,
  setActiveTabId,
  setBtnMenuAnchor,
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
  closeNewTabDialog,
  closeOtherTabs,
  closeRightTabs,
  openInputDialog,
  closeInputDialog,
  setInputDialogDirty,
  openHost,
  cloneSession,
  attachSession,
  unpinTab,
  pinTab,
  unlockTab,
  lockTab,
  renameTab,
  saveButton,
  deleteButton,
  moveButton,
  refreshData,
  openSaveTabToButtonDialog,
  openEditHost,
  openEditTabHost,
  closeTabOrPane,
  closeTab,
  hideTab,
  openAddHostForm,
} from "./store";
import NewTabDialog from "./NewTabDialog";
import { dialogs } from "./Dialogs";
import FreeTextField from "./components/FreeTextField";

export interface DialogManagerProps {
  isMobile: boolean;
  isTouch: boolean;
  groups: string[];
  memoTabId: string | null;
  contextMenu: ContextMenu | null;
  handleCloseMenu: () => void;
  handleToggleFiles: () => void;
  handleReconnectTab: (id: string) => void;
  sendParsedString: (s: string, isLiquid?: boolean, userVars?: Record<string, string>) => void;
  handleButtonClick: (
    btn: Pick<ButtonData, "id" | "name" | "type" | "payload" | "liquidjs">,
    alternativeMode?: number,
  ) => Promise<void>;
}

const PluginManagerUrl =
  "https://raw.githubusercontent.com/sagan/cozyssh-plugins/refs/heads/master/CsPluginManager.tsx";

/**
 * button type, label
 */
const buttonTypes: [ButtonData["type"], string][] = [
  ["send_string", "Send String"],
  ["terminal_function", "Terminal Function"],
  ["misc", "Misc"],
  ["open_terminal", "Open Terminal"],
  ["run_script", "Run Script"],
];

export default function DialogManager({
  isMobile,
  isTouch,
  groups,
  memoTabId,
  contextMenu,
  handleCloseMenu,
  handleToggleFiles,
  handleReconnectTab,
  handleButtonClick,
  sendParsedString,
}: DialogManagerProps) {
  const hosts = useStore((state) => state.hosts);
  const lastMenuBtn = useStore((state) => state.lastMenuBtn);
  const editButton = useStore((state) => state.editButton);
  const btnMenuAnchor = useStore((state) => state.btnMenuAnchor);
  const toasts = useStore((state) => state.toasts);
  const buttonFormData = useStore((state) => state.buttonFormData);
  const initialBtnFormData = useStore((state) => state.initialBtnFormData);
  const editButtonDialogOpen = useStore((state) => state.editButtonDialogOpen);
  const newTabDialogOpen = useStore((state) => state.newTabDialogOpen);
  const tabs = useStore((state) => state.tabs);
  const activeTabId = useStore((state) => state.activeTabId);
  const buttons = useStore((state) => state.buttons);
  const inputDialogOpen = useStore((state) => state.inputDialogOpen);
  const inputValue = useStore((state) => state.inputValue);
  const sendScope = useStore((state) => state.sendScope);
  const inputLiquid = useStore((state) => state.inputLiquid);
  const activePaneId = useStore((state) => state.activePaneId);
  const shellIntegrations = useStore((state) => state.shellIntegrations);
  const appendNewLine = useStore((state) => state.appendNewLine);

  const [titleMenuAnchor, setTitleMenuAnchor] = useState<null | HTMLElement>(null);
  const [importTip, setImportTip] = useState<ToastData | null>(null);

  const [userVars, setUserVars] = useState<Record<string, string>>({});
  const [renderedPreview, setRenderedPreview] = useState("");

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
        const context = {
          shellIntegration: shellIntegrations[activePaneId] || {},
          vars: vars || {},
          localVars: localVars || {},
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

      try {
        const response = await csFetch(url);
        if (!response.ok) {
          setImportTip({
            msg: `Failed to fetch ${url} : Server responded with status ${response.status}.`,
            severity: "error",
          });
          return;
        }

        const text = await response.text();
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
            const errorMsg = result.error.issues
              .map((err) => `${err.path.join(".") || "root"}: ${err.message}`)
              .join(", ");
            setImportTip({
              msg: `Not a valid ButtonData object. Validation errors: ${errorMsg}`,
              severity: "error",
            });
            return;
          }

          const validatedData = result.data;

          if (validatedData.id && buttons.find((b) => b.id === validatedData.id)) {
            if (!(await dialogs.confirm(`Button with ID "${validatedData.id}" already exists. Overwrite it?`))) {
              return;
            }
          }

          setButtonFormData({
            name: validatedData.name,
            type: validatedData.type,
            payload: validatedData.payload,
            group: validatedData.group || getStore().buttonFormData.group || DEFAULT_BUTTON_GROUP,
            autorun: validatedData.autorun,
            order: validatedData.order,
            shortcut: validatedData.shortcut,
          });

          setImportTip({
            msg: "Successfully loaded button data from JSON! Review the fields and click 'Save' to confirm.",
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
            const btn = buttons.find((b) => b.id === buttonId);
            if (
              btn &&
              !(await dialogs.confirm(
                `Button "${btn.name}" (id: "${buttonId}") already exists in group "${btn.group}". Overwrite it?`,
              ))
            ) {
              return;
            }
          }

          if (!buttonName) {
            try {
              const urlObj = new URL(url);
              const pathParts = urlObj.pathname.split("/");
              const lastPart = pathParts[pathParts.length - 1] || "Imported Script";
              buttonName = lastPart.replace(/\.(ts|tsx|js|jsx|txt)$/i, "") || "Imported Script";
            } catch (e) {
              console.log(e);
              buttonName = "Imported Script";
            }
          }

          setButtonFormData({
            name: buttonName,
            type: "run_script",
            payload: text,
            group: group || getStore().buttonFormData.group || DEFAULT_BUTTON_GROUP,
            autorun,
            order: getStore().buttonFormData.order || 0,
            shortcut: "",
          });

          setImportTip({
            msg: "Successfully loaded script file! Review the fields and click 'Save' to confirm.",
            severity: "success",
          });
        }
      } catch (error) {
        setImportTip({
          msg: `Network error or failed to load button data: ${error}`,
          severity: "error",
        });
      }
    },
    [buttons],
  );

  const handleAddFromUrl = useCallback(async () => {
    const url = await dialogs.prompt("Enter URL to load button data from:");
    if (!url) {
      return;
    }
    await importFromUrl(url);
  }, [importFromUrl]);

  const handleInstallPluginManager = useCallback(async () => {
    await importFromUrl(PluginManagerUrl);
  }, [importFromUrl]);

  const buttonFormDirty = useMemo(() => {
    return !!initialBtnFormData && JSON.stringify(buttonFormData) !== JSON.stringify(initialBtnFormData);
  }, [buttonFormData, initialBtnFormData]);

  return (
    <>
      <Menu
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
                {tab.type !== "scratchpad" && tab.panes.length === 1 && (
                  <>
                    {tab.panes[0].host !== LOCAL_NAME && (
                      <MenuItem
                        onClick={() => {
                          handleCloseMenu();
                          openEditTabHost(tab);
                        }}
                      >
                        Edit {tab.panes[0].host}
                      </MenuItem>
                    )}
                    {tab.isPinned ? (
                      <MenuItem
                        className="hide-desktop"
                        onClick={() => {
                          handleCloseMenu();
                          unpinTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        Unpin Tab
                      </MenuItem>
                    ) : (
                      <MenuItem
                        className="hide-desktop"
                        onClick={() => {
                          handleCloseMenu();
                          pinTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        Pin Tab
                      </MenuItem>
                    )}
                    {tab.isLocked ? (
                      <MenuItem
                        onClick={() => {
                          handleCloseMenu();
                          unlockTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        Unlock Tab
                      </MenuItem>
                    ) : (
                      <MenuItem
                        onClick={() => {
                          handleCloseMenu();
                          lockTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        Lock Tab
                      </MenuItem>
                    )}
                    <MenuItem
                      onClick={() => {
                        handleCloseMenu();
                        hideTab(memoTabId);
                        triggerFocus();
                      }}
                    >
                      Run in Background
                    </MenuItem>
                  </>
                )}
                <MenuItem
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
                  Find
                </MenuItem>
                {tab.panes.length > 1 && (
                  <MenuItem
                    onClick={() => {
                      handleCloseMenu();
                      closeTab();
                    }}
                  >
                    Close Tab
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    handleCloseMenu();
                    closeTabOrPane();
                  }}
                >
                  Close Pane/Tab
                </MenuItem>

                {tab.type !== "scratchpad" && (
                  <>
                    <MenuItem
                      onClick={() => {
                        handleCloseMenu();
                        cloneSession(memoTabId);
                      }}
                    >
                      Clone Session
                    </MenuItem>
                    {tab.panes.length < 4 && (
                      <MenuItem
                        onClick={() => {
                          handleCloseMenu();
                          cloneSession(memoTabId, true);
                        }}
                      >
                        Clone Session (Split Screen)
                      </MenuItem>
                    )}
                    {tab.panes.length === 1 && (
                      <MenuItem onClick={handleToggleFiles}>
                        {tab.showFiles ? "Close Files" : tab.panes[0]?.host === LOCAL_NAME ? "Open Files" : "Open SFTP"}
                      </MenuItem>
                    )}
                  </>
                )}
                {tab.type !== "scratchpad" && (
                  <>
                    <MenuItem
                      onClick={() => {
                        handleReconnectTab(memoTabId);
                        triggerFocus();
                      }}
                    >
                      Reconnect
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        handleCloseMenu();
                        renameTab(memoTabId);
                      }}
                    >
                      Rename Tab
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        handleCloseMenu();
                        openSaveTabToButtonDialog(memoTabId);
                      }}
                    >
                      Save Tab to Button
                    </MenuItem>
                  </>
                )}
                <MenuItem
                  onClick={() => {
                    handleCloseMenu();
                    closeOtherTabs(memoTabId);
                  }}
                >
                  Close Other Tabs
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    handleCloseMenu();
                    closeRightTabs(memoTabId);
                  }}
                >
                  Close Tabs to the Right
                </MenuItem>
                {tab.type === "scratchpad" && (
                  <MenuItem
                    onClick={() => {
                      fetch("/api/scratchpad/reload", { method: METHOD_POST, headers: apiReqHeaders() }).then(() => {
                        // csNotify("Reloading Scratchpad from disk...");
                      });
                      handleCloseMenu();
                    }}
                  >
                    Force sync
                  </MenuItem>
                )}
              </>
            );
          })()}
      </Menu>

      <Menu anchorEl={btnMenuAnchor?.anchor} open={Boolean(btnMenuAnchor)} onClose={() => setBtnMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (!btnMenuAnchor) {
              return;
            }
            const data = {
              id: "",
              name: btnMenuAnchor.btn.name,
              type: btnMenuAnchor.btn.type,
              payload: btnMenuAnchor.btn.payload,
              group: btnMenuAnchor.btn.group || DEFAULT_BUTTON_GROUP,
              autorun: btnMenuAnchor.btn.autorun || 0,
              order: btnMenuAnchor.btn.order || 0,
              shortcut: btnMenuAnchor.btn.shortcut || "",
              liquidjs: btnMenuAnchor.btn.liquidjs || 0,
            };
            setEditButton(btnMenuAnchor.btn);
            setButtonFormData(data);
            setInitialBtnFormData(data);
            setBtnMenuAnchor(null);
            setEditButtonDialogOpen(true);
          }}
        >
          Edit {lastMenuBtn ? `"${lastMenuBtn.name}"` : "Button"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (btnMenuAnchor) {
              setBtnMenuAnchor(null);
              openInputDialog({
                inputValue: btnMenuAnchor.btn.payload,
                inputLiquid: btnMenuAnchor.btn.liquidjs === 1 || btnMenuAnchor.btn.liquidjs === 2,
                sendScope: 0,
                appendNewLine: false,
              });
            }
          }}
          sx={{ display: lastMenuBtn?.type === "send_string" ? "flex" : "none" }}
        >
          Send
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (btnMenuAnchor) {
              setBtnMenuAnchor(null);
              openInputDialog({
                inputValue: btnMenuAnchor.btn.payload,
                inputLiquid: btnMenuAnchor.btn.liquidjs === 1 || btnMenuAnchor.btn.liquidjs === 2,
                sendScope: 2,
                appendNewLine: false,
              });
            }
          }}
          sx={{ display: lastMenuBtn?.type === "send_string" ? "flex" : "none" }}
        >
          Send To All
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (btnMenuAnchor) {
              const host = btnMenuAnchor.btn.payload;
              setBtnMenuAnchor(null);
              openHostInNewWindow(host);
            }
          }}
          sx={{
            display: lastMenuBtn?.type === "open_terminal" ? "flex" : "none",
          }}
        >
          Open (New Window)
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (btnMenuAnchor) {
              const hosts = btnMenuAnchor.btn.payload.split(/\s*,\s*/);
              setBtnMenuAnchor(null);
              for (const host of hosts) {
                openHost(host, { target: "_self" });
              }
            }
          }}
          sx={{
            display: lastMenuBtn?.type === "open_terminal" ? "flex" : "none",
          }}
        >
          Open (In Current Tab)
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (btnMenuAnchor) {
              setBtnMenuAnchor(null);
              navigator.clipboard.writeText(
                `${window.location.origin}/#${encodeURIComponent(btnMenuAnchor.btn.payload)}`,
              );
            }
          }}
          className="hide-desktop"
          sx={{
            display: lastMenuBtn?.type === "open_terminal" ? "flex" : "none",
          }}
        >
          Copy URL
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (btnMenuAnchor) {
              navigator.clipboard.writeText(btnMenuAnchor.btn.payload);
              setBtnMenuAnchor(null);
            }
          }}
          sx={{
            display:
              lastMenuBtn?.type === "send_string" ||
              lastMenuBtn?.type === "run_script" ||
              lastMenuBtn?.type === "open_terminal"
                ? "flex"
                : "none",
          }}
        >
          Copy Contents
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (btnMenuAnchor) {
              setBtnMenuAnchor(null);
              moveButton(btnMenuAnchor.btn.id, -1);
            }
          }}
        >
          Move Button Left
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (btnMenuAnchor) {
              setBtnMenuAnchor(null);
              moveButton(btnMenuAnchor.btn.id, 1);
            }
          }}
        >
          Move Button Right
        </MenuItem>
        <MenuItem
          onClick={() => btnMenuAnchor && deleteButton(btnMenuAnchor.btn.id, btnMenuAnchor.btn.name)}
          sx={{ color: "error.main" }}
        >
          Delete Button
        </MenuItem>
      </Menu>

      <Dialog
        id="edit-button-dialog"
        disableRestoreFocus
        data-id={editButton?.id || ""}
        open={editButtonDialogOpen}
        onClose={() => {
          if (buttonFormDirty) {
            return;
          }
          setEditButtonDialogOpen(false);
        }}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pr: 1.5 }}>
          <span>{editButton ? "Edit Button " + editButton.id : "Add Button"}</span>
          <IconButton
            aria-label="more"
            id="edit-button-dialog-title-menu-button"
            aria-controls={titleMenuAnchor ? "edit-button-dialog-title-menu" : undefined}
            aria-expanded={titleMenuAnchor ? "true" : undefined}
            aria-haspopup="true"
            onClick={handleTitleMenuClick}
            size="small"
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <Menu
          id="edit-button-dialog-title-menu"
          anchorEl={titleMenuAnchor}
          open={!!titleMenuAnchor}
          onClose={handleTitleMenuClose}
        >
          <MenuItem
            onClick={() => {
              handleTitleMenuClose();
              handleAddFromUrl();
            }}
            disabled={!!editButton}
          >
            Add From URL
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleTitleMenuClose();
              handleInstallPluginManager();
            }}
            disabled={!!editButton}
          >
            Add Plugin Manager
          </MenuItem>
        </Menu>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {importTip && (
            <Alert severity={importTip.severity} onClose={() => setImportTip(null)} sx={{ mb: 1 }}>
              {importTip.msg}
            </Alert>
          )}
          <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
            <TextField
              sx={{ flex: 2 }}
              label="Button Name"
              size="small"
              value={buttonFormData.name}
              onChange={(e) => setButtonFormData({ ...buttonFormData, name: e.target.value })}
            />
            <FreeTextField
              sx={{ flex: 1 }}
              size="small"
              label="Button Group"
              placeholder={DEFAULT_BUTTON_GROUP}
              options={groups}
              value={buttonFormData.group}
              onChange={(newValue) => setButtonFormData({ ...buttonFormData, group: newValue || "" })}
            />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <TextField
              select
              label="Button Type"
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
              slotProps={{ select: { native: true } }}
              sx={{ flexGrow: 1 }}
            >
              {buttonTypes.map((v) => (
                <option key={v[0]} value={v[0]}>
                  {v[1]}
                </option>
              ))}
            </TextField>
            <TextField
              label="Order"
              type="number"
              size="small"
              value={buttonFormData.order}
              onChange={(e) => setButtonFormData({ ...buttonFormData, order: parseInt(e.target.value) || 0 })}
              sx={{ width: 100 }}
            />
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <TextField
              label="Shortcut"
              type="search"
              size="small"
              value={buttonFormData.shortcut}
              onChange={(e) => setButtonFormData({ ...buttonFormData, shortcut: e.target.value })}
              placeholder="Press keys or input, e.g. 'ctrl+shift+m', modifiers in ctrl,alt,shift,meta order"
              onKeyDown={(e) => {
                if (e.ctrlKey || e.altKey || e.metaKey || (e.key.length > 1 && e.key !== "Shift")) {
                  e.preventDefault();
                  e.stopPropagation();
                  setButtonFormData({ ...buttonFormData, shortcut: getKeyCombination(e as unknown as KeyboardEvent) });
                }
              }}
              sx={{ flexGrow: 1 }}
            />
            <FormControlLabel
              title="Enable shortcut only if the button group is currently the active button group"
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
              label={<Typography variant="body2">Local shortcut</Typography>}
            />
            {(buttonFormData.type === "run_script" || buttonFormData.type === "open_terminal") && (
              <FormControlLabel
                title={`Automatically ${
                  buttonFormData.type === "run_script" ? "run this script" : "open this terminal"
                } when the page loads`}
                sx={{ flexShrink: 0, mr: 0, ml: 0, whiteSpace: "nowrap" }}
                control={
                  <Checkbox
                    checked={buttonFormData.autorun === 1}
                    onChange={(e) => setButtonFormData({ ...buttonFormData, autorun: e.target.checked ? 1 : 0 })}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Autorun</Typography>}
              />
            )}
            {buttonFormData.type === "send_string" && (
              <FormControlLabel
                title="Treat payload as LiquidJS template and enable Liquid highlight extension"
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
                    placeholder="LiquidJS template"
                    height="200px"
                    theme="light"
                    extensions={[liquid(), EditorView.lineWrapping]}
                    onChange={(value) => setButtonFormData({ ...buttonFormData, payload: value })}
                    style={{ fontSize: "12px" }}
                  />
                </Box>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8 }}>
                  <b>Available System Variables</b>:&nbsp;
                  <Chip color="success" label="shellIntegration" />
                  <Chip color="success" label="vars" />
                  <Chip color="success" label="localVars" />
                </Box>
                {editButtonVars.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8 }}>
                    <b>Detected Custom Variables:</b>
                    {editButtonVars.map((v) => (
                      <Chip color="secondary" label={v} />
                    ))}
                  </Box>
                )}
              </Box>
            ) : (
              <TextField
                fullWidth
                label="Command / String"
                size="small"
                multiline
                rows={3}
                value={buttonFormData.payload}
                onChange={(e) => setButtonFormData({ ...buttonFormData, payload: e.target.value })}
                placeholder="String to send to terminal, <ctrl-x> style syntax supported"
              />
            )
          ) : buttonFormData.type === "terminal_function" ? (
            <TextField
              select
              fullWidth
              label="Function"
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
              label="Action"
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
                label="Server / Address"
                size="small"
                placeholder="e.g. local, production-db, root@192.168.1.1"
                options={[LOCAL_NAME, ...hosts.map((h) => h.name)]}
                value={buttonFormData.payload}
                onChange={(newValue) => {
                  setButtonFormData({ ...buttonFormData, payload: newValue || "" });
                }}
              />
              <Typography variant="body2" color="text.secondary">
                Server name or <b>[username[:password]@]hostname[:port]</b>. Use <b>{LOCAL_NAME}</b> for local shell.
                <br />
                Append <b>?id=abc&title=Local</b> style query string to set optional session-scope parameters (URL
                Encoded):
                <br />- <b>id</b> : The terminal pane id. If the same id pane exists, switch to it instead of opening a
                new one
                <br />- <b>title</b> : The opened tab title
                <br />- <b>remoteCommand</b> : Remote shell command to execute on connected
                <br />- <b>proxyJump</b> : Proxy jump server
                <br />- <b>target</b> : The tab id. If the same id tab exists, the new terminal will be opened in the
                target tab, use <code>_self</code> for current tab
                <br />- <b>exec</b> : Only valid for <code>{LOCAL_NAME}</code> host. If set to <code>1</code>, it
                treats&nbsp;
                <code>remoteCommand</code> as a single program with args and execute it directly instead of executing it
                using system shell.
                <br />- <b>localForward</b> & <b>remoteForward</b> & <b>dynamicForward</b> : OpenSSH syntax SSH tunnel
                rules. Use&nbsp;
                <code>%0A</code> (\n) to seperate multiple rules.
                <br />- <b>env</b>: Environment variables to send to SSH server. Format: <code>name=value</code>.&nbsp;
                Use&nbsp;
                <code>%0A</code> (\n) to seperate multiple variables.
                <br />- <b>state</b>: Set the initial state of the opened terminal session: 0=normal, 1=pinned,
                2=locked, 3=hidden.
                <br /> E.g. <b>local?id=local-abc&title=Local&remoteCommand=tmux attach || tmux new</b>
                <br /> It's possible to set multiple (up to 4) comma-separated servers to open them in split screen.
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
                <Typography variant="caption" color="text.secondary">
                  Check{" "}
                  <a
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#1976d2" }}
                    href="https://github.com/sagan/cozyssh/blob/master/docs/SCRIPTS.md"
                  >
                    help
                  </a>{" "}
                  about scripts.
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
          <Button onClick={() => setEditButtonDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={saveButton}
            disabled={!buttonFormData.name || !buttonFormData.payload || (!!editButton && !buttonFormDirty)}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        id="input-dialog"
        open={inputDialogOpen}
        onClose={() => handleCloseInputDialog(false)}
        disableRestoreFocus
        fullWidth
        maxWidth={inputLiquid ? "md" : "sm"}
      >
        <DialogTitle>Terminal Input</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {!inputLiquid ? (
            <TextField
              fullWidth
              multiline
              rows={6}
              variant="outlined"
              id={ID_INPUT_DIALOG_INPUT}
              placeholder={
                "Type input to send to terminal. <ctrl-x> style syntax supported. Ctrl + Enter to send; Ctrl + Shift + Enter to send to all tabs" +
                (activeTab && activeTab.panes.length > 1 ? " or Ctrl + Alt + Enter to send to all panes" : "")
              }
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputDialogDirty(true);
              }}
              onKeyDown={(e) => {
                const key = getKeyCombination(e as unknown as KeyboardEvent);
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
                    Template
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ py: 0, px: 1, minWidth: 0, fontSize: "typography.caption.fontSize", textTransform: "none" }}
                    onClick={() => navigator.clipboard.writeText(inputValue)}
                  >
                    Copy
                  </Button>
                </Box>
                <TextField
                  fullWidth
                  multiline
                  rows={6}
                  variant="outlined"
                  id={ID_INPUT_DIALOG_INPUT}
                  placeholder={
                    "Type template/input to send to terminal. Ctrl + Enter to send; Ctrl + Shift + Enter to send to all tabs" +
                    (activeTab && activeTab.panes.length > 1 ? " or Ctrl + Alt + Enter to send to all panes" : "")
                  }
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setInputDialogDirty(true);
                  }}
                  onKeyDown={(e) => {
                    const key = getKeyCombination(e as unknown as KeyboardEvent);
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
                  System Variables
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8 }}>
                  <Chip color="success" label="shellIntegration" />
                  <Chip color="success" label="vars" />
                  <Chip color="success" label="localVars" />
                </Box>
              </Box>
              <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Variables
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
                    <TextField
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
                          ? "Ctrl + Enter to send; +Alt/Shift for all panes/tabs"
                          : "Ctrl + Enter to send; +Shift for all tabs"
                      }
                      onKeyDown={(e) => {
                        const key = getKeyCombination(e as unknown as KeyboardEvent);
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
                      No variables to display
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Rendered Preview
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
                      Copy
                    </Button>
                  </Box>
                  <TextField
                    fullWidth
                    multiline
                    rows={6}
                    variant="outlined"
                    slotProps={{
                      input: {
                        readOnly: true,
                        sx: { fontFamily: "monospace", fontSize: "typography.body2.fontSize" },
                      },
                    }}
                    value={renderedPreview}
                    sx={{ bgcolor: "action.hover" }}
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
              label={<Typography variant="body2">Append new line (\n)</Typography>}
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
                label={<Typography variant="body2">Send to all panes</Typography>}
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
              label={<Typography variant="body2">Send to all</Typography>}
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
          <Button onClick={() => handleCloseInputDialog(true)}>Cancel</Button>
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
            Send
          </Button>
        </DialogActions>
      </Dialog>

      <NewTabDialog
        isMobile={isMobile}
        isTouch={isTouch}
        key={newTabDialogOpen ? "open" : "closed"}
        open={newTabDialogOpen}
        onClose={closeNewTabDialog}
        onExecuteButton={handleButtonClick}
        onSelectTab={(tabId) => {
          setActiveTabId(tabId);
          const t = tabs.find((x) => x.id === tabId);
          if (t) {
            setActivePaneId(t.activePaneId);
            triggerFocus();
          }
        }}
        onAttachPinned={(id, host, title, isLocked) => {
          attachSession(id, host, title, isLocked);
          closeNewTabDialog();
        }}
        onSelect={async (host, alternativeMode = 0) => {
          const [hostname, query] = cutString(host, "?");
          // Check if it's a direct connection and not in known hosts
          const parsedHost = parseHostName(hostname);
          const parsedHostString = getCanonicalHostString(parsedHost);
          let known: HostData | undefined;
          if (parsedHost.hostname !== LOCAL_NAME) {
            known = hosts.find((h) => h.name === parsedHost.hostname || getCanonicalHostString(h) === parsedHostString);
            if (!known) {
              // Automatically add to ~/.ssh/config
              try {
                await fetch("/api/hosts", {
                  method: METHOD_POST,
                  headers: apiReqHeaders(),
                  body: JSON.stringify({
                    user: "",
                    port: "22",
                    name: parsedHost.hostname,
                    ...parsedHost,
                    password: undefined, // don't save password from direct connect string
                  } satisfies HostData),
                });
                refreshData({ sync: 2 });
              } catch (e) {
                console.error("Failed to auto-add host:", e);
              }
            }
          }
          const hostStr = (known?.name || cutSuffix(parsedHostString, ":22")[0]) + (query ? "?" + query : "");
          if (alternativeMode === 3) {
            openHostInNewWindow(hostStr);
          } else if (alternativeMode === 2) {
            if (known) {
              openEditHost(known);
            } else {
              openAddHostForm(parsedHost);
            }
          } else {
            openHost(hostStr, { target: alternativeMode ? "_self" : undefined });
          }
        }}
      />
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
