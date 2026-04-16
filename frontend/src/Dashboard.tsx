import { useState, useEffect, useRef } from 'react';
import { Box, CssBaseline, ThemeProvider, createTheme, Tabs, Tab, IconButton, Menu, MenuItem, Typography, Button, ButtonGroup, useMediaQuery, useTheme, Paper, Dialog, DialogTitle, DialogContent, DialogActions, TextField } from '@mui/material';
import Sidebar from './Sidebar';
import TerminalComponent from './Terminal';
import type { TerminalHandle } from './Terminal';
import CloseIcon from '@mui/icons-material/Close';
import MenuIcon from '@mui/icons-material/Menu';
import KeyboardTabIcon from '@mui/icons-material/KeyboardTab';
import NorthIcon from '@mui/icons-material/North';
import SouthIcon from '@mui/icons-material/South';
import WestIcon from '@mui/icons-material/West';
import EastIcon from '@mui/icons-material/East';
import PushPinIcon from '@mui/icons-material/PushPin';
import AddIcon from '@mui/icons-material/Add';

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    background: { default: '#ffffff', paper: '#f4f6f8' },
  },
});

interface TabData {
  id: string;
  host: string;
  title: string;
  isPinned?: boolean;
  state?: string;
}

interface ButtonData {
  id: string;
  name: string;
  type: string;
  payload: string;
}

export default function Dashboard() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const defaultTabId = `local-${Date.now()}`;
  const [tabs, setTabs] = useState<TabData[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>(defaultTabId);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; targetTabId: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const terminalRefs = useRef<{ [key: string]: TerminalHandle | null }>({});
  const [viewportHeight, setViewportHeight] = useState('100dvh');
  const [isCtrlActive, setIsCtrlActive] = useState(false);

  const [buttons, setButtons] = useState<ButtonData[]>([]);
  const [buttonDialogOpen, setButtonDialogOpen] = useState(false);
  const [editingButton, setEditingButton] = useState<ButtonData | null>(null);
  const [buttonFormData, setButtonFormData] = useState({ name: '', type: 'send_string', payload: '' });
  const [btnMenuAnchor, setBtnMenuAnchor] = useState<{ anchor: HTMLElement, btn: ButtonData } | null>(null);

  const handleSendKey = (key: string) => {
    if (activeTabId && terminalRefs.current[activeTabId]) {
      terminalRefs.current[activeTabId]?.sendData(key);
      // Re-focus firmly
      setTimeout(() => {
        const term = terminalRefs.current[activeTabId];
        if (term) (term as any).focus?.();
      }, 0);
    }
  };

  const tabId = useRef(sessionStorage.getItem('cozy_tab_id') || Math.random().toString());
  useEffect(() => {
    sessionStorage.setItem('cozy_tab_id', tabId.current);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleVVResize = () => {
      setViewportHeight(`${vv.height}px`);
    };
    vv.addEventListener('resize', handleVVResize);
    handleVVResize();
    return () => vv.removeEventListener('resize', handleVVResize);
  }, []);

  const [sysHostname, setSysHostname] = useState<string>('server');
  const [appVersion, setAppVersion] = useState<string>('dev');

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    const token = localStorage.getItem('cozy_token');
    fetch('/api/sysinfo', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (data) {
          data.hostname && setSysHostname(data.hostname);
          data.version && setAppVersion(data.version);
        }
      })
      .catch(e => console.error(e));

    fetch('/api/buttons', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setButtons(data || []))
      .catch(e => console.error(e));

    const bc = new BroadcastChannel('cozy_tabs');
    let pinnedElsewhere = false;

    // The Responder: always listen and answer based on current state (via ref)
    bc.onmessage = (e) => {
      if (e.data === 'probe_pinned') {
        const hasPinned = tabsRef.current.some(t => t.isPinned);
        if (hasPinned) bc.postMessage('pinned_present');
      }
      if (e.data === 'pinned_present') pinnedElsewhere = true;
    };

    // The Initiator: run ONLY ONCE on mount
    bc.postMessage('probe_pinned');

    setTimeout(() => {
      if (!pinnedElsewhere) {
        fetch('/api/tabs/pinned', { headers: { 'Authorization': `Bearer ${token}` } })
          .then(r => r.json())
          .then((pinned: any[]) => {
            const pinnedTabs = pinned.map(p => ({ id: p.id, host: p.host, title: p.title, isPinned: true }));
            if (pinnedTabs.length > 0) {
              setTabs(pinnedTabs);
              setActiveTabId(pinnedTabs[0].id);
            } else {
              const initialId = `local-${Date.now()}`;
              setTabs([{ id: initialId, host: 'local', title: 'local' }]);
              setActiveTabId(initialId);
            }
          })
          .catch(e => {
            console.error(e);
            const initialId = `local-${Date.now()}`;
            setTabs([{ id: initialId, host: 'local', title: 'local' }]);
            setActiveTabId(initialId);
          });
      } else {
        const initialId = `local-${Date.now()}`;
        setTabs([{ id: initialId, host: 'local', title: 'local' }]);
        setActiveTabId(initialId);
      }
    }, 150);

    return () => bc.close();
  }, []); // Run ONLY once on mount

  useEffect(() => {
    const active = tabs.find(t => t.id === activeTabId);
    if (!active || active.title === 'local') {
      document.title = `CozySSH ${sysHostname}`;
    } else {
      document.title = `${active.title} - CozySSH ${sysHostname}`;
    }
  }, [tabs, activeTabId, sysHostname]);

  const handleLogout = async () => {
    const token = localStorage.getItem('cozy_token');
    if (token) {
      await fetch('/api/logout', { headers: { 'Authorization': `Bearer ${token}` } });
    }
    localStorage.removeItem('cozy_token');
    window.location.href = '/login';
  };

  const handleSelectHost = (host: string) => {
    const newId = `${host}-${Date.now()}`;
    setTabs(prev => [...prev, { id: newId, host, title: host }]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const targetTab = tabs.find(t => t.id === id);
    if (targetTab?.isPinned) {
      // If pinned, call unpin first? Or just close in UI?
      // Requirement says pinned tabs are permanent. 
      // If the user clicks 'X' on a pinned tab, we should probably unpin it too.
      handleUnpinTab(id);
    }

    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const newTabs = prev.filter(t => t.id !== id);
      if (activeTabId === id && newTabs.length > 0) {
        // Shift active tab cleanly
        const nextIdx = idx > 0 ? idx - 1 : 0;
        setActiveTabId(newTabs[nextIdx].id);
      } else if (newTabs.length === 0) {
        setActiveTabId('');
      }
      return newTabs;
    });
  };

  const handlePinTab = async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    const token = localStorage.getItem('cozy_token');
    await fetch('/api/tabs/pin', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tab.id, host: tab.host, title: tab.title })
    });
    setTabs(prev => prev.map(t => t.id === id ? { ...t, isPinned: true } : t));
    setContextMenu(null);
  };

  const handleUnpinTab = async (id: string) => {
    const token = localStorage.getItem('cozy_token');
    await fetch('/api/tabs/unpin', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    setTabs(prev => prev.map(t => t.id === id ? { ...t, isPinned: false } : t));
    setContextMenu(null);
  };

  const handleAttach = async (id: string, host: string, title: string) => {
    const token = localStorage.getItem('cozy_token');
    await fetch('/api/sessions/attach', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    setTabs(prev => {
      if (!prev.find(t => t.id === id)) {
        return [...prev, { id, host, title, isPinned: true }];
      }
      return prev;
    });
    setActiveTabId(id);
  };

  const handleRename = async () => {
    if (!contextMenu) return;
    const targetId = contextMenu.targetTabId;
    const targetTab = tabs.find(t => t.id === targetId);
    if (!targetTab) return;

    const newTitle = prompt("Enter new tab name:", targetTab.title);
    if (newTitle && newTitle.trim() !== "") {
      if (targetTab.isPinned) {
        const token = localStorage.getItem('cozy_token');
        await fetch('/api/tabs/rename', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: targetId, title: newTitle })
        });
      }
      setTabs(prev => prev.map(t => t.id === targetId ? { ...t, title: newTitle } : t));
    }
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX + 2, mouseY: e.clientY - 6, targetTabId: id });
  };

  const handleCloseMenu = () => setContextMenu(null);

  const handleCloseOther = () => {
    if (!contextMenu) return;
    const targetId = contextMenu.targetTabId;
    setTabs(prev => prev.filter(t => t.id === targetId));
    setActiveTabId(targetId);
    setContextMenu(null);
  };

  const handleCloseRight = () => {
    if (!contextMenu) return;
    const targetId = contextMenu.targetTabId;
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === targetId);
      return prev.slice(0, idx + 1);
    });
    if (activeTabId !== targetId) {
      setActiveTabId(targetId);
    }
    setContextMenu(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setTabs(prev => {
          if (prev.length <= 1) return prev;
          const idx = prev.findIndex(t => t.id === activeTabId);
          const nextIdx = (idx + 1) % prev.length;
          setActiveTabId(prev[nextIdx].id);
          return prev;
        });
      } else if (e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setTabs(prev => {
          if (prev.length <= 1) return prev;
          const idx = prev.findIndex(t => t.id === activeTabId);
          const nextIdx = (idx - 1 + prev.length) % prev.length;
          setActiveTabId(prev[nextIdx].id);
          return prev;
        });
      } else if (e.altKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        if (activeTabId) {
          handleCloseTab({ stopPropagation: () => { } } as any, activeTabId);
        }
      } else if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        handleSelectHost('local');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, tabs]);

  const handleButtonClick = (btn: ButtonData) => {
    if (btn.type === 'send_string') {
      handleSendKey(btn.payload);
    }
  };

  const handleSaveButton = async () => {
    const token = localStorage.getItem('cozy_token');
    const method = editingButton ? 'PUT' : 'POST';
    const url = editingButton ? `/api/buttons/${editingButton.id}` : '/api/buttons';
    await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buttonFormData)
    });
    setButtonDialogOpen(false);
    fetch('/api/buttons', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setButtons(data || []));
  };

  const handleDeleteButton = async (id: string, name: string) => {
    if (!confirm(`Delete button "${name}"?`)) return;
    const token = localStorage.getItem('cozy_token');
    await fetch(`/api/buttons/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    setBtnMenuAnchor(null);
    fetch('/api/buttons', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setButtons(data || []));
  };

  const handleMoveButton = async (id: string, direction: number) => {
    const token = localStorage.getItem('cozy_token');
    await fetch('/api/buttons/move', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, direction })
    });
    setBtnMenuAnchor(null);
    fetch('/api/buttons', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setButtons(data || []));
  };

  return (
    <ThemeProvider theme={lightTheme}>
      <Box sx={{ display: 'flex', height: viewportHeight, overflow: 'hidden' }}>
        <CssBaseline />
        <Sidebar
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          onSelect={(host) => { handleSelectHost(host); setMobileOpen(false); }}
          onLogout={handleLogout}
          activeTabs={tabs.map(t => t.id)}
          sysHostname={sysHostname}
          appVersion={appVersion}
          onAttach={handleAttach}
        />
        <Box component="main" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {tabs.length > 0 && (
            <Box sx={{ bgcolor: '#f4f6f8', display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexShrink: 0, overflow: 'hidden' }}>
              <IconButton
                color="inherit"
                aria-label="open drawer"
                edge="start"
                onClick={() => setMobileOpen(!mobileOpen)}
                sx={{ ml: 1, display: { md: 'none' } }}
              >
                <MenuIcon />
              </IconButton>
              <Box sx={{ flexGrow: 1, minWidth: 0, overflow: 'hidden' }}>
                <Tabs
                  value={activeTabId}
                  onChange={(_, val) => setActiveTabId(val)}
                  variant="scrollable"
                  scrollButtons={true}
                  allowScrollButtonsMobile
                  sx={{ minHeight: 40 }}
                >
                  {tabs.map((tab) => (
                    <Tab
                      key={tab.id}
                      value={tab.id}
                      onContextMenu={(e) => handleContextMenu(e, tab.id)}
                      sx={{ minHeight: 40, py: 0, textTransform: 'none', minWidth: 'auto' }}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          {tab.isPinned && <PushPinIcon sx={{ fontSize: 14, mr: 0.5, color: 'primary.main' }} />}
                          <Box sx={{
                            width: 8, height: 8, borderRadius: '50%', mr: 1,
                            bgcolor: tab.state === 'connected' ? 'success.main' :
                              (tab.state === 'connecting to host' || tab.state === 'connecting to ssh server') ? 'warning.main' : 'error.main'
                          }} title={tab.state || 'disconnected'} />
                          <span>{tab.title}</span>
                          <IconButton
                            size="small"
                            onClick={(e) => handleCloseTab(e, tab.id)}
                            sx={{ ml: 1, p: 0.5 }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      }
                    />
                  ))}
                </Tabs>
              </Box>
            </Box>
          )}

          <Box sx={{ flexGrow: 1, bgcolor: '#ffffff', overflow: 'hidden', position: 'relative' }}>
            {tabs.map((tab) => (
              <Box
                key={tab.id}
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: activeTabId === tab.id ? 'block' : 'none',
                }}
              >
                <TerminalComponent
                  ref={el => { terminalRefs.current[tab.id] = el; }}
                  host={tab.host}
                  sessionId={tab.id}
                  isActive={activeTabId === tab.id}
                  isCtrlActive={isCtrlActive}
                  onCtrlDone={() => setIsCtrlActive(false)}
                  onStateChange={(state) => {
                    setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, state } : t));
                  }}
                />
              </Box>
            ))}
            {tabs.length === 0 && (
              <Box sx={{ p: 4, textAlign: 'center', mt: 10 }}>
                <IconButton onClick={() => setMobileOpen(true)} sx={{ display: { md: 'none' }, mb: 4 }}>
                  <MenuIcon fontSize="large" />
                </IconButton>
                <Typography color="text.secondary">Select a server from the sidebar to open a terminal interface.</Typography>
              </Box>
            )}
          </Box>

          {tabs.length > 0 && (
            <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: '#f8f9fa', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
              <Tabs
                value={false}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{
                  flexGrow: 1,
                  minHeight: 40,
                  '& .MuiTabs-flexContainer': { gap: 1, px: 2, alignItems: 'center' },
                  '& .MuiTabs-indicator': { display: 'none' }
                }}
              >
                {buttons.map(btn => (
                  <Tab
                    key={btn.id}
                    label={btn.name}
                    title={btn.payload}
                    component="div"
                    onClick={() => handleButtonClick(btn)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setBtnMenuAnchor({ anchor: e.currentTarget, btn });
                    }}
                    sx={{
                      minHeight: 28, minWidth: 'auto', p: '2px 12px',
                      textTransform: 'none', fontSize: '0.8rem', borderRadius: 1.5,
                      border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
                      color: 'text.primary', margin: '6px 4px', cursor: 'pointer',
                      '&:hover': { bgcolor: 'primary.light', color: 'white' }
                    }}
                  />
                ))}
                <Tab
                  icon={<AddIcon fontSize="small" />}
                  component="div"
                  onClick={() => {
                    setEditingButton(null);
                    setButtonFormData({ name: '', type: 'send_string', payload: '' });
                    setButtonDialogOpen(true);
                  }}
                  sx={{ minHeight: 28, minWidth: 40, p: 0, margin: '6px 4px', cursor: 'pointer' }}
                />
              </Tabs>
            </Box>
          )}

          {isMobile && tabs.length > 0 && (
            <Paper
              elevation={3}
              sx={{
                p: 0.5,
                bgcolor: '#f4f6f8',
                borderTop: 1,
                borderColor: 'divider',
                display: 'flex',
                justifyContent: 'center',
                gap: 0.5,
                overflowX: 'auto',
                flexShrink: 0
              }}
            >
              <ButtonGroup size="small" variant="outlined">
                <Button
                  variant={isCtrlActive ? "contained" : "outlined"}
                  onMouseDown={(e) => { e.preventDefault(); setIsCtrlActive(!isCtrlActive); }}
                >
                  Ctrl
                </Button>
                <Button onMouseDown={(e) => { e.preventDefault(); handleSendKey('\x1b'); }}>Esc</Button>
                <Button onMouseDown={(e) => { e.preventDefault(); handleSendKey('\x09'); }}><KeyboardTabIcon fontSize="small" /></Button>
              </ButtonGroup>
              <ButtonGroup size="small" variant="outlined">
                <Button onMouseDown={(e) => { e.preventDefault(); handleSendKey('\x1b[A'); }}><NorthIcon fontSize="small" /></Button>
                <Button onMouseDown={(e) => { e.preventDefault(); handleSendKey('\x1b[B'); }}><SouthIcon fontSize="small" /></Button>
                <Button onMouseDown={(e) => { e.preventDefault(); handleSendKey('\x1b[D'); }}><WestIcon fontSize="small" /></Button>
                <Button onMouseDown={(e) => { e.preventDefault(); handleSendKey('\x1b[C'); }}><EastIcon fontSize="small" /></Button>
              </ButtonGroup>
            </Paper>
          )}
        </Box>
      </Box>

      <Menu
        open={contextMenu !== null}
        onClose={handleCloseMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        {contextMenu && (
          tabs.find(t => t.id === contextMenu.targetTabId)?.isPinned ? (
            <MenuItem onClick={() => handleUnpinTab(contextMenu.targetTabId)}>Unpin Tab</MenuItem>
          ) : (
            <MenuItem onClick={() => handlePinTab(contextMenu.targetTabId)}>Pin Tab</MenuItem>
          )
        )}
        <MenuItem onClick={handleRename}>Rename Tab</MenuItem>
        <MenuItem onClick={handleCloseOther}>Close Other tabs</MenuItem>
        <MenuItem onClick={handleCloseRight}>Close tabs to the right</MenuItem>
      </Menu>

      <Menu
        anchorEl={btnMenuAnchor?.anchor}
        open={Boolean(btnMenuAnchor)}
        onClose={() => setBtnMenuAnchor(null)}
      >
        <MenuItem onClick={() => {
          if (!btnMenuAnchor) return;
          setEditingButton(btnMenuAnchor.btn);
          setButtonFormData({ name: btnMenuAnchor.btn.name, type: btnMenuAnchor.btn.type, payload: btnMenuAnchor.btn.payload });
          setBtnMenuAnchor(null);
          setButtonDialogOpen(true);
        }}>Edit Button</MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleMoveButton(btnMenuAnchor.btn.id, -1)}>Move Button Left</MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleMoveButton(btnMenuAnchor.btn.id, 1)}>Move Button Right</MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleDeleteButton(btnMenuAnchor.btn.id, btnMenuAnchor.btn.name)} sx={{ color: 'error.main' }}>Delete Button</MenuItem>
      </Menu>

      <Dialog open={buttonDialogOpen} onClose={() => setButtonDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{editingButton ? 'Edit Button' : 'Add Button'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField sx={{ mt: 1 }} fullWidth label="Button Name" size="small" value={buttonFormData.name} onChange={e => setButtonFormData({ ...buttonFormData, name: e.target.value })} />
          <TextField fullWidth label="Command / String" size="small" multiline rows={3} value={buttonFormData.payload} onChange={e => setButtonFormData({ ...buttonFormData, payload: e.target.value })} placeholder="String to send to terminal..." />
          <Typography variant="caption" color="text.secondary">Type: Sending String (Implicit)</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setButtonDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveButton} disabled={!buttonFormData.name || !buttonFormData.payload}>Save</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}
