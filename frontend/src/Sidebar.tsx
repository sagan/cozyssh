import { useEffect, useState, useMemo, useRef } from 'react';
import { List, ListItem, ListItemButton, ListItemIcon, ListItemText, Drawer, Toolbar, Typography, Box, CircularProgress, IconButton, Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, useMediaQuery, useTheme, Tabs, Tab, Chip } from '@mui/material';
import ComputerIcon from '@mui/icons-material/Computer';
import DnsIcon from '@mui/icons-material/Dns';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddIcon from '@mui/icons-material/Add';

const drawerWidth = 260; // Expanded slightly for filter components naturally

interface Host {
  name: string;
  hostname: string;
  port: string;
  user: string;
  identity_file?: string;
  tags?: string[];
}

export default function Sidebar({ sysHostname, appVersion, mobileOpen, onClose, onSelect, onLogout, activeTabs, onAttach }: { sysHostname: string, appVersion: string, mobileOpen: boolean, onClose: () => void, onSelect: (host: string) => void, onLogout?: () => void, activeTabs: string[], onAttach: (id: string, host: string, title: string) => void }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  // Settings State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pinnedSessions, setPinnedSessions] = useState<any[]>([]);
  const [dialogTab, setDialogTab] = useState(0);

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

  // Host CRUD State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [formData, setFormData] = useState({ alias: '', hostname: '', user: '', port: '', identity_file: '', tags: '' });

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; target: Host } | null>(null);

  const fetchHosts = () => {
    const token = localStorage.getItem('cozy_token');
    fetch('/api/hosts', { headers: { 'Authorization': `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401) {
          localStorage.removeItem('cozy_token');
          window.location.href = '/login';
          throw new Error('Unauthorized');
        }
        return r.json();
      })
      .then((data) => setHosts(data || []))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchHosts();
  }, []);

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

  const handleContextMenu = (e: React.MouseEvent, host: Host) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4, target: host });
  };

  const closeMenu = () => setContextMenu(null);

  const handleAddOpen = () => {
    setEditingAlias(null);
    setFormData({ alias: '', hostname: '', user: 'root', port: '22', identity_file: '', tags: '' });
    setDialogOpen(true);
  };

  const handleEditOpen = () => {
    if (!contextMenu) return;
    setEditingAlias(contextMenu.target.name);
    setFormData({
      alias: contextMenu.target.name,
      hostname: contextMenu.target.hostname,
      user: contextMenu.target.user || 'root',
      port: contextMenu.target.port || '22',
      identity_file: contextMenu.target.identity_file || '',
      tags: contextMenu.target.tags ? contextMenu.target.tags.join(' ') : ''
    });
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

  const handleSaveHost = async () => {
    if (!formData.alias || !formData.hostname) return;
    const token = localStorage.getItem('cozy_token');
    const url = editingAlias ? `/api/hosts/${editingAlias}` : `/api/hosts`;
    const method = editingAlias ? 'PUT' : 'POST';

    // Convert comma or space separated string to array safely
    const parsedTags = formData.tags.replace(/,/g, ' ').split(/\s+/).filter(t => t.trim() !== '');

    const payload = {
      ...formData,
      tags: parsedTags
    };

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    setDialogOpen(false);
    fetchHosts();
  };

  const filteredHosts = useMemo(() => {
    const tokens = filterStr.toLowerCase().split(/\s+/);
    const requiredTags = tokens.filter(t => t.startsWith('#')).map(t => t.substring(1));
    const searchWords = tokens.filter(t => !t.startsWith('#')).map(t => t.toLowerCase());

    return hosts.filter(h => {
      // Check tags
      if (requiredTags.length > 0) {
        if (!h.tags) return false;
        const lowerTags = h.tags.map(t => t.toLowerCase());
        for (const reqTag of requiredTags) {
          if (!lowerTags.includes(reqTag)) return false;
        }
      }

      // Check normal strings
      if (searchWords.length > 0) {
        const matches = searchWords.every(word => h.name.toLowerCase().includes(word) || h.hostname.toLowerCase().includes(word));
        if (!matches) return false;
      }

      return true;
    });
  }, [hosts, filterStr]);

  const uniqueTags = useMemo(() => {
    const set = new Set<string>();
    hosts.forEach(h => {
      if (h.tags) h.tags.forEach(t => set.add(t));
    });
    return Array.from(set).sort();
  }, [hosts]);

  useEffect(() => {
    // Slight timeout gives the DOM time to render the chips and evaluate scrollHeight cleanly
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
          <MenuItem onClick={() => { setAnchorEl(null); setSettingsOpen(true); }}>Dashboard</MenuItem>
          <MenuItem onClick={() => { setAnchorEl(null); if (onLogout) onLogout(); }}>Logout</MenuItem>
        </Menu>
      </Toolbar>

      <Box sx={{ px: 2, pb: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            size="small"
            type="search"
            placeholder="Filter hosts or #tag..."
            value={filterStr}
            onChange={(e) => setFilterStr(e.target.value)}
            sx={{ flexGrow: 1 }}
          />
          <IconButton size="small" onClick={handleAddOpen} sx={{ bgcolor: 'action.hover', border: '1px solid #ccc' }}>
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
                    }}
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
          {filteredHosts.map((host, idx) => (
            <ListItem key={idx} disablePadding onContextMenu={(e) => handleContextMenu(e, host)}>
              <ListItemButton onClick={() => onSelect(host.name)}>
                <ListItemIcon sx={{ minWidth: 40 }}><DnsIcon fontSize="small" /></ListItemIcon>
                <ListItemText 
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.2, wordBreak: 'break-all' }}>{host.name}</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 0.25, mt: 0.2 }}>
                        {host.tags && host.tags.map(tag => (
                          <Typography key={tag} variant="caption" sx={{ color: 'primary.main', fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            #{tag}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                  } 
                  secondary={
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.2 }}>
                      {`${host.user || 'root'}@${host.hostname}`}
                    </Typography>
                  } 
                />
              </ListItemButton>
            </ListItem>
          ))}
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
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>Delete File Target</MenuItem>
      </Menu>

      {/* Dashboard Dialog */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>CozySSH {appVersion} Dashboard</DialogTitle>
        <DialogContent sx={{ minHeight: 400 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={dialogTab} onChange={(_, newVal) => setDialogTab(newVal)}>
              <Tab label="Sessions" />
              <Tab label="Settings" />
              <Tab label="Shortcuts" />
            </Tabs>
          </Box>
          <Box sx={{ mt: 2, minWidth: 350, minHeight: 200 }}>
            {dialogTab === 0 && (
              <List dense sx={{ border: '1px solid #ddd', borderRadius: 1, maxHeight: 250, overflow: 'auto' }}>
                {pinnedSessions.map(ps => {
                  const isLocal = activeTabs.includes(ps.id);
                  const canAttach = !isLocal && ps.listenerCount > 0;
                  return (
                    <ListItem key={ps.id} divider>
                      <ListItemText primary={ps.title} secondary={`${ps.host} (Listeners: ${ps.listenerCount})`} />
                      {canAttach && <Button size="small" variant="outlined" onClick={() => onAttach(ps.id, ps.host, ps.title)}>Attach</Button>}
                    </ListItem>
                  );
                })}
                {pinnedSessions.length === 0 && <ListItem><ListItemText primary="No pinned sessions" /></ListItem>}
              </List>
            )}

            {dialogTab === 1 && (
              <>
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
                  <b>Alt + T</b> : Open new local shell tab<br />
                  <b>Alt + J</b> : Switch to next tab<br />
                  <b>Alt + K</b> : Switch to previous tab<br />
                  <b>Alt + W</b> : Close current tab
                </Typography>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Host CRUD Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingAlias ? `Edit Host: ${editingAlias}` : 'Add New Server'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField fullWidth label="Alias Name" size="small" value={formData.alias} onChange={e => setFormData({ ...formData, alias: e.target.value })} placeholder="e.g. production-database" required />
            <TextField fullWidth label="HostName (IP / Domain)" size="small" value={formData.hostname} onChange={e => setFormData({ ...formData, hostname: e.target.value })} required />
            <TextField fullWidth label="User" size="small" value={formData.user} onChange={e => setFormData({ ...formData, user: e.target.value })} placeholder="default: root" />
            <TextField fullWidth label="Port" size="small" value={formData.port} onChange={e => setFormData({ ...formData, port: e.target.value })} placeholder="default: 22" />
            <TextField fullWidth label="IdentityFile (Optional)" size="small" value={formData.identity_file} onChange={e => setFormData({ ...formData, identity_file: e.target.value })} placeholder="~/.ssh/id_ed25519" />
            <TextField fullWidth label="Tags (Optional)" size="small" value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} placeholder="e.g. production web" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveHost} disabled={!formData.alias || !formData.hostname}>Save Changes</Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
}
