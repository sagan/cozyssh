import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from "react-router";
import {
  Autocomplete, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Drawer, Toolbar, Typography, Box,
  CircularProgress, IconButton, Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button,
  useMediaQuery, useTheme, Tabs, Tab, Chip, Divider,
} from '@mui/material';
import ComputerIcon from '@mui/icons-material/Computer';
import DnsIcon from '@mui/icons-material/Dns';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddIcon from '@mui/icons-material/Add';
import StarIcon from '@mui/icons-material/Star';

import { version as PACKAGE_JSON_VERSION } from '../package.json';
import type { HostData, PasswordUpdateRequest, SessionPinned } from './api';
import {
  METHOD_PUT, METHOD_POST, METHOD_DELETE, HEADER_AUTHORIZATION_BEARER_PREFIX, HEADER_AUTHORIZATION, MIME_JSON,
  HEADER_CONTENT_TYPE, BROWSER_STORAGE_KEY_TOKEN, APP_NAME,
} from './constants';
import { type HostForm, type ServiceWorkerStatus, filterHosts, remoteCommandOptions, searchString } from './common';
import { dialogs } from './Dialogs';

const drawerWidth = 260;

export default function Sidebar({ sysHostname, appVersion, mobileOpen, onClose, onSelect, onSelectTagAsSplit,
  onLogout, onOpenScratchpad, activeTabs, onAttach, onRefresh, hosts, fetchHosts }: {
    sysHostname: string, appVersion: string, mobileOpen: boolean,
    onClose: () => void, onSelect: (host: string) => void,
    onSelectTagAsSplit?: (tag: string, hosts: string[]) => void,
    onLogout?: () => void, onOpenScratchpad?: () => void, activeTabs: string[],
    onAttach: (id: string, host: string, title: string, isLocked: boolean) => void,
    onRefresh?: () => void, hosts: HostData[], fetchHosts: () => void,
  }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [loading, setLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  // Settings State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pinnedSessions, setPinnedSessions] = useState<SessionPinned[]>([]);
  const [dialogTab, setDialogTab] = useState(0);

  const [swStatus, setSwStatus] = useState<ServiceWorkerStatus>('unknown');

  useEffect(() => {
    if (settingsOpen && dialogTab === 1) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (!reg) {
            setSwStatus('unregistered');
          } else if (reg.active) {
            setSwStatus('active');
          } else if (reg.waiting) {
            setSwStatus('waiting');
          } else if (reg.installing) {
            setSwStatus('installing');
          }
        }).catch(() => setSwStatus('error'));
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSwStatus('unsupported');
      }
    }
  }, [settingsOpen, dialogTab]);

  useEffect(() => {
    if (settingsOpen) {
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      fetch('/api/sessions/pinned', {
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        }
      })
        .then(r => r.json() as Promise<SessionPinned[]>)
        .then(data => setPinnedSessions(data || []))
        .catch(e => console.error(e));
    }
  }, [settingsOpen]);

  const [startupParams] = useSearchParams();
  const [filterStr, setFilterStr] = useState(startupParams.get('filter') || '');
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [showTagsToggle, setShowTagsToggle] = useState(false);
  const tagsContainerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Host CRUD State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [formData, setFormData] = useState<HostForm>({
    name: '', hostname: '', user: '', port: '', identity_file: '', source: "",
    proxy_jump: '', remote_command: '', tags: '', comment: '',
  });
  const [initialHostFormData, setInitialHostFormData] = useState<HostForm | null>(null);

  // Context Menu State
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; target: HostData } | null>(null);
  const [tagContextMenuOpen, setTagContextMenuOpen] = useState(false);
  const [tagContextMenu, setTagContextMenu] = useState<{ mouseX: number; mouseY: number; tag: string } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loading && hosts.length > 0) setLoading(false);
  }, [hosts, loading]);

  const handleSavePassword = useCallback(async () => {
    if (newPwd !== confirmPwd) {
      dialogs.alert("Passwords don't match");
      return;
    }
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const res = await fetch('/api/settings/password', {
      method: METHOD_POST,
      headers: {
        [HEADER_CONTENT_TYPE]: MIME_JSON,
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token
      },
      body: JSON.stringify({ new_password: newPwd } satisfies PasswordUpdateRequest)
    });
    if (res.ok) {
      dialogs.alert('Password updated! You will be logged out.');
      if (onLogout) {
        onLogout();
      }
    } else {
      dialogs.alert('Failed to update password');
    }
  }, [confirmPwd, newPwd, onLogout]);

  const handleClearCache = useCallback(async () => {
    if (!await dialogs.confirm("This will unregister the Service Worker, clear all caches and reload. Proceed?")) {
      return;
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
      if (window.caches) {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }
      window.location.reload();
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, host: HostData) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, target: host });
    setContextMenuOpen(true);
  }, []);

  const handleTagContextMenu = useCallback((e: React.MouseEvent, tag: string) => {
    e.preventDefault();
    setTagContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, tag });
    setTagContextMenuOpen(true);
  }, []);

  const handleOpenAllServersInNewWindow = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    const tag = tagContextMenu.tag;
    setTagContextMenuOpen(false);
    window.open(`${window.location.origin}/##${tag}`, '_blank', 'noopener');
  }, [tagContextMenu]);

  const handleOpenAllServers = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    const tag = tagContextMenu.tag;
    setTagContextMenuOpen(false);
    setFilterStr(`#${tag} `);
    const targets = hosts.filter(h => h.tags && h.tags.includes(tag));
    targets.forEach(h => onSelect(h.name));
  }, [hosts, onSelect, tagContextMenu]);

  const handleOpenSplitServers = useCallback(() => {
    if (!tagContextMenu || !onSelectTagAsSplit) {
      return;
    }
    const tag = tagContextMenu.tag;
    setTagContextMenuOpen(false);
    const filtered = hosts.filter(h => h.tags && h.tags.includes(tag));

    const nameSorter = (a: HostData, b: HostData) => a.name.localeCompare(b.name);
    const hostNameSorter = (a: HostData, b: HostData) => {
      if (a.hostname === b.hostname) {
        return a.name.localeCompare(b.name);
      }
      return a.hostname.localeCompare(b.hostname);
    };

    const favs = filtered.filter(h => h.is_favourite).sort(nameSorter);
    const normals = filtered.filter(h => !h.is_favourite && !h.is_auto).sort(nameSorter);
    const autos = filtered.filter(h => !h.is_favourite && h.is_auto).sort(hostNameSorter);

    const targets = [...favs, ...normals, ...autos].slice(0, 4);
    if (targets.length > 0) {
      onSelectTagAsSplit(tag, targets.map(h => h.name));
    }
  }, [hosts, onSelectTagAsSplit, tagContextMenu]);

  const handleCopyTagUrl = useCallback(() => {
    if (!tagContextMenu) {
      return;
    }
    const tag = tagContextMenu.tag;
    setTagContextMenuOpen(false);
    const url = `${window.location.origin}/##${tag}`;
    navigator.clipboard.writeText(url);
  }, [tagContextMenu]);

  const handleAddOpen = useCallback(() => {
    const data: HostForm = {
      name: "", hostname: '', user: 'root', port: '22', source: "",
      identity_file: '', proxy_jump: '', remote_command: '', tags: "", comment: '',
    };
    setEditingName(null);
    setFormData(data);
    setInitialHostFormData(data);
    setDialogOpen(true);
  }, []);

  const handleEditOpen = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    const target = contextMenu.target;
    setContextMenuOpen(false);
    const isAuto = target.source === 'known_hosts';
    const data: HostForm = {
      name: isAuto ? target.hostname : target.name,
      hostname: target.hostname,
      user: target.user || 'root',
      port: target.port || '22',
      source: "",
      identity_file: target.identity_file || '',
      proxy_jump: target.proxy_jump || '',
      remote_command: target.remote_command || '',
      tags: target.tags ? target.tags.join(' ') : '',
      comment: target.comment || '',
    };
    setEditingName(isAuto ? null : target.name);
    setFormData(data);
    setInitialHostFormData(data);
    setDialogOpen(true);
  }, [contextMenu]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const target = contextMenu.target;
    setContextMenuOpen(false);
    if (await dialogs.confirm(`Are you extremely certain you want to permanently delete "${target.name}"?`)) {
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      await fetch(`/api/hosts/${target.name}`, {
        method: METHOD_DELETE,
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token
        }
      });
      fetchHosts();
    }
  }, [contextMenu, fetchHosts]);

  const handleToggleFavourite = useCallback(async () => {
    if (!contextMenu) {
      return;
    }
    const target = contextMenu.target;
    setContextMenuOpen(false);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);

    let newTags = target.tags ? [...target.tags] : [];
    if (target.is_favourite) {
      newTags = newTags.filter(t => t !== 'fav');
    } else {
      if (!newTags.includes('fav')) {
        newTags.push('fav');
      }
    }

    const payload: HostData = {
      name: target.source === 'known_hosts' ? target.hostname : target.name,
      hostname: target.hostname,
      user: target.user || 'root',
      port: target.port || '22',
      identity_file: target.identity_file || '',
      proxy_jump: target.proxy_jump || '',
      remote_command: target.remote_command || '',
      source: target.source || "",
      comment: target.comment || "",
      tags: newTags
    };

    const url = target.source === 'config' ? `/api/hosts/${target.name}` : `/api/hosts`;
    const method = target.source === 'config' ? METHOD_PUT : METHOD_POST;

    await fetch(url, {
      method,
      headers: {
        [HEADER_CONTENT_TYPE]: MIME_JSON,
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token
      },
      body: JSON.stringify(payload)
    });
    fetchHosts();
  }, [contextMenu, fetchHosts]);

  const handleSaveHost = useCallback(async () => {
    if (!formData.hostname) {
      return;
    }
    const finalName = formData.name.trim() || formData.hostname.trim();
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const url = editingName ? `/api/hosts/${editingName}` : `/api/hosts`;
    const method = editingName ? METHOD_PUT : METHOD_POST;

    const parsedTags = formData.tags.replace(/,/g, ' ').split(/\s+/).filter(t => t.trim() !== '');

    const payload: HostData = {
      ...formData,
      name: finalName,
      tags: parsedTags
    };

    await fetch(url, {
      method,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(payload)
    });

    setInitialHostFormData(null); // Reset dirty state on successful save
    setDialogOpen(false);
    fetchHosts();
  }, [editingName, fetchHosts, formData]);

  const handleCloseHostDialog = useCallback((_e: unknown, reason: string) => {
    const isDirty = initialHostFormData && JSON.stringify(formData) !== JSON.stringify(initialHostFormData);
    if (isDirty && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
      return;
    }
    setDialogOpen(false);
    setTimeout(() => window.csFocus(), 0);
  }, [formData, initialHostFormData]);

  const filteredHosts = useMemo(() => {
    const filtered = filterHosts(hosts, filterStr);

    const favs = filtered.filter(h => h.is_favourite);
    const normals = filtered.filter(h => !h.is_favourite && !h.is_auto);
    const autos = filtered.filter(h => !h.is_favourite && h.is_auto);

    const nameSorter = (a: HostData, b: HostData) => a.name.localeCompare(b.name);
    const hostNameSorter = (a: HostData, b: HostData) => {
      if (a.hostname === b.hostname) {
        return a.name.localeCompare(b.name);
      }
      return a.hostname.localeCompare(b.hostname);
    };

    return {
      favourite: favs.sort(nameSorter),
      normal: normals.sort(nameSorter),
      auto: autos.sort(hostNameSorter)
    };
  }, [hosts, filterStr]);

  const flatFilteredHosts = useMemo(() => {
    return [...filteredHosts.favourite, ...filteredHosts.normal, ...filteredHosts.auto];
  }, [filteredHosts]);

  useEffect(() => {
    if (filterStr.trim() !== '' && flatFilteredHosts.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedIndex(0);
    } else {
      setSelectedIndex(-1);
    }
  }, [filterStr, flatFilteredHosts]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleFilterKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.altKey && e.key === 'j')) {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex(prev => Math.min(prev + 1, flatFilteredHosts.length - 1));
    } else if (e.key === 'ArrowUp' || (e.altKey && e.key === 'k')) {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < flatFilteredHosts.length) {
        onSelect(flatFilteredHosts[selectedIndex].name);
        setFilterStr('');
        filterRef.current?.blur();
      }
    }
  }, [flatFilteredHosts, onSelect, selectedIndex]);

  const uniqueTags = useMemo(() => {
    const set = new Set<string>();
    hosts.forEach(h => {
      if (h.tags) h.tags.forEach(t => set.add(t));
    });
    return Array.from(set).sort();
  }, [hosts]);

  useEffect(() => {
    setTimeout(() => {
      if (tagsContainerRef.current) {
        setShowTagsToggle(tagsContainerRef.current.scrollHeight > 60);
      }
    }, 0);
  }, [uniqueTags, filterStr]);

  return (
    <Drawer
      id="sidebar"
      variant={isMobile ? "temporary" : "permanent"}
      open={isMobile ? mobileOpen : true}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', pr: 1 }}>
        <Typography variant="h6" noWrap sx={{ fontWeight: 'bold' }}>
          <span>{APP_NAME}</span>&nbsp;
          <span title={sysHostname}>{sysHostname}</span>
        </Typography>
        <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
          <MoreVertIcon />
        </IconButton>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          <MenuItem onClick={() => {
            setAnchorEl(null);
            if (onRefresh) {
              onRefresh();
            }
          }}>Refresh</MenuItem>
          <MenuItem onClick={() => {
            setAnchorEl(null);
            setSettingsOpen(true);
            if (isMobile) {
              onClose();
            }
          }}>Dashboard</MenuItem>
          <MenuItem onClick={() => {
            setAnchorEl(null);
            if (onOpenScratchpad) {
              onOpenScratchpad();
            }
          }}>Open Scratchpad</MenuItem>
          <MenuItem onClick={() => {
            setAnchorEl(null);
            if (onLogout) {
              onLogout();
            }
          }}>Logout</MenuItem>
        </Menu>
      </Toolbar>

      <Box sx={{ px: 2, pb: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            inputRef={filterRef}
            size="small"
            type="search"
            placeholder="Filter hosts or #tag..."
            title="<Alt + I>"
            value={filterStr}
            onChange={(e) => setFilterStr(e.target.value)}
            onKeyDown={handleFilterKeyDown}
            sx={{ flexGrow: 1 }}
          />
          <IconButton size="small" title="New Server" onClick={handleAddOpen}
            sx={{ bgcolor: 'action.hover', border: '1px solid #ccc' }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>

        {uniqueTags.length > 0 && (
          <Box sx={{ position: 'relative' }}>
            <Box
              ref={tagsContainerRef}
              sx={{
                display: 'flex', flexWrap: 'wrap', gap: 0.75,
                maxHeight: tagsExpanded ? 'none' : '60px',
                overflow: 'hidden',
                px: 0.5, py: 0.5
              }}
            >
              {uniqueTags.map(tag => {
                const tagLower = tag.toLowerCase();
                const filterStrLower = filterStr.toLowerCase().trim();
                const isActive = filterStrLower.includes(`#${tagLower} `) || filterStrLower.endsWith(`#${tagLower}`);
                return (
                  <Chip
                    key={tag}
                    label={`#${tag}`}
                    size="small"
                    color={isActive ? "primary" : "default"}
                    variant={isActive ? "filled" : "outlined"}
                    onClick={() => {
                      if (isActive && filterStr.trim() === `#${tag}`) {
                        setFilterStr('');
                      } else {
                        setFilterStr(`#${tag} `);
                      }
                      filterRef.current?.focus();
                    }}
                    onContextMenu={(e) => handleTagContextMenu(e, tag)}
                    sx={{
                      borderRadius: '6px',
                      fontWeight: isActive ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      '&:hover': {
                        backgroundColor: isActive ? 'primary.dark' : 'action.hover'
                      }
                    }}
                  />
                )
              })}
            </Box>
            {showTagsToggle && (
              <Box sx={{ textAlign: 'center', mt: -0.5 }}>
                <IconButton size="small" onClick={() => setTagsExpanded(!tagsExpanded)} sx={{ p: 0 }}>
                  {tagsExpanded ? <Typography variant="caption" color="text.secondary">▲</Typography>
                    : <Typography variant="caption" color="text.secondary">▼</Typography>}
                </IconButton>
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Box sx={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {loading ? <Box sx={{ p: 2, alignSelf: 'center' }}><CircularProgress size={24} /></Box> : null}
        <List>
          <ListItem disablePadding>
            <ListItemButton onClick={() => onSelect('local')}>
              <ListItemIcon><ComputerIcon /></ListItemIcon>
              <ListItemText primary="Local Shell" />
            </ListItemButton>
          </ListItem>

          {(filteredHosts.favourite.length > 0 || filteredHosts.normal.length > 0
            || filteredHosts.auto.length > 0) && <Divider sx={{ my: 1 }} />}

          {filteredHosts.favourite.map((host, idx) => {
            const absIdx = idx;
            return <HostListItem key={`fav-${idx}`} filter={filterStr} host={host} onSelect={onSelect}
              onContextMenu={handleContextMenu} isSelected={selectedIndex === absIdx} />;
          })}

          {filteredHosts.favourite.length > 0 && (filteredHosts.normal.length > 0 || filteredHosts.auto.length > 0)
            && <Divider sx={{ my: 1 }} />}

          {filteredHosts.normal.map((host, idx) => {
            const absIdx = filteredHosts.favourite.length + idx;
            return <HostListItem key={`normal-${idx}`} filter={filterStr} host={host} onSelect={onSelect}
              onContextMenu={handleContextMenu} isSelected={selectedIndex === absIdx} />;
          })}

          {filteredHosts.normal.length > 0 && filteredHosts.auto.length > 0 && <Divider sx={{ my: 1 }} />}

          {filteredHosts.auto.map((host, idx) => {
            const absIdx = filteredHosts.favourite.length + filteredHosts.normal.length + idx;
            return <HostListItem key={`auto-${idx}`} filter={filterStr} host={host} onSelect={onSelect}
              onContextMenu={handleContextMenu} isSelected={selectedIndex === absIdx} />;
          })}
        </List>
      </Box>

      {/* Host Context Menu */}
      <Menu
        open={contextMenuOpen}
        onClose={() => setContextMenuOpen(false)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={handleEditOpen}>Edit {contextMenu?.target.name}</MenuItem>
        <MenuItem onClick={() => {
          if (!contextMenu) {
            return;
          }
          window.open(`${window.location.origin}/#${contextMenu?.target.name}`, '_blank', 'noopener');
        }}>Open (New Window)</MenuItem>
        <MenuItem onClick={() => {
          if (!contextMenu) {
            return;
          }
          const target = contextMenu.target;
          setContextMenuOpen(false);
          const url = `${window.location.origin}/#${target.source !== 'known_hosts'
            ? target.name : `${target.user || "root"}@${target.hostname}`}`;
          navigator.clipboard.writeText(url);
        }}>Copy URL</MenuItem>
        <MenuItem onClick={() => {
          if (!contextMenu) {
            return;
          }
          const target = contextMenu.target;
          setContextMenuOpen(false);
          let command = `ssh`;
          if (target.identity_file) {
            command += ` -i "${target.identity_file}"`;
          }
          if (target.proxy_jump) {
            const jumpServers = target.proxy_jump.split(',').map(name => {
              name = name.trim();
              const server = hosts.find(h => h.name === name);
              if (!server) {
                return name;
              }
              if (server.port !== "22") {
                return `${server.user}@${server.hostname}:${server.port}`;
              }
              return `${server.user}@${server.hostname}`;
            });
            command += ` -J ${jumpServers.join(',')}`;
          }
          if (target.remote_command) {
            if (/\b(?:sudo|vim|vi|nano|top|htop|btop|tmux|screen)\b/.test(target.remote_command)) {
              command += ` -t`;
            }
            command += ` -o "RemoteCommand=${target.remote_command}"`;
          }
          if (target.port !== "22") {
            command += ` -p ${target.port}`;
          }
          command += ` ${target.user}@${target.hostname}`;
          navigator.clipboard.writeText(command);
        }}>Copy SSH Command</MenuItem>
        <MenuItem onClick={() => {
          if (!contextMenu) {
            return;
          }
          const target = contextMenu.target;
          setContextMenuOpen(false);
          let command = `ssh-copy-id`;
          if (target.identity_file) {
            command += ` -i "${target.identity_file}"`;
          }
          if (target.port !== "22") {
            command += ` -p ${target.port}`;
          }
          command += ` ${target.user}@${target.hostname}`;
          navigator.clipboard.writeText(command);
        }}>Copy ssh-copy-id Command</MenuItem>
        <MenuItem onClick={handleToggleFavourite}>
          {contextMenu?.target.is_favourite ? 'Remove From Favourite' : 'Add To Favourite'}
        </MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>Delete {
          contextMenu?.target.source === 'config' ? 'Host' : 'Auto Host'}</MenuItem>
      </Menu>

      <Menu
        open={tagContextMenuOpen}
        onClose={() => setTagContextMenuOpen(false)}
        anchorReference="anchorPosition"
        anchorPosition={tagContextMenu ? { top: tagContextMenu.mouseY, left: tagContextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={handleOpenAllServers}>Open All ({tagContextMenu?.tag})</MenuItem>
        <MenuItem onClick={handleOpenSplitServers}>Open All (split screen)</MenuItem>
        <MenuItem onClick={handleOpenAllServersInNewWindow}>Open All (new window)</MenuItem>
        <MenuItem onClick={handleCopyTagUrl}>Copy URL</MenuItem>
      </Menu>

      {/* Dashboard Dialog */}
      <Dialog id="dashboard-dialog" open={settingsOpen} onClose={() => {
        setSettingsOpen(false);
        setTimeout(() => window.csFocus(), 0);
      }} fullWidth maxWidth="sm" sx={{ '& .MuiDialog-paper': { overflow: 'hidden' } }}>
        <DialogTitle>Dashboard</DialogTitle>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
          <Tabs
            value={dialogTab}
            onChange={(_, newVal) => setDialogTab(newVal)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            <Tab label="Sessions" />
            <Tab label="Settings" />
            <Tab label="Shortcuts" />
            <Tab label="About" />
          </Tabs>
        </Box>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ p: 3, pt: 1, minWidth: 0 }}>
            {dialogTab === 0 && (
              <List dense sx={{ border: '1px solid #ddd', borderRadius: 1 }}>
                {pinnedSessions.map(ps => {
                  const isLocal = activeTabs.includes(ps.id);
                  const canAttach = !isLocal;
                  return (
                    <ListItem key={ps.id} divider>
                      <ListItemText primary={ps.title} secondary={`${ps.host} (Listeners: ${ps.listenerCount})`} />
                      {canAttach && <Button size="small" variant="outlined"
                        onClick={() => onAttach(ps.id, ps.host, ps.title, !!ps.isLocked)}>Attach</Button>}
                    </ListItem>
                  );
                })}
                {pinnedSessions.length === 0 && <ListItem><ListItemText primary="No pinned sessions" /></ListItem>}
              </List>
            )}

            {dialogTab === 1 && (
              <>
                <Typography variant="subtitle2" gutterBottom>Service Worker & Cache</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">Status:</Typography>
                  <Chip label={swStatus} size="small" color={swStatus === 'active' ? 'success' : 'default'}
                    variant="outlined" sx={{ fontWeight: 'bold' }} />
                </Box>
                <Button variant="outlined" color="error" size="small" onClick={handleClearCache} sx={{ mt: 1 }}>
                  Force Clear Cache & Unregister SW
                </Button>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>Change App Password</Typography>
                <TextField fullWidth label="New Password" type="password" size="small" margin="dense"
                  value={newPwd} onChange={e => setNewPwd(e.target.value)} />
                <TextField fullWidth label="Confirm Password" type="password" size="small" margin="dense"
                  value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
                <Button variant="contained" onClick={handleSavePassword} disabled={!newPwd} sx={{ mt: 2 }}
                  disableElevation>Save Password</Button>
              </>
            )}

            {dialogTab === 2 && (
              <>
                <Typography variant="subtitle2" gutterBottom>Keyboard Shortcuts</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
                  <b>Alt + O</b> : Open new tab dialog, use ← → to switch view, ↑ ↓ to select, Enter to open<br />
                  <b>Alt + A</b> : Open new tab dialog - tabs view<br />
                  <b>Alt + E</b> : Open new tab dialog - buttons view<br />
                  <b>Alt + N</b> : Open new local shell tab<br />
                  <b>Alt + S</b> : Open scratchpad<br />
                  <b>Alt + H / Alt + L</b> : Switch to previous / next tab<br />
                  <b>Alt + 1-9,0</b> : Switch to tab 1-9, last tab<br />
                  <b>Alt + C</b> : Clone current tab or pane in new tab<br />
                  <b>Alt + Shift + C</b> : Clone current tab or pane in same tab (Max 4 panes per tab)<br />
                  <b>Alt + W</b> : Close current tab or pane<br />
                  <b>Alt + I</b> : Focus sidebar search filter, use ↑ ↓ to select, Enter to open<br />
                  <b>Alt + G</b> : Focus active terminal session<br />
                  <b>Alt + V / Alt + Shift + V</b> : Switch to next / previous group in button bar<br />
                  <b>Alt + Shift + 1-9,0</b> : Click the button in button bar<br />
                  <b>Alt + J / Alt + K</b> : Scroll terminal down / up by a few lines<br />
                  <b>Alt + Shift + J / Alt + Shift + K</b> : Scroll terminal down / up by a page<br />
                  <b>Ctrl + Shift + F</b> : Open terminal search box<br />
                  <b>Ctrl + Shift + R</b> : Reconnect current terminal<br />
                  <b>Ctrl + Shift + C</b> : Copy selected text in terminal<br />
                  <b>Ctrl + Shift + V (Windows) / Cmd + V (Mac)</b> : Paste into terminal<br />
                  <b>Mouse Select</b> in terminal to copy<br />
                  <b>Mouse Right Click</b> in terminal to paste<br />
                </Typography>
              </>
            )}

            {dialogTab === 3 && (
              <Box sx={{ textAlign: 'center', mt: 4 }}>
                <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold' }}>CozySSH</Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  Version: <b>{appVersion}</b><br />
                  Frontend: <b>{PACKAGE_JSON_VERSION}</b>
                </Typography>
                <Typography variant="body2" sx={{ mt: 3 }}>
                  <a href="https://github.com/sagan/cozyssh" target="_blank" rel="noopener noreferrer"
                    style={{ color: theme.palette.primary.main, textDecoration: 'none' }}>
                    GitHub Repository
                  </a>
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Host CRUD Dialog */}
      <Dialog id="edit-host-dialog" data-host-name={editingName}
        open={dialogOpen} onClose={handleCloseHostDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingName ? `Edit Host ${editingName}` : 'Add Host'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField fullWidth label="Alias Name" size="small" value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder={formData.hostname || "e.g. production-database"} />
            <TextField fullWidth label="HostName (IP / Domain)" size="small" value={formData.hostname}
              onChange={e => setFormData({ ...formData, hostname: e.target.value })}
              required autoFocus={!formData.hostname} />
            <TextField fullWidth label="User" size="small" value={formData.user}
              onChange={e => setFormData({ ...formData, user: e.target.value })} placeholder="default: root" />
            <TextField fullWidth label="Port" size="small" value={formData.port}
              onChange={e => setFormData({ ...formData, port: e.target.value })} placeholder="default: 22" />
            <TextField fullWidth label="Tags (Optional)" size="small" value={formData.tags}
              onChange={e => setFormData({ ...formData, tags: e.target.value })} placeholder="e.g. production web" />
            <TextField fullWidth label="IdentityFile (Optional)" size="small" value={formData.identity_file}
              onChange={e => setFormData({ ...formData, identity_file: e.target.value })}
              placeholder="~/.ssh/id_ed25519" />
            <TextField fullWidth label="ProxyJump (Optional)" size="small" value={formData.proxy_jump}
              onChange={e => setFormData({ ...formData, proxy_jump: e.target.value })}
              placeholder="e.g. server-foo,server-bar" />
            <Autocomplete freeSolo options={remoteCommandOptions} value={formData.remote_command}
              onInputChange={(_event, newValue) => {
                setFormData({ ...formData, remote_command: newValue })
              }}
              renderInput={(params) => (
                <TextField {...params} fullWidth label="RemoteCommand (Optional)"
                  size="small" placeholder="e.g. tmux attach || tmux new" />
              )}
            />
            <TextField fullWidth label="Comment (Optional)" size="small" multiline rows={2} value={formData.comment}
              onChange={e => setFormData({ ...formData, comment: e.target.value })}
              placeholder="Host description..." />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveHost} disabled={!formData.hostname}>Save</Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
}

function HostListItem({ filter, host, onSelect, onContextMenu, isSelected }: {
  filter: string, host: HostData, onSelect: (name: string) => void,
  onContextMenu: (e: React.MouseEvent, host: HostData) => void, isSelected?: boolean,
}) {
  const itemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: 'auto',
        block: 'nearest',
      });
    }
  }, [isSelected]);

  const isFavourite = host.is_favourite;
  let secondaryText = `${host.user || 'root'}@${host.hostname}`;
  if (filter && host.comment) {
    const matchedComment = searchString(host.comment, filter);
    if (matchedComment) secondaryText += ` // ${matchedComment}`;
  }
  return (
    <ListItem
      ref={itemRef}
      disablePadding
      onContextMenu={(e) => onContextMenu(e, host)}
      sx={{
        bgcolor: isSelected ? 'action.hover' : (isFavourite ? 'action.selected' : 'transparent'),
        '&:hover': {
          bgcolor: isSelected ? 'action.hover' : (isFavourite ? 'action.focus' : 'action.hover'),
        },
        mb: 0.2,
        outline: isSelected ? '1px solid' : 'none',
        outlineColor: 'primary.main',
        outlineOffset: '-1px',
        borderRadius: 1
      }}
    >
      <ListItemButton title={host.comment || ""} onClick={() => onSelect(host.name)} sx={{ py: 0.5 }}>
        <ListItemIcon sx={{ minWidth: 32 }}>
          {isFavourite ? (
            <StarIcon fontSize="small" sx={{
              color: 'primary.main',
              filter: 'drop-shadow(0 0 2px rgba(25, 118, 210, 0.3))'
            }} />
          ) : (
            <DnsIcon fontSize="small" color="action" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
              <Typography variant="body2" sx={{
                fontWeight: isFavourite ? 700 : 500,
                lineHeight: 1.2, wordBreak: 'break-all', color: isFavourite ? 'primary.main' : 'text.primary'
              }}>
                {host.name}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 0.25 }}>
                {host.tags && host.tags.filter(t => t !== 'fav').map(tag => (
                  <Typography key={tag} variant="caption" sx={{
                    color: 'primary.main', fontSize: '0.6rem',
                    fontWeight: 600, opacity: 0.8
                  }}>
                    #{tag}
                  </Typography>
                ))}
              </Box>
            </Box>
          }
          secondary={
            (!host.is_auto || host.name !== `${host.user || 'root'}@${host.hostname}`) && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>
                {secondaryText}
              </Typography>
            )
          }
        />
      </ListItemButton>
    </ListItem>
  );
}
