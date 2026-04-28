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
} from '@mui/material';
import ComputerIcon from '@mui/icons-material/Computer';
import DnsIcon from '@mui/icons-material/Dns';
import HistoryIcon from '@mui/icons-material/History';
import SendIcon from '@mui/icons-material/Send';
import StarIcon from '@mui/icons-material/Star';
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
  onSelect: (host: string) => void;
}

export default function NewTabDialog({ open, onClose, hosts, recents, onSelect }: NewTabDialogProps) {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  const filteredRecents = useMemo(() => {
    const f = filter.toLowerCase();
    return recents
      .filter(r => r.host.toLowerCase().includes(f))
      .sort((a, b) => b.last_used - a.last_used)
      .slice(0, 5);
  }, [recents, filter]);

  const filteredHosts = useMemo(() => {
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
  }, [hosts, filter]);

  const directConnect = useMemo(() => {
    if (!filter || (!filter.includes('.') && !filter.includes(':') && filter !== 'localhost')) return null;
    return filter;
  }, [filter]);

  const items = useMemo(() => {
    const res: { type: 'recent' | 'host' | 'direct' | 'local', value: string, label: string, subtitle?: string, isFav?: boolean }[] = [];
    
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

    return res;
  }, [filteredRecents, filteredHosts, directConnect, hosts, filter]);

  useEffect(() => {
    if (open) {
      setFilter('');
      setSelectedIndex(0);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        onSelect(items[selectedIndex].value);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleSelect = (val: string) => {
    onSelect(val);
    onClose();
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
          placeholder="Search for a server or type an address..."
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setSelectedIndex(0); }}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          size="small"
          autoComplete="off"
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
        />
      </DialogTitle>
      <DialogContent sx={{ p: 0 }} dividers>
        <List sx={{ pt: 0, pb: 0 }}>
          {items.map((item, index) => (
            <React.Fragment key={`${item.type}-${item.value}-${index}`}>
              {index === 0 && item.type === 'recent' && (
                <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">Recent</Typography>
                </ListItem>
              )}
              {((index === 0 && (item.type === 'host' || item.type === 'local')) || (index > 0 && (item.type === 'host' || item.type === 'local') && items[index-1].type === 'recent')) && (
                 <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">{filter === '' ? 'Favorites' : 'All Servers'}</Typography>
                 </ListItem>
              )}
              {item.type === 'direct' && (
                 <ListItem sx={{ py: 0.25, px: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="overline" sx={{ lineHeight: 1.5, fontWeight: 'bold' }} color="text.secondary">Direct Connection</Typography>
                 </ListItem>
              )}

              <ListItemButton
                selected={selectedIndex === index}
                ref={selectedIndex === index ? selectedItemRef : null}
                onClick={() => handleSelect(item.value)}
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
              <Typography variant="body2" color="text.secondary">No matching servers found</Typography>
            </Box>
          )}
        </List>
      </DialogContent>
    </Dialog>
  );
}
