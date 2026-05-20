import { useEffect, useState, useMemo, useRef } from 'react';
import { Autocomplete, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Drawer, Toolbar, Typography, Box, CircularProgress, IconButton, Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, useMediaQuery, useTheme, Tabs, Tab, Chip, Divider } from '@mui/material';
import ComputerIcon from '@mui/icons-material/Computer';
import DnsIcon from '@mui/icons-material/Dns';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddIcon from '@mui/icons-material/Add';
import StarIcon from '@mui/icons-material/Star';
import { version as PACKAGE_JSON_VERSION } from '../package.json';

const drawerWidth = 260;

const remoteCommandOptions = [
  'tmux attach || tmux new', // Linux + tmux
  'tmux attach -or (tmux new)', // Windows PowerShell + psmux ( https://github.com/psmux/psmux ). Use "-or ()" so it works with PowerShell 5.1+
];

export interface Host {
  name: string;
  hostname: string;
  port: string;
  user: string;
  identity_file?: string;
  proxy_jump?: string;
  remote_command?: string;
  tags?: string[];
  comment?: string;
  source?: string;
  is_auto?: boolean;
  is_favourite?: boolean;
}

export default function Sidebar({ sysHostname, appVersion, mobileOpen, onClose, onSelect, onSelectTagAsSplit, onLogout, onOpenScratchpad, activeTabs, onAttach, onRefresh, hosts, fetchHosts }: { sysHostname: string, appVersion: string, mobileOpen: boolean, onClose: () => void, onSelect: (host: string) => void, onSelectTagAsSplit?: (tag: string, hosts: string[]) => void, onLogout?: () => void, onOpenScratchpad?: () => void, activeTabs: string[], onAttach: (id: string, host: string, title: string, isLocked: boolean) => void, onRefresh?: () => void, hosts: Host[], fetchHosts: () => void }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [loading, setLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  // Settings State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pinnedSessions, setPinnedSessions] = useState<any[]>([]);
  const [dialogTab, setDialogTab] = useState(0);

  const [swStatus, setSwStatus] = useState<string>('Unknown');

  useEffect(() => {
    if (settingsOpen && dialogTab === 1) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (!reg) setSwStatus('Not registered');
          else if (reg.active) setSwStatus('Active');
          else if (reg.waiting) setSwStatus('Waiting');
          else if (reg.installing) setSwStatus('Installing');
        }).catch(() => setSwStatus('Error checking status'));
      } else {
        setSwStatus('Not supported');
      }
    }
  }, [settingsOpen, dialogTab]);

  useEffect(() => {
    if (settingsOpen) {
      const token = localStorage.getItem('cozy_token');
      fetch('/api/sessions/pinned', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => setPinnedSessions(data || []))
        .catch(e => console.error(e));
    }
  }, [settingsOpen]);

  const [filterStr, setFilterStr] = useState('');
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [showTagsToggle, setShowTagsToggle] = useState(false);
  const tagsContainerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Host CRUD State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [formData, setFormData] = useState({ alias: '', hostname: '', user: '', port: '', identity_file: '', proxy_jump: '', remote_command: '', tags: '', comment: '' });
  const [initialHostFormData, setInitialHostFormData] = useState<any>(null);

  // Context Menu State
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; target: Host } | null>(null);
  const [tagContextMenuOpen, setTagContextMenuOpen] = useState(false);
  const [tagContextMenu, setTagContextMenu] = useState<{ mouseX: number; mouseY: number; tag: string } | null>(null);

  useEffect(() => {
    if (loading && hosts.length > 0) setLoading(false);
  }, [hosts, loading]);

  const handleSavePassword = async () => {
    if (newPwd !== confirmPwd) {
      alert("Passwords don't match");
      return;
    }
    const token = localStorage.getItem('cozy_token');
    const res = await fetch('/api/settings/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ new_password: newPwd })
    });
    if (res.ok) {
      alert('Password updated! You will be logged out.');
      if (onLogout) onLogout();
    } else {
      alert('Failed to update password');
    }
  };

  const handleClearCache = async () => {
    if (!confirm("This will unregister the Service Worker, clear all caches and reload. Proceed?")) return;
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (let registration of registrations) {
        await registration.unregister();
      }
      if (window.caches) {
        const cacheNames = await caches.keys();
        for (let cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }
      window.location.reload();
    }
  };

  const handleContextMenu = (e: React.MouseEvent, host: Host) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, target: host });
    setContextMenuOpen(true);
  };

  const closeMenu = () => setContextMenuOpen(false);
  const closeTagMenu = () => setTagContextMenuOpen(false);

  const handleTagContextMenu = (e: React.MouseEvent, tag: string) => {
    e.preventDefault();
    setTagContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, tag });
    setTagContextMenuOpen(true);
  };

  const handleOpenAllServers = () => {
    if (!tagContextMenu) return;
    const tag = tagContextMenu.tag;
    setFilterStr(`#${tag} `);
    const targets = hosts.filter(h => h.tags && h.tags.includes(tag));
    targets.forEach(h => onSelect(h.name));
    closeTagMenu();
  };

  const handleOpenSplitServers = () => {
    if (!tagContextMenu || !onSelectTagAsSplit) return;
    const tag = tagContextMenu.tag;
    const filtered = hosts.filter(h => h.tags && h.tags.includes(tag));

    const nameSorter = (a: any, b: any) => a.name.localeCompare(b.name);
    const hostNameSorter = (a: any, b: any) => {
      if (a.hostname === b.hostname) return a.name.localeCompare(b.name);
      return a.hostname.localeCompare(b.hostname);
    };

    const favs = filtered.filter(h => h.is_favourite).sort(nameSorter);
    const normals = filtered.filter(h => !h.is_favourite && !h.is_auto).sort(nameSorter);
    const autos = filtered.filter(h => !h.is_favourite && h.is_auto).sort(hostNameSorter);

    const targets = [...favs, ...normals, ...autos].slice(0, 4);
    if (targets.length > 0) {
      onSelectTagAsSplit(tag, targets.map(h => h.name));
    }
    closeTagMenu();
  };

  const handleCopyTagUrl = () => {
    if (!tagContextMenu) return;
    const url = `${window.location.origin}/##${tagContextMenu.tag}`;
    navigator.clipboard.writeText(url);
    closeTagMenu();
  };

  const handleAddOpen = () => {
    const data = { alias: '', hostname: '', user: 'root', port: '22', identity_file: '', proxy_jump: '', remote_command: '', tags: '', comment: '' };
    setEditingAlias(null);
    setFormData(data);
    setInitialHostFormData(data);
    setDialogOpen(true);
  };

  const handleEditOpen = () => {
    if (!contextMenu) return;
    const isAuto = contextMenu.target.source === 'known_hosts';
    const data = {
      alias: isAuto ? contextMenu.target.hostname : contextMenu.target.name,
      hostname: contextMenu.target.hostname,
      user: contextMenu.target.user || 'root',
      port: contextMenu.target.port || '22',
      identity_file: contextMenu.target.identity_file || '',
      proxy_jump: contextMenu.target.proxy_jump || '',
      remote_command: contextMenu.target.remote_command || '',
      tags: contextMenu.target.tags ? contextMenu.target.tags.join(' ') : '',
      comment: contextMenu.target.comment || ''
    };
    setEditingAlias(isAuto ? null : contextMenu.target.name);
    setFormData(data);
    setInitialHostFormData(data);
    closeMenu();
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    if (confirm(`Are you extremely certain you want to permanently delete "${contextMenu.target.name}"?`)) {
      const token = localStorage.getItem('cozy_token');
      await fetch(`/api/hosts/${contextMenu.target.name}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchHosts();
    }
    closeMenu();
  };

  const handleToggleFavourite = async () => {
    if (!contextMenu) return;
    const host = contextMenu.target;
    const token = localStorage.getItem('cozy_token');

    let newTags = host.tags ? [...host.tags] : [];
    if (host.is_favourite) {
      newTags = newTags.filter(t => t !== 'fav');
    } else {
      if (!newTags.includes('fav')) {
        newTags.push('fav');
      }
    }

    const payload = {
      alias: host.source === 'known_hosts' ? host.hostname : host.name,
      hostname: host.hostname,
      user: host.user || 'root',
      port: host.port || '22',
      identity_file: host.identity_file || '',
      proxy_jump: host.proxy_jump || '',
      remote_command: host.remote_command || '',
      tags: newTags
    };

    const url = host.source === 'config' ? `/api/hosts/${host.name}` : `/api/hosts`;
    const method = host.source === 'config' ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    closeMenu();
    fetchHosts();
  };

  const handleSaveHost = async () => {
    if (!formData.hostname) return;
    const finalAlias = formData.alias.trim() || formData.hostname.trim();
    const token = localStorage.getItem('cozy_token');
    const url = editingAlias ? `/api/hosts/${editingAlias}` : `/api/hosts`;
    const method = editingAlias ? 'PUT' : 'POST';

    const parsedTags = formData.tags.replace(/,/g, ' ').split(/\s+/).filter(t => t.trim() !== '');

    const payload = {
      ...formData,
      alias: finalAlias,
      tags: parsedTags
    };

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    setInitialHostFormData(null); // Reset dirty state on successful save
    setDialogOpen(false);
    fetchHosts();
  };

  const handleCloseHostDialog = (_: any, reason: string) => {
    const isDirty = initialHostFormData && JSON.stringify(formData) !== JSON.stringify(initialHostFormData);
    if (isDirty && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
      return;
    }
    setDialogOpen(false);
    setTimeout(() => (window as any).csFocus?.(), 0);
  };

  const filteredHosts = useMemo(() => {
    const filtered = filterHosts(hosts, filterStr);

    const favs = filtered.filter(h => h.is_favourite);
    const normals = filtered.filter(h => !h.is_favourite && !h.is_auto);
    const autos = filtered.filter(h => !h.is_favourite && h.is_auto);

    const nameSorter = (a: Host, b: Host) => a.name.localeCompare(b.name);
    const hostNameSorter = (a: Host, b: Host) => {
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

  const handleFilterKeyDown = (e: React.KeyboardEvent) => {
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
  };

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
          <span>CozySSH</span>&nbsp;
          <span title={sysHostname}>{sysHostname}</span>
        </Typography>
        <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
          <MoreVertIcon />
        </IconButton>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          <MenuItem onClick={() => {
            setAnchorEl(null);
            if (onRefresh) onRefresh();
          }}>Refresh</MenuItem>
          <MenuItem onClick={() => { setAnchorEl(null); setSettingsOpen(true); if (isMobile) onClose(); }}>Dashboard</MenuItem>
          <MenuItem onClick={() => { setAnchorEl(null); if (onOpenScratchpad) onOpenScratchpad(); }}>Open Scratchpad</MenuItem>
          <MenuItem onClick={() => { setAnchorEl(null); if (onLogout) onLogout(); }}>Logout</MenuItem>
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
          <IconButton size="small" title="New Server" onClick={handleAddOpen} sx={{ bgcolor: 'action.hover', border: '1px solid #ccc' }}>
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
                  {tagsExpanded ? <Typography variant="caption" color="text.secondary">▲</Typography> : <Typography variant="caption" color="text.secondary">▼</Typography>}
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

          {(filteredHosts.favourite.length > 0 || filteredHosts.normal.length > 0 || filteredHosts.auto.length > 0) && <Divider sx={{ my: 1 }} />}

          {filteredHosts.favourite.map((host, idx) => {
            const absIdx = idx;
            return <HostListItem key={`fav-${idx}`} filter={filterStr} host={host} onSelect={onSelect} onContextMenu={handleContextMenu} isSelected={selectedIndex === absIdx} />;
          })}

          {filteredHosts.favourite.length > 0 && (filteredHosts.normal.length > 0 || filteredHosts.auto.length > 0) && <Divider sx={{ my: 1 }} />}

          {filteredHosts.normal.map((host, idx) => {
            const absIdx = filteredHosts.favourite.length + idx;
            return <HostListItem key={`normal-${idx}`} filter={filterStr} host={host} onSelect={onSelect} onContextMenu={handleContextMenu} isSelected={selectedIndex === absIdx} />;
          })}

          {filteredHosts.normal.length > 0 && filteredHosts.auto.length > 0 && <Divider sx={{ my: 1 }} />}

          {filteredHosts.auto.map((host, idx) => {
            const absIdx = filteredHosts.favourite.length + filteredHosts.normal.length + idx;
            return <HostListItem key={`auto-${idx}`} filter={filterStr} host={host} onSelect={onSelect} onContextMenu={handleContextMenu} isSelected={selectedIndex === absIdx} />;
          })}
        </List>
      </Box>

      {/* Host Context Menu */}
      <Menu
        open={contextMenuOpen}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={handleEditOpen}>Edit {contextMenu?.target.name}</MenuItem>
        <MenuItem onClick={() => {
          if (!contextMenu) return;
          const url = `${window.location.origin}/#${contextMenu?.target.source !== 'known_hosts' ? contextMenu.target.name : `${contextMenu.target.user || "root"}@${contextMenu.target.hostname}`}`;
          navigator.clipboard.writeText(url);
          closeMenu();
        }}>Copy URL</MenuItem>
        <MenuItem onClick={() => {
          if (!contextMenu) return;
          let command = `ssh`;
          if (contextMenu.target.identity_file) {
            command += ` -i "${contextMenu.target.identity_file}"`;
          }
          if (contextMenu.target.proxy_jump) {
            const jumpServers = contextMenu.target.proxy_jump.split(',').map(name => {
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
          if (contextMenu.target.remote_command) {
            if (/\b(?:sudo|vim|vi|nano|top|htop|btop|tmux|screen)\b/.test(contextMenu.target.remote_command)) {
              command += ` -t`;
            }
            command += ` -o "RemoteCommand=${contextMenu.target.remote_command}"`;
          }
          if (contextMenu.target.port !== "22") {
            command += ` -p ${contextMenu.target.port}`;
          }
          command += ` ${contextMenu.target.user}@${contextMenu.target.hostname}`;
          navigator.clipboard.writeText(command);
          closeMenu();
        }}>Copy SSH Command</MenuItem>
        <MenuItem onClick={() => {
          if (!contextMenu) return;
          let command = `ssh-copy-id`;
          if (contextMenu.target.identity_file) {
            command += ` -i "${contextMenu.target.identity_file}"`;
          }
          if (contextMenu.target.port !== "22") {
            command += ` -p ${contextMenu.target.port}`;
          }
          command += ` ${contextMenu.target.user}@${contextMenu.target.hostname}`;
          navigator.clipboard.writeText(command);
          closeMenu();
        }}>Copy ssh-copy-id Command</MenuItem>
        <MenuItem onClick={handleToggleFavourite}>
          {contextMenu?.target.is_favourite ? 'Remove From Favourite' : 'Add To Favourite'}
        </MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>Delete {contextMenu?.target.source === 'config' ? 'Host' : 'Auto Host'}</MenuItem>
      </Menu>

      <Menu
        open={tagContextMenuOpen}
        onClose={closeTagMenu}
        anchorReference="anchorPosition"
        anchorPosition={tagContextMenu ? { top: tagContextMenu.mouseY, left: tagContextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={handleOpenAllServers}>Open All ({tagContextMenu?.tag})</MenuItem>
        <MenuItem onClick={handleOpenSplitServers}>Open All in same tab (split)</MenuItem>
        <MenuItem onClick={handleCopyTagUrl}>Copy URL</MenuItem>
      </Menu>

      {/* Dashboard Dialog */}
      <Dialog open={settingsOpen} onClose={() => {
        setSettingsOpen(false);
        setTimeout(() => (window as any).csFocus?.(), 0);
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
                      {canAttach && <Button size="small" variant="outlined" onClick={() => onAttach(ps.id, ps.host, ps.title, !!ps.isLocked)}>Attach</Button>}
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
                  <Chip label={swStatus} size="small" color={swStatus === 'Active' ? 'success' : 'default'} variant="outlined" sx={{ fontWeight: 'bold' }} />
                </Box>
                <Button variant="outlined" color="error" size="small" onClick={handleClearCache} sx={{ mt: 1 }}>
                  Force Clear Cache & Unregister SW
                </Button>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>Change App Password</Typography>
                <TextField fullWidth label="New Password" type="password" size="small" margin="dense" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
                <TextField fullWidth label="Confirm Password" type="password" size="small" margin="dense" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
                <Button variant="contained" onClick={handleSavePassword} disabled={!newPwd} sx={{ mt: 2 }} disableElevation>Save Password</Button>
              </>
            )}

            {dialogTab === 2 && (
              <>
                <Typography variant="subtitle2" gutterBottom>Keyboard Shortcuts</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
                  <b>Alt + O</b> : Open new tab dialog, use ← → to switch view, ↑ ↓ to select, Enter to open<br />
                  <b>Alt + E</b> : Open new tab dialog - buttons view<br />
                  <b>Alt + N</b> : Open new local shell tab<br />
                  <b>Alt + S</b> : Open scratchpad<br />
                  <b>Alt + H / Alt + L</b> : Switch to previous / next tab<br />
                  <b>Alt + 1-9,0</b> : Switch to tab 1-9, last tab<br />
                  <b>Alt + W</b> : Close current tab or pane<br />
                  <b>Alt + I</b> : Focus sidebar search filter, use ↑ ↓ to select, Enter to open<br />
                  <b>Alt + G</b> : Focus active terminal session<br />
                  <b>Alt + A</b> : Select all in current terminal and copy<br />
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
                  <a href="https://github.com/sagan/cozyssh" target="_blank" rel="noopener noreferrer" style={{ color: theme.palette.primary.main, textDecoration: 'none' }}>
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
      <Dialog open={dialogOpen} onClose={handleCloseHostDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingAlias ? `Edit Host: ${editingAlias}` : 'Add New Server'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField fullWidth label="Alias Name" size="small" value={formData.alias} onChange={e => setFormData({ ...formData, alias: e.target.value })} placeholder={formData.hostname || "e.g. production-database"} />
            <TextField fullWidth label="HostName (IP / Domain)" size="small" value={formData.hostname} onChange={e => setFormData({ ...formData, hostname: e.target.value })} required autoFocus={!formData.hostname} />
            <TextField fullWidth label="User" size="small" value={formData.user} onChange={e => setFormData({ ...formData, user: e.target.value })} placeholder="default: root" />
            <TextField fullWidth label="Port" size="small" value={formData.port} onChange={e => setFormData({ ...formData, port: e.target.value })} placeholder="default: 22" />
            <TextField fullWidth label="Tags (Optional)" size="small" value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} placeholder="e.g. production web" />
            <TextField fullWidth label="IdentityFile (Optional)" size="small" value={formData.identity_file} onChange={e => setFormData({ ...formData, identity_file: e.target.value })} placeholder="~/.ssh/id_ed25519" />
            <TextField fullWidth label="ProxyJump (Optional)" size="small" value={formData.proxy_jump} onChange={e => setFormData({ ...formData, proxy_jump: e.target.value })} placeholder="e.g. server-foo,server-bar" />
            <Autocomplete freeSolo options={remoteCommandOptions} value={formData.remote_command}
              onInputChange={(_event, newValue) => {
                setFormData({ ...formData, remote_command: newValue })
              }}
              renderInput={(params) => (
                <TextField {...params} fullWidth label="RemoteCommand (Optional)" size="small" placeholder="e.g. tmux attach || tmux new" />
              )}
            />
            <TextField fullWidth label="Comment (Optional)" size="small" multiline rows={2} value={formData.comment} onChange={e => setFormData({ ...formData, comment: e.target.value })} placeholder="Host description..." />
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

function HostListItem({ filter, host, onSelect, onContextMenu, isSelected }: { filter: string, host: Host, onSelect: (name: string) => void, onContextMenu: (e: React.MouseEvent, host: Host) => void, isSelected?: boolean }) {
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
            <StarIcon fontSize="small" sx={{ color: 'primary.main', filter: 'drop-shadow(0 0 2px rgba(25, 118, 210, 0.3))' }} />
          ) : (
            <DnsIcon fontSize="small" color="action" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: isFavourite ? 700 : 500, lineHeight: 1.2, wordBreak: 'break-all', color: isFavourite ? 'primary.main' : 'text.primary' }}>
                {host.name}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 0.25 }}>
                {host.tags && host.tags.filter(t => t !== 'fav').map(tag => (
                  <Typography key={tag} variant="caption" sx={{ color: 'primary.main', fontSize: '0.6rem', fontWeight: 600, opacity: 0.8 }}>
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

/**
 * Filter hosts by tags and search text.
 * @param hosts - Array of hosts to filter
 * @param filterStr - Filter string. Put "#tag" syntax(es) at the beginning to filter by tags. E.g. "#foo #bar git server".
 * @returns Filtered array of hosts.
 */
export function filterHosts(hosts: Host[], filterStr: string): Host[] {
  filterStr = filterStr.trim().toLowerCase();
  if (!filterStr) {
    return hosts;
  }

  const tokens = filterStr.split(/\s+/);
  const requiredTags: string[] = [];
  let textStartIndex = 0;

  // Extract tags from the beginning
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('#') && token.length > 1) {
      // Remove the '#' and add to required tags
      requiredTags.push(token.substring(1));
      textStartIndex = i + 1;
    } else {
      // Stop extracting tags as soon as a non-tag word appears
      break;
    }
  }

  // The rest of the string is the search text (case-insensitive)
  const searchText = tokens.slice(textStartIndex).join(' ');

  return hosts.filter(host => {
    // 1. Tag Filtering
    // If the filter contains tags, the host MUST have all of them
    if (requiredTags.length > 0) {
      if (!host.tags || host.tags.length === 0) {
        return false;
      }

      const hasAllTags = requiredTags.every(tag => host.tags!.includes(tag));
      if (!hasAllTags) {
        return false;
      }
    }

    // 2. Text Filtering
    // If there is remaining text, it must match name, hostname, or comment
    if (searchText) {
      const matchName = host.name.toLowerCase().includes(searchText);
      const matchHostname = host.hostname.toLowerCase().includes(searchText);
      const matchComment = !!(host.comment && host.comment.toLowerCase().includes(searchText));

      if (!matchName && !matchHostname && !matchComment) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Search needle in input and returns a snippet with the needle highlighted and centered.
 * For example, if it searchs "Liberty" in "Declaration of Independence", it returns "that among these are Life, Liberty and the pursuit of Happiness."
 * @param input - Input string
 * @param needle - Needle to search for
 * @returns Snippet with the needle highlighted and centered
 */
export function searchString(input: string, needle: string): string {
  if (!input || !needle) return "";

  const lowerInput = input.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const matchIndex = lowerInput.indexOf(lowerNeedle);

  // Return empty string if no match is found
  if (matchIndex === -1) {
    return "";
  }

  // Define the number of characters of context to grab around the match
  const contextLength = 40;

  // Calculate initial start and end bounds
  let start = Math.max(0, matchIndex - contextLength);
  let end = Math.min(input.length, matchIndex + needle.length + contextLength);

  // If we aren't at the beginning of the string, snap to the nearest subsequent whitespace 
  // to avoid returning a partially truncated word at the start of the snippet.
  if (start > 0) {
    const nextSpace = input.substring(start, matchIndex).indexOf(" ");
    if (nextSpace !== -1) {
      start = start + nextSpace + 1;
    }
  }

  // If we aren't at the end of the string, snap to the nearest preceding whitespace 
  // to avoid returning a partially truncated word at the end of the snippet.
  if (end < input.length) {
    const trailingContext = input.substring(matchIndex + needle.length, end);
    const lastSpace = trailingContext.lastIndexOf(" ");
    if (lastSpace !== -1) {
      end = matchIndex + needle.length + lastSpace;
    }
  }

  // Extract the snippet
  let snippet = input.substring(start, end);

  // Replace multi-line breaks, tabs, or consecutive spaces with a single space
  return snippet.replace(/\s+/g, " ").trim();
}
