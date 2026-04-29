import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
  IconButton,
  InputAdornment,
  useMediaQuery,
  useTheme
} from '@mui/material';
import ComputerIcon from '@mui/icons-material/Computer';
import DnsIcon from '@mui/icons-material/Dns';
import HistoryIcon from '@mui/icons-material/History';
import SendIcon from '@mui/icons-material/Send';
import StarIcon from '@mui/icons-material/Star';
import TabIcon from '@mui/icons-material/Tab';
import PushPinIcon from '@mui/icons-material/PushPin';
import SmartButtonIcon from '@mui/icons-material/SmartButton';
import type { Host } from './Sidebar';

interface Recent {
  host: string;
  last_used: number;
}

interface NewTabDialogProps {
  open: boolean;
  onClose: () => void;
  hosts: Host[];
  recents: Recent[];
  tabs?: any[];
  serverPinned?: any[];
  buttons?: any[];
  activeGroup?: string;
  onSelect: (host: string) => void;
  onSelectTab?: (tabId: string) => void;
  onAttachPinned?: (id: string, host: string, title: string) => void;
  onExecuteButton?: (btn: any) => void;
}

export default function NewTabDialog({ open, onClose, hosts, recents, tabs = [], serverPinned = [], buttons = [], activeGroup, onSelect, onSelectTab, onAttachPinned, onExecuteButton }: NewTabDialogProps) {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'servers' | 'tabs' | 'buttons'>('servers');
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<{ x: number, y: number, time: number } | null>(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTouch = useMediaQuery('(pointer: coarse)');

  const filteredRecents = useMemo(() => {
    if (viewMode !== 'servers') return [];
    const f = filter.toLowerCase();
    return recents
      .filter(r => r.host.toLowerCase().includes(f))
      .sort((a, b) => b.last_used - a.last_used)
      .slice(0, 5);
  }, [recents, filter, viewMode]);

  const filteredHosts = useMemo(() => {
    if (viewMode !== 'servers') return [];
    const f = filter.toLowerCase();
    const result = hosts.filter(h =>
      h.name.toLowerCase().includes(f) ||
      h.hostname.toLowerCase().includes(f) ||
      (h.user && h.user.toLowerCase().includes(f))
    );

    if (filter === '') {
      return result.filter(h => h.is_favourite).sort((a, b) => a.name.localeCompare(b.name));
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [hosts, filter, viewMode]);

  const directConnect = useMemo(() => {
    if (viewMode !== 'servers') return null;
    if (!filter || (!filter.includes('.') && !filter.includes(':') && filter !== 'localhost')) return null;
    return filter;
  }, [filter, viewMode]);

  const activeTabsList = useMemo(() => {
    if (viewMode !== 'tabs') return [];
    const f = filter.toLowerCase();
    return tabs.filter(t => t.title.toLowerCase().includes(f) || (t.type === 'terminal' && t.panes.some((p: any) => p.host.toLowerCase().includes(f))));
  }, [tabs, filter, viewMode]);

  const attachablePinnedTabs = useMemo(() => {
    if (viewMode !== 'tabs') return [];
    const f = filter.toLowerCase();
    return serverPinned.filter(p => !tabs.some(t => t.id === p.id) && (p.title?.toLowerCase().includes(f) || p.host?.toLowerCase().includes(f)));
  }, [serverPinned, tabs, filter, viewMode]);

  const filteredButtons = useMemo(() => {
    if (viewMode !== 'buttons') return [];
    const f = filter.toLowerCase();
    return buttons.filter(b => b.name.toLowerCase().includes(f));
  }, [buttons, filter, viewMode]);

  const activeGroupButtons = useMemo(() => {
    if (viewMode !== 'buttons') return [];
    return filteredButtons.filter(b => (b.group || 'Default') === (activeGroup || 'Default'));
  }, [filteredButtons, activeGroup, viewMode]);

  const otherGroupButtons = useMemo(() => {
    if (viewMode !== 'buttons') return [];
    return filteredButtons.filter(b => (b.group || 'Default') !== (activeGroup || 'Default'));
  }, [filteredButtons, activeGroup, viewMode]);

  const items = useMemo(() => {
    const res: { type: 'recent' | 'host' | 'direct' | 'local' | 'tab' | 'pinned_tab' | 'button' | 'other_button', value: string, label: string, subtitle?: string, isFav?: boolean, id?: string, host?: string, btn?: any }[] = [];

    if (viewMode === 'servers') {
      filteredRecents.forEach(r => {
        const knownHost = hosts.find(h => h.name === r.host);
        res.push({
          type: 'recent',
          value: r.host,
          label: r.host,
          subtitle: knownHost ? `${knownHost.user || 'root'}@${knownHost.hostname}` : undefined
        });
      });

      if ('local'.includes(filter.toLowerCase())) {
        res.push({ type: 'local', value: 'local', label: 'Local Shell', subtitle: 'Run commands on this machine' });
      }

      filteredHosts.forEach(h => {
        res.push({
          type: 'host',
          value: h.name,
          label: h.name,
          subtitle: `${h.user || 'root'}@${h.hostname}`,
          isFav: h.is_favourite
        });
      });

      if (directConnect) {
        res.push({
          type: 'direct',
          value: directConnect,
          label: `Connect to ${directConnect} (SSH)`
        });
      }
    } else if (viewMode === 'tabs') {
      activeTabsList.forEach(t => {
        res.push({
          type: 'tab',
          id: t.id,
          value: t.id,
          label: t.title,
          subtitle: t.type === 'scratchpad' ? 'Scratchpad' : `Terminal (${t.panes.length} pane${t.panes.length > 1 ? 's' : ''})`
        });
      });

      attachablePinnedTabs.forEach(p => {
        res.push({
          type: 'pinned_tab',
          id: p.id,
          value: p.id,
          host: p.host,
          label: p.title || p.host,
          subtitle: `Attach to pinned session`
        });
      });
    } else if (viewMode === 'buttons') {
      activeGroupButtons.forEach(b => {
        res.push({
          type: 'button',
          id: b.id,
          value: b.id,
          label: b.name,
          subtitle: `Group: ${b.group || 'Default'} | Type: ${b.type}${b.type !== "send_string" && b.type !== "run_script" ? ' | Payload: ' + b.payload : ''}`,
          btn: b
        });
      });
      otherGroupButtons.forEach(b => {
        res.push({
          type: 'other_button',
          id: b.id,
          value: b.id,
          label: b.name,
          subtitle: `Group: ${b.group || 'Default'}`,
          btn: b
        });
      });
    }

    return res;
  }, [filteredRecents, filteredHosts, directConnect, hosts, filter, viewMode, activeTabsList, attachablePinnedTabs, activeGroupButtons, otherGroupButtons]);

  useEffect(() => {
    if (open) {
      setFilter('');
      setSelectedIndex(0);
      setViewMode('servers');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [selectedIndex]);

  const cycleViewMode = (direction: 'next' | 'prev') => {
    const modes: ('servers' | 'tabs' | 'buttons')[] = ['servers', 'tabs', 'buttons'];
    setViewMode(prev => {
      const idx = modes.indexOf(prev);
      if (direction === 'next') {
        return modes[(idx + 1) % modes.length];
      } else {
        return modes[(idx - 1 + modes.length) % modes.length];
      }
    });
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'ArrowLeft') {
      if (filter === '') {
        e.preventDefault();
        cycleViewMode('prev');
      }
    } else if (e.key === 'ArrowRight') {
      if (filter === '') {
        e.preventDefault();
        cycleViewMode('next');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        handleSelect(items[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleSelect = (item: any) => {
    if (item.type === 'tab') {
      onSelectTab?.(item.id);
      onClose();
    } else if (item.type === 'pinned_tab') {
      onAttachPinned?.(item.id, item.host, item.label);
      onClose();
    } else if (item.type === 'button' || item.type === 'other_button') {
      onExecuteButton?.(item.btn);
      onClose();
    } else {
      onSelect(item.value);
      onClose();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isTouch || !isMobile) return;
    const touch = e.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isTouch || !isMobile || !swipeStartRef.current) return;
    const touch = e.changedTouches[0];
    const diffX = touch.clientX - swipeStartRef.current.x;
    const diffY = touch.clientY - swipeStartRef.current.y;
    const diffTime = Date.now() - swipeStartRef.current.time;

    swipeStartRef.current = null;

    if (Math.abs(diffX) > 100 && Math.abs(diffX) > Math.abs(diffY) * 2 && diffTime < 500) {
      if (diffX > 0) {
        cycleViewMode('prev');
      } else {
        cycleViewMode('next');
      }
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      sx={{
        '& .MuiDialog-container': {
          alignItems: 'flex-start',
        }
      }}
      slotProps={{
        paper: {
          sx: {
            mt: '10vh',
            minHeight: '200px',
            maxHeight: '70vh',
            borderRadius: 2
          }
        }
      }}
    >
      <DialogTitle sx={{ p: 1.5, pb: 1 }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder={viewMode === 'servers' ? "Search for a server or type an address..." : viewMode === 'tabs' ? "Search opened tabs..." : "Search buttons..."}
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setSelectedIndex(0); }}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          size="small"
          autoComplete="off"
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => {
                      cycleViewMode('next');
                      inputRef.current?.focus();
                    }}
                    color={viewMode !== 'servers' ? 'primary' : 'default'}
                    title={`Toggle View (Currently: ${viewMode})`}
                  >
                    {viewMode === 'servers' ? <DnsIcon /> : viewMode === 'tabs' ? <TabIcon /> : <SmartButtonIcon />}
                  </IconButton>
                </InputAdornment>
              )
            }
          }}
        />
      </DialogTitle>
      <DialogContent sx={{ p: 0 }} dividers onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <List sx={{ pt: 0, pb: 0 }}>
          {items.map((item, index) => (
            <React.Fragment key={`${item.type}-${item.value}-${index}`}>
              {index === 0 && item.type === 'recent' && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">Recent</Typography>
                </ListItem>
              )}
              {((index === 0 && (item.type === 'host' || item.type === 'local')) || (index > 0 && (item.type === 'host' || item.type === 'local') && items[index - 1].type === 'recent')) && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">{filter === '' ? 'Favorites' : 'All Servers'}</Typography>
                </ListItem>
              )}
              {item.type === 'direct' && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">Direct Connection</Typography>
                </ListItem>
              )}
              {index === 0 && item.type === 'tab' && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">Current Browser Tabs</Typography>
                </ListItem>
              )}
              {((index === 0 && item.type === 'pinned_tab') || (index > 0 && item.type === 'pinned_tab' && items[index - 1].type === 'tab')) && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">Attachable Pinned Tabs</Typography>
                </ListItem>
              )}
              {index === 0 && item.type === 'button' && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">Active Group ({activeGroup || 'Default'})</Typography>
                </ListItem>
              )}
              {((index === 0 && item.type === 'other_button') || (index > 0 && item.type === 'other_button' && items[index - 1].type === 'button')) && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">Other Groups</Typography>
                </ListItem>
              )}

              <ListItemButton
                selected={selectedIndex === index}
                ref={selectedIndex === index ? selectedItemRef : null}
                onClick={() => handleSelect(item)}
                sx={{
                  py: 0.5,
                  '&.Mui-selected': {
                    bgcolor: 'primary.main',
                    color: 'white',
                    '& .MuiListItemIcon-root, & .MuiListItemText-secondary': {
                      color: 'white'
                    },
                    '&:hover': {
                      bgcolor: 'primary.dark',
                      color: 'white',
                      '& .MuiListItemIcon-root, & .MuiListItemText-secondary': {
                        color: 'white'
                      },
                    }
                  }
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {item.type === 'recent' ? <HistoryIcon fontSize="small" /> :
                    item.type === 'direct' ? <SendIcon fontSize="small" /> :
                      item.type === 'local' ? <ComputerIcon fontSize="small" /> :
                        item.type === 'tab' ? <TabIcon fontSize="small" color="primary" sx={{ color: selectedIndex === index ? 'white' : 'primary.main' }} /> :
                          item.type === 'pinned_tab' ? <PushPinIcon fontSize="small" color="primary" sx={{ color: selectedIndex === index ? 'white' : 'primary.main' }} /> :
                            item.type === 'button' || item.type === 'other_button' ? <SmartButtonIcon fontSize="small" color="primary" sx={{ color: selectedIndex === index ? 'white' : 'primary.main' }} /> :
                              item.isFav ? <StarIcon fontSize="small" color="primary" sx={{ color: selectedIndex === index ? 'white' : 'primary.main' }} /> : <DnsIcon fontSize="small" />}
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="body2" sx={{ fontWeight: item.isFav ? 'bold' : 'normal', color: 'inherit', lineHeight: 1.2 }}>
                      {item.label}
                    </Typography>
                  }
                  secondary={
                    item.subtitle ? (
                      <Typography variant="caption" sx={{ color: 'inherit', opacity: 0.8, display: 'block', mt: -0.2 }}>
                        {item.subtitle}
                      </Typography>
                    ) : undefined
                  }
                />
              </ListItemButton>
            </React.Fragment>
          ))}
          {items.length === 0 && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">No matching {viewMode} found</Typography>
            </Box>
          )}
        </List>
      </DialogContent>
    </Dialog>
  );
}

