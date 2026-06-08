import { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import HomeIcon from "@mui/icons-material/Home";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CloseIcon from "@mui/icons-material/Close";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import RefreshIcon from "@mui/icons-material/Refresh";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import TerminalIcon from "@mui/icons-material/Terminal";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import SearchIcon from "@mui/icons-material/Search";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Menu, MenuItem, TableSortLabel, InputBase } from "@mui/material";

import type { FileInfo, FileMkdirRequest, FileRenameRequest, FsList, FsToken } from "./api";
import {
  BROWSER_STORAGE_KEY_TOKEN,
  HEADER_AUTHORIZATION,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  HEADER_CONTENT_TYPE,
  METHOD_POST,
  MIME_JSON,
} from "./constants";
import { formatSize, type Order } from "./common";
import TextEditor from "./TextEditor";
import { dialogs } from "./Dialogs";

interface FileBrowserProps {
  sessionId: string;
  isActive: boolean;
  shellCwd?: string;
  onClose: () => void;
}

export default function FileBrowser({ sessionId, isActive, shellCwd, onClose }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [sortField, setSortField] = useState<Exclude<keyof FileInfo, "isDir">>("name");
  const [sortOrder, setSortOrder] = useState<Order>("asc");
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; file: FileInfo } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingFile, setEditingFile] = useState<FileInfo | null>(null);
  const [editingPath, setEditingPath] = useState<string>("");
  const [editorContent, setEditorContent] = useState<string>("");
  const [isWindowsHost, setIsWindowsHost] = useState<boolean>(false);

  const [isFilterOpen, setIsFilterOpen] = useState<boolean>(false);
  const [filterValue, setFilterValue] = useState<string>("");
  const [isFilterPinned, setIsFilterPinned] = useState<boolean>(false);

  const isWindowsPath = (path: string) => /^[a-zA-Z]:/.test(path) || path.includes("\\") || /^\/[a-zA-Z]:/.test(path);

  const getPathJoiner = (p: string) => {
    const isWin = isWindowsHost || isWindowsPath(p);
    const sep = isWin ? "\\" : "/";
    return (child: string) => {
      // If child is an absolute Windows path (C:\) or absolute Unix path (/etc), return as-is
      if (/^[a-zA-Z]:/.test(child)) {
        return child;
      }
      if (child.startsWith("/") && !isWin) {
        return child;
      }

      // Handle the case where child has a leading slash on Windows (from previous bugs)
      if (isWin && child.startsWith("/")) {
        const stripped = child.substring(1);
        if (/^[a-zA-Z]:/.test(stripped)) {
          return stripped;
        }
      }

      if (!p || p === "") {
        return child;
      }

      // If we are at the virtual root, don't use double slashes
      if (p === "/") {
        return "/" + child;
      }

      if (p.endsWith("/") || p.endsWith("\\")) {
        return p + child;
      }
      return p + sep + child;
    };
  };

  const fetchFiles = async (path: string = "") => {
    setLoading(true);
    try {
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      const res = await fetch(`/api/fs/list?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, {
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });
      if (res.ok) {
        const data: FsList = await res.json();
        setCurrentPath(data.path);
        setFiles(data.files || []);
        if (isWindowsPath(data.path) || (data.files && data.files.some((f) => isWindowsPath(f.name)))) {
          setIsWindowsHost(true);
        }
        // Reset filter if not pinned on directory change
        if (!isFilterPinned && data.path !== currentPath) {
          setIsFilterOpen(false);
          setFilterValue("");
        }
      } else {
        dialogs.alert("Failed to list files");
      }
    } catch (e) {
      console.error(e);
      dialogs.alert("Error fetching files");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive && !loading && currentPath === "") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, sessionId]);

  const sortedFiles = [...files].sort((a, b) => {
    // Directories always first
    if (a.isDir && !b.isDir) {
      return -1;
    }
    if (!a.isDir && b.isDir) {
      return 1;
    }

    let cmp = 0;
    if (sortField === "name") {
      cmp = a.name.localeCompare(b.name);
    } else if (sortField === "size") {
      cmp = a.size - b.size;
    } else if (sortField === "modTime") {
      cmp = a.modTime.localeCompare(b.modTime);
    }

    return sortOrder === "asc" ? cmp : -cmp;
  });

  const filteredFiles = sortedFiles.filter((f) => f.name.toLowerCase().includes(filterValue.toLowerCase()));

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const handleNavigate = (folder: string) => {
    const isWindows = isWindowsPath(currentPath);
    const sep = isWindows ? "\\" : "/";
    let nextPath = currentPath;

    if (folder === "..") {
      const parts = currentPath.split(/[/\\]/).filter(Boolean);
      if (parts.length > 0) {
        parts.pop();
        if (parts.length === 0) {
          nextPath = "/";
        } else {
          nextPath = parts.join(sep);
          if (!isWindows) {
            nextPath = "/" + nextPath;
          } else if (parts.length === 1 && parts[0].endsWith(":")) {
            nextPath += sep;
          }
        }
      } else {
        nextPath = "/";
      }
    } else {
      const join = getPathJoiner(currentPath);
      nextPath = join(folder);
    }
    fetchFiles(nextPath);
  };

  const handleGoTo = async () => {
    const val = filterValue.trim();
    if (!val) {
      return;
    }

    const join = getPathJoiner(currentPath);
    let targetPath = val;

    // If it's not an absolute path, join it with currentPath
    const isWin = isWindowsHost || isWindowsPath(currentPath);
    const isAbs = isWindowsPath(val) || val.startsWith("/") || (isWin && val.startsWith("\\")) || val.startsWith("~");

    if (!isAbs) {
      targetPath = join(val);
    }

    setLoading(true);
    try {
      const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
      const res = await fetch(
        `/api/fs/stat?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(targetPath)}`,
        {
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
        },
      );

      if (res.ok) {
        const fileInfo: FileInfo = await res.json();
        if (fileInfo.isDir) {
          fetchFiles(targetPath);
        } else {
          if (fileInfo.size <= 1048576) {
            handleEditAsText(fileInfo, targetPath);
          } else {
            dialogs.alert(`File is too large to open (${formatSize(fileInfo.size)}). Max limit is 1MB.`);
          }
        }
      } else {
        dialogs.alert("Path not found or error accessing path");
      }
    } catch (e) {
      console.error(e);
      dialogs.alert("Error accessing path");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) {
      return;
    }
    const file = e.target.files[0];

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      const res = await fetch(
        `/api/fs/upload?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(currentPath)}`,
        {
          method: METHOD_POST,
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
          body: formData,
        },
      );

      if (res.ok) {
        fetchFiles(currentPath);
      } else {
        dialogs.alert("Upload failed");
      }
    } catch (error) {
      console.error(error);
      dialogs.alert("Upload error");
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDownload = async (fileName: string) => {
    setContextMenu(null);
    const join = getPathJoiner(currentPath);
    const targetPath = join(fileName);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      const res = await fetch(
        `/api/fs/token?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(targetPath)}`,
        {
          method: METHOD_POST,
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
        },
      );
      if (res.ok) {
        const data: FsToken = await res.json();
        const dlUrl = `/api/fs/download?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(
          targetPath,
        )}&expires=${data.expires}&sig=${data.sig}`;
        const a = document.createElement("a");
        a.href = dlUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        dialogs.alert("Failed to initiate secure download.");
      }
    } catch (e) {
      console.error(e);
      dialogs.alert("Error initiating secure download.");
    }
  };

  const handleEditAsText = async (file: FileInfo, fullPath?: string) => {
    setContextMenu(null);
    const targetPath = fullPath || getPathJoiner(currentPath)(file.name);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/fs/token?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(targetPath)}`,
        {
          method: METHOD_POST,
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
        },
      );
      if (res.ok) {
        const data: FsToken = await res.json();
        const dlUrl = `/api/fs/download?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(
          targetPath,
        )}&expires=${data.expires}&sig=${data.sig}`;
        const dlRes = await fetch(dlUrl, {
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
        });
        if (dlRes.ok) {
          const text = await dlRes.text();
          setEditorContent(text);
          setEditingFile(file);
          setEditingPath(targetPath);
        } else {
          dialogs.alert("Failed to download file for editing.");
        }
      } else {
        dialogs.alert("Failed to initiate secure editing.");
      }
    } catch (e) {
      console.error(e);
      dialogs.alert("Error fetching file for editing.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTextFile = async (newContent: string) => {
    if (!editingFile || !editingPath) {
      return;
    }
    setLoading(true);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      // Get the parent directory of editingPath
      const isWin = isWindowsHost || isWindowsPath(editingPath);
      let parentDir = "";
      const lastSep = Math.max(editingPath.lastIndexOf("/"), editingPath.lastIndexOf("\\"));
      if (lastSep !== -1) {
        parentDir = editingPath.substring(0, lastSep);
        if (isWin) {
          if (parentDir.endsWith(":")) {
            parentDir += "\\";
          }
        } else if (parentDir === "") {
          parentDir = "/";
        }
      }

      const blob = new Blob([newContent], { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", blob, editingFile.name);

      const res = await fetch(
        `/api/fs/upload?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(parentDir)}`,
        {
          method: METHOD_POST,
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
          body: formData,
        },
      );

      if (res.ok) {
        setEditorContent(newContent);
        if (parentDir === currentPath) {
          fetchFiles(currentPath);
        }
      } else {
        dialogs.alert("Save failed");
      }
    } catch (error) {
      console.error(error);
      dialogs.alert("Save error");
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async (file: FileInfo) => {
    setContextMenu(null);
    const newName = await dialogs.prompt(`Rename ${file.name} to:`, file.name);
    if (!newName || newName === file.name) {
      return;
    }

    const join = getPathJoiner(currentPath);
    const oldPath = join(file.name);
    const newPath = join(newName);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);

    try {
      const res = await fetch(
        `/api/fs/rename?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(oldPath)}`,
        {
          method: METHOD_POST,
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
            [HEADER_CONTENT_TYPE]: MIME_JSON,
          },
          body: JSON.stringify({ newPath } satisfies FileRenameRequest),
        },
      );
      if (res.ok) {
        fetchFiles(currentPath);
      } else {
        dialogs.alert("Rename failed");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (file: FileInfo) => {
    setContextMenu(null);
    if (!(await dialogs.confirm(`Are you sure you want to delete ${file.name}?`))) {
      return;
    }

    const join = getPathJoiner(currentPath);
    const path = join(file.name);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);

    try {
      const res = await fetch(`/api/fs/delete?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, {
        method: METHOD_POST,
        headers: {
          [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        },
      });
      if (res.ok) {
        fetchFiles(currentPath);
      } else {
        dialogs.alert("Delete failed");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleMkdir = async () => {
    const name = await dialogs.prompt("New folder name:");
    if (!name) {
      return;
    }

    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      const res = await fetch(
        `/api/fs/mkdir?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(currentPath)}`,
        {
          method: METHOD_POST,
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
            [HEADER_CONTENT_TYPE]: MIME_JSON,
          },
          body: JSON.stringify({ name } satisfies FileMkdirRequest),
        },
      );
      if (res.ok) {
        fetchFiles(currentPath);
      } else {
        dialogs.alert("Failed to create folder");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleNewFile = async () => {
    const name = await dialogs.prompt("New file name:");
    if (!name) {
      return;
    }

    setLoading(true);
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    try {
      const blob = new Blob([""], { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", blob, name);

      const res = await fetch(
        `/api/fs/upload?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(currentPath)}`,
        {
          method: METHOD_POST,
          headers: {
            [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
          },
          body: formData,
        },
      );

      if (res.ok) {
        fetchFiles(currentPath);
      } else {
        dialogs.alert("Failed to create file");
      }
    } catch (error) {
      console.error(error);
      dialogs.alert("Error creating file");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPath = (file: FileInfo) => {
    setContextMenu(null);
    const join = getPathJoiner(currentPath);
    const fullPath = join(file.name);
    navigator.clipboard.writeText(fullPath);
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault();
    setContextMenu({
      mouseX: e.clientX - 2,
      mouseY: e.clientY - 4,
      file,
    });
  };

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        position: "relative",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          p: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "#f4f6f8",
        }}
      >
        <IconButton size="small" onClick={() => handleNavigate("..")} sx={{ mr: 1 }} title="Up one level">
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        <Typography
          variant="body2"
          sx={{
            flexGrow: 1,
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentPath || "/"}
        </Typography>
        <IconButton
          size="small"
          onClick={() => fetchFiles(currentPath)}
          disabled={loading}
          sx={{ mr: 1 }}
          title="Refresh"
        >
          <RefreshIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={handleMkdir} disabled={loading} sx={{ mr: 1 }} title="New Folder">
          <CreateNewFolderIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={handleNewFile} disabled={loading} sx={{ mr: 1 }} title="New File">
          <NoteAddIcon fontSize="small" />
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
        <IconButton size="small" onClick={() => fetchFiles("~")} disabled={loading} sx={{ mr: 1 }} title="Go To Home">
          <HomeIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          color={isFilterOpen ? "primary" : "default"}
          sx={{ mr: 1, bgcolor: isFilterOpen ? "action.selected" : "transparent" }}
          title="Filter files"
        >
          <SearchIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" title="Upload files" onClick={handleUploadClick} disabled={loading} sx={{ mr: 1 }}>
          <CloudUploadIcon fontSize="small" />
        </IconButton>
        <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} />
        <IconButton size="small" onClick={onClose} title="Close File Browser">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {isFilterOpen && (
        <Box
          sx={{
            px: 1,
            py: 0.5,
            borderBottom: "1px solid",
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            bgcolor: "background.paper",
          }}
        >
          <SearchIcon fontSize="small" sx={{ color: "action.active", mr: 1 }} />
          <InputBase
            placeholder="Filter files..."
            fullWidth
            size="small"
            autoFocus
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleGoTo();
              }
            }}
            sx={{ fontSize: "0.875rem" }}
          />
          {filterValue && (
            <IconButton size="small" onClick={() => setFilterValue("")} sx={{ p: "2px", mr: 0.5 }}>
              <CloseIcon fontSize="inherit" />
            </IconButton>
          )}
          <IconButton
            size="small"
            onClick={handleGoTo}
            disabled={loading || !filterValue.trim()}
            title="Go to path"
            sx={{ mr: 0.5 }}
          >
            <ArrowForwardIcon fontSize="small" />
          </IconButton>
          <Box sx={{ width: "1px", height: "20px", bgcolor: "divider", mx: 1 }} />
          <IconButton
            size="small"
            onClick={() => setIsFilterPinned(!isFilterPinned)}
            color={isFilterPinned ? "primary" : "default"}
            title={isFilterPinned ? "Unpin filter" : "Pin filter"}
          >
            {isFilterPinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
          </IconButton>
        </Box>
      )}

      <TableContainer component={Paper} sx={{ flexGrow: 1, overflow: "auto", borderRadius: 0, boxShadow: "none" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell width={30}></TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === "name"}
                    direction={sortField === "name" ? sortOrder : "asc"}
                    onClick={() => handleSort("name")}
                  >
                    Name
                  </TableSortLabel>
                </TableCell>
                <TableCell width={100}>
                  <TableSortLabel
                    active={sortField === "size"}
                    direction={sortField === "size" ? sortOrder : "asc"}
                    onClick={() => handleSort("size")}
                  >
                    Size
                  </TableSortLabel>
                </TableCell>
                <TableCell width={160}>
                  <TableSortLabel
                    active={sortField === "modTime"}
                    direction={sortField === "modTime" ? sortOrder : "asc"}
                    onClick={() => handleSort("modTime")}
                  >
                    Modified
                  </TableSortLabel>
                </TableCell>
                <TableCell width={60}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredFiles.map((file, idx) => (
                <TableRow
                  key={idx}
                  hover
                  onDoubleClick={() => file.isDir && handleNavigate(file.name)}
                  onContextMenu={(e) => handleContextMenu(e, file)}
                >
                  <TableCell padding="none" sx={{ pl: 1 }}>
                    {file.isDir ? (
                      <FolderIcon color="primary" fontSize="small" />
                    ) : (
                      <InsertDriveFileIcon color="action" fontSize="small" />
                    )}
                  </TableCell>
                  <TableCell
                    sx={{ cursor: file.isDir ? "pointer" : "default", fontWeight: file.isDir ? 500 : 400 }}
                    onClick={() => file.isDir && handleNavigate(file.name)}
                  >
                    {file.name}
                  </TableCell>
                  <TableCell sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
                    {file.isDir ? "--" : formatSize(file.size)}
                  </TableCell>
                  <TableCell sx={{ color: "text.secondary", fontSize: "0.8rem" }}>{file.modTime}</TableCell>
                  <TableCell padding="none" sx={{ pr: 1, textAlign: "right" }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                      {!file.isDir && (
                        <IconButton size="small" title="Download securely" onClick={() => handleDownload(file.name)}>
                          <CloudDownloadIcon fontSize="small" color="primary" />
                        </IconButton>
                      )}
                      <IconButton size="small" onClick={(e) => handleContextMenu(e, file)}>
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
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        {!(contextMenu?.file.isDir && /^[a-zA-Z]:\\?$/.test(contextMenu.file.name)) && (
          <>
            <MenuItem onClick={() => contextMenu && handleRename(contextMenu.file)}>Rename</MenuItem>
            <MenuItem onClick={() => contextMenu && handleDelete(contextMenu.file)} sx={{ color: "error.main" }}>
              Delete
            </MenuItem>
          </>
        )}
        <MenuItem onClick={() => contextMenu && handleCopyPath(contextMenu.file)}>Copy Path</MenuItem>
        {!contextMenu?.file.isDir && (
          <MenuItem onClick={() => contextMenu && handleDownload(contextMenu.file.name)}>Download</MenuItem>
        )}
        {!contextMenu?.file.isDir && contextMenu?.file.size !== undefined && contextMenu.file.size <= 1048576 && (
          <MenuItem onClick={() => contextMenu && handleEditAsText(contextMenu.file)}>Edit as text</MenuItem>
        )}
      </Menu>

      {editingFile && (
        <TextEditor
          fileName={editingPath}
          initialContent={editorContent}
          onSave={handleSaveTextFile}
          onClose={() => setEditingFile(null)}
          isSaving={loading}
        />
      )}
    </Box>
  );
}
