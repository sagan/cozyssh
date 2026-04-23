import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Box, Typography, IconButton, Tabs, Tab, Menu, MenuItem } from '@mui/material';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from "@codemirror/view";
import AddIcon from '@mui/icons-material/Add';
import LockIcon from '@mui/icons-material/Lock';

export interface ScratchpadPage {
  id: string;
  title: string;
  content: string;
  locked?: boolean;
  lastUpdated: number;
}

export interface ScratchpadData {
  pages: ScratchpadPage[];
}

export interface ScratchpadHandle {
  focus: () => void;
}

interface ScratchpadProps {
  onSyncStateChange?: (state: 'offline' | 'syncing' | 'synced') => void;
}

const WS_RECONNECT_DELAY_MS = 3000;
const CACHE_KEY = 'cozy_scratchpad_cache';

const Scratchpad = forwardRef<ScratchpadHandle, ScratchpadProps>(({ onSyncStateChange }, ref) => {
  const [data, setData] = useState<ScratchpadData>(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed?.pages) {
          return parsed;
        }
      } catch (e) {
        console.error("Failed to parse scratchpad cache", e);
      }
    }
    return {
      pages: []
    };
  });

  const [activePageId, setActivePageId] = useState<string>(data.pages.length > 0 ? data.pages[0].id : '');
  const [syncState, setSyncState] = useState<'offline' | 'syncing' | 'synced'>('offline');
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; pageId: string } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const dataRef = useRef(data);
  const wsTimerRef = useRef<any>(null);
  const cmRef = useRef<any>(null);

  const focusEditor = () => {
    if (cmRef.current?.view) {
      cmRef.current.view.focus();
      const length = cmRef.current.view.state.doc.length;
      cmRef.current.view.dispatch({ selection: { anchor: length, head: length } });
    }
  };

  useImperativeHandle(ref, () => ({
    focus: focusEditor
  }));

  useEffect(() => {
    const timer = setTimeout(focusEditor, 50);
    return () => clearTimeout(timer);
  }, [activePageId]);

  // Update refs synchronously to avoid stale data in callbacks
  useEffect(() => {
    dataRef.current = data;
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    if (data.pages.length > 0 && !data.pages.find(p => p.id === activePageId)) {
      setActivePageId(data.pages[0].id);
    }
  }, [data.pages, activePageId]);

  const connectWS = () => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) { }
    }
    setSyncState('syncing');
    if (onSyncStateChange) onSyncStateChange('syncing');
    const token = localStorage.getItem('cozy_token');
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/api/ws/scratchpad?token=${encodeURIComponent(token || '')}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setSyncState('synced');
      if (onSyncStateChange) onSyncStateChange('synced');
      ws.send(JSON.stringify({ type: 'hello' }));
      // Push any offline modifications unconditionally. Backend resolves conflicts.
      if (dataRef.current.pages.length > 0) {
        ws.send(JSON.stringify({ type: 'sync', data: dataRef.current }));
      }
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'sync' && msg.data) {
          setData(prev => {
            const pageMap = new Map<string, ScratchpadPage>();
            // Start with all local pages
            prev.pages.forEach(p => pageMap.set(p.id, p));
            // Apply server pages (they win if newer or same age, resolving conflicts safely)
            msg.data.pages.forEach((sp: ScratchpadPage) => {
              const lp = pageMap.get(sp.id);
              if (!lp || sp.lastUpdated >= lp.lastUpdated) {
                pageMap.set(sp.id, sp);
              }
            });

            const finalPages: ScratchpadPage[] = [];
            // To handle deleted pages, any page on local that is older than server's latest sync, but simply missing from server, means server deleted it
            // For true multi-device sync, we just trust server list but keep local pages that are NEWER.
            msg.data.pages.forEach((sp: ScratchpadPage) => {
              const lp = prev.pages.find(p => p.id === sp.id);
              if (lp && lp.lastUpdated > sp.lastUpdated) {
                finalPages.push(lp);
              } else {
                finalPages.push(sp);
              }
            });
            // Also append any local pages completely missing from server (e.g. offline creates)
            prev.pages.forEach(p => {
              if (!msg.data.pages.find((sp: ScratchpadPage) => sp.id === p.id)) {
                finalPages.push(p);
              }
            });

            return { pages: finalPages };
          });
          setSyncState('synced');
          if (onSyncStateChange) onSyncStateChange('synced');
        } else if (msg.type === 'force_sync' && msg.data) {
          setData(msg.data);
          setSyncState('synced');
          if (onSyncStateChange) onSyncStateChange('synced');
        }
      } catch (e) {
        console.error("WS Message Error", e);
      }
    };

    ws.onclose = () => {
      setSyncState('offline');
      if (onSyncStateChange) onSyncStateChange('offline');
      if (wsRef.current === ws) {
        wsRef.current = null;
        clearTimeout(wsTimerRef.current);
        wsTimerRef.current = setTimeout(connectWS, WS_RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  };

  useEffect(() => {
    localStorage.setItem('cozy_scratchpad_sync_state', syncState);
  }, [syncState]);

  useEffect(() => {
    connectWS();
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      clearTimeout(wsTimerRef.current);
    };
  }, []);

  const triggerUpload = (newData: ScratchpadData) => {
    setData(newData);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setSyncState('syncing');
      if (onSyncStateChange) onSyncStateChange('syncing');
      wsRef.current.send(JSON.stringify({ type: 'sync', data: newData }));
    }
  };

  const handleEditorChange = (value: string) => {
    const newData = { ...data };
    newData.pages = newData.pages.map(p => p.id === activePageId ? { ...p, content: value, lastUpdated: Date.now() } : p);
    triggerUpload(newData);
  };

  const handleAddPage = () => {
    const newId = Math.random().toString(36).substring(2);
    const newPageTitle = `Page ${data.pages.length + 1}`;
    const newData = {
      ...data,
      lastUpdated: Date.now(),
      pages: [...data.pages, { id: newId, title: newPageTitle, content: '', lastUpdated: Date.now() }]
    };
    triggerUpload(newData);
    setActivePageId(newId);
  };

  const handleContextMenu = (e: React.MouseEvent, pageId: string) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, pageId });
  };

  const handleRename = () => {
    if (!contextMenu) return;
    const targetPage = data.pages.find(p => p.id === contextMenu.pageId);
    if (!targetPage) return;
    const newTitle = prompt("Rename page:", targetPage.title);
    if (newTitle && newTitle !== targetPage.title) {
      const newData = {
        ...data,
        lastUpdated: Date.now(),
        pages: data.pages.map(p => p.id === contextMenu.pageId ? { ...p, title: newTitle, lastUpdated: Date.now() } : p)
      };
      triggerUpload(newData);
    }
    setContextMenu(null);
  };

  const handleDelete = () => {
    if (!contextMenu) return;
    if (data.pages.length <= 1) {
      alert("Cannot delete the last page.");
      setContextMenu(null);
      return;
    }
    const activePage = data.pages.find(p => p.id === contextMenu.pageId)
    if (confirm(`Delete page "${activePage?.title}"?`)) {
      const newData = {
        ...data,
        pages: data.pages.filter(p => p.id !== contextMenu.pageId)
      };
      triggerUpload(newData);
      if (activePageId === contextMenu.pageId) {
        setActivePageId(newData.pages[0].id);
      }
    }
    setContextMenu(null);
  };

  const handleToggleLock = () => {
    if (!contextMenu) return;
    const newData = {
      ...data,
      pages: data.pages.map(p => p.id === contextMenu.pageId ? { ...p, locked: !p.locked, lastUpdated: Date.now() } : p)
    };
    triggerUpload(newData);
    setContextMenu(null);
  };

  const handleCopy = () => {
    if (!contextMenu) return;
    const targetPage = data.pages.find(p => p.id === contextMenu.pageId);
    if (targetPage) {
      navigator.clipboard.writeText(targetPage.content);
    }
    setContextMenu(null);
  };

  const cPage = data.pages.find(p => p.id === activePageId) || data.pages[0];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.paper', width: '100%', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', bgcolor: '#f4f6f8', flexShrink: 0, overflow: 'hidden' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0, overflow: 'hidden' }}>
          <Tabs
            value={activePageId}
            onChange={(_, val) => setActivePageId(val)}
            variant="scrollable"
            scrollButtons={true}
            allowScrollButtonsMobile
            sx={{ minHeight: 40 }}
          >
            {data.pages.map(p => (
              <Tab
                key={p.id}
                value={p.id}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {p.locked && <LockIcon sx={{ fontSize: 14 }} color="action" />}
                    <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'none' }}>{p.title}</Typography>
                  </Box>
                }
                onContextMenu={(e) => handleContextMenu(e, p.id)}
                sx={{ minHeight: 40, py: 0, minWidth: 'auto' }}
              />
            ))}
          </Tabs>
        </Box>
        <IconButton size="small" onClick={handleAddPage} sx={{ ml: 1, mr: 1 }} title="New Page">
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Editor */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
        {cPage && (
          <CodeMirror
            ref={cmRef}
            value={cPage.content}
            height="100%"
            style={{ height: '100%' }}
            extensions={[EditorView.lineWrapping]}
            onChange={handleEditorChange}
            readOnly={cPage.locked}
          />
        )}
      </Box>

      {/* Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={handleRename}>Rename</MenuItem>
        <MenuItem onClick={handleToggleLock}>
          {data.pages.find(p => p.id === contextMenu?.pageId)?.locked ? "Unlock" : "Lock"}
        </MenuItem>
        <MenuItem onClick={handleCopy}>Copy Content</MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>Delete</MenuItem>
      </Menu>
    </Box>
  );
});

export default Scratchpad;
