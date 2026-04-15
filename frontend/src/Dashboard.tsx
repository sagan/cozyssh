import { useState, useEffect, useRef } from 'react';
import { Box, CssBaseline, ThemeProvider, createTheme, Tabs, Tab, IconButton, Menu, MenuItem, Typography, Button, ButtonGroup, useMediaQuery, useTheme, Paper } from '@mui/material';
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

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    const token = localStorage.getItem('cozy_token');
    fetch('/api/sysinfo', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => data && data.hostname && setSysHostname(data.hostname))
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
          handleCloseTab({ stopPropagation: () => {} } as any, activeTabId);
        }
      } else if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        handleSelectHost('local');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, tabs]);

  return (
    <ThemeProvider theme={lightTheme}>
      <Box sx={{ display: 'flex', height: viewportHeight, overflow: 'hidden' }}>
        <CssBaseline />
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} onSelect={(host) => { handleSelectHost(host); setMobileOpen(false); }} onLogout={handleLogout} />
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
        <MenuItem onClick={handleCloseOther}>Close Other tabs</MenuItem>
        <MenuItem onClick={handleCloseRight}>Close tabs to the right</MenuItem>
      </Menu>
    </ThemeProvider>
  );
}
