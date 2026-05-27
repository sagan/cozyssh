import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Typography, IconButton, Tabs, Tab, Menu, MenuItem } from '@mui/material';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from "@codemirror/view";
import AddIcon from '@mui/icons-material/Add';
import LockIcon from '@mui/icons-material/Lock';

import type {
  ScratchpadData, ScratchpadDeleteMsg, ScratchpadHelloMsg, ScratchpadPage, ScratchpadSyncMsg,
} from './api';
import {
  BROWSER_STORAGE_KEY_SCRATCCHPAD_CACHE, BROWSER_STORAGE_KEY_SCRATCHPAD_SYNC_STATE,
  BROWSER_STORAGE_KEY_TOKEN,
} from './constants';
import { type ScratchpadSyncState, generatePassword } from './common';
import { dialogs } from './Dialogs';

export interface ScratchpadHandle {
  focus: () => void;
}

interface ScratchpadProps {
  onSyncStateChange?: (state: ScratchpadSyncState) => void;
}

const WS_RECONNECT_DELAY_MS = 3000;

const Scratchpad = forwardRef<ScratchpadHandle, ScratchpadProps>(({ onSyncStateChange }, ref) => {
  const [data, setData] = useState<ScratchpadData>(() => {
    const cached = localStorage.getItem(BROWSER_STORAGE_KEY_SCRATCCHPAD_CACHE);
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
      pages: [],
    };
  });

  const [activePageId, setActivePageId] = useState<string>(data.pages.length > 0 ? data.pages[0].id : '');
  const [syncState, setSyncState] = useState<ScratchpadSyncState>('offline');
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; pageId: string } | null>(null);
  const [dirtyPageIds, setDirtyPageIds] = useState<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const dataRef = useRef(data);
  const dirtyRef = useRef<Set<string>>(new Set());
  const lastSyncDataRef = useRef<string>(''); // To store JSON of what we last sent
  const wsTimerRef = useRef<number | undefined>(undefined);
  const debounceTimerRef = useRef<number | undefined>(undefined);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  const focusEditor = useCallback(() => {
    if (cmRef.current?.view) {
      cmRef.current.view.focus();
      const length = cmRef.current.view.state.doc.length;
      cmRef.current.view.dispatch({ selection: { anchor: length, head: length } });
    }
  }, []);

  useImperativeHandle(ref, () => ({
    focus: focusEditor
  }));

  useEffect(() => {
    const timer = setTimeout(focusEditor, 50);
    return () => clearTimeout(timer);
  }, [activePageId, focusEditor]);

  // Update refs synchronously to avoid stale data in callbacks
  useEffect(() => {
    dataRef.current = data;
    localStorage.setItem(BROWSER_STORAGE_KEY_SCRATCCHPAD_CACHE, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    dirtyRef.current = dirtyPageIds;
  }, [dirtyPageIds]);

  useEffect(() => {
    if (data.pages.length > 0 && !data.pages.find(p => p.id === activePageId)) {
      setActivePageId(data.pages[0].id);
    }
  }, [data.pages, activePageId]);

  const connectWS = useCallback(() => {
    if (wsRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      try { wsRef.current.close(); } catch (e) { /* empty */ }
    }
    setSyncState('syncing');
    if (onSyncStateChange) onSyncStateChange('syncing');
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/api/ws/scratchpad`;

    const ws = new WebSocket(wsUrl, token ? [token] : undefined);
    wsRef.current = ws;

    ws.onopen = () => {
      setSyncState('synced');
      if (onSyncStateChange) {
        onSyncStateChange('synced');
      }
      ws.send(JSON.stringify({ type: 'hello' } satisfies ScratchpadHelloMsg));
      // Push any offline modifications unconditionally. Backend resolves conflicts.
      if (dataRef.current.pages.length > 0) {
        ws.send(JSON.stringify({ type: 'sync', data: dataRef.current } satisfies ScratchpadSyncMsg));
      }
    };

    ws.onmessage = (evt) => {
      try {
        const msg: ScratchpadSyncMsg | ScratchpadDeleteMsg = JSON.parse(evt.data);
        if (msg.type === 'sync' && msg.data) {
          setData(prev => {
            const localMap = new Map<string, ScratchpadPage>();
            prev.pages.forEach(p => localMap.set(p.id, p));

            // Merge server pages
            msg.data.pages.forEach((sp: ScratchpadPage) => {
              const lp = localMap.get(sp.id);
              // If server page is newer OR we don't have it, use server version
              if (!lp || sp.lastUpdated >= lp.lastUpdated) {
                localMap.set(sp.id, sp);
              }
            });

            // Reconstruct pages list. 
            // Note: If we want to support deletions properly, we'd need more logic here.
            // For now, this handles partial updates correctly.
            return { pages: Array.from(localMap.values()) };
          });
          setSyncState('synced');
          if (onSyncStateChange) {
            onSyncStateChange('synced');
          }
        } else if (msg.type === 'delete' && msg.id) {
          setData(prev => ({
            ...prev,
            pages: prev.pages.filter(p => p.id !== msg.id)
          }));
          setSyncState('synced');
          if (onSyncStateChange) {
            onSyncStateChange('synced');
          }
        } else if (msg.type === 'force_sync' && msg.data) {
          setData(msg.data);
          setSyncState('synced');
          if (onSyncStateChange) {
            onSyncStateChange('synced');
          }
        }
      } catch (e) {
        console.error("WS Message Error", e);
      }
    };

    ws.onclose = () => {
      setSyncState('offline');
      if (onSyncStateChange) {
        onSyncStateChange('offline');
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
        clearTimeout(wsTimerRef.current);
        wsTimerRef.current = setTimeout(connectWS, WS_RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [onSyncStateChange]);

  useEffect(() => {
    localStorage.setItem(BROWSER_STORAGE_KEY_SCRATCHPAD_SYNC_STATE, syncState);
  }, [syncState]);

  useEffect(() => {
    connectWS();
    return () => {
      if (dirtyRef.current.size > 0) {
        triggerSync();
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      clearTimeout(wsTimerRef.current);
      clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerSync = useCallback((forceAll = false) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    const dataToSend: ScratchpadData = { pages: [] };
    if (forceAll) {
      dataToSend.pages = dataRef.current.pages;
    } else {
      const dirty: ScratchpadPage[] = Array.from(dirtyRef.current).flatMap(id => {
        const page = dataRef.current.pages.find(p => p.id === id);
        return page ? [page] : [];
      });
      if (dirty.length === 0) {
        return;
      }
      dataToSend.pages = dirty;
    }

    const payload = JSON.stringify({ type: 'sync', data: dataToSend } satisfies ScratchpadSyncMsg);
    if (payload === lastSyncDataRef.current && !forceAll) {
      return;
    }

    setSyncState('syncing');
    if (onSyncStateChange) {
      onSyncStateChange('syncing');
    }
    wsRef.current.send(payload);
    lastSyncDataRef.current = payload;
    setDirtyPageIds(new Set());
  }, [onSyncStateChange]);

  useEffect(() => {
    if (dirtyPageIds.size > 0) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        triggerSync();
      }, 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyPageIds]);

  const handleEditorChange = useCallback((value: string) => {
    const updatedNow = Date.now();
    setData(prev => ({
      ...prev,
      pages: prev.pages.map(p => p.id === activePageId ? { ...p, content: value, lastUpdated: updatedNow } : p),
    }));
    setSyncState('dirty');
    if (onSyncStateChange) {
      onSyncStateChange('dirty');
    }
    setDirtyPageIds(prev => new Set(prev).add(activePageId));
  }, [activePageId, onSyncStateChange]);

  const handleAddPage = useCallback(() => {
    const updatedNow = Date.now();
    const newId = generatePassword(12);
    const newPageTitle = `Page ${data.pages.length + 1}`;
    const newPage = { id: newId, title: newPageTitle, content: '', lastUpdated: updatedNow };

    setData(prev => ({
      ...prev,
      pages: [...prev.pages, newPage]
    }));
    setSyncState('dirty');
    if (onSyncStateChange) {
      onSyncStateChange('dirty');
    }
    setDirtyPageIds(prev => new Set(prev).add(newId));
    setActivePageId(newId);
  }, [data.pages.length, onSyncStateChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent, pageId: string) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, pageId });
  }, []);

  const handleRename = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const pageId = contextMenu.pageId;
    setContextMenu(null);
    const targetPage = data.pages.find(p => p.id === pageId);
    if (!targetPage) {
      return;
    }
    const newTitle = await dialogs.prompt("Rename page:", targetPage.title);
    if (newTitle && newTitle !== targetPage.title) {
      const updatedNow = Date.now();
      setData(prev => ({
        ...prev,
        pages: prev.pages.map(p => p.id === pageId ? { ...p, title: newTitle, lastUpdated: updatedNow } : p),
      }));
      setSyncState('dirty');
      if (onSyncStateChange) onSyncStateChange('dirty');
      setDirtyPageIds(prev => new Set(prev).add(pageId));
    }
  }, [contextMenu, data.pages, onSyncStateChange]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const pageId = contextMenu.pageId;
    setContextMenu(null);
    if (data.pages.length <= 1) {
      dialogs.alert("Cannot delete the last page.");
      return;
    }
    const activePage = data.pages.find(p => p.id === pageId);
    if (!await dialogs.confirm(`Delete page "${activePage?.title}"?`)) {
      return;
    }
    const newData = {
      ...data,
      pages: data.pages.filter(p => p.id !== pageId),
    };
    setData(newData);
    setSyncState('syncing');
    if (onSyncStateChange) {
      onSyncStateChange('syncing');
    }
    wsRef.current?.send(JSON.stringify({ type: 'delete', id: pageId } satisfies ScratchpadDeleteMsg));
    if (activePageId === pageId) {
      setActivePageId(newData.pages[0].id);
    }
  }, [activePageId, contextMenu, data, onSyncStateChange]);

  const handleToggleLock = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    const pageId = contextMenu.pageId;
    setContextMenu(null);
    const updatedNow = Date.now();
    setData(prev => ({
      ...prev,
      pages: prev.pages.map(p => p.id === pageId ? { ...p, locked: !p.locked, lastUpdated: updatedNow } : p),
    }));
    setSyncState('dirty');
    if (onSyncStateChange) {
      onSyncStateChange('dirty');
    }
    setDirtyPageIds(prev => new Set(prev).add(pageId));
  }, [contextMenu, onSyncStateChange]);

  const handleCopy = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    const pageId = contextMenu.pageId;
    setContextMenu(null);
    const targetPage = data.pages.find(p => p.id === pageId);
    if (targetPage) {
      navigator.clipboard.writeText(targetPage.content);
    }
  }, [contextMenu, data.pages]);

  const cPage = data.pages.find(p => p.id === activePageId) || data.pages[0];

  return (
    <Box id="scratchpad-tab" sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.paper', width: '100%', minWidth: 0 }}>
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
        <MenuItem onClick={handleCopy}>Copy Contents</MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>Delete</MenuItem>
      </Menu>
    </Box>
  );
});

export default Scratchpad;
