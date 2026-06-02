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
  Autocomplete,
  Menu,
  MenuItem,
  Alert,
  IconButton,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";

import type { HostData, ButtonData } from "./api";
import {
  BROWSER_STORAGE_KEY_TOKEN,
  DEFAULT_BUTTON_GROUP,
  HEADER_AUTHORIZATION,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  HEADER_CONTENT_TYPE,
  LOCAL_NAME,
  METHOD_POST,
  MIME_JSON,
  MISC_FUNCTIONS,
  TERMINAL_FUNCTIONS,
} from "./constants";
import {
  type Recent,
  type Toast,
  type ContextMenu,
  type NewTabDialogViewMode,
  type ToastData,
  getKeyCombination,
  ButtonDataSchema,
  generatePassword,
  removePassFromHost,
} from "./common";
import { type TabData, setActivePaneId, setActiveTabId, triggerFocus, useStore } from "./store";
import NewTabDialog from "./NewTabDialog";
import { dialogs } from "./Dialogs";

export interface DialogManagerProps {
  activeGroup: string;
  setEditingButton: React.Dispatch<React.SetStateAction<ButtonData | null>>;
  setInitialBtnFormData: React.Dispatch<React.SetStateAction<ButtonData | null>>;
  setButtonDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setInputDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  contextMenu: ContextMenu | null;
  handleCloseMenu: () => void;
  memoTabId: string | null;
  handleUnpinTab: (id: string) => void;
  handlePinTab: (id: string) => void;
  handleUnlockTab: (id: string) => void;
  handleLockTab: (id: string) => void;
  handleCloneSession: (id: string) => void;
  handleToggleFiles: () => void;
  handleReconnectTab: (id: string) => void;
  handleRename: () => void;
  handleCloseOther: () => void;
  handleCloseRight: () => void;
  btnMenuAnchor: { anchor: HTMLElement; btn: ButtonData } | null;
  setBtnMenuAnchor: (v: { anchor: HTMLElement; btn: ButtonData } | null) => void;
  lastMenuBtn: ButtonData | null;
  handleMoveButton: (id: string, dir: number) => void;
  handleDeleteButton: (id: string, name: string) => void;
  buttonDialogOpen: boolean;
  editingButton: ButtonData | null;
  buttonFormData: ButtonData;
  setButtonFormData: (v: ButtonData) => void;
  handleCloseBtnDialog: (e: unknown, reason: string) => void;
  handleSaveButton: () => void;
  hosts: HostData[];
  groups: string[];
  inputDialogOpen: boolean;
  handleCloseInputDialog: () => void;
  inputValue: string;
  setInputValue: (v: string) => void;
  appendNewLine: boolean;
  setAppendNewLine: (v: boolean) => void;
  sendScope: number;
  setSendScope: React.Dispatch<React.SetStateAction<0 | 1 | 2>>;
  sendParsedString: (s: string) => void;
  newTabDialogOpen: boolean;
  setNewTabDialogOpen: (v: boolean) => void;
  recents: Recent[];
  newTabDialogInitialViewMode: NewTabDialogViewMode;
  handleAttach: (id: string, host: string, title: string, isLocked: boolean) => void;
  handleRefresh: () => void;
  handleSelectHost: (h: string) => void;
  toasts: Toast[];
  setToasts: React.Dispatch<React.SetStateAction<Toast[]>>;
  handleButtonClick: (btn: Pick<ButtonData, "id" | "name" | "type" | "payload">) => Promise<void>;
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
  contextMenu,
  handleCloseMenu,
  memoTabId,
  handleUnpinTab,
  handlePinTab,
  handleUnlockTab,
  handleLockTab,
  handleCloneSession,
  handleToggleFiles,
  handleReconnectTab,
  handleRename,
  handleCloseOther,
  handleCloseRight,
  btnMenuAnchor,
  setBtnMenuAnchor,
  lastMenuBtn,
  handleButtonClick,
  handleMoveButton,
  handleDeleteButton,
  buttonDialogOpen,
  editingButton,
  buttonFormData,
  setButtonFormData,
  handleCloseBtnDialog,
  handleSaveButton,
  hosts,
  groups,
  inputDialogOpen,
  handleCloseInputDialog,
  inputValue,
  setInputValue,
  appendNewLine,
  setAppendNewLine,
  sendScope,
  setSendScope,
  sendParsedString,
  newTabDialogOpen,
  setNewTabDialogOpen,
  recents,
  newTabDialogInitialViewMode,
  handleAttach,
  handleRefresh,
  handleSelectHost,
  toasts,
  setToasts,
  setEditingButton,
  setInitialBtnFormData,
  setButtonDialogOpen,
  setInputDialogOpen,
  activeGroup,
}: DialogManagerProps) {
  const { tabs, activeTabId, buttons } = useStore();

  const [titleMenuAnchor, setTitleMenuAnchor] = useState<null | HTMLElement>(null);
  const [importTip, setImportTip] = useState<ToastData | null>(null);

  const titleMenuOpen = Boolean(titleMenuAnchor);

  const activeTab: TabData | undefined = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId);
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (!buttonDialogOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImportTip(null);
    }
  }, [buttonDialogOpen]);

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
            id: validatedData.id || generatePassword(12),
            name: validatedData.name,
            type: validatedData.type,
            payload: validatedData.payload,
            group: validatedData.group || buttonFormData.group || DEFAULT_BUTTON_GROUP,
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
            id: buttonId || generatePassword(12),
            name: buttonName,
            type: "run_script",
            payload: text,
            group: group || buttonFormData.group || DEFAULT_BUTTON_GROUP,
            autorun: 0,
            order: buttonFormData.order || 0,
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
    [buttonFormData.group, buttonFormData.order, buttons, setButtonFormData],
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
                {tab.type !== "scratchpad" && (
                  <>
                    {tab.isPinned ? (
                      <MenuItem
                        onClick={() => {
                          handleUnpinTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        Unpin tab
                      </MenuItem>
                    ) : tab.panes.length === 1 ? (
                      <MenuItem
                        onClick={() => {
                          handlePinTab(memoTabId);
                          triggerFocus();
                        }}
                      >
                        Pin tab
                      </MenuItem>
                    ) : null}
                    {tab.isPinned &&
                      (tab.isLocked ? (
                        <MenuItem
                          onClick={() => {
                            handleUnlockTab(memoTabId);
                            triggerFocus();
                          }}
                        >
                          Unlock tab
                        </MenuItem>
                      ) : (
                        <MenuItem
                          onClick={() => {
                            handleLockTab(memoTabId);
                            triggerFocus();
                          }}
                        >
                          Lock tab
                        </MenuItem>
                      ))}
                  </>
                )}
                {tab.panes.length === 1 && tab.type !== "scratchpad" && (
                  <>
                    <MenuItem onClick={() => handleCloneSession(memoTabId)}>Clone session</MenuItem>
                    <MenuItem onClick={handleToggleFiles}>
                      {tab.showFiles ? "Close files" : tab.panes[0]?.host === LOCAL_NAME ? "Open files" : "Open SFTP"}
                    </MenuItem>
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
                    <MenuItem onClick={handleRename}>Rename tab</MenuItem>
                  </>
                )}
                <MenuItem onClick={handleCloseOther}>Close other tabs</MenuItem>
                <MenuItem onClick={handleCloseRight}>Close tabs to the right</MenuItem>
                {tab.type === "scratchpad" && (
                  <MenuItem
                    onClick={() => {
                      fetch("/api/scratchpad/reload", {
                        method: METHOD_POST,
                        headers: {
                          [HEADER_AUTHORIZATION]:
                            HEADER_AUTHORIZATION_BEARER_PREFIX + localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN),
                        },
                      }).then(() => {
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
            };
            setEditingButton(btnMenuAnchor.btn);
            setButtonFormData(data);
            setInitialBtnFormData(data);
            setBtnMenuAnchor(null);
            setButtonDialogOpen(true);
          }}
        >
          Edit Button
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (btnMenuAnchor) {
              setInputValue(btnMenuAnchor.btn.payload);
              setSendScope(2);
              setAppendNewLine(false);
              setInputDialogOpen(true);
              setBtnMenuAnchor(null);
            }
          }}
          sx={{ display: lastMenuBtn?.type === "send_string" ? "flex" : "none" }}
        >
          Send To All
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
        <MenuItem onClick={() => btnMenuAnchor && handleMoveButton(btnMenuAnchor.btn.id, -1)}>
          Move Button Left
        </MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleMoveButton(btnMenuAnchor.btn.id, 1)}>
          Move Button Right
        </MenuItem>
        <MenuItem
          onClick={() => btnMenuAnchor && handleDeleteButton(btnMenuAnchor.btn.id, btnMenuAnchor.btn.name)}
          sx={{ color: "error.main" }}
        >
          Delete Button
        </MenuItem>
      </Menu>

      <Dialog
        id="edit-button-dialog"
        disableRestoreFocus
        data-id={editingButton?.id || ""}
        open={buttonDialogOpen}
        onClose={handleCloseBtnDialog}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pr: 1.5 }}>
          <span>{editingButton ? "Edit Button " + editingButton.id : "Add Button"}</span>
          <IconButton
            aria-label="more"
            id="title-menu-button"
            aria-controls={titleMenuOpen ? "title-menu" : undefined}
            aria-expanded={titleMenuOpen ? "true" : undefined}
            aria-haspopup="true"
            onClick={handleTitleMenuClick}
            size="small"
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <Menu id="title-menu" anchorEl={titleMenuAnchor} open={titleMenuOpen} onClose={handleTitleMenuClose}>
          <MenuItem
            onClick={() => {
              handleTitleMenuClose();
              handleAddFromUrl();
            }}
            disabled={!!editingButton}
          >
            Add From URL
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleTitleMenuClose();
              handleInstallPluginManager();
            }}
            disabled={!!editingButton}
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
              fullWidth
              label="Button Name"
              size="small"
              value={buttonFormData.name}
              onChange={(e) => setButtonFormData({ ...buttonFormData, name: e.target.value })}
            />
            <Autocomplete
              size="small"
              freeSolo
              fullWidth
              options={groups}
              value={buttonFormData.group}
              onChange={(_e, newValue) => setButtonFormData({ ...buttonFormData, group: newValue || "" })}
              onInputChange={(_e, newValue) => setButtonFormData({ ...buttonFormData, group: newValue || "" })}
              renderInput={(params) => (
                <TextField {...params} label="Button Group" placeholder={DEFAULT_BUTTON_GROUP} />
              )}
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
          </Box>

          {buttonFormData.type === "send_string" ? (
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
              <Autocomplete
                freeSolo
                options={[LOCAL_NAME, ...hosts.map((h) => h.name)]}
                value={buttonFormData.payload}
                onChange={(_event, newValue) => {
                  setButtonFormData({ ...buttonFormData, payload: newValue || "" });
                }}
                onInputChange={(_event, newInputValue) => {
                  setButtonFormData({ ...buttonFormData, payload: newInputValue || "" });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    fullWidth
                    label="Server / Address"
                    size="small"
                    placeholder="e.g. local, production-db, root@192.168.1.1"
                  />
                )}
              />
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                Server name or <b>[username[:password]@]hostname[:port]</b>. Use <b>{LOCAL_NAME}</b> for local shell.
                <br />
                Append <b>?id=abc&title=Local</b> style query string to set optional session-scope parameters:
                <br />- <b>id</b> : The terminal pane id. If the same id pane exists, switch to it instead of opening a
                new one
                <br />- <b>title</b> : The opened tab title
                <br />- <b>remoteCommand</b> : Remote shell command to execute on connected
                <br />- <b>target</b> : The tab id. If the same id tab exists, the new terminal will be opened in the
                target tab
                <br />
                E.g. <b>local?id=local-abc&title=Local&remoteCommand=tmux attach || tmux new</b>
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
          <Button onClick={() => setButtonDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveButton}
            disabled={!buttonFormData.name || !buttonFormData.payload}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={inputDialogOpen} onClose={handleCloseInputDialog} disableRestoreFocus fullWidth maxWidth="sm">
        <DialogTitle>Terminal Input</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <TextField
            fullWidth
            multiline
            rows={6}
            variant="outlined"
            placeholder="Type input to send to terminal. Press Enter to send, Shift + Enter for new line. <ctrl-x> style syntax supported."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (inputValue) {
                  const data = appendNewLine ? inputValue + "\n" : inputValue;
                  sendParsedString(data);
                }
                handleCloseInputDialog();
              }
            }}
            autoFocus
          />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1 }}>
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
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseInputDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (inputValue) {
                const data = appendNewLine ? inputValue + "\n" : inputValue;
                sendParsedString(data);
              }
              handleCloseInputDialog();
            }}
          >
            Send
          </Button>
        </DialogActions>
      </Dialog>

      <NewTabDialog
        key={newTabDialogOpen ? "open" : "closed"}
        open={newTabDialogOpen}
        onClose={() => {
          setNewTabDialogOpen(false);
          triggerFocus();
        }}
        hosts={hosts}
        recents={recents}
        tabs={tabs}
        initialViewMode={newTabDialogInitialViewMode}
        buttons={buttons}
        activeGroup={activeGroup}
        onExecuteButton={(btn) => {
          handleButtonClick(btn);
          setNewTabDialogOpen(false);
        }}
        onSelectTab={(tabId) => {
          setActiveTabId(tabId);
          const t = tabs.find((x) => x.id === tabId);
          if (t) {
            setActivePaneId(t.activePaneId);
            triggerFocus();
          }
        }}
        onAttachPinned={(id, host, title, isLocked) => {
          handleAttach(id, host, title, isLocked);
          setNewTabDialogOpen(false);
        }}
        onSelect={async (host) => {
          host = removePassFromHost(host);
          // Check if it's a direct connection and not in known hosts
          if (host.includes(".") || host.includes(":") || host === "localhost") {
            const known = hosts.find((h) => h.name === host || h.hostname === host);
            if (!known) {
              // Automatically add to ~/.ssh/config
              const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
              let user = "root";
              let hostname = host;
              const i = host.lastIndexOf("@");
              if (i !== -1) {
                user = host.slice(0, i);
                hostname = host.slice(i + 1);
              }
              try {
                await fetch("/api/hosts", {
                  method: METHOD_POST,
                  headers: {
                    [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
                    [HEADER_CONTENT_TYPE]: MIME_JSON,
                  },
                  body: JSON.stringify({
                    name: host,
                    hostname: hostname,
                    user: user,
                    port: "22",
                  } satisfies HostData),
                });
                handleRefresh(); // Refresh hosts list
              } catch (e) {
                console.error("Failed to auto-add host:", e);
              }
            }
          }
          handleSelectHost(host);
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
            key={t.id}
            severity={t.severity}
            data-severity={t.severity}
            data-msg={t.msg}
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
