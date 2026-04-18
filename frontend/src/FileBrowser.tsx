import { useState, useEffect, useRef } from 'react';
import { Box, Typography, IconButton, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, CircularProgress } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CloseIcon from '@mui/icons-material/Close';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import RefreshIcon from '@mui/icons-material/Refresh';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { Menu, MenuItem, TableSortLabel } from '@mui/material';
import TerminalIcon from '@mui/icons-material/Terminal';

interface FileInfo {
  name: string;
  isDir: boolean;
  size: number;
  modTime: string;
}

interface FileBrowserProps {
  sessionId: string;
  isActive: boolean;
  shellCwd?: string;
  onClose: () => void;
}

export default function FileBrowser({ sessionId, isActive, shellCwd, onClose }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [sortField, setSortField] = useState<'name' | 'size' | 'modTime'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; file: FileInfo } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async (path: string = '') => {
    setLoading(true);
    try {
      const token = localStorage.getItem('cozy_token');
      const res = await fetch(`/api/fs/list?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentPath(data.path);
        setFiles(data.files || []);
      } else {
        alert('Failed to list files');
      }
    } catch (e) {
      console.error(e);
      alert('Error fetching files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive && !loading && currentPath === '') {
      fetchFiles();
    }
  }, [isActive, sessionId]);

  const sortedFiles = [...files].sort((a, b) => {
    // Directories always first
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;

    let cmp = 0;
    if (sortField === 'name') {
      cmp = a.name.localeCompare(b.name);
    } else if (sortField === 'size') {
      cmp = a.size - b.size;
    } else if (sortField === 'modTime') {
      cmp = a.modTime.localeCompare(b.modTime);
    }

    return sortOrder === 'asc' ? cmp : -cmp;
  });

  const handleSort = (field: 'name' | 'size' | 'modTime') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleNavigate = (folder: string) => {
    let nextPath = currentPath;
    
    if (folder === '..') {
      const parts = currentPath.split('/').filter(Boolean);
      if (parts.length > 0) {
        parts.pop();
        nextPath = parts.length === 0 ? '/' : '/' + parts.join('/');
      } else {
        nextPath = '/';
      }
    } else {
      if (!nextPath.endsWith('/')) nextPath += '/';
      nextPath += folder;
    }
    fetchFiles(nextPath);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    const token = localStorage.getItem('cozy_token');
    try {
      const res = await fetch(`/api/fs/upload?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(currentPath)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        fetchFiles(currentPath);
      } else {
        alert('Upload failed');
      }
    } catch (error) {
      console.error(error);
      alert('Upload error');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (fileName: string) => {
    const targetPath = currentPath + (currentPath.endsWith('/') ? '' : '/') + fileName;
    const token = localStorage.getItem('cozy_token');
    try {
      const res = await fetch(`/api/fs/token?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(targetPath)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const dlUrl = `/api/fs/download?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(targetPath)}&expires=${data.expires}&sig=${data.sig}`;
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        alert("Failed to initiate secure download.");
      }
    } catch (e) {
      console.error(e);
      alert("Error initiating secure download.");
    }
  };

  const handleRename = async (file: FileInfo) => {
    const newName = prompt(`Rename ${file.name} to:`, file.name);
    if (!newName || newName === file.name) return;

    const oldPath = currentPath + (currentPath.endsWith('/') ? '' : '/') + file.name;
    const newPath = currentPath + (currentPath.endsWith('/') ? '' : '/') + newName;
    const token = localStorage.getItem('cozy_token');

    try {
      const res = await fetch(`/api/fs/rename?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(oldPath)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPath })
      });
      if (res.ok) {
        fetchFiles(currentPath);
      } else {
        alert('Rename failed');
      }
    } catch (e) {
      console.error(e);
    }
    setContextMenu(null);
  };

  const handleDelete = async (file: FileInfo) => {
    if (!confirm(`Are you sure you want to delete ${file.name}?`)) return;

    const path = currentPath + (currentPath.endsWith('/') ? '' : '/') + file.name;
    const token = localStorage.getItem('cozy_token');

    try {
      const res = await fetch(`/api/fs/delete?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchFiles(currentPath);
      } else {
        alert('Delete failed');
      }
    } catch (e) {
      console.error(e);
    }
    setContextMenu(null);
  };

  const handleMkdir = async () => {
    const name = prompt('New folder name:');
    if (!name) return;

    const token = localStorage.getItem('cozy_token');
    try {
      const res = await fetch(`/api/fs/mkdir?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(currentPath)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        fetchFiles(currentPath);
      } else {
        alert('Failed to create folder');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyPath = (file: FileInfo) => {
    const fullPath = currentPath + (currentPath.endsWith('/') ? '' : '/') + file.name;
    navigator.clipboard.writeText(fullPath).then(() => {
      // maybe a toast?
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault();
    setContextMenu({
      mouseX: e.clientX - 2,
      mouseY: e.clientY - 4,
      file
    });
  };

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', p: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#f4f6f8' }}>
        <IconButton size="small" onClick={() => handleNavigate('..')} sx={{ mr: 1 }} title="Up one level">
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" sx={{ flexGrow: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentPath || '/'}
        </Typography>
        <IconButton size="small" onClick={() => fetchFiles(currentPath)} disabled={loading} sx={{ mr: 1 }} title="Refresh">
          <RefreshIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={handleMkdir} disabled={loading} sx={{ mr: 1 }} title="New Folder">
          <CreateNewFolderIcon fontSize="small" />
        </IconButton>
        <IconButton 
          size="small" 
          onClick={() => shellCwd && fetchFiles(shellCwd)} 
          disabled={loading || !shellCwd} 
          sx={{ mr: 1 }} 
          title={shellCwd ? `Go to Shell CWD: ${shellCwd}` : "Shell CWD not detected"}
        >
          <TerminalIcon fontSize="small" />
        </IconButton>
        <Button size="small" startIcon={<CloudUploadIcon />} onClick={handleUploadClick} disabled={loading} sx={{ mr: 1 }}>
          Upload
        </Button>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
        <IconButton size="small" onClick={onClose} title="Close File Browser">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <TableContainer component={Paper} sx={{ flexGrow: 1, overflow: 'auto', borderRadius: 0, boxShadow: 'none' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell width={30}></TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'name'}
                    direction={sortField === 'name' ? sortOrder : 'asc'}
                    onClick={() => handleSort('name')}
                  >
                    Name
                  </TableSortLabel>
                </TableCell>
                <TableCell width={100}>
                  <TableSortLabel
                    active={sortField === 'size'}
                    direction={sortField === 'size' ? sortOrder : 'asc'}
                    onClick={() => handleSort('size')}
                  >
                    Size
                  </TableSortLabel>
                </TableCell>
                <TableCell width={160}>
                  <TableSortLabel
                    active={sortField === 'modTime'}
                    direction={sortField === 'modTime' ? sortOrder : 'asc'}
                    onClick={() => handleSort('modTime')}
                  >
                    Modified
                  </TableSortLabel>
                </TableCell>
                <TableCell width={60}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedFiles.map((file, idx) => (
                <TableRow 
                  key={idx} 
                  hover 
                  onDoubleClick={() => file.isDir && handleNavigate(file.name)}
                  onContextMenu={(e) => handleContextMenu(e, file)}
                >
                  <TableCell padding="none" sx={{ pl: 1 }}>
                    {file.isDir ? <FolderIcon color="primary" fontSize="small" /> : <InsertDriveFileIcon color="action" fontSize="small" />}
                  </TableCell>
                  <TableCell sx={{ cursor: file.isDir ? 'pointer' : 'default', fontWeight: file.isDir ? 500 : 400 }} onClick={() => file.isDir && handleNavigate(file.name)}>
                    {file.name}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                    {file.isDir ? '--' : formatSize(file.size)}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                    {file.modTime}
                  </TableCell>
                  <TableCell padding="none" sx={{ pr: 1, textAlign: 'right' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                      {!file.isDir && (
                        <IconButton 
                          size="small" 
                          title="Download securely" 
                          onClick={() => handleDownload(file.name)}
                        >
                          <CloudDownloadIcon fontSize="small" color="primary" />
                        </IconButton>
                      )}
                      <IconButton 
                        size="small" 
                        onClick={(e) => handleContextMenu(e, file)}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
        }
      >
        <MenuItem onClick={() => contextMenu && handleRename(contextMenu.file)}>Rename</MenuItem>
        <MenuItem onClick={() => contextMenu && handleDelete(contextMenu.file)} sx={{ color: 'error.main' }}>Delete</MenuItem>
        <MenuItem onClick={() => contextMenu && handleCopyPath(contextMenu.file)}>Copy Path</MenuItem>
        {!contextMenu?.file.isDir && (
          <MenuItem onClick={() => contextMenu && handleDownload(contextMenu.file.name)}>Download</MenuItem>
        )}
      </Menu>
    </Box>
  );
}
