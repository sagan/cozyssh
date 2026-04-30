import { useEffect, useState, useMemo, useRef } from 'react';
import { List, ListItem, ListItemButton, ListItemIcon, ListItemText, Drawer, Toolbar, Typography, Box, CircularProgress, IconButton, Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, useMediaQuery, useTheme, Tabs, Tab, Chip, Divider } from '@mui/material';
import ComputerIcon from '@mui/icons-material/Computer';
import DnsIcon from '@mui/icons-material/Dns';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddIcon from '@mui/icons-material/Add';
import StarIcon from '@mui/icons-material/Star';

const drawerWidth = 260;

export interface Host {
  name: string;
  hostname: string;
  port: string;
  user: string;
  identity_file?: string;
  proxy_jump?: string;
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
  const [formData, setFormData] = useState({ alias: '', hostname: '', user: '', port: '', identity_file: '', proxy_jump: '', tags: '', comment: '' });
  const [initialHostFormData, setInitialHostFormData] = useState<any>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; target: Host } | null>(null);
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
  };

  const closeMenu = () => setContextMenu(null);
  const closeTagMenu = () => setTagContextMenu(null);

  const handleTagContextMenu = (e: React.MouseEvent, tag: string) => {
    e.preventDefault();
    setTagContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, tag });
  };

  const handleOpenAllServers = () => {
    if (!tagContextMenu) return;
    const tag = tagContextMenu.tag;
    setFilterStr(`#${tag} `);
    const targets = hosts.filter(h => h.tags && h.tags.includes(tag));
    targets.forEach(h => onSelect(h.name));
    setTagContextMenu(null);
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
    setTagContextMenu(null);
  };

  const handleCopyTagUrl = () => {
    if (!tagContextMenu) return;
    const url = `${window.location.origin}/##${tagContextMenu.tag}`;
    navigator.clipboard.writeText(url);
    setTagContextMenu(null);
  };

  const handleAddOpen = () => {
    const data = { alias: '', hostname: '', user: 'root', port: '22', identity_file: '', proxy_jump: '', tags: '', comment: '' };
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
  };

  const filteredHosts = useMemo(() => {
    const tokens = filterStr.toLowerCase().split(/\s+/).filter(t => t.trim() !== '');
    const requiredTags = tokens.filter(t => t.startsWith('#')).map(t => t.substring(1));
    const searchWords = tokens.filter(t => !t.startsWith('#')).map(t => t.toLowerCase());

    const filtered = hosts.filter(h => {
      if (requiredTags.length > 0) {
        if (!h.tags) return false;
        const lowerTags = h.tags.map(t => t.toLowerCase());
        for (const reqTag of requiredTags) {
          if (!lowerTags.includes(reqTag)) return false;
        }
      }

      if (searchWords.length > 0) {
        return searchWords.every(word =>
          h.name.toLowerCase().includes(word) ||
          h.hostname.toLowerCase().includes(word) ||
          (h.user && h.user.toLowerCase().includes(word))
        );
      }

      return true;
    });

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
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, flatFilteredHosts.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
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
                const isActive = filterStr.toLowerCase().includes(`#${tag.toLowerCase()}`);
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
            return <HostListItem key={`fav-${idx}`} host={host} onSelect={onSelect} onContextMenu={handleContextMenu} isSelected={selectedIndex === absIdx} />;
          })}

          {filteredHosts.favourite.length > 0 && (filteredHosts.normal.length > 0 || filteredHosts.auto.length > 0) && <Divider sx={{ my: 1 }} />}

          {filteredHosts.normal.map((host, idx) => {
            const absIdx = filteredHosts.favourite.length + idx;
            return <HostListItem key={`normal-${idx}`} host={host} onSelect={onSelect} onContextMenu={handleContextMenu} isSelected={selectedIndex === absIdx} />;
          })}

          {filteredHosts.normal.length > 0 && filteredHosts.auto.length > 0 && <Divider sx={{ my: 1 }} />}

          {filteredHosts.auto.map((host, idx) => {
            const absIdx = filteredHosts.favourite.length + filteredHosts.normal.length + idx;
            return <HostListItem key={`auto-${idx}`} host={host} onSelect={onSelect} onContextMenu={handleContextMenu} isSelected={selectedIndex === absIdx} />;
          })}
        </List>
      </Box>

      {/* Host Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={handleEditOpen}>Edit {contextMenu?.target.name}</MenuItem>
        {contextMenu?.target.source !== 'known_hosts' && (
          <MenuItem onClick={() => {
            if (!contextMenu) return;
            const url = `${window.location.origin}/#${contextMenu.target.name}`;
            navigator.clipboard.writeText(url);
            closeMenu();
          }}>Copy URL</MenuItem>
        )}
        <MenuItem onClick={handleToggleFavourite}>
          {contextMenu?.target.is_favourite ? 'Remove From Favourite' : 'Add To Favourite'}
        </MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>Delete {contextMenu?.target.source === 'config' ? 'Host' : 'Auto Host'}</MenuItem>
      </Menu>

      <Menu
        open={tagContextMenu !== null}
        onClose={closeTagMenu}
        anchorReference="anchorPosition"
        anchorPosition={tagContextMenu ? { top: tagContextMenu.mouseY, left: tagContextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={handleOpenAllServers}>Open All ({tagContextMenu?.tag})</MenuItem>
        <MenuItem onClick={handleOpenSplitServers}>Open All in same tab (split)</MenuItem>
        <MenuItem onClick={handleCopyTagUrl}>Copy URL</MenuItem>
      </Menu>

      {/* Dashboard Dialog */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="sm" sx={{ '& .MuiDialog-paper': { overflow: 'hidden' } }}>
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
                  <b>Alt + T</b> : Open new tab<br />
                  <b>Alt + J</b> : Switch to next tab<br />
                  <b>Alt + K</b> : Switch to previous tab<br />
                  <b>Alt + 1-9</b> : Switch to tab 1-9<br />
                  <b>Alt + 0</b> : Switch to last tab<br />
                  <b>Alt + W</b> : Close current tab<br />
                  <b>Alt + I</b> : Focus sidebar search filter, then Use ↑ ↓ to select, Enter to open<br />
                  <b>Alt + G</b> : Focus active terminal session<br />
                  <b>Alt + Shift + 1-9,0</b> : Click the button in button bar<br />
                  <b>Alt + ↑ / ↓</b> : Scroll terminal up / down<br />
                  <b>Mouse Select</b> in terminal to copy<br />
                  <b>Mouse Right Click</b> in terminal to paste<br />
                </Typography>
              </>
            )}

            {dialogTab === 3 && (
              <Box sx={{ textAlign: 'center', mt: 4 }}>
                <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold' }}>CozySSH</Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  Version: <b>{appVersion}</b>
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
            <TextField fullWidth label="ProxyJump (Optional)" size="small" value={formData.proxy_jump} onChange={e => setFormData({ ...formData, proxy_jump: e.target.value })} placeholder="e.g. jump-host-alias" />
            <TextField fullWidth label="Comment (Optional)" size="small" multiline rows={2} value={formData.comment} onChange={e => setFormData({ ...formData, comment: e.target.value })} placeholder="Host description..." />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveHost} disabled={!formData.hostname}>Save Changes</Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
}

function HostListItem({ host, onSelect, onContextMenu, isSelected }: { host: Host, onSelect: (name: string) => void, onContextMenu: (e: React.MouseEvent, host: Host) => void, isSelected?: boolean }) {
  const isFavourite = host.is_favourite;
  return (
    <ListItem
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
                {`${host.user || 'root'}@${host.hostname}`}
              </Typography>
            )
          }
        />
      </ListItemButton>
    </ListItem>
  );
}
