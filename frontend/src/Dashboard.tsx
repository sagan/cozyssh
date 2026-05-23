import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from "react-router";
import { Box, CssBaseline, createTheme, ThemeProvider, IconButton, Typography, useMediaQuery, useTheme, Drawer, Dialog, DialogTitle, DialogContent } from '@mui/material';
import Sidebar from './Sidebar';
import type { TerminalHandle } from './Terminal';
import type { ScratchpadHandle } from './Scratchpad';
import CloseIcon from '@mui/icons-material/Close';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useLocalStorage } from './useLocalStorage';
import { DEFAULT_SCROLL_LINES, MISC_FUNCTIONS } from './constants';
import { useDashboardStore, getStore } from './dashboardStore';
import type { TabData, ButtonData } from './dashboardStore';
import { defaultTheme, getIntVar } from './common';
import { setupPluginAPI, runScript } from './pluginAPI';
import { useKeyboardManager } from './useKeyboardManager';
import TabBar from './TabBar';
import TerminalGrid from './TerminalGrid';
import ButtonBar from './ButtonBar';
import DialogManager from './DialogManager';
import AppletWrapper, { type AppletData } from './AppletWrapper';

const VIBRATE_PATTERN = 100;

interface DashboardProps {
  initialData?: any;
}

export default function Dashboard({ initialData }: DashboardProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTouch = useMediaQuery('(pointer: coarse)');
  // ── Store state (shared with pluginAPI and keyboard manager) ────────────
  const {
    tabs, setTabs,
    activeTabId, setActiveTabId,
    activePaneId, setActivePaneId,
    hosts, setHosts,
    buttons, setButtons,
    vars, setVars,

  } = useDashboardStore();

  // ── UI-only state (stays in React) ────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; targetTabId: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileAppletsOpen, setMobileAppletsOpen] = useState(false);
  // terminalRefs is kept as a local ref for all Dashboard-internal usage,
  // and also written into the store so pluginAPI / useKeyboardManager can read it.
  const terminalRefs = useRef<{ [key: string]: TerminalHandle | ScratchpadHandle | null }>({});
  const [viewportHeight, setViewportHeight] = useState('100dvh');
  const [isCtrlActive, setIsCtrlActive] = useState(false);
  const [isAltActive, setIsAltActive] = useState(false);
  const [scratchpadSyncState, setScratchpadSyncState] = useState<'offline' | 'syncing' | 'synced' | 'dirty'>('offline');
  const [memoTabId, setMemoTabId] = useState<string | null>(null);
  const [unreadTabIds, setUnreadTabIds] = useState<Set<string>>(new Set());
  const [applets, setApplets] = useState<AppletData[]>([]);
  const maxZIndexRef = useRef(10000);
  const swipeStartRef = useRef<{ x: number, y: number, time: number } | null>(null);

  // ── Mobile bar state ─────────────────────────────────────────────────────
  /** When true, swipe gestures on the terminal send arrow keys instead of switching tabs */
  const [gestureMode, setGestureMode] = useState(false);
  /** When true, the extra-keys panel is visible and the system keyboard is suppressed */
  const [extraKeysOpen, setExtraKeysOpen] = useState(false);
  /** Height of the on-screen keyboard in px (0 when hidden) */
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [activeGroup, setActiveGroup] = useState<string>(localStorage.getItem('cozy_active_group') || 'Default');
  const [buttonDialogOpen, setButtonDialogOpen] = useState(false);
  const [editingButton, setEditingButton] = useState<ButtonData | null>(null);
  const [buttonFormData, setButtonFormData] = useState({ name: '', type: 'send_string', payload: '', group: 'Default', autorun: 0, order: 0, shortcut: '' });
  const [initialBtnFormData, setInitialBtnFormData] = useState<any>(null);
  const [btnMenuAnchor, setBtnMenuAnchor] = useState<{ anchor: HTMLElement, btn: ButtonData } | null>(null);
  const [lastMenuBtn, setLastMenuBtn] = useState<ButtonData | null>(null);
  const handleNewButtonClick = () => {
    const maxOrder = buttons.length > 0 ? Math.max(...buttons.map(b => b.order || 0)) : 0;
    const data = { name: '', type: 'send_string', payload: '', group: activeGroup, autorun: 0, order: maxOrder + 10 || 10, shortcut: '' };
    setEditingButton(null);
    setButtonFormData(data);
    setInitialBtnFormData(data);
    setButtonDialogOpen(true);
  };
  const [buttonsLoaded, setButtonsLoaded] = useState(false);
  const [inputDialogOpen, setInputDialogOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [appendNewLine, setAppendNewLine] = useState(true);
  const [sendScope, setSendScope] = useState<0 | 1 | 2>(0);
  const [toasts, setToasts] = useState<{ id: number; msg: string; severity: 'success' | 'info' | 'warning' | 'error' }[]>([]);
  const toastIdRef = useRef(0);
  const [recents, setRecents] = useLocalStorage<{ host: string, last_used: number }[]>('cozy_recents', []);
  const [newTabDialogOpen, setNewTabDialogOpen] = useState(false);
  const [newTabDialogInitialViewMode, setNewTabDialogInitialViewMode] = useState<'servers' | 'tabs' | 'buttons' | undefined>('servers');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // localVars uses useLocalStorage for persistence; synced into store for pluginAPI
  const [localVars, setLocalVars] = useLocalStorage<Record<string, string | undefined>>("cozy_localvars", {});
  useEffect(() => { useDashboardStore.getState().setLocalVars(localVars); }, [localVars]);

  // sendScope needs to be readable from stable callbacks
  const sendScopeRef = useRef<0 | 1 | 2>(0);
  useEffect(() => { sendScopeRef.current = sendScope; }, [sendScope]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('cs:terminal-change', { detail: { activePaneId } }));
  }, [activePaneId]);

  const csNotify = (msg: string, severity: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    toastIdRef.current++;
    const id = toastIdRef.current;
    setToasts(prev => {
      const newToasts = [...prev, { id, msg, severity }];
      return newToasts.slice(-3); // Keep last 3
    });
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
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

  const [groups, filteredButtons] = useMemo(() => {
    const groups = ['Default', ...Array.from(new Set(buttons.map(b => b.group || 'Default').filter(g => g !== 'Default')))].sort();
    const filteredButtons = buttons.filter(b => (b.group || 'Default') === activeGroup);
    return [groups, filteredButtons];
  }, [buttons, activeGroup]);

  useEffect(() => {
    if (buttonsLoaded && !groups.includes(activeGroup)) {
      setActiveGroup('Default');
    }
  }, [groups, buttonsLoaded, activeGroup]);

  useEffect(() => {
    (window as any).csGetApplet = (name?: string) => {
      return name ? applets.find(a => a.name === name) : applets;
    }
    return () => {
      delete (window as any).csGetApplet;
    };
  }, [applets]);

  const handleSelectHost = React.useCallback(async (host: string, customTitle?: string) => {
    const id = Math.random().toString(36).substring(2);
    console.log('handleSelectHost called for:', host, customTitle, 'ID:', id);
    const newTab: TabData = {
      id: id,
      title: customTitle || host,
      panes: [{ id: id, host }],
      activePaneId: id,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setActivePaneId(id);

    // Record recent
    if (host !== 'local') {
      const token = localStorage.getItem('cozy_token');
      try {
        fetch('/api/recents', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ host })
        });

        // Optimistic update for local recents
        setRecents(prev => {
          const now = Math.floor(Date.now() / 1000);
          const idx = prev.findIndex(r => r.host === host);
          const next = [...prev];
          if (idx >= 0) {
            next[idx] = { ...next[idx], last_used: now };
          } else {
            next.push({ host, last_used: now });
          }
          return next.sort((a, b) => b.last_used - a.last_used).slice(0, 50);
        });
      } catch (e) {
        console.error('Failed to record recent:', e);
      }
    }
  }, [setRecents]);

  const handleSelectTagAsSplit = React.useCallback((tag: string, hosts: string[]) => {
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
  }, []);

  const handleAttach = React.useCallback(async (id: string, host: string, title: string, isLocked: boolean = false) => {
    const existing = getStore().tabs.find(t => t.panes.some(p => (p.sessionId || p.id) === id && p.state !== 'stolen'));
    if (existing) {
      setActiveTabId(existing.id);
      setActivePaneId(existing.panes.find(p => (p.sessionId || p.id) === id && p.state !== 'stolen')?.id || existing.activePaneId);
      return;
    }
    const token = localStorage.getItem('cozy_token');
    await fetch('/api/sessions/attach', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const frontendId = `${id}-${Date.now()}`;
    setTabs(prev => [...prev, { id: frontendId, panes: [{ id: frontendId, sessionId: id, host }], activePaneId: frontendId, title, isPinned: true, isLocked }]);
    setActiveTabId(frontendId);
    setActivePaneId(frontendId);
  }, [tabs]);

  const handleRefresh = React.useCallback(async () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Plugin API setup (single stable effect — no stale closures) ──────────
  useEffect(() => {
    return setupPluginAPI({
      notify: csNotify,
      setTheme: (options, ...args) => setMuiTheme(createTheme(options, ...args)),
      handleSelectHost,
      handleSelectTagAsSplit,
      handleAttach,
      handleRefresh,
      setApplets,
      setMobileAppletsOpen,
      isMobile,
      maxZIndexRef,
      setLocalVars,
      getTerminalRefs: () => terminalRefs.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // csGetApplet needs the reactive applets list — keep as a tiny separate effect
  useEffect(() => {
    (window as any).csGetApplet = (name?: string) =>
      name ? applets.find(a => a.name === name) : applets;
    return () => { delete (window as any).csGetApplet; };
  }, [applets]);

  const handleCloseInputDialog = () => {
    setInputDialogOpen(false);
    setTimeout(() => {
      terminalRefs.current[activePaneId]?.focus();
    }, 50);
  };

  const handleCloseSearch = () => {
    setSearchOpen(false);
    const term = terminalRefs.current[activePaneId] as any;
    term?.clearSearchDecorations?.();
    setTimeout(() => term?.focus?.(), 50);
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
    const scope = sendScopeRef.current;
    const { tabs: currentTabs, activeTabId: currentActiveTabId, activePaneId: currentActivePaneId } = getStore();
    let targetPaneIds: string[] = [];
    if (scope === 2) {
      targetPaneIds = currentTabs.flatMap(t => t.panes.map(p => p.id));
    } else if (scope === 1) {
      const currentTab = currentTabs.find(t => t.id === currentActiveTabId);
      targetPaneIds = currentTab ? currentTab.panes.map(p => p.id) : [currentActivePaneId];
    } else {
      targetPaneIds = [currentActivePaneId];
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

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isTouch || !isMobile || gestureMode) return; // gesture mode uses native listeners
    const touch = e.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isTouch || !isMobile || gestureMode || !swipeStartRef.current) return;
    const touch = e.changedTouches[0];
    const diffX = touch.clientX - swipeStartRef.current.x;
    const diffY = touch.clientY - swipeStartRef.current.y;
    const diffTime = Date.now() - swipeStartRef.current.time;
    swipeStartRef.current = null;

    // Thresholds: move at least 100px, mostly horizontal, within 500ms
    if (Math.abs(diffX) > 100 && Math.abs(diffX) > Math.abs(diffY) * 2 && diffTime < 500) {
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      if (diffX > 0 && currentIndex > 0) {
        const newTab = tabs[currentIndex - 1];
        window.navigator.vibrate?.(VIBRATE_PATTERN);
        setActiveTabId(newTab.id);
        setActivePaneId(newTab.activePaneId);
        setTimeout(() => terminalRefs.current[newTab.activePaneId]?.focus(), 50);
      } else if (diffX < 0 && currentIndex < tabs.length - 1) {
        const newTab = tabs[currentIndex + 1];
        window.navigator.vibrate?.(VIBRATE_PATTERN);
        setActiveTabId(newTab.id);
        setActivePaneId(newTab.activePaneId);
        setTimeout(() => terminalRefs.current[newTab.activePaneId]?.focus(), 50);
      }
    }
  };

  const tabId = useRef(sessionStorage.getItem('cozy_tab_id') || Math.random().toString());

  useEffect(() => {
    sessionStorage.setItem('cozy_tab_id', tabId.current);
  }, []);

  // 1. Add this ref right above the visualViewport useEffect
  const extraKeysOpenRef = useRef(extraKeysOpen);
  useEffect(() => { extraKeysOpenRef.current = extraKeysOpen; }, [extraKeysOpen]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleVVResize = () => {
      setViewportHeight(`${vv.height}px`);
      // ALWAYS calculate from vv.height so the math perfectly cancels out during animation
      setKeyboardHeight(Math.max(0, window.innerHeight - vv.height));
    };
    vv.addEventListener('resize', handleVVResize);
    handleVVResize();
    return () => vv.removeEventListener('resize', handleVVResize);
  }, []);

  // ── VirtualKeyboard API setup ───────────────────────────────────────────
  useEffect(() => {
    const vk = (navigator as any).virtualKeyboard;
    if (!vk) return;
    // Opt-in: keyboard overlays content instead of resizing the viewport.
    // This lets us position our bar precisely at keyboardHeight.
    vk.overlaysContent = true;
    const handleGeometryChange = () => {
      setKeyboardHeight(vk.boundingRect?.height ?? 0);
    };
    vk.addEventListener('geometrychange', handleGeometryChange);
    return () => {
      vk.removeEventListener('geometrychange', handleGeometryChange);
      // Restore default behaviour on unmount
      vk.overlaysContent = false;
    };
  }, []);

  // ── Keep inputmode in sync with extraKeysOpen across tab/pane changes ────
  // When the extra-keys panel is open, every terminal that becomes active must
  // have inputmode="none" so the system keyboard stays suppressed.  We also
  // call vk.hide() explicitly for the VirtualKeyboard API path.
  useEffect(() => {
    const applyMode = () => {
      if (extraKeysOpen) {
        // Only suppress the active terminal
        const term = terminalRefs.current[activePaneId] as any;
        const textarea = term?.getXterm?.()?.textarea as HTMLTextAreaElement | undefined;
        if (textarea) textarea.inputMode = 'none';
        // Belt-and-suspenders: force-hide via VK API
        (navigator as any).virtualKeyboard?.hide?.();
      } else {
        // Restore all terminals so the keyboard can appear naturally again
        for (const term of Object.values(terminalRefs.current)) {
          const textarea = (term as any)?.getXterm?.()?.textarea as HTMLTextAreaElement | undefined;
          if (textarea && textarea.inputMode === 'none') textarea.inputMode = '';
        }
      }
    };

    applyMode();
    // Newly-opened tabs mount their xterm asynchronously; retry after a short
    // delay to make sure the textarea exists when we try to patch it.
    const t = setTimeout(applyMode, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraKeysOpen, activePaneId]);

  const [sysHostname, setSysHostname] = useState<string>('');
  const [appVersion, setAppVersion] = useState<string>('dev');

  // Listen for activeGroup changes dispatched by useKeyboardManager
  useEffect(() => {
    const handler = (e: Event) => {
      const group = (e as CustomEvent).detail?.group;
      if (group) setActiveGroup(group);
    };
    window.addEventListener('cs:active-group-change', handler);
    return () => window.removeEventListener('cs:active-group-change', handler);
  }, []);

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
    if (data.vars) {
      setVars(data.vars || {});
    }
    if (data.recents) {
      setRecents(data.recents);
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

  const [startupParams] = useSearchParams();

  const initted = useRef(false);
  useEffect(() => {
    if (initted.current) return;
    initted.current = true;
    const autoload = startupParams.get('noautoload') !== '1';
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
          const hasPinned = getStore().tabs.some(t => t.isPinned);
          if (hasPinned) bc?.postMessage('pinned_present');
        }
        if (e.data === 'pinned_present') pinnedElsewhere = true;
      };

      console.log('initAsync starting, hash:', hash);
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
          const initialId = `local-${Date.now()}`;
          setTabs([{ id: initialId, panes: [{ id: initialId, host: 'local' }], activePaneId: initialId, title: 'local' }]);
          setActiveTabId(initialId);
          setActivePaneId(initialId);
          return;
        }
      }

      loadFullData(data);

      bc!.postMessage('probe_pinned');

      setTimeout(() => {
        const pinnedTabsData: any[] = data.pinned || [];
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
            const host = hash !== "local" ? hostsData.find(h => hash.includes("@") ? hash == `${h.user || "root"}@${h.hostname}` : h.name === hash || h.hostname === hash) : { name: "local" };
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
        } else if (autoload) {
          if (!pinnedElsewhere) {
            // Only auto-open tabs that are not currently in use by any client
            const availablePins = pinnedTabsData.filter((p: any) => !p.listenerCount || p.listenerCount === 0);
            const pinnedTabs = availablePins.map((p: any) => {
              const paneId = p.id;
              return { id: p.id, panes: [{ id: paneId, host: p.host }], activePaneId: paneId, title: p.title, isPinned: true, isLocked: p.isLocked };
            });
            if (pinnedTabs.length > 0) {
              setTabs(prev => prev.length > 0 ? prev : pinnedTabs);
              if (!getStore().activeTabId) setActiveTabId(pinnedTabs[0].id);
              if (!getStore().activePaneId) setActivePaneId(pinnedTabs[0].activePaneId);
            } else {
              const initialId = `local-${Date.now()}`;
              const initialPaneId = Math.random().toString(36).substring(2);
              setTabs(prev => prev.length > 0 ? prev : [{ id: initialId, panes: [{ id: initialPaneId, host: 'local' }], activePaneId: initialPaneId, title: 'local' }]);
              if (!getStore().activeTabId) setActiveTabId(initialId);
              if (!getStore().activePaneId) setActivePaneId(initialPaneId);
            }
          } else {
            const initialId = `local-${Date.now()}`;
            const initialPaneId = Math.random().toString(36).substring(2);
            setTabs(prev => prev.length > 0 ? prev : [{ id: initialId, panes: [{ id: initialPaneId, host: 'local' }], activePaneId: initialPaneId, title: 'local' }]);
            if (!getStore().activeTabId) setActiveTabId(initialId);
            if (!getStore().activePaneId) setActivePaneId(initialPaneId);
          }
        }
      }, 350);
    };

    initAsync();

    return () => {
      if (bc) bc.close();
    };
  }, [initialData, handleSelectTagAsSplit, handleSelectHost, startupParams]); // Run ONLY once on mount

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
      await fetch('/api/sessions/close_all_normal', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
      await fetch('/api/logout', { headers: { 'Authorization': `Bearer ${token}` } });
    }
    localStorage.clear();
    if (window.caches) {
      await caches.delete('api-data-cache');
      await caches.delete('manifest-cache');
    }
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


  const handleCloseTab = (e: React.MouseEvent | null, id: string) => {
    e?.stopPropagation();
    const targetTab = tabs.find(t => t.id === id);
    if (targetTab?.isPinned && !targetTab?.isLocked) {
      handleUnpinTab(id);
    }
    if (targetTab && !targetTab.isLocked) {
      const token = localStorage.getItem('cozy_token');
      targetTab.panes.forEach(p => {
        if (p.state !== 'stolen') {
          fetch('/api/sessions/close', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: p.sessionId || p.id })
          }).catch(e => console.error(e));
        }
      });
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
    setTimeout(() => terminalRefs.current[getStore().activePaneId]?.focus(), 50);
  };

  const handleCloseCurrentPaneOrTab = () => {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab) return;
    if (currentTab.panes.length > 1) {
      const paneIdx = currentTab.panes.findIndex(p => p.id === activePaneId);
      const newPanes = currentTab.panes.filter(p => p.id !== activePaneId);
      const nextPaneId = newPanes[Math.max(0, paneIdx - 1)].id;

      if (!currentTab.isLocked) {
        const paneToClose = currentTab.panes.find(p => p.id === activePaneId);
        if (paneToClose && paneToClose.state !== 'stolen') {
          const token = localStorage.getItem('cozy_token');
          fetch('/api/sessions/close', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: paneToClose.sessionId || paneToClose.id })
          }).catch(e => console.error(e));
        }
      }
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, panes: newPanes, activePaneId: nextPaneId } : t));
      setActivePaneId(nextPaneId);
    } else {
      handleCloseTab(null, activeTabId);
    }
  };

  const handlePinTab = async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    if (tab.panes.length > 1) {
      alert("Only single-pane tabs can be pinned.");
      return;
    }
    const pane = tab.panes[0];
    if (!pane) return;
    const backendSessionId = pane.sessionId || pane.id;
    const token = localStorage.getItem('cozy_token');
    // Pinning only supports single-pane tabs for now (backend requirement)
    const host = pane.host || 'local';
    await fetch('/api/tabs/pin', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: backendSessionId, host, title: tab.title })
    });
    setTabs(prev => prev.map(t => t.id === id ? { ...t, isPinned: true } : t));
    setContextMenu(null);
  };

  const handleUnpinTab = async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    const backendSessionId = tab.panes[0]?.sessionId || tab.panes[0]?.id || id;
    const token = localStorage.getItem('cozy_token');
    await fetch('/api/tabs/unpin', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: backendSessionId })
    });
    setContextMenu(null);
  };

  const handleLockTab = async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    if (tab.panes.length > 1) {
      alert("Only single-pane tabs can be locked.");
      return;
    }
    const pane = tab.panes[0];
    if (!pane) return;
    const backendSessionId = pane.sessionId || pane.id;
    const token = localStorage.getItem('cozy_token');
    const host = pane.host || 'local';
    await fetch('/api/tabs/lock', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: backendSessionId, host, title: tab.title })
    });
    setTabs(prev => prev.map(t => t.id === id ? { ...t, isLocked: true } : t));
    setContextMenu(null);
  };

  const handleUnlockTab = async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    if (tab.panes.length > 1) {
      alert("Only single-pane tabs can be unlocked.");
      return;
    }
    const pane = tab.panes[0];
    if (!pane) return;
    const paneId = pane.sessionId || pane.id;
    const token = localStorage.getItem('cozy_token');
    const host = pane.host || 'local';
    await fetch('/api/tabs/pin', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: paneId, host, title: tab.title })
    });
    setTabs(prev => prev.map(t => t.id === id ? { ...t, isLocked: false } : t));
    if (activeTabId === id) setActiveTabId(paneId);
    setContextMenu(null);
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
        const backendSessionId = targetTab.panes[0]?.sessionId || targetTab.panes[0]?.id || targetId;
        await fetch('/api/tabs/rename', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: backendSessionId, title: newTitle })
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
    const backendSessionId = pane.sessionId || pane.id;
    setTabs(prev => [...prev, {
      id: newId,
      title: targetTab.title + ' (1)',
      panes: [{ id: newPaneId, host: pane.host, cloneFrom: backendSessionId, state: pane.state }],
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

  const handleButtonClick = async (btn: ButtonData) => {
    window.navigator.vibrate?.(VIBRATE_PATTERN);
    switch (btn.type) {
      case 'send_string':
        await sendParsedString(btn.payload);
        terminalRefs.current[activePaneId]?.focus();
        break;

      case 'open_terminal':
        handleSelectHost(btn.payload || 'local');
        break;

      case 'terminal_function': {
        const term = terminalRefs.current[activePaneId] as any;
        if (!term) return;
        switch (btn.payload) {
          case 'COPY':
            term.selectAll?.();
            const textCopy = term.getSelection?.()?.trim();
            if (textCopy) {
              navigator.clipboard.writeText(textCopy);
            }
            term.clearSelection?.();
            term.focus?.();
            break;

          case 'COPY_VISIBLE': {
            const xterm = term?.getXterm?.();
            if (!xterm) {
              return;
            }
            const buffer = xterm.buffer.active;
            const start = buffer.viewportY;
            const end = start + xterm.rows;
            let text = "";
            for (let i = start; i < end; i++) {
              const line = buffer.getLine(i);
              if (line) {
                text += line.translateToString().trim() + "\n";
              }
            }
            text = text.trim();
            if (text) {
              navigator.clipboard.writeText(text);
            }
            term.focus?.();
            break;
          }

          case 'COPY_SELECTION': {
            const text = term.getSelection?.();
            if (text) {
              navigator.clipboard.writeText(text);
            }
            term.focus?.();
            break;
          }

          case 'COPY_LAST_COMMAND_OUTPUT': {
            const text = term.getLastCommandOutput?.();
            if (text) {
              navigator.clipboard.writeText(text);
            }
            term.focus?.();
            break;
          }

          case 'PASTE': {
            const text = await navigator.clipboard.readText();
            if (text) {
              term.sendData?.(text);
            }
            term.focus?.();
            break;
          }

          case 'INPUT':
            setInputValue('');
            setSendScope(0);
            setInputDialogOpen(true);
            break;

          case 'CLEAR':
            term.clear?.();
            term.focus?.();
            break;

          case 'RESET':
            term.reset?.();
            term.focus?.();
            break;

          case 'RECONNECT':
            term.reconnect?.();
            term.focus?.();
            break;

          case 'CLOSE':
            handleCloseCurrentPaneOrTab();
            break;

          case 'SCROLL_TO_TOP':
            term.scrollToTop?.();
            term.focus?.();
            break;

          case 'SCROLL_TO_BOTTOM':
            term.scrollToBottom?.();
            term.focus?.();
            break;

          case 'SCROLL_UP': {
            const scrollLines = getIntVar(getStore().vars, getStore().localVars, 'cs_scroll_lines', DEFAULT_SCROLL_LINES);
            term.scrollLines?.(-scrollLines);
            term.focus?.();
            break;
          }

          case 'SCROLL_DOWN': {
            const scrollLines = getIntVar(getStore().vars, getStore().localVars, 'cs_scroll_lines', DEFAULT_SCROLL_LINES);
            term.scrollLines?.(scrollLines);
            term.focus?.();
            break;
          }

          case 'SCROLL_PAGE_UP':
            term.scrollPages?.(-1);
            term.focus?.();
            break;

          case 'SCROLL_PAGE_DOWN':
            term.scrollPages?.(1);
            term.focus?.();
            break;

          case 'SEARCH':
            setSearchOpen(true);
            setTimeout(() => searchInputRef.current?.focus(), 100);
            break;

          default:
            break;
        }
        break;
      }

      case 'misc':
        switch (btn.payload) {
          case 'NEXT_BUTTON_GROUP': {
            const idx = groups.indexOf(activeGroup);
            const nextIdx = (idx + 1) % groups.length;
            setActiveGroup(groups[nextIdx]);
            break;
          }
          case 'PREV_BUTTON_GROUP': {
            const idx = groups.indexOf(activeGroup);
            const prevIdx = (idx - 1 + groups.length) % groups.length;
            setActiveGroup(groups[prevIdx]);
            break;
          }
          case 'OPEN_SCRATCHPAD':
            handleOpenScratchpad();
            break;
          default:
            break;
        }
        terminalRefs.current[activePaneId]?.focus();
        break;

      case 'run_script':
        await runScript(btn, csNotify, () => terminalRefs.current);
        break;

      default:
        break;
    }
  };

  // ── Keyboard shortcuts (reads fresh state from store — tiny stable dep array) ──
  useKeyboardManager({
    handleButtonClick,
    handleSelectHost,
    handleOpenScratchpad,
    handleCloseCurrentPaneOrTab,
    setNewTabDialogOpen,
    setNewTabDialogInitialViewMode,
    searchInputRef,
    setSearchOpen,
    getTerminalRefs: () => terminalRefs.current,
  });

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

  const noautorun = getIntVar(vars, localVars, "cs_noautorun");

  useEffect(() => {
    if ((window as any).__CS_AUTORUN_DONE__ === undefined && buttonsLoaded) {
      (window as any).__CS_AUTORUN_DONE__ = 0;
      (async () => {
        if (noautorun !== 1 && startupParams.get("noautorun") !== "1") {
          const scriptsToRun = buttons.filter(b => b.type === 'run_script' && b.autorun === 1);
          for (const btn of scriptsToRun) {
            try {
              await handleButtonClick(btn);
            } catch (e) {
              console.error(`Autorun script ${btn.name} error:`, e);
            }
          }
        }
        (window as any).__CS_AUTORUN_DONE__ = 1;
      })();
    }
  }, [startupParams, buttonsLoaded, buttons, noautorun]);

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
    setTimeout(() => (window as any).csFocus?.(), 0);
  };


  const [lastKeyboardHeight, setLastKeyboardHeight] = useState(0);

  // 1. Bring back a safe tracking state just for the closing transition
  const [isClosingPanel, setIsClosingPanel] = useState(false);
  const prevExtraKeysOpen = useRef(extraKeysOpen);

  useEffect(() => {
    if (keyboardHeight > 60) setLastKeyboardHeight(keyboardHeight);
  }, [keyboardHeight]);

  // 2. Track when the panel closes to hold the spacer momentarily
  useEffect(() => {
    if (prevExtraKeysOpen.current === true && extraKeysOpen === false) {
      setIsClosingPanel(true);
      const timer = setTimeout(() => setIsClosingPanel(false), 350);
      return () => clearTimeout(timer);
    }
    prevExtraKeysOpen.current = extraKeysOpen;
  }, [extraKeysOpen]);

  const activeKbHeight = keyboardHeight > 60 ? keyboardHeight : lastKeyboardHeight;
  const panelHeight = activeKbHeight > 60 ? (activeKbHeight + 40) : Math.round(window.innerHeight * 0.38);

  const barHeight = extraKeysOpen ? 0 : 40;

  // 3. CRITICAL FIX: Only calculate the spacer if the panel is open or closing.
  // Otherwise, it must be exactly 0 (like on initial page load).
  const spacerHeight = (extraKeysOpen || isClosingPanel)
    ? Math.max(0, panelHeight - keyboardHeight - barHeight)
    : 0;


  const [muiTheme, setMuiTheme] = useState(defaultTheme);

  return (
    <ThemeProvider theme={muiTheme}>
      <Box id="main-ui" sx={{ display: 'flex', height: viewportHeight, overflow: 'hidden' }}>
        <CssBaseline />
        <Sidebar
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          onSelect={(host) => { handleSelectHost(host); setMobileOpen(false); }}
          onSelectTagAsSplit={(tag, hosts) => { handleSelectTagAsSplit(tag, hosts); setMobileOpen(false); }}
          onLogout={handleLogout}
          activeTabs={tabs.flatMap(t => t.panes.filter((p: any) => p.state !== 'stolen').map((p: any) => p.sessionId || p.id))}
          sysHostname={sysHostname}
          appVersion={appVersion}
          onAttach={(id, host, title, isLocked) => { handleAttach(id, host, title, isLocked); setMobileOpen(false); }}
          onRefresh={() => { handleRefresh(); setMobileOpen(false); }}
          hosts={hosts}
          fetchHosts={fetchHosts}
          onOpenScratchpad={() => { handleOpenScratchpad(); setMobileOpen(false); }}
        />
        <Box
          component="main"
          style={{
            // Pass the calculated height perfectly to CSS
            '--keyboard-spacer-height': spacerHeight
          } as React.CSSProperties}
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            position: 'relative',
          }}
        >
          <TabBar
            mobileOpen={mobileOpen}
            setMobileOpen={setMobileOpen}
            mobileAppletsOpen={mobileAppletsOpen}
            setMobileAppletsOpen={setMobileAppletsOpen}
            searchOpen={searchOpen}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchInputRef={searchInputRef}
            terminalRefs={terminalRefs}
            unreadTabIds={unreadTabIds}
            isMobile={isMobile}
            applets={applets}
            scratchpadSyncState={scratchpadSyncState}
            handleContextMenu={handleContextMenu}
            handleCloseTab={handleCloseTab}
            handleCloseSearch={handleCloseSearch}
            setNewTabDialogInitialViewMode={setNewTabDialogInitialViewMode}
            setNewTabDialogOpen={setNewTabDialogOpen}
          />
          <TerminalGrid
            terminalRefs={terminalRefs}
            isCtrlActive={isCtrlActive}
            setIsCtrlActive={setIsCtrlActive}
            isAltActive={isAltActive}
            setIsAltActive={setIsAltActive}
            scratchpadSyncState={scratchpadSyncState}
            setScratchpadSyncState={setScratchpadSyncState}
            handleTerminalData={handleTerminalData}
            isTouch={isTouch}
            isMobile={isMobile}
            mobileAppletsOpen={mobileAppletsOpen}
            setMobileAppletsOpen={setMobileAppletsOpen}
            applets={applets}
            setMobileOpen={setMobileOpen}
            setNewTabDialogOpen={setNewTabDialogOpen}
            setNewTabDialogInitialViewMode={setNewTabDialogInitialViewMode}
            handleTouchStart={handleTouchStart}
            handleTouchEnd={handleTouchEnd}
            handleSendKey={handleSendKey}
            VIBRATE_PATTERN={VIBRATE_PATTERN}
            gestureMode={gestureMode}
            onGestureModeChange={setGestureMode}
            extraKeysOpen={extraKeysOpen}
            onExtraKeysOpenChange={setExtraKeysOpen}
            keyboardHeight={keyboardHeight}
            getActiveTerminal={() => terminalRefs.current[activePaneId]}
          />
          <ButtonBar
            activeGroup={activeGroup}
            setActiveGroup={setActiveGroup}
            groups={groups}
            filteredButtons={filteredButtons}
            handleButtonClick={handleButtonClick}
            setBtnMenuAnchor={setBtnMenuAnchor}
            setLastMenuBtn={setLastMenuBtn}
            onNewButtonClick={handleNewButtonClick}
          />
          <Box
            sx={{
              flexShrink: 0,
              order: 9999,
              height: `${spacerHeight}px`, // Controlled strictly by React math
              width: '100%',
            }}
          />
        </Box>
        {applets.filter(a => a.position === 'sidebar').length > 0 && (
          isMobile ? (
            <Drawer
              anchor="right"
              open={mobileAppletsOpen}
              onClose={() => setMobileAppletsOpen(false)}
              sx={{ '& .MuiDrawer-paper': { width: 320, boxSizing: 'border-box' } }}
            >
              <Box sx={{ px: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Applets</Typography>
                <IconButton onClick={() => setMobileAppletsOpen(false)}>
                  <CloseIcon />
                </IconButton>
              </Box>
              <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
                {applets.filter(a => a.position === 'sidebar').map((applet, idx) => (
                  <AppletWrapper
                    key={applet.name}
                    applet={applet}
                    index={idx}
                    onClose={() => setApplets(prev => prev.filter(a => a.name !== applet.name))}
                    onSwitchPosition={(pos) => setApplets(prev => prev.map(a => a.name === applet.name ? { ...a, position: pos } : a))}
                  />
                ))}
              </Box>
            </Drawer>
          ) : (
            <Box sx={{ width: 320, flexShrink: 0, borderLeft: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', overflow: 'hidden', height: '100%' }}>
              {applets.filter(a => a.position === 'sidebar').map((applet, idx) => (
                <AppletWrapper
                  key={applet.name}
                  applet={applet}
                  index={idx}
                  onClose={() => setApplets(prev => prev.filter(a => a.name !== applet.name))}
                  onSwitchPosition={(pos) => setApplets(prev => prev.map(a => a.name === applet.name ? { ...a, position: pos } : a))}
                />
              ))}
            </Box>
          )
        )}
      </Box>

      {applets.filter(a => a.position === 'widget').map((applet, idx) => (
        <AppletWrapper
          key={applet.name}
          applet={applet}
          index={idx}
          onClose={() => setApplets(prev => prev.filter(a => a.name !== applet.name))}
          onSwitchPosition={(pos) => setApplets(prev => prev.map(a => a.name === applet.name ? { ...a, position: pos } : a))}
          onFocus={() => setApplets(prev => prev.map(a => a.name === applet.name ? { ...a, zIndex: maxZIndexRef.current++ } : a))}
        />
      ))}

      {applets.filter(a => a.position === 'dialog').map((applet) => (
        <Dialog
          key={applet.name}
          open
          onClose={() => setApplets(prev => prev.filter(a => a.name !== applet.name))}
          fullWidth
          maxWidth={false}
          slotProps={{ paper: { sx: { width: applet.width ?? 600, maxWidth: '95vw', height: applet.height ?? undefined } } }}
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', p: 1, pl: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 'bold' }}>{applet.name}</Typography>
            <IconButton size="small" title="Move to sidebar" onClick={() => setApplets(prev => prev.map(a => a.name === applet.name ? { ...a, position: 'sidebar' } : a))} sx={{ mr: 0.5 }}>
              <ViewSidebarIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" title="Move to widget" onClick={() => setApplets(prev => prev.map(a => a.name === applet.name ? { ...a, position: 'widget', zIndex: maxZIndexRef.current++ } : a))} sx={{ mr: 0.5 }}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => setApplets(prev => prev.filter(a => a.name !== applet.name))}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
            <AppletWrapper
              applet={applet}
              index={0}
              onClose={() => setApplets(prev => prev.filter(a => a.name !== applet.name))}
              onSwitchPosition={(pos) => setApplets(prev => prev.map(a => a.name === applet.name ? { ...a, position: pos } : a))}
            />
          </DialogContent>
        </Dialog>
      ))}

      <DialogManager
        contextMenu={contextMenu}
        handleCloseMenu={handleCloseMenu}
        memoTabId={memoTabId}
        handleUnpinTab={handleUnpinTab}
        handlePinTab={handlePinTab}
        handleUnlockTab={handleUnlockTab}
        handleLockTab={handleLockTab}
        handleCloneSession={handleCloneSession}
        handleToggleFiles={handleToggleFiles}
        handleReconnectTab={handleReconnectTab}
        handleRename={handleRename}
        handleCloseOther={handleCloseOther}
        handleCloseRight={handleCloseRight}
        btnMenuAnchor={btnMenuAnchor}
        setBtnMenuAnchor={setBtnMenuAnchor}
        lastMenuBtn={lastMenuBtn}
        handleMoveButton={handleMoveButton}
        handleDeleteButton={handleDeleteButton}
        buttonDialogOpen={buttonDialogOpen}
        editingButton={editingButton}
        buttonFormData={buttonFormData}
        setButtonFormData={setButtonFormData}
        handleCloseBtnDialog={handleCloseBtnDialog}
        handleSaveButton={handleSaveButton}
        MISC_FUNCTIONS={MISC_FUNCTIONS}
        hosts={hosts}
        inputDialogOpen={inputDialogOpen}
        handleCloseInputDialog={handleCloseInputDialog}
        inputValue={inputValue}
        setInputValue={setInputValue}
        appendNewLine={appendNewLine}
        setAppendNewLine={setAppendNewLine}
        sendScope={sendScope}
        setSendScope={setSendScope}
        sendParsedString={sendParsedString}
        newTabDialogOpen={newTabDialogOpen}
        setNewTabDialogOpen={setNewTabDialogOpen}
        recents={recents}
        newTabDialogInitialViewMode={newTabDialogInitialViewMode}
        setEditingButton={setEditingButton}
        setInitialBtnFormData={setInitialBtnFormData}
        setButtonDialogOpen={setButtonDialogOpen}
        setInputDialogOpen={setInputDialogOpen}
        activeGroup={activeGroup}
        handleButtonClick={handleButtonClick}
        handleAttach={handleAttach}
        handleRefresh={handleRefresh}
        handleSelectHost={handleSelectHost}
        terminalRefs={terminalRefs}
        toasts={toasts}
        setToasts={setToasts}
      />
    </ThemeProvider>
  );
}