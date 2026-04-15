import { useEffect, useState, useMemo } from 'react';
import { List, ListItem, ListItemButton, ListItemIcon, ListItemText, Drawer, Toolbar, Typography, Box, CircularProgress, IconButton, Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, useMediaQuery, useTheme } from '@mui/material';
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
}

export default function Sidebar({ mobileOpen, onClose, onSelect, onLogout }: { mobileOpen: boolean, onClose: () => void, onSelect: (host: string) => void, onLogout?: () => void }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  
  // Settings State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');

  // Filtering State
  const [filterStr, setFilterStr] = useState('');
  
  // Host CRUD State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [formData, setFormData] = useState({ alias: '', hostname: '', user: '', port: '', identity_file: '' });

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
    setFormData({ alias: '', hostname: '', user: 'root', port: '22', identity_file: '' });
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
      identity_file: contextMenu.target.identity_file || ''
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
    
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(formData)
    });
    
    setDialogOpen(false);
    fetchHosts();
  };

  const filteredHosts = useMemo(() => {
    const lower = filterStr.toLowerCase();
    return hosts.filter(h => h.name.toLowerCase().includes(lower) || h.hostname.toLowerCase().includes(lower));
  }, [hosts, filterStr]);

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
          CozySSH
        </Typography>
        <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
          <MoreVertIcon />
        </IconButton>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          <MenuItem onClick={() => { setAnchorEl(null); setSettingsOpen(true); }}>Settings</MenuItem>
          <MenuItem onClick={() => { setAnchorEl(null); if (onLogout) onLogout(); }}>Logout</MenuItem>
        </Menu>
      </Toolbar>

      <Box sx={{ px: 2, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          size="small"
          placeholder="Filter hosts..."
          value={filterStr}
          onChange={(e) => setFilterStr(e.target.value)}
          sx={{ flexGrow: 1 }}
        />
        <IconButton size="small" onClick={handleAddOpen} sx={{ bgcolor: 'action.hover', border: '1px solid #ccc' }}>
          <AddIcon fontSize="small" />
        </IconButton>
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
                <ListItemIcon><DnsIcon /></ListItemIcon>
                <ListItemText primary={host.name} secondary={`${host.user || 'root'}@${host.hostname}`} />
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

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <DialogTitle>Settings & Shortcuts</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, minWidth: 300 }}>
            <Typography variant="subtitle2" gutterBottom>Change App Password</Typography>
            <TextField fullWidth label="New Password" type="password" size="small" margin="dense" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
            <TextField fullWidth label="Confirm Password" type="password" size="small" margin="dense" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
            
            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }} gutterBottom>Keyboard Shortcuts</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
              <b>Alt + T</b> : Open new local shell tab<br/>
              <b>Alt + J</b> : Switch to next tab<br/>
              <b>Alt + K</b> : Switch to previous tab<br/>
              <b>Alt + W</b> : Close current tab
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSavePassword} disabled={!newPwd}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Host CRUD Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingAlias ? `Edit Host: ${editingAlias}` : 'Add New Server'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField fullWidth label="Alias Name" size="small" value={formData.alias} onChange={e => setFormData({...formData, alias: e.target.value})} placeholder="e.g. production-database" required />
            <TextField fullWidth label="HostName (IP / Domain)" size="small" value={formData.hostname} onChange={e => setFormData({...formData, hostname: e.target.value})} required />
            <TextField fullWidth label="User" size="small" value={formData.user} onChange={e => setFormData({...formData, user: e.target.value})} placeholder="default: root" />
            <TextField fullWidth label="Port" size="small" value={formData.port} onChange={e => setFormData({...formData, port: e.target.value})} placeholder="default: 22" />
            <TextField fullWidth label="IdentityFile (Optional)" size="small" value={formData.identity_file} onChange={e => setFormData({...formData, identity_file: e.target.value})} placeholder="~/.ssh/id_ed25519" />
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
