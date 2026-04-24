import { useState, useEffect, useRef } from 'react';
import { Box, CssBaseline, ThemeProvider, createTheme, Tabs, Tab, IconButton, Menu, MenuItem, Typography, Button, ButtonGroup, useMediaQuery, useTheme, Paper, Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControlLabel, Checkbox } from '@mui/material';
import Sidebar from './Sidebar';
import type { Host } from './Sidebar';
import TerminalComponent from './Terminal';
import type { TerminalHandle } from './Terminal';
import FileBrowser from './FileBrowser';
import Scratchpad from './Scratchpad';
import type { ScratchpadHandle } from './Scratchpad';
import CloseIcon from '@mui/icons-material/Close';
import MenuIcon from '@mui/icons-material/Menu';
import KeyboardTabIcon from '@mui/icons-material/KeyboardTab';
import NorthIcon from '@mui/icons-material/North';
import SouthIcon from '@mui/icons-material/South';
import WestIcon from '@mui/icons-material/West';
import EastIcon from '@mui/icons-material/East';
import PushPinIcon from '@mui/icons-material/PushPin';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from "@codemirror/view";
import { javascript } from '@codemirror/lang-javascript';
import { transform } from 'sucrase';

const VIBRATE_PATTERN = 100;

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    background: { default: '#ffffff', paper: '#f4f6f8' },
  },
});

interface PaneData {
  id: string;
  host: string;
  state?: string;
  cloneFrom?: string;
}

interface TabData {
  id: string;
  title: string;
  panes: PaneData[];
  activePaneId: string;
  isPinned?: boolean;
  showFiles?: boolean;
  type?: 'terminal' | 'scratchpad';
}

interface ButtonData {
  id: string;
  name: string;
  type: string;
  payload: string;
  group?: string;
}

interface DashboardProps {
  initialData?: any;
}
export default function Dashboard({ initialData }: DashboardProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTouch = useMediaQuery('(pointer: coarse)');
  const defaultTabId = `local-${Date.now()}`;
  const [tabs, setTabs] = useState<TabData[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>(defaultTabId);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; targetTabId: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const terminalRefs = useRef<{ [key: string]: TerminalHandle | ScratchpadHandle | null }>({});
  const [viewportHeight, setViewportHeight] = useState('100dvh');
  const [isCtrlActive, setIsCtrlActive] = useState(false);
  const [scratchpadSyncState, setScratchpadSyncState] = useState<'offline' | 'syncing' | 'synced' | 'dirty'>('offline');
  const [shellCwds, setShellCwds] = useState<{ [key: string]: string }>({});
  const [memoTabId, setMemoTabId] = useState<string | null>(null);
  const [activePaneId, setActivePaneId] = useState<string>('');
  const [unreadTabIds, setUnreadTabIds] = useState<Set<string>>(new Set());

  const [buttons, setButtons] = useState<ButtonData[]>([]);
  const [activeGroup, setActiveGroup] = useState<string>(localStorage.getItem('cozy_active_group') || 'Default');
  const [buttonDialogOpen, setButtonDialogOpen] = useState(false);
  const [editingButton, setEditingButton] = useState<ButtonData | null>(null);
  const [buttonFormData, setButtonFormData] = useState({ name: '', type: 'send_string', payload: '', group: 'Default' });
  const [initialBtnFormData, setInitialBtnFormData] = useState<any>(null);
  const [btnMenuAnchor, setBtnMenuAnchor] = useState<{ anchor: HTMLElement, btn: ButtonData } | null>(null);
  const [lastMenuBtn, setLastMenuBtn] = useState<ButtonData | null>(null);
  const [buttonsLoaded, setButtonsLoaded] = useState(false);
  const [inputDialogOpen, setInputDialogOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [appendNewLine, setAppendNewLine] = useState(true);
  const [sendScope, setSendScope] = useState<0 | 1 | 2>(0);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const toastIdRef = useRef(0);
  const [hosts, setHosts] = useState<Host[]>([]);

  const csNotify = (msg: string) => {
    toastIdRef.current++;
    const id = toastIdRef.current;
    setToasts(prev => {
      const newToasts = [...prev, { id, msg }];
      return newToasts.slice(-3);
    });
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const handleTerminalData = (tabId: string) => {
    setUnreadTabIds(prev => {
      // Don't mark active tab or already unread tabs
      if (tabId === activeTabId || prev.has(tabId)) return prev;
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
  };

  useEffect(() => {
    if (unreadTabIds.has(activeTabId)) {
      setUnreadTabIds(prev => {
        const next = new Set(prev);
        next.delete(activeTabId);
        return next;
      });
    }
  }, [activeTabId, unreadTabIds]);

  useEffect(() => {
    localStorage.setItem('cozy_active_group', activeGroup);
  }, [activeGroup]);

  const groups = ['Default', ...Array.from(new Set(buttons.map(b => b.group || 'Default').filter(g => g !== 'Default')))].sort();
  const filteredButtons = buttons.filter(b => (b.group || 'Default') === activeGroup);

  useEffect(() => {
    if (buttonsLoaded && !groups.includes(activeGroup)) {
      setActiveGroup('Default');
    }
  }, [groups, buttonsLoaded, activeGroup]);

  useEffect(() => {
    (window as any).csGetTerminal = () => {
      const term: any = terminalRefs.current[activePaneId];
      return term?.getXterm?.();
    };
    (window as any).csNotify = (msg: string) => csNotify(msg);
    (window as any).csGetHosts = () => hosts;
    (window as any).csOpen = (target: any, options: { name?: string } = {}) => {
      const targets = Array.isArray(target) ? target.slice(0, 4) : [target];
      const hostNames = targets.map(t => {
        if (typeof t === 'string') {
          if (t === 'local') return 'local';
          const known = hosts.find(h => h.name === t || h.hostname === t);
          return known ? known.name : t;
        }
        return t.name;
      });

      const title = options.name || hostNames[0];

      if (hostNames.length > 1) {
        handleSelectTagAsSplit(title, hostNames);
      } else {
        handleSelectHost(hostNames[0], options.name);
      }
    };

    (window as any).csFetch = async (url: string, options: any = {}) => {
      const token = localStorage.getItem('cozy_token');
      const proxyUrl = `/api/fetch?url=${encodeURIComponent(url)}`;

      const rawHeaders = options.headers || {};
      const headers: any = {};
      const restricted = ['authorization', 'referer', 'origin', 'user-agent', 'cookie'];

      headers["Authorization"] = `Bearer ${token}`;
      for (const key in rawHeaders) {
        if (restricted.includes(key.toLowerCase())) {
          headers[`X-CozySSH-${key}`] = rawHeaders[key];
        } else {
          headers[key] = rawHeaders[key];
        }
      }

      return fetch(proxyUrl, {
        method: options.method || 'GET',
        headers: headers,
        body: options.body
      });
    };

    (window as any).csExec = async (cmdline: string) => {
      const token = localStorage.getItem('cozy_token');
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ cmdline })
      });
      if (!res.ok) throw new Error("Exec failed: " + res.statusText);
      return res.json();
    };

    (window as any).csRefresh = async () => {
      await handleRefresh();
    };

    return () => {
      delete (window as any).csGetTerminal;
      delete (window as any).csNotify;
      delete (window as any).csGetHosts;
      delete (window as any).csOpen;
      delete (window as any).csFetch;
      delete (window as any).csExec;
      delete (window as any).csRefresh;
    };
  }, [activePaneId, hosts]);

  const handleCloseInputDialog = () => {
    setInputDialogOpen(false);
    setTimeout(() => {
      terminalRefs.current[activePaneId]?.focus();
    }, 50);
  };

  const handleSendKey = (key: string) => {
    if (activePaneId && terminalRefs.current[activePaneId]) {
      const term: any = terminalRefs.current[activePaneId];
      term?.sendData?.(key);
      // Re-focus firmly
      setTimeout(() => {
        const term = terminalRefs.current[activePaneId];
        if (term) (term as any).focus?.();
      }, 0);
    }
  };

  const sendParsedString = async (input: string) => {
    let targetPaneIds: string[] = [];
    if (sendScope === 2) {
      targetPaneIds = tabsRef.current.flatMap(t => t.panes.map(p => p.id));
    } else if (sendScope === 1) {
      const currentTab = tabsRef.current.find(t => t.id === activeTabId);
      targetPaneIds = currentTab ? currentTab.panes.map(p => p.id) : [activePaneId];
    } else {
      targetPaneIds = [activePaneId];
    }

    const parts = input.split(/(<ctrl-[a-z]>)/gi);
    for (const part of parts) {
      if (!part) continue;
      const ctrlMatch = part.match(/<ctrl-([a-z])>/i);
      const dataToSend = ctrlMatch
        ? String.fromCharCode(ctrlMatch[1].toLowerCase().charCodeAt(0) - 96)
        : part;

      for (const pid of targetPaneIds) {
        if (pid && terminalRefs.current[pid]) {
          const term: any = terminalRefs.current[pid];
          term?.sendData?.(dataToSend);
        }
      }
      await new Promise(r => setTimeout(r, ctrlMatch ? 50 : 10));
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

  const loadFullData = (data: any) => {
    if (data.sysinfo) {
      setSysHostname(data.sysinfo.hostname || 'unknown');
      setAppVersion(data.sysinfo.version || 'dev');
    }
    if (data.hosts) {
      setHosts(data.hosts);
    }
    if (data.buttons) {
      setButtons(data.buttons || []);
      setButtonsLoaded(true);
    }
  };

  const fetchHosts = async () => {
    const token = localStorage.getItem('cozy_token');
    try {
      const r = await fetch('/api/hosts', { headers: { 'Authorization': `Bearer ${token}` } });
      if (r.status === 401) {
        localStorage.removeItem('cozy_token');
        window.location.href = '/login';
        return;
      }
      const data = await r.json();
      setHosts(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRefresh = async () => {
    const token = localStorage.getItem('cozy_token');
    try {
      const r = await fetch('/api/fulldata', { headers: { 'Authorization': `Bearer ${token}` } });
      if (r.status === 401) {
        localStorage.removeItem('cozy_token');
        window.location.href = '/login';
        return;
      }
      const data = await r.json();
      loadFullData(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('cozy_token');
    const hash = window.location.hash.substring(1);
    if (hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    let bc: BroadcastChannel | null = new BroadcastChannel('cozy_tabs');
    let pinnedElsewhere = false;

    const initAsync = async () => {
      bc!.onmessage = (e) => {
        if (e.data === 'probe_pinned') {
          const hasPinned = tabsRef.current.some(t => t.isPinned);
          if (hasPinned) bc?.postMessage('pinned_present');
        }
        if (e.data === 'pinned_present') pinnedElsewhere = true;
      };

      let data = initialData;
      if (!data) {
        try {
          const r = await fetch('/api/fulldata', { headers: { 'Authorization': `Bearer ${token}` } });
          if (r.status === 401) {
            localStorage.removeItem('cozy_token');
            window.location.href = '/login';
            return;
          }
          data = await r.json();
        } catch (e) {
          console.error(e);
          return;
        }
      }

      loadFullData(data);

      bc!.postMessage('probe_pinned');

      setTimeout(() => {
        if (hash) {
          const hostsData: any[] = data.hosts || [];
          if (hash.startsWith('#')) {
            // Tag mode /##tag
            const tag = hash.substring(1);
            const filtered = hostsData.filter(h => h.tags && h.tags.includes(tag));

            const nameSorter = (a: any, b: any) => a.name.localeCompare(b.name);
            const hostNameSorter = (a: any, b: any) => {
              if (a.hostname === b.hostname) return a.name.localeCompare(b.name);
              return a.hostname.localeCompare(b.hostname);
            };

            const favs = filtered.filter(h => h.tags?.includes('fav')).sort(nameSorter);
            const normals = filtered.filter(h => !h.tags?.includes('fav') && !h.is_auto).sort(nameSorter);
            const autos = filtered.filter(h => !h.tags?.includes('fav') && h.is_auto).sort(hostNameSorter);

            const targets = [...favs, ...normals, ...autos].slice(0, 4);
            if (targets.length > 0) {
              handleSelectTagAsSplit(tag, targets.map(h => h.name));
            } else {
              const initialId = `local-${Date.now()}`;
              const initialPaneId = Math.random().toString(36).substring(2);
              setTabs([{ id: initialId, panes: [{ id: initialPaneId, host: 'local' }], activePaneId: initialPaneId, title: 'local' }]);
              setActiveTabId(initialId);
              setActivePaneId(initialPaneId);
            }
          } else {
            // Single host mode /#host
            const host = hostsData.find(h => h.name === hash || h.hostname === hash);
            if (host) {
              handleSelectHost(host.name);
            } else {
              const initialId = `local-${Date.now()}`;
              const initialPaneId = Math.random().toString(36).substring(2);
              setTabs([{ id: initialId, panes: [{ id: initialPaneId, host: 'local' }], activePaneId: initialPaneId, title: 'local' }]);
              setActiveTabId(initialId);
              setActivePaneId(initialPaneId);
              setTimeout(() => alert(`SSH server "${hash}" not found in config.`), 100);
            }
          }
        } else if (!pinnedElsewhere) {
          const pinnedTabsData: any[] = data.pinned || [];
          // Only auto-open tabs that are not currently in use by any client
          const availablePins = pinnedTabsData.filter((p: any) => !p.listenerCount || p.listenerCount === 0);
          const pinnedTabs = availablePins.map((p: any) => {
            const paneId = p.id;
            return { id: p.id, panes: [{ id: paneId, host: p.host }], activePaneId: paneId, title: p.title, isPinned: true };
          });
          if (pinnedTabs.length > 0) {
            setTabs(pinnedTabs);
            setActiveTabId(pinnedTabs[0].id);
            setActivePaneId(pinnedTabs[0].activePaneId);
          } else {
            const initialId = `local-${Date.now()}`;
            const initialPaneId = Math.random().toString(36).substring(2);
            setTabs([{ id: initialId, panes: [{ id: initialPaneId, host: 'local' }], activePaneId: initialPaneId, title: 'local' }]);
            setActiveTabId(initialId);
            setActivePaneId(initialPaneId);
          }
        } else {
          const initialId = `local-${Date.now()}`;
          const initialPaneId = Math.random().toString(36).substring(2);
          setTabs([{ id: initialId, panes: [{ id: initialPaneId, host: 'local' }], activePaneId: initialPaneId, title: 'local' }]);
          setActiveTabId(initialId);
          setActivePaneId(initialPaneId);
        }
      }, 350);
    };

    initAsync();

    return () => {
      if (bc) bc.close();
    };
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
    const syncState = localStorage.getItem('cozy_scratchpad_sync_state');
    if (syncState && syncState !== 'synced') {
      if (!confirm("Scratchpad data is not fully synced to the server. Are you sure you want to log out and clear the local cache?")) {
        return;
      }
    }
    const token = localStorage.getItem('cozy_token');
    if (token) {
      await fetch('/api/logout', { headers: { 'Authorization': `Bearer ${token}` } });
    }
    localStorage.removeItem('cozy_token');
    localStorage.removeItem('cozy_scratchpad_cache');
    localStorage.removeItem('cozy_scratchpad_sync_state');
    window.location.href = '/login';
  };

  const handleOpenScratchpad = () => {
    const existing = tabs.find(t => t.type === 'scratchpad');
    if (existing) {
      setActiveTabId(existing.id);
      setActivePaneId(existing.panes[0].id);
      setTimeout(() => terminalRefs.current[existing.panes[0].id]?.focus(), 50);
      return;
    }
    const tabId = `scratchpad-${Date.now()}`;
    const newTab: TabData = {
      id: tabId,
      title: 'Scratchpad',
      panes: [{ id: tabId, host: 'scratchpad' }],
      activePaneId: tabId,
      type: 'scratchpad'
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setActivePaneId(tabId);
    setTimeout(() => terminalRefs.current[tabId]?.focus(), 50);
  };

  const handleSelectHost = (host: string, customTitle?: string) => {
    const id = Math.random().toString(36).substring(2);
    const newTab: TabData = {
      id: id,
      title: customTitle || host,
      panes: [{ id: id, host }],
      activePaneId: id,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setActivePaneId(id);
  };

  const handleSelectTagAsSplit = (tag: string, hosts: string[]) => {
    const tabId = Math.random().toString(36).substring(2);
    const panes = hosts.map(host => ({
      id: Math.random().toString(36).substring(2),
      host
    }));
    const newTab: TabData = {
      id: tabId,
      title: tag,
      panes: panes,
      activePaneId: panes[0].id,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setActivePaneId(panes[0].id);
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const targetTab = tabs.find(t => t.id === id);
    if (targetTab?.isPinned) {
      handleUnpinTab(id);
    }

    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const newTabs = prev.filter(t => t.id !== id);
      if (activeTabId === id && newTabs.length > 0) {
        const nextIdx = idx > 0 ? idx - 1 : 0;
        const nextTab = newTabs[nextIdx];
        setActiveTabId(nextTab.id);
        setActivePaneId(nextTab.activePaneId);
      } else if (newTabs.length === 0) {
        setActiveTabId('');
        setActivePaneId('');
      }
      return newTabs;
    });
  };

  const handleCloseCurrentPaneOrTab = () => {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab) return;
    if (currentTab.panes.length > 1) {
      const paneIdx = currentTab.panes.findIndex(p => p.id === activePaneId);
      const newPanes = currentTab.panes.filter(p => p.id !== activePaneId);
      const nextPaneId = newPanes[Math.max(0, paneIdx - 1)].id;
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, panes: newPanes, activePaneId: nextPaneId } : t));
      setActivePaneId(nextPaneId);
    } else {
      handleCloseTab({ stopPropagation: () => { } } as any, activeTabId);
    }
  };

  const handlePinTab = async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    if (tab.panes.length > 1) {
      alert("Only single-pane tabs can be pinned.");
      return;
    }
    const token = localStorage.getItem('cozy_token');
    // Pinning only supports single-pane tabs for now (backend requirement)
    const host = tab.panes[0]?.host || 'local';
    await fetch('/api/tabs/pin', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tab.id, host, title: tab.title })
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
        return [...prev, { id, panes: [{ id, host }], activePaneId: id, title, isPinned: true }];
      }
      return prev;
    });
    setActiveTabId(id);
    // Note: panes[0].id will be active
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

  const handleCloneSession = (id: string) => {
    const targetTab = tabs.find(t => t.id === id);
    if (!targetTab) return;
    // Clone first pane
    const pane = targetTab.panes[0];
    const newPaneId = Math.random().toString(36).substring(2);
    const newId = `${pane.host}-${Date.now()}`;
    setTabs(prev => [...prev, {
      id: newId,
      title: targetTab.title + ' (1)',
      panes: [{ id: newPaneId, host: pane.host, cloneFrom: pane.id, state: pane.state }],
      activePaneId: newPaneId,
      showFiles: targetTab.showFiles
    }]);
    setActiveTabId(newId);
    setActivePaneId(newPaneId);
    setContextMenu(null);
  };

  const handleReconnectTab = (id: string) => {
    const targetTab = tabs.find(t => t.id === id);
    if (!targetTab) return;
    targetTab.panes.forEach(p => {
      const term: any = terminalRefs.current[p.id];
      term?.reconnect?.();
    });
    setContextMenu(null);
  };

  const handleToggleFiles = () => {
    if (!contextMenu) return;
    const targetId = contextMenu.targetTabId;
    setTabs(prev => prev.map(t => t.id === targetId ? { ...t, showFiles: !t.showFiles } : t));
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setMemoTabId(id);
    setContextMenu({ mouseX: e.clientX + 2, mouseY: e.clientY - 6, targetTabId: id });
  };

  const handleCloseMenu = () => setContextMenu(null);

  const handleCloseOther = () => {
    if (!contextMenu) return;
    const targetId = contextMenu.targetTabId;
    const tab = tabs.find(t => t.id === targetId);
    setTabs(prev => prev.filter(t => t.id === targetId));
    setActiveTabId(targetId);
    if (tab) setActivePaneId(tab.activePaneId);
    setContextMenu(null);
  };

  const handleCloseRight = () => {
    if (!contextMenu) return;
    const targetId = contextMenu.targetTabId;
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === targetId);
      const newTabs = prev.slice(0, idx + 1);
      const targetTab = newTabs[idx];
      if (activeTabId !== targetId) {
        setActiveTabId(targetId);
        setActivePaneId(targetTab.activePaneId);
      }
      return newTabs;
    });
    setContextMenu(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        const allPanes = tabs.flatMap(t => t.panes.map(p => ({ tabId: t.id, paneId: p.id })));
        if (allPanes.length === 0) return;
        const idx = allPanes.findIndex(p => p.paneId === activePaneId);
        const nextIdx = (idx + 1) % allPanes.length;
        const target = allPanes[nextIdx];
        setActiveTabId(target.tabId);
        setActivePaneId(target.paneId);
        setTimeout(() => terminalRefs.current[target.paneId]?.focus(), 10);
      } else if (e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        const allPanes = tabs.flatMap(t => t.panes.map(p => ({ tabId: t.id, paneId: p.id })));
        if (allPanes.length === 0) return;
        const idx = allPanes.findIndex(p => p.paneId === activePaneId);
        const nextIdx = (idx - 1 + allPanes.length) % allPanes.length;
        const target = allPanes[nextIdx];
        setActiveTabId(target.tabId);
        setActivePaneId(target.paneId);
        setTimeout(() => terminalRefs.current[target.paneId]?.focus(), 10);
      } else if (e.altKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        const currentTab = tabs.find(t => t.id === activeTabId);
        if (currentTab && currentTab.panes.length > 0) {
          const pid = currentTab.panes[0].id;
          setActivePaneId(pid);
          setTimeout(() => terminalRefs.current[pid]?.focus(), 0);
        }
      } else if (e.altKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        handleCloseCurrentPaneOrTab();
      } else if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        handleSelectHost('local');
      } else if (e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
          const target = tabs[idx];
          setActiveTabId(target.id);
          setActivePaneId(target.activePaneId);
          setTimeout(() => terminalRefs.current[target.activePaneId]?.focus(), 10);
        }
      } else if (e.altKey && e.key === '0') {
        e.preventDefault();
        if (tabs.length > 0) {
          const last = tabs[tabs.length - 1];
          setActiveTabId(last.id);
          setActivePaneId(last.activePaneId);
          setTimeout(() => terminalRefs.current[last.activePaneId]?.focus(), 10);
        }
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        (terminalRefs.current[activePaneId] as any)?.scrollLines?.(-3);
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        (terminalRefs.current[activePaneId] as any)?.scrollLines?.(3);
      } else if (e.altKey && e.shiftKey) {
        const digitMatch = e.code.match(/Digit(\d)/);
        if (digitMatch) {
          e.preventDefault();
          const num = parseInt(digitMatch[1]);
          const idx = num === 0 ? 9 : num - 1;
          const filteredButtons = buttons.filter(b => (b.group || 'Default') === activeGroup);
          if (idx < filteredButtons.length) {
            handleButtonClick(filteredButtons[idx]);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, activePaneId, tabs, buttons, activeGroup]);

  const handleButtonClick = async (btn: ButtonData) => {
    window.navigator.vibrate?.(VIBRATE_PATTERN);
    if (btn.type === 'send_string') {
      await sendParsedString(btn.payload);
      terminalRefs.current[activePaneId]?.focus();
    } else if (btn.type === 'terminal_function') {
      const term = terminalRefs.current[activePaneId] as any;
      if (!term) return;
      if (btn.payload === 'COPY') {
        term.selectAll?.();
        const text = term.getSelection?.();
        if (text) {
          navigator.clipboard.writeText(text);
        }
        term.clearSelection?.();
        term.focus?.();
      } else if (btn.payload === 'PASTE') {
        const text = await navigator.clipboard.readText();
        if (text) {
          term.sendData?.(text);
        }
        term.focus?.();
      } else if (btn.payload === 'INPUT') {
        setInputValue('');
        setSendScope(0);
        setInputDialogOpen(true);
      } else if (btn.payload === 'CLEAR') {
        term.clear?.();
        term.focus?.();
      } else if (btn.payload === 'RESET') {
        term.reset?.();
        term.focus?.();
      } else if (btn.payload === 'RECONNECT') {
        term.reconnect?.();
        term.focus?.();
      } else if (btn.payload === 'CLOSE') {
        handleCloseCurrentPaneOrTab();
      }
    } else if (btn.type === 'misc') {
      if (btn.payload === 'NEXT_BUTTON_GROUP') {
        const idx = groups.indexOf(activeGroup);
        const nextIdx = (idx + 1) % groups.length;
        setActiveGroup(groups[nextIdx]);
      } else if (btn.payload === 'PREV_BUTTON_GROUP') {
        const idx = groups.indexOf(activeGroup);
        const prevIdx = (idx - 1 + groups.length) % groups.length;
        setActiveGroup(groups[prevIdx]);
      } else if (btn.payload === 'OPEN_SCRATCHPAD') {
        handleOpenScratchpad();
      }
      terminalRefs.current[activePaneId]?.focus();
    } else if (btn.type === 'run_script') {
      try {
        const jsCode = transform(btn.payload, { transforms: ['typescript'] }).code;
        await eval(jsCode);
      } catch (e) {
        console.error('Script Error:', e);
        csNotify('Script Error: ' + e);
      }
      terminalRefs.current[activePaneId]?.focus();
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
    setInitialBtnFormData(null);
    setButtonDialogOpen(false);
    fetch('/api/buttons', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setButtons(data || []);
        setButtonsLoaded(true);
      });
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
      .then(data => {
        setButtons(data || []);
        setButtonsLoaded(true);
      });
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
      .then(data => {
        setButtons(data || []);
        setButtonsLoaded(true);
      });
  };

  const handleCloseBtnDialog = (_: any, reason: string) => {
    const isDirty = initialBtnFormData && JSON.stringify(buttonFormData) !== JSON.stringify(initialBtnFormData);
    if (isDirty && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
      return;
    }
    setButtonDialogOpen(false);
  };

  return (
    <ThemeProvider theme={lightTheme}>
      <Box sx={{ display: 'flex', height: viewportHeight, overflow: 'hidden' }}>
        <CssBaseline />
        <Sidebar
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          onSelect={(host) => { handleSelectHost(host); setMobileOpen(false); }}
          onSelectTagAsSplit={(tag, hosts) => { handleSelectTagAsSplit(tag, hosts); setMobileOpen(false); }}
          onLogout={handleLogout}
          activeTabs={tabs.map(t => t.id)}
          sysHostname={sysHostname}
          appVersion={appVersion}
          onAttach={(id, host, title) => { handleAttach(id, host, title); setMobileOpen(false); }}
          onRefresh={() => { handleRefresh(); setMobileOpen(false); }}
          hosts={hosts}
          fetchHosts={fetchHosts}
          onOpenScratchpad={() => { handleOpenScratchpad(); setMobileOpen(false); }}
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
                  onChange={(_, val) => {
                    setActiveTabId(val);
                    const t = tabs.find(x => x.id === val);
                    if (t) {
                      setActivePaneId(t.activePaneId);
                      setTimeout(() => terminalRefs.current[t.activePaneId]?.focus(), 50);
                    }
                  }}
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
                          <Box sx={{ width: 16, mr: 0.5, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            {tab.type === 'scratchpad' ? (
                              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                {scratchpadSyncState === 'offline' && <CloudOffIcon fontSize="small" color="error" />}
                                {scratchpadSyncState === 'syncing' && <SyncIcon fontSize="small" color="info" sx={{ animation: "spin 2s linear infinite", '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }} />}
                                {scratchpadSyncState === 'dirty' && <CloudUploadIcon fontSize="small" color="warning" />}
                                {scratchpadSyncState === 'synced' && <CloudDoneIcon fontSize="small" color="success" />}
                              </Box>
                            ) : (() => {
                              const state = tab.panes.find(p => p.id === tab.activePaneId)?.state || 'disconnected';
                              const isConnected = state === 'connected';
                              const isUnread = unreadTabIds.has(tab.id);

                              if (isConnected && isUnread) {
                                return <PriorityHighIcon sx={{ fontSize: 18, color: '#2196f3', fontWeight: 'bold' }} />;
                              }

                              return (
                                <Box sx={{
                                  width: 8, height: 8, borderRadius: '50%',
                                  bgcolor: isConnected ? 'success.main' :
                                    ((state.startsWith('connecting')) ? 'warning.main' : 'error.main')
                                }} title={state} />
                              );
                            })()}
                          </Box>
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
                  display: activeTabId === tab.id ? 'flex' : 'none',
                  flexDirection: 'column'
                }}
              >
                <Box sx={{ flexGrow: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                  {(() => {
                    const renderPaneInner = (pane: PaneData) => (
                      <Box
                        sx={{
                          flex: 1,
                          height: '100%',
                          minWidth: 0,
                          minHeight: 0,
                          position: 'relative',
                          outline: activePaneId === pane.id ? '1px solid #1976d2' : 'none',
                          outlineOffset: -1,
                          zIndex: activePaneId === pane.id ? 1 : 0
                        }}
                        onClick={() => setActivePaneId(pane.id)}
                      >
                        {tab.type === 'scratchpad' ? (
                          <Scratchpad
                            ref={el => { terminalRefs.current[pane.id] = el; }}
                            onSyncStateChange={setScratchpadSyncState}
                          />
                        ) : (
                          <TerminalComponent
                            key={pane.id}
                            ref={el => { terminalRefs.current[pane.id] = el; }}
                            host={pane.host}
                            sessionId={pane.id}
                            cloneFrom={pane.cloneFrom}
                            isActive={activeTabId === tab.id && activePaneId === pane.id}
                            isCtrlActive={isCtrlActive}
                            onCtrlDone={() => setIsCtrlActive(false)}
                            onStateChange={(state) => {
                              setTabs(prev => prev.map(t => t.id === tab.id ? {
                                ...t,
                                panes: t.panes.map(p => p.id === pane.id ? { ...p, state } : p)
                              } : t));
                            }}
                            onCwdChange={(cwd) => {
                              setShellCwds(prev => ({ ...prev, [pane.id]: cwd }));
                            }}
                            onDataReceived={() => handleTerminalData(tab.id)}
                            onStolen={() => {
                              setTabs(prev => prev.map(t => t.id === tab.id ? {
                                ...t,
                                isPinned: false,
                                panes: t.panes.map(p => p.id === pane.id ? { ...p, state: 'stolen' } : p)
                              } : t));
                            }}
                            onManualReconnect={(wasStolen) => {
                              if (wasStolen) {
                                const newId = `${pane.host}-${Date.now()}`;
                                setTabs(prev => prev.map(t => t.id === tab.id ? {
                                  ...t,
                                  activePaneId: newId,
                                  panes: t.panes.map(p => p.id === pane.id ? { ...p, id: newId, state: 'connecting' } : p)
                                } : t));
                                setActivePaneId(newId);
                              }
                            }}
                            isTouch={isTouch}
                          />
                        )}
                      </Box>
                    );

                    const n = tab.panes.length;
                    if (n <= 1) return renderPaneInner(tab.panes[0]);
                    if (n === 2) return (
                      <Box sx={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
                        {renderPaneInner(tab.panes[0])}
                        <Box sx={{ width: '1px', bgcolor: 'divider', flexShrink: 0 }} />
                        {renderPaneInner(tab.panes[1])}
                      </Box>
                    );
                    if (n === 3) return (
                      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                        {renderPaneInner(tab.panes[0])}
                        <Box sx={{ height: '1px', bgcolor: 'divider', flexShrink: 0 }} />
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
                          {renderPaneInner(tab.panes[1])}
                          <Box sx={{ width: '1px', bgcolor: 'divider', flexShrink: 0 }} />
                          {renderPaneInner(tab.panes[2])}
                        </Box>
                      </Box>
                    );
                    if (n === 4) return (
                      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
                          {renderPaneInner(tab.panes[0])}
                          <Box sx={{ width: '1px', bgcolor: 'divider', flexShrink: 0 }} />
                          {renderPaneInner(tab.panes[1])}
                        </Box>
                        <Box sx={{ height: '1px', bgcolor: 'divider', flexShrink: 0 }} />
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
                          {renderPaneInner(tab.panes[2])}
                          <Box sx={{ width: '1px', bgcolor: 'divider', flexShrink: 0 }} />
                          {renderPaneInner(tab.panes[3])}
                        </Box>
                      </Box>
                    );
                    return null;
                  })()}
                </Box>
                {tab.showFiles && (
                  <Box sx={{ height: '50%', minHeight: 200, borderTop: 1, borderColor: 'divider' }}>
                    <FileBrowser
                      sessionId={tab.activePaneId}
                      isActive={activeTabId === tab.id && tab.showFiles}
                      shellCwd={shellCwds[tab.activePaneId]}
                      onClose={() => setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, showFiles: false } : t))}
                    />
                  </Box>
                )}
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
            <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: '#f8f9fa', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              <Box sx={{ px: 1, display: 'flex', alignItems: 'center', borderRight: 1, borderColor: 'divider', flexShrink: 0 }}>
                <TextField
                  select
                  size="small"
                  value={activeGroup}
                  onChange={(e) => setActiveGroup(e.target.value)}
                  slotProps={{ select: { native: true } }}
                  sx={{
                    minWidth: 80,
                    '& .MuiInputBase-root': { fontSize: '0.8rem', height: 26 },
                    '& select': { py: 0, pr: '18px !important' }
                  }}
                >
                  {groups.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </TextField>
              </Box>
              <Tabs
                key={`tabs-${activeGroup}-${filteredButtons.length}`}
                value={false}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{
                  flexGrow: 1,
                  minHeight: 40,
                  minWidth: 0,
                  '& .MuiTabs-flexContainer': { gap: 1, px: 2, alignItems: 'center' },
                  '& .MuiTabs-indicator': { display: 'none' }
                }}
              >
                {filteredButtons.map(btn => (
                  <Tab
                    key={btn.id}
                    label={btn.name}
                    title={btn.type + ": " + btn.payload}
                    component="div"
                    onClick={() => handleButtonClick(btn)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setBtnMenuAnchor({ anchor: e.currentTarget, btn });
                      setLastMenuBtn(btn);
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
              </Tabs>
              <Box sx={{ flexShrink: 0, px: 1, borderLeft: 1, borderColor: 'divider' }}>
                <IconButton
                  size="small"
                  onClick={() => {
                    const data = { name: '', type: 'send_string', payload: '', group: activeGroup };
                    setEditingButton(null);
                    setButtonFormData(data);
                    setInitialBtnFormData(data);
                    setButtonDialogOpen(true);
                  }}
                  sx={{ p: 0.5 }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          )}

          {(isMobile || isTouch) && tabs.length > 0 && (
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
                  onMouseDown={(e) => { e.preventDefault(); window.navigator.vibrate?.(VIBRATE_PATTERN); setIsCtrlActive(!isCtrlActive); }}
                >
                  Ctrl
                </Button>
                <Button onMouseDown={(e) => { e.preventDefault(); window.navigator.vibrate?.(VIBRATE_PATTERN); handleSendKey('\x1b'); }}>Esc</Button>
                <Button onMouseDown={(e) => { e.preventDefault(); window.navigator.vibrate?.(VIBRATE_PATTERN); handleSendKey('\x09'); }}><KeyboardTabIcon fontSize="small" /></Button>
              </ButtonGroup>
              <ButtonGroup size="small" variant="outlined">
                <Button onMouseDown={(e) => { e.preventDefault(); window.navigator.vibrate?.(VIBRATE_PATTERN); handleSendKey('\x1b[A'); }}><NorthIcon fontSize="small" /></Button>
                <Button onMouseDown={(e) => { e.preventDefault(); window.navigator.vibrate?.(VIBRATE_PATTERN); handleSendKey('\x1b[B'); }}><SouthIcon fontSize="small" /></Button>
                <Button onMouseDown={(e) => { e.preventDefault(); window.navigator.vibrate?.(VIBRATE_PATTERN); handleSendKey('\x1b[D'); }}><WestIcon fontSize="small" /></Button>
                <Button onMouseDown={(e) => { e.preventDefault(); window.navigator.vibrate?.(VIBRATE_PATTERN); handleSendKey('\x1b[C'); }}><EastIcon fontSize="small" /></Button>
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
        {memoTabId && (() => {
          const tab = tabs.find(t => t.id === memoTabId);
          if (!tab) return null;
          return (
            <>
              {tab.type !== 'scratchpad' && (tab.isPinned ? (
                <MenuItem onClick={() => handleUnpinTab(memoTabId)}>Unpin tab</MenuItem>
              ) : tab.panes.length === 1 ? (
                <MenuItem onClick={() => handlePinTab(memoTabId)}>Pin tab</MenuItem>
              ) : null)}
              {tab.panes.length === 1 && tab.type !== 'scratchpad' && (
                <>
                  {tab.panes[0]?.host !== 'local' && (
                    <MenuItem onClick={() => handleCloneSession(memoTabId)}>Clone session</MenuItem>
                  )}
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
            group: btnMenuAnchor.btn.group || 'Default'
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
              navigator.clipboard.writeText(btnMenuAnchor.btn.payload);
              setBtnMenuAnchor(null);
            }
          }}
          sx={{ display: lastMenuBtn?.type === 'send_string' ? 'flex' : 'none' }}
        >
          Copy Contents
        </MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleMoveButton(btnMenuAnchor.btn.id, -1)}>Move Button Left</MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleMoveButton(btnMenuAnchor.btn.id, 1)}>Move Button Right</MenuItem>
        <MenuItem onClick={() => btnMenuAnchor && handleDeleteButton(btnMenuAnchor.btn.id, btnMenuAnchor.btn.name)} sx={{ color: 'error.main' }}>Delete Button</MenuItem>
      </Menu>

      <Dialog open={buttonDialogOpen} onClose={handleCloseBtnDialog} fullWidth maxWidth="xs">
        <DialogTitle>{editingButton ? 'Edit Button' : 'Add Button'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField sx={{ mt: 1 }} fullWidth label="Button Name" size="small" value={buttonFormData.name} onChange={e => setButtonFormData({ ...buttonFormData, name: e.target.value })} />
          <TextField fullWidth label="Button Group" size="small" value={buttonFormData.group} onChange={e => setButtonFormData({ ...buttonFormData, group: e.target.value })} placeholder="Default" />
          <TextField
            select
            fullWidth
            label="Button Type"
            size="small"
            value={buttonFormData.type}
            onChange={e => setButtonFormData({ ...buttonFormData, type: e.target.value, payload: e.target.value === 'terminal_function' ? 'COPY' : e.target.value === 'misc' ? 'NEXT_BUTTON_GROUP' : '' })}
            slotProps={{ select: { native: true } }}
          >
            <option value="send_string">Send String</option>
            <option value="terminal_function">Terminal Function</option>
            <option value="misc">Misc</option>
            <option value="run_script">Run Script</option>
          </TextField>

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
              <option value="COPY">COPY (Buffer)</option>
              <option value="PASTE">PASTE (Clipboard)</option>
              <option value="INPUT">INPUT (Prompt)</option>
              <option value="CLEAR">CLEAR (Screen)</option>
              <option value="RESET">RESET (Terminal)</option>
              <option value="RECONNECT">RECONNECT (Session)</option>
              <option value="CLOSE">CLOSE (Pane/Tab)</option>
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
              <option value="NEXT_BUTTON_GROUP">Next Button Group</option>
              <option value="PREV_BUTTON_GROUP">Prev Button Group</option>
              <option value="OPEN_SCRATCHPAD">Open Scratchpad</option>
            </TextField>
          ) : (
            <Box sx={{ border: '1px solid #ccc', borderRadius: 1, overflow: 'hidden' }}>
              <Typography variant="body2">
                Check <a target="_blank" rel="noopener noreferrer" href="https://github.com/sagan/cozyssh/blob/master/docs/SCRIPTS.md">help</a> about scripts.
              </Typography>
              <CodeMirror
                value={buttonFormData.payload}
                height="200px"
                extensions={[javascript({ typescript: true }), EditorView.lineWrapping]}
                onChange={(value) => setButtonFormData({ ...buttonFormData, payload: value })}
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

      <Box sx={{ position: 'fixed', top: 20, right: 20, zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {toasts.map(t => (
          <Paper key={t.id} sx={{ p: 1.5, minWidth: 200, bgcolor: 'primary.main', color: 'white', display: 'flex', alignItems: 'center', boxShadow: 3 }}>
            <Typography variant="body2" sx={{ flexGrow: 1 }}>{t.msg}</Typography>
            <IconButton size="small" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} sx={{ color: 'white', ml: 1 }}>
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </Paper>
        ))}
      </Box>
    </ThemeProvider>
  );
}
