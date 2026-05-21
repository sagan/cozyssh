// import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Box, Typography, Button, FormControlLabel, Checkbox, Autocomplete, Menu, MenuItem, Alert } from '@mui/material';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from "@codemirror/view";
import { javascript } from '@codemirror/lang-javascript';
import NewTabDialog from './NewTabDialog';
import { getKeyCombination } from './common';
import { TERMINAL_FUNCTIONS } from './constants';

import { useDashboardStore } from './dashboardStore';

export interface DialogManagerProps {
  activeGroup: string;
  setEditingButton: any;
  setInitialBtnFormData: any;
  setButtonDialogOpen: any;
  setInputDialogOpen: any;
  contextMenu: any;
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
  btnMenuAnchor: any;
  setBtnMenuAnchor: (v: any) => void;
  lastMenuBtn: any;
  handleMoveButton: (id: string, dir: number) => void;
  handleDeleteButton: (id: string, name: string) => void;
  buttonDialogOpen: boolean;
  editingButton: any;
  buttonFormData: any;
  setButtonFormData: (v: any) => void;
  handleCloseBtnDialog: (e: any, reason: string) => void;
  handleSaveButton: () => void;
  MISC_FUNCTIONS: any[];
  hosts: any[];
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
  recents: any[];
  newTabDialogInitialViewMode: "servers" | "tabs" | "buttons" | undefined;
  handleAttach: (id: string, host: string, title: string, isLocked: boolean) => void;
  handleRefresh: () => void;
  handleSelectHost: (h: string) => void;
  terminalRefs: any;
  toasts: any[];
  setToasts: (v: any) => void;
  handleButtonClick: (b: any) => void;
}


export default function DialogManager({
  contextMenu, handleCloseMenu, memoTabId, handleUnpinTab, handlePinTab, handleUnlockTab, handleLockTab,
  handleCloneSession, handleToggleFiles, handleReconnectTab, handleRename, handleCloseOther, handleCloseRight,
  btnMenuAnchor, setBtnMenuAnchor, lastMenuBtn, handleButtonClick, handleMoveButton, handleDeleteButton,
  buttonDialogOpen, editingButton, buttonFormData, setButtonFormData, handleCloseBtnDialog, handleSaveButton,
  MISC_FUNCTIONS, hosts, inputDialogOpen, handleCloseInputDialog, inputValue, setInputValue,
  appendNewLine, setAppendNewLine, sendScope, setSendScope, sendParsedString,
  newTabDialogOpen, setNewTabDialogOpen, recents, newTabDialogInitialViewMode,
  handleAttach, handleRefresh, handleSelectHost, terminalRefs, toasts, setToasts, setEditingButton, setInitialBtnFormData, setButtonDialogOpen, setInputDialogOpen, activeGroup
}: DialogManagerProps) {
  const { tabs, activeTabId, setActiveTabId, buttons, setActivePaneId } = useDashboardStore();

  return (
    <>
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        {memoTabId && (() => {
          const tab = tabs.find(t => t.id === memoTabId);
          if (!tab) return null;
          return (
            <>
              {tab.type !== 'scratchpad' && (
                <>
                  {tab.isPinned ? (
                    <MenuItem onClick={() => handleUnpinTab(memoTabId)}>Unpin tab</MenuItem>
                  ) : tab.panes.length === 1 ? (
                    <MenuItem onClick={() => handlePinTab(memoTabId)}>Pin tab</MenuItem>
                  ) : null}
                  {tab.isPinned && (
                    tab.isLocked ? (
                      <MenuItem onClick={() => handleUnlockTab(memoTabId)}>Unlock tab</MenuItem>
                    ) : (
                      <MenuItem onClick={() => handleLockTab(memoTabId)}>Lock tab</MenuItem>
                    )
                  )}
                </>
              )}
              {tab.panes.length === 1 && tab.type !== 'scratchpad' && (
                <>
                  <MenuItem onClick={() => handleCloneSession(memoTabId)}>Clone session</MenuItem>
                  <MenuItem onClick={handleToggleFiles}>
                    {tab.showFiles ? 'Close files' : (tab.panes[0]?.host === 'local' ? 'Open files' : 'Open SFTP')}
                  </MenuItem>
                </>
              )}
              {tab.type !== 'scratchpad' && (
                <>
                  <MenuItem onClick={() => handleReconnectTab(memoTabId)}>Reconnect</MenuItem>
                  <MenuItem onClick={handleRename}>Rename tab</MenuItem>
                </>
              )}
              <MenuItem onClick={handleCloseOther}>Close other tabs</MenuItem>
              <MenuItem onClick={handleCloseRight}>Close tabs to the right</MenuItem>
              {tab.type === 'scratchpad' && (
                <MenuItem onClick={() => {
                  fetch('/api/scratchpad/reload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('cozy_token')}` }
                  }).then(() => {
                    // csNotify("Reloading Scratchpad from disk...");
                  });
                  handleCloseMenu();
                }}>Force sync</MenuItem>
              )}
            </>
          );
        })()}
      </Menu>

      <Menu
        anchorEl={btnMenuAnchor?.anchor}
        open={Boolean(btnMenuAnchor)}
        onClose={() => setBtnMenuAnchor(null)}
      >
        <MenuItem onClick={() => {
          if (!btnMenuAnchor) return;
          const data = {
            name: btnMenuAnchor.btn.name,
            type: btnMenuAnchor.btn.type,
            payload: btnMenuAnchor.btn.payload,
            group: btnMenuAnchor.btn.group || 'Default',
            autorun: btnMenuAnchor.btn.autorun || 0,
            order: btnMenuAnchor.btn.order || 0,
            shortcut: btnMenuAnchor.btn.shortcut || ''
          };
          setEditingButton(btnMenuAnchor.btn);
          setButtonFormData(data);
          setInitialBtnFormData(data);
          setBtnMenuAnchor(null);
          setButtonDialogOpen(true);
        }}>Edit Button</MenuItem>
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
          sx={{ display: lastMenuBtn?.type === 'send_string' ? 'flex' : 'none' }}
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
          sx={{ display: lastMenuBtn?.type === 'send_string' || lastMenuBtn?.type === 'run_script' ? 'flex' : 'none' }}
        >
          Copy Contents
        </MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleMoveButton(btnMenuAnchor.btn.id, -1)}>Move Button Left</MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleMoveButton(btnMenuAnchor.btn.id, 1)}>Move Button Right</MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleDeleteButton(btnMenuAnchor.btn.id, btnMenuAnchor.btn.name)} sx={{ color: 'error.main' }}>Delete Button</MenuItem>
      </Menu>

      <Dialog open={buttonDialogOpen} onClose={handleCloseBtnDialog} fullWidth maxWidth="lg">
        <DialogTitle>{editingButton ? 'Edit Button' : 'Add Button'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <TextField fullWidth label="Button Name" size="small" value={buttonFormData.name} onChange={e => setButtonFormData({ ...buttonFormData, name: e.target.value })} />
            <TextField fullWidth label="Button Group" size="small" value={buttonFormData.group} onChange={e => setButtonFormData({ ...buttonFormData, group: e.target.value })} placeholder="Default" />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              select
              label="Button Type"
              size="small"
              value={buttonFormData.type}
              onChange={e => setButtonFormData({
                ...buttonFormData,
                type: e.target.value,
                payload: e.target.value === 'terminal_function' ? 'COPY'
                  : e.target.value === 'misc' ? 'NEXT_BUTTON_GROUP'
                    : e.target.value === 'open_terminal' ? 'local'
                      : ''
              })}
              slotProps={{ select: { native: true } }}
              sx={{ flexGrow: 1 }}
            >
              <option value="send_string">Send String</option>
              <option value="terminal_function">Terminal Function</option>
              <option value="misc">Misc</option>
              <option value="open_terminal">Open Terminal</option>
              <option value="run_script">Run Script</option>
            </TextField>
            <TextField
              label="Order"
              type="number"
              size="small"
              value={buttonFormData.order}
              onChange={e => setButtonFormData({ ...buttonFormData, order: parseInt(e.target.value) || 0 })}
              sx={{ width: 100 }}
            />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              label="Shortcut"
              type="search"
              size="small"
              value={buttonFormData.shortcut}
              onChange={e => setButtonFormData({ ...buttonFormData, shortcut: e.target.value })}
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
            {buttonFormData.type === 'run_script' && (
              <FormControlLabel
                title="Automatically run this script when the page loads"
                sx={{ flexShrink: 0, mr: 0, ml: 0, whiteSpace: 'nowrap' }}
                control={
                  <Checkbox
                    checked={buttonFormData.autorun === 1}
                    onChange={e => setButtonFormData({ ...buttonFormData, autorun: e.target.checked ? 1 : 0 })}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Autorun</Typography>}
              />
            )}
          </Box>

          {buttonFormData.type === 'send_string' ? (
            <TextField
              fullWidth
              label="Command / String"
              size="small"
              multiline
              rows={3}
              value={buttonFormData.payload}
              onChange={e => setButtonFormData({ ...buttonFormData, payload: e.target.value })}
              placeholder="String to send to terminal, <ctrl-x> style syntax supported"
            />
          ) : buttonFormData.type === 'terminal_function' ? (
            <TextField
              select
              fullWidth
              label="Function"
              size="small"
              value={buttonFormData.payload}
              onChange={e => setButtonFormData({ ...buttonFormData, payload: e.target.value })}
              slotProps={{ select: { native: true } }}
            >
              {TERMINAL_FUNCTIONS.map((f: any) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </TextField>
          ) : buttonFormData.type === 'misc' ? (
            <TextField
              select
              fullWidth
              label="Action"
              size="small"
              value={buttonFormData.payload}
              onChange={e => setButtonFormData({ ...buttonFormData, payload: e.target.value })}
              slotProps={{ select: { native: true } }}
            >
              {MISC_FUNCTIONS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </TextField>
          ) : buttonFormData.type === 'open_terminal' ? (
            <Autocomplete
              freeSolo
              options={['local', ...hosts.map(h => h.name)]}
              value={buttonFormData.payload}
              onChange={(_event, newValue) => {
                setButtonFormData({ ...buttonFormData, payload: newValue || '' });
              }}
              onInputChange={(_event, newInputValue) => {
                setButtonFormData({ ...buttonFormData, payload: newInputValue || '' });
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
          ) : (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ px: 1.5, py: 0.5, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">
                  Check <a target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2' }} href="https://github.com/sagan/cozyssh/blob/master/docs/SCRIPTS.md">help</a> about scripts.
                </Typography>
              </Box>
              <CodeMirror
                value={buttonFormData.payload}
                height="200px"
                theme="light"
                extensions={[javascript({ typescript: true }), EditorView.lineWrapping]}
                onChange={(value) => setButtonFormData({ ...buttonFormData, payload: value })}
                style={{ fontSize: '12px' }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setButtonDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveButton} disabled={!buttonFormData.name || !buttonFormData.payload}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={inputDialogOpen} onClose={handleCloseInputDialog} fullWidth maxWidth="sm">
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
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (inputValue) {
                  const data = appendNewLine ? inputValue + '\n' : inputValue;
                  sendParsedString(data);
                }
                handleCloseInputDialog();
              }
            }}
            autoFocus
          />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
            <FormControlLabel
              control={<Checkbox checked={appendNewLine} onChange={(e) => setAppendNewLine(e.target.checked)} size="small" />}
              label={<Typography variant="body2">Append new line (\n)</Typography>}
            />
            {tabs.find(t => t.id === activeTabId)?.panes.length! > 1 && (
              <FormControlLabel
                control={<Checkbox checked={sendScope === 1} onChange={(e) => setSendScope(e.target.checked ? 1 : 0)} size="small" />}
                label={<Typography variant="body2">Send to all panes</Typography>}
              />
            )}
            <FormControlLabel
              control={<Checkbox checked={sendScope === 2} onChange={(e) => setSendScope(e.target.checked ? 2 : 0)} size="small" />}
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
                const data = appendNewLine ? inputValue + '\n' : inputValue;
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
        open={newTabDialogOpen}
        onClose={() => {
          setNewTabDialogOpen(false);
          setTimeout(() => (window as any).csFocus?.(), 0);
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
          const t = tabs.find(x => x.id === tabId);
          if (t) {
            setActivePaneId(t.activePaneId);
            setTimeout(() => terminalRefs.current[t.activePaneId]?.focus(), 50);
          }
        }}
        onAttachPinned={(id, host, title, isLocked) => { handleAttach(id, host, title, isLocked); setNewTabDialogOpen(false); }}
        onSelect={async (host) => {
          // Check if it's a direct connection and not in known hosts
          if (host.includes('.') || host.includes(':') || host === 'localhost') {
            const known = hosts.find(h => h.name === host || h.hostname === host);
            if (!known) {
              // Automatically add to ~/.ssh/config
              const token = localStorage.getItem('cozy_token');
              let user = 'root';
              let hostname = host;
              if (host.includes('@')) {
                const parts = host.split('@');
                user = parts[0];
                hostname = parts[1];
              }
              try {
                await fetch('/api/hosts', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    alias: host,
                    hostname: hostname,
                    user: user,
                    port: '22'
                  })
                });
                handleRefresh(); // Refresh hosts list
              } catch (e) {
                console.error('Failed to auto-add host:', e);
              }
            }
          }
          handleSelectHost(host);
        }}
      />

      <Box sx={{ position: 'fixed', top: 20, right: 20, zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
        {toasts.map(t => (
          <Alert
            key={t.id}
            severity={t.severity}
            variant="filled"
            onClose={() => setToasts((prev: any[]) => prev.filter((x: any) => x.id !== t.id))}
            sx={{
              minWidth: 250,
              boxShadow: 3,
              // Add a simple animation feel
              animation: 'slideIn 0.1s cubic-bezier(0.15, 1.15, 0.3, 1) forwards',
              '@keyframes slideIn': {
                '0%': { transform: 'translateX(100%)', opacity: 0 },
                '100%': { transform: 'translateX(0)', opacity: 1 }
              }
            }}
          >
            {t.msg}
          </Alert>
        ))}
      </Box>
    </>
  );
}