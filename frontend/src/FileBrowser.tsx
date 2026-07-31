import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  Badge,
  Button,
  LinearProgress,
  Tooltip,
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
import FileUploadIcon from "@mui/icons-material/FileUpload";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import { Menu, MenuItem, TableSortLabel, InputBase } from "@mui/material";

import type { FileInfo, FileMkdirRequest, FileRenameRequest, FsList, FsToken } from "./api";
import { type Order, apiReqHeaders, formatSize, getKeyCombination, t, triggerDownload } from "./common";
import { METHOD_POST } from "./constants";
import TextEditor from "./TextEditor";
import { dialogs } from "./Dialogs";

export interface UploadQueueItem {
  id: string;
  name: string;
  relPath: string;
  size: number;
  isDir: boolean;
  targetDir: string;
  file?: File;
  status: "pending" | "uploading" | "completed" | "error" | "canceled";
  progress: number;
  error?: string;
  xhr?: XMLHttpRequest;
}

interface ScannedEntryItem {
  file?: File;
  relPath: string;
  isDir: boolean;
}

async function scanEntry(entry: FileSystemEntry, pathPrefix: string = ""): Promise<ScannedEntryItem[]> {
  const result: ScannedEntryItem[] = [];
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    try {
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
      result.push({ file, relPath: pathPrefix + file.name, isDir: false });
    } catch {
      // Ignore unreadable file
    }
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const dirReader = dirEntry.createReader();
    const readAllEntries = async (): Promise<FileSystemEntry[]> => {
      let entries: FileSystemEntry[] = [];
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => dirReader.readEntries(resolve, reject));
        entries = entries.concat(batch);
      } while (batch.length > 0);
      return entries;
    };
    try {
      const entries = await readAllEntries();
      if (entries.length === 0) {
        result.push({ relPath: pathPrefix + dirEntry.name, isDir: true });
      } else {
        for (const child of entries) {
          const subResults = await scanEntry(child, pathPrefix + dirEntry.name + "/");
          result.push(...subResults);
        }
      }
    } catch {
      result.push({ relPath: pathPrefix + dirEntry.name, isDir: true });
    }
  }
  return result;
}

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
  const [contextMenuOpen, setContextMenuOpen] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [editingFile, setEditingFile] = useState<FileInfo | null>(null);
  const [editingPath, setEditingPath] = useState<string>("");
  const [editorContent, setEditorContent] = useState<string>("");
  const [isWindowsHost, setIsWindowsHost] = useState<boolean>(false);

  const [isFilterOpen, setIsFilterOpen] = useState<boolean>(false);
  const [filterValue, setFilterValue] = useState<string>("");
  const [isFilterPinned, setIsFilterPinned] = useState<boolean>(false);

  // Upload Queue State & UI
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [isUploadPanelOpen, setIsUploadPanelOpen] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const dragCounterRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);

  const isWindowsPath = (path: string) => /^[a-zA-Z]:/.test(path) || path.includes("\\") || /^\/[a-zA-Z]:/.test(path);

  const getPathJoiner = useCallback(
    (p: string) => {
      const isWin = isWindowsHost || isWindowsPath(p);
      const sep = isWin ? "\\" : "/";
      return (child: string) => {
        if (/^[a-zA-Z]:/.test(child)) return child;
        if (child.startsWith("/") && !isWin) return child;
        if (isWin && child.startsWith("/")) {
          const stripped = child.substring(1);
          if (/^[a-zA-Z]:/.test(stripped)) return stripped;
        }
        if (!p || p === "") return child;
        if (p === "/") return "/" + child;
        if (p.endsWith("/") || p.endsWith("\\")) return p + child;
        return p + sep + child;
      };
    },
    [isWindowsHost],
  );

  const fetchFiles = useCallback(
    async (path: string = "") => {
      setLoading(true);
      try {
        const res = await fetch(`/api/fs/list?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, {
          headers: apiReqHeaders(),
        });
        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
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
      } catch (err) {
        dialogs.alert(t("Failed to list files:") + ` ${err}`);
      } finally {
        setLoading(false);
      }
    },
    [currentPath, isFilterPinned, sessionId],
  );

  useEffect(() => {
    if (isActive && !loading && currentPath === "") {
      fetchFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, sessionId]);

  const enqueueItems = useCallback(
    (items: ScannedEntryItem[]) => {
      if (items.length === 0) return;
      const join = getPathJoiner(currentPath);
      const isWin = isWindowsHost || isWindowsPath(currentPath);
      const sep = isWin ? "\\" : "/";

      const newQueueItems: UploadQueueItem[] = items.map((item) => {
        const parts = item.relPath.split(/[/\\]/).filter(Boolean);
        let targetDir = currentPath;
        if (parts.length > 1) {
          const relDir = parts.slice(0, -1).join(sep);
          targetDir = join(relDir);
        }
        return {
          id: Math.random().toString(36).substring(2, 9) + "-" + Date.now(),
          name: item.relPath,
          relPath: item.relPath,
          size: item.file ? item.file.size : 0,
          isDir: item.isDir,
          targetDir,
          file: item.file,
          status: "pending",
          progress: 0,
        };
      });

      setUploadQueue((prev) => [...prev, ...newQueueItems]);
    },
    [currentPath, getPathJoiner, isWindowsHost],
  );

  // Queue runner
  useEffect(() => {
    const processNext = async () => {
      if (isProcessingRef.current) return;

      const pendingItem = uploadQueue.find((item) => item.status === "pending");
      if (!pendingItem) return;

      isProcessingRef.current = true;

      setUploadQueue((prev) =>
        prev.map((it) => (it.id === pendingItem.id ? { ...it, status: "uploading", progress: 0 } : it)),
      );

      if (pendingItem.isDir || !pendingItem.file) {
        try {
          const dirName = pendingItem.relPath.split(/[/\\]/).pop() || pendingItem.relPath;
          const res = await fetch(
            `/api/fs/mkdir?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(pendingItem.targetDir)}`,
            {
              method: METHOD_POST,
              headers: apiReqHeaders(),
              body: JSON.stringify({ name: dirName } satisfies FileMkdirRequest),
            },
          );
          if (!res.ok) throw new Error(`status=${res.status}`);
          setUploadQueue((prev) =>
            prev.map((it) => (it.id === pendingItem.id ? { ...it, status: "completed", progress: 100 } : it)),
          );
          if (pendingItem.targetDir === currentPath) {
            fetchFiles(currentPath);
          }
        } catch (err: unknown) {
          setUploadQueue((prev) =>
            prev.map((it) => (it.id === pendingItem.id ? { ...it, status: "error", error: String(err) } : it)),
          );
        } finally {
          isProcessingRef.current = false;
        }
      } else {
        const xhr = new XMLHttpRequest();
        setUploadQueue((prev) => prev.map((it) => (it.id === pendingItem.id ? { ...it, xhr } : it)));

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            setUploadQueue((prev) => prev.map((it) => (it.id === pendingItem.id ? { ...it, progress: percent } : it)));
          }
        };

        const promise = new Promise<void>((resolve) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadQueue((prev) =>
                prev.map((it) =>
                  it.id === pendingItem.id ? { ...it, status: "completed", progress: 100, xhr: undefined } : it,
                ),
              );
              if (pendingItem.targetDir === currentPath) {
                fetchFiles(currentPath);
              }
            } else {
              setUploadQueue((prev) =>
                prev.map((it) =>
                  it.id === pendingItem.id
                    ? { ...it, status: "error", error: xhr.responseText || `status=${xhr.status}`, xhr: undefined }
                    : it,
                ),
              );
            }
            resolve();
          };

          xhr.onerror = () => {
            setUploadQueue((prev) =>
              prev.map((it) =>
                it.id === pendingItem.id ? { ...it, status: "error", error: t("Network error"), xhr: undefined } : it,
              ),
            );
            resolve();
          };

          xhr.onabort = () => {
            setUploadQueue((prev) =>
              prev.map((it) => (it.id === pendingItem.id ? { ...it, status: "canceled", xhr: undefined } : it)),
            );
            resolve();
          };
        });

        const formData = new FormData();
        formData.append("file", pendingItem.file);

        const headers = apiReqHeaders(true) as Record<string, string>;
        const url = `/api/fs/upload?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(pendingItem.targetDir)}`;

        xhr.open(METHOD_POST, url);
        for (const key in headers) {
          xhr.setRequestHeader(key, headers[key]);
        }
        xhr.send(formData);

        await promise;
        isProcessingRef.current = false;
      }
    };

    processNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadQueue, sessionId, currentPath]);

  // Global paste listener (Ctrl+V)
  useEffect(() => {
    if (!isActive) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      const files = e.clipboardData?.files;

      let hasFiles = false;
      if (files && files.length > 0) {
        hasFiles = true;
      } else if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === "file") {
            hasFiles = true;
            break;
          }
        }
      }

      if (!hasFiles) return;

      e.preventDefault();
      e.stopPropagation();

      const scanned: ScannedEntryItem[] = [];
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === "file") {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry) {
              const res = await scanEntry(entry);
              scanned.push(...res);
            } else {
              const file = item.getAsFile();
              if (file) {
                scanned.push({ file, relPath: file.name, isDir: false });
              }
            }
          }
        }
      } else if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          scanned.push({ file, relPath: file.name, isDir: false });
        }
      }

      if (scanned.length > 0) {
        enqueueItems(scanned);
        setIsUploadPanelOpen(true);
      }
    };

    window.addEventListener("paste", handlePaste, true);
    return () => {
      window.removeEventListener("paste", handlePaste, true);
    };
  }, [isActive, enqueueItems]);

  // Drag & Drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      const items = e.dataTransfer.items;
      const files = e.dataTransfer.files;

      const scanned: ScannedEntryItem[] = [];

      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === "file") {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry) {
              const res = await scanEntry(entry);
              scanned.push(...res);
            } else {
              const file = item.getAsFile();
              if (file) {
                scanned.push({ file, relPath: file.name, isDir: false });
              }
            }
          }
        }
      } else if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          scanned.push({ file, relPath: file.name, isDir: false });
        }
      }

      if (scanned.length > 0) {
        enqueueItems(scanned);
        setIsUploadPanelOpen(true);
      }
    },
    [enqueueItems],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return;
      const filesArray = Array.from(e.target.files);
      const items: ScannedEntryItem[] = filesArray.map((file) => ({
        file,
        relPath: file.name,
        isDir: false,
      }));
      enqueueItems(items);
      setIsUploadPanelOpen(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [enqueueItems],
  );

  const handleFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return;
      const filesArray = Array.from(e.target.files);
      const items: ScannedEntryItem[] = filesArray.map((file) => ({
        file,
        relPath: file.webkitRelativePath || file.name,
        isDir: false,
      }));
      enqueueItems(items);
      setIsUploadPanelOpen(true);
      if (folderInputRef.current) folderInputRef.current.value = "";
    },
    [enqueueItems],
  );

  const handleCancelQueueItem = useCallback((id: string) => {
    setUploadQueue((prev) =>
      prev.map((it) => {
        if (it.id === id) {
          if (it.status === "uploading" && it.xhr) {
            it.xhr.abort();
          }
          return { ...it, status: "canceled", xhr: undefined };
        }
        return it;
      }),
    );
  }, []);

  const handleRemoveQueueItem = useCallback((id: string) => {
    setUploadQueue((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const handleClearFinishedQueue = useCallback(() => {
    setUploadQueue((prev) => prev.filter((it) => it.status === "pending" || it.status === "uploading"));
  }, []);

  const sortedFiles = [...files].sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;

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

  const handleSort = useCallback(
    (field: typeof sortField) => {
      if (sortField === field) {
        setSortOrder(sortOrder === "asc" ? "desc" : "asc");
      } else {
        setSortField(field);
        setSortOrder("asc");
      }
    },
    [sortField, sortOrder],
  );

  const handleNavigate = useCallback(
    (folder: string) => {
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
    },
    [currentPath, fetchFiles, getPathJoiner],
  );

  const handleEditAsText = useCallback(
    async (file: FileInfo, fullPath?: string) => {
      setContextMenuOpen(false);
      const targetPath = fullPath || getPathJoiner(currentPath)(file.name);
      setLoading(true);
      try {
        const res = await fetch(
          `/api/fs/token?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(targetPath)}`,
          {
            method: METHOD_POST,
            headers: apiReqHeaders(),
          },
        );
        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
        const data: FsToken = await res.json();
        const dlUrl = `/api/fs/download?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(
          targetPath,
        )}&expires=${data.expires}&sig=${data.sig}`;
        const dlRes = await fetch(dlUrl, { headers: apiReqHeaders() });
        if (!dlRes.ok) {
          throw new Error(t("failed to download file for editing:") + ` status=${dlRes.status}`);
        }
        const text = await dlRes.text();
        setEditorContent(text);
        setEditingFile(file);
        setEditingPath(targetPath);
      } catch (err: unknown) {
        dialogs.alert(t("Error fetching file for editing:") + ` ${err}`);
      } finally {
        setLoading(false);
      }
    },
    [currentPath, getPathJoiner, sessionId],
  );

  const handleGoTo = useCallback(async () => {
    const val = filterValue.trim();
    if (!val) return;

    const join = getPathJoiner(currentPath);
    let targetPath = val;

    const isWin = isWindowsHost || isWindowsPath(currentPath);
    const isAbs = isWindowsPath(val) || val.startsWith("/") || (isWin && val.startsWith("\\")) || val.startsWith("~");

    if (!isAbs) {
      targetPath = join(val);
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/fs/stat?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(targetPath)}`,
        {
          headers: apiReqHeaders(),
        },
      );

      if (!res.ok) {
        throw new Error(`status=${res.status}`);
      }
      const fileInfo: FileInfo = await res.json();
      if (fileInfo.isDir) {
        fetchFiles(targetPath);
      } else {
        if (fileInfo.size <= 1048576) {
          handleEditAsText(fileInfo, targetPath);
        } else {
          dialogs.alert(
            t("File is too large to open. Max limit is 1MiB. The file size is:") + " " + formatSize(fileInfo.size),
          );
        }
      }
    } catch (err: unknown) {
      dialogs.alert(t("Error accessing path:") + ` ${err}`);
    } finally {
      setLoading(false);
    }
  }, [currentPath, fetchFiles, filterValue, getPathJoiner, handleEditAsText, isWindowsHost, sessionId]);

  const handleDownload = useCallback(
    async (filename: string) => {
      setContextMenuOpen(false);
      const join = getPathJoiner(currentPath);
      const targetPath = join(filename);
      try {
        const res = await fetch(
          `/api/fs/token?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(targetPath)}`,
          {
            method: METHOD_POST,
            headers: apiReqHeaders(),
          },
        );
        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
        const data: FsToken = await res.json();
        const dlUrl = `/api/fs/download?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(
          targetPath,
        )}&expires=${data.expires}&sig=${data.sig}`;
        triggerDownload(dlUrl, filename);
      } catch (err: unknown) {
        dialogs.alert(t("Error downloading file:") + ` ${err} (${filename})`);
      }
    },
    [currentPath, getPathJoiner, sessionId],
  );

  const handleDownloadArchive = useCallback(
    async (folderName: string) => {
      setContextMenuOpen(false);
      const join = getPathJoiner(currentPath);
      const targetPath = join(folderName);
      try {
        const res = await fetch(
          `/api/fs/token?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(targetPath)}`,
          {
            method: METHOD_POST,
            headers: apiReqHeaders(),
          },
        );
        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
        const data: FsToken = await res.json();
        const dlUrl = `/api/fs/download?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(
          targetPath,
        )}&expires=${data.expires}&sig=${data.sig}&archive=1`;
        triggerDownload(dlUrl, `${folderName}.tar.gz`);
      } catch (err: unknown) {
        dialogs.alert(t("Error downloading folder archive:") + ` ${err} (${folderName})`);
      }
    },
    [currentPath, getPathJoiner, sessionId],
  );

  const handleSaveTextFile = useCallback(
    async (newContent: string) => {
      if (!editingFile || !editingPath) return;
      setLoading(true);
      try {
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
            headers: apiReqHeaders(true),
            body: formData,
          },
        );

        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
        setEditorContent(newContent);
        if (parentDir === currentPath) {
          fetchFiles(currentPath);
        }
      } catch (err: unknown) {
        dialogs.alert(t("Save error:") + ` ${err}`);
      } finally {
        setLoading(false);
      }
    },
    [currentPath, editingFile, editingPath, fetchFiles, isWindowsHost, sessionId],
  );

  const handleRename = useCallback(
    async (file: FileInfo) => {
      setContextMenuOpen(false);
      const newName = await dialogs.prompt(
        t("Rename file") + ". " + t("Current name:") + " " + file.name + ". " + t("Enter new name:") + " ",
        file.name,
      );
      if (!newName || newName === file.name) return;

      const join = getPathJoiner(currentPath);
      const oldPath = join(file.name);
      const newPath = join(newName);
      try {
        const res = await fetch(
          `/api/fs/rename?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(oldPath)}`,
          {
            method: METHOD_POST,
            headers: apiReqHeaders(),
            body: JSON.stringify({ newPath } satisfies FileRenameRequest),
          },
        );
        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
        fetchFiles(currentPath);
      } catch (err: unknown) {
        dialogs.alert(t("Rename failed:") + ` ${err}`);
      }
    },
    [currentPath, fetchFiles, getPathJoiner, sessionId],
  );

  const handleDelete = useCallback(
    async (file: FileInfo) => {
      setContextMenuOpen(false);
      if (
        !(await dialogs.confirm(
          (file.isDir
            ? t("Are you sure you want to delete this folder:")
            : t("Are you sure you want to delete this file:")) +
            " " +
            file.name,
        ))
      ) {
        return;
      }
      const join = getPathJoiner(currentPath);
      const path = join(file.name);
      try {
        const res = await fetch(`/api/fs/delete?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, {
          method: METHOD_POST,
          headers: apiReqHeaders(),
        });
        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }
        fetchFiles(currentPath);
      } catch (err: unknown) {
        dialogs.alert(t("Delete failed:") + ` ${err}`);
      }
    },
    [currentPath, fetchFiles, getPathJoiner, sessionId],
  );

  const handleMkdir = useCallback(async () => {
    const name = await dialogs.prompt(t("Enter new folder name:"));
    if (!name) return;

    try {
      const res = await fetch(
        `/api/fs/mkdir?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(currentPath)}`,
        {
          method: METHOD_POST,
          headers: apiReqHeaders(),
          body: JSON.stringify({ name } satisfies FileMkdirRequest),
        },
      );
      if (!res.ok) {
        throw new Error(`status=${res.status}`);
      }
      fetchFiles(currentPath);
    } catch (err: unknown) {
      dialogs.alert(t("Failed to create folder:") + ` ${err}`);
    }
  }, [currentPath, fetchFiles, sessionId]);

  const handleNewFile = useCallback(async () => {
    const name = await dialogs.prompt(t("Enter new file name:"));
    if (!name) return;
    setLoading(true);
    try {
      const blob = new Blob([""], { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", blob, name);

      const res = await fetch(
        `/api/fs/upload?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(currentPath)}`,
        {
          method: METHOD_POST,
          headers: apiReqHeaders(true),
          body: formData,
        },
      );
      if (!res.ok) {
        throw new Error(`status=${res.status}`);
      }
      fetchFiles(currentPath);
    } catch (err: unknown) {
      dialogs.alert(t("Error creating file:") + ` ${err}`);
    } finally {
      setLoading(false);
    }
  }, [currentPath, fetchFiles, sessionId]);

  const handleCopyName = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    setContextMenuOpen(false);
    navigator.clipboard.writeText(contextMenu.file.name);
  }, [contextMenu]);

  const handleCopyPath = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    setContextMenuOpen(false);
    const join = getPathJoiner(currentPath);
    const fullPath = join(contextMenu.file.name);
    navigator.clipboard.writeText(fullPath);
  }, [contextMenu, currentPath, getPathJoiner]);

  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault();
    setContextMenu({
      mouseX: e.clientX - 2,
      mouseY: e.clientY - 4,
      file,
    });
    setContextMenuOpen(true);
  }, []);

  const [activeOrPendingCount, finishedCount] = useMemo(
    () =>
      uploadQueue.reduce(
        (acc, item) => {
          if (item.status === "pending" || item.status === "uploading") {
            acc[0]++;
          }
          if (item.status === "completed" || item.status === "error" || item.status === "canceled") {
            acc[1]++;
          }
          return acc;
        },
        [0, 0] as [number, number],
      ),
    [uploadQueue],
  );

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
      {/* Hidden File Inputs */}
      <input type="file" ref={fileInputRef} style={{ display: "none" }} multiple onChange={handleFileChange} />
      <input
        type="file"
        ref={folderInputRef}
        style={{ display: "none" }}
        {...({
          webkitdirectory: "",
          directory: "",
          multiple: true,
        } as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={handleFolderChange}
      />

      {/* Top Toolbar */}
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
        <IconButton size="small" onClick={() => handleNavigate("..")} sx={{ mr: 1 }} title={t("Up one level")}>
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
          title={t("Refresh")}
        >
          <RefreshIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={handleMkdir} disabled={loading} sx={{ mr: 1 }} title={t("New Folder")}>
          <CreateNewFolderIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={handleNewFile} disabled={loading} sx={{ mr: 1 }} title={t("New File")}>
          <NoteAddIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => shellCwd && fetchFiles(shellCwd)}
          disabled={loading || !shellCwd}
          sx={{ mr: 1 }}
          title={shellCwd ? t("Go to Shell CWD:") + " " + shellCwd : t("Shell CWD not detected")}
        >
          <TerminalIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => fetchFiles("~")}
          disabled={loading}
          sx={{ mr: 1 }}
          title={t("Go To Home")}
        >
          <HomeIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          color={isFilterOpen ? "primary" : "default"}
          sx={{ mr: 1, bgcolor: isFilterOpen ? "action.selected" : "transparent" }}
          title={t("Filter files")}
        >
          <SearchIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          title={t("Upload manager")}
          onClick={() => setIsUploadPanelOpen((prev) => !prev)}
          color={isUploadPanelOpen ? "primary" : "default"}
          sx={{ mr: 1 }}
        >
          <Badge
            badgeContent={activeOrPendingCount > 0 ? activeOrPendingCount : undefined}
            color="primary"
            variant={activeOrPendingCount > 0 ? "standard" : finishedCount > 0 ? "dot" : "standard"}
          >
            <CloudUploadIcon fontSize="small" color={activeOrPendingCount > 0 ? "primary" : "inherit"} />
          </Badge>
        </IconButton>
        <IconButton size="small" onClick={onClose} title={t("Close File Browser")}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Filter Bar */}
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
            placeholder={t("Filter files...")}
            fullWidth
            size="small"
            autoFocus
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            onKeyDown={(e) => {
              const kb = getKeyCombination(e);
              if (kb === "enter") {
                e.preventDefault();
                e.stopPropagation();
                handleGoTo();
              }
            }}
            sx={{ fontSize: "typography.caption.fontSize" }}
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
            title={t("Go to path")}
            sx={{ mr: 0.5 }}
          >
            <ArrowForwardIcon fontSize="small" />
          </IconButton>
          <Box sx={{ width: "1px", height: "20px", bgcolor: "divider", mx: 1 }} />
          <IconButton
            size="small"
            onClick={() => setIsFilterPinned(!isFilterPinned)}
            color={isFilterPinned ? "primary" : "default"}
            title={isFilterPinned ? t("Unpin filter") : t("Pin filter")}
          >
            {isFilterPinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
          </IconButton>
        </Box>
      )}

      {/* Main Content View with Drag & Drop */}
      <Box
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        sx={{
          flexGrow: 1,
          display: "flex",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Drag Overlay Visual Feedback */}
        {isDraggingOver && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 100,
              bgcolor: "rgba(25, 118, 210, 0.12)",
              backdropFilter: "blur(2px)",
              border: "2px dashed #1976d2",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <CloudUploadIcon sx={{ fontSize: 64, color: "primary.main", mb: 1 }} />
            <Typography variant="h6" color="primary" sx={{ fontWeight: 600 }}>
              {t("Drop files or folders here to upload")}
            </Typography>
          </Box>
        )}

        {/* File Browser Table */}
        <TableContainer
          component={Paper}
          sx={{
            flex: 1,
            overflow: "auto",
            borderRadius: 0,
            boxShadow: "none",
            height: "100%",
          }}
        >
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
                      {t("Name")}
                    </TableSortLabel>
                  </TableCell>
                  <TableCell width={100}>
                    <TableSortLabel
                      active={sortField === "size"}
                      direction={sortField === "size" ? sortOrder : "asc"}
                      onClick={() => handleSort("size")}
                    >
                      {t("Size")}
                    </TableSortLabel>
                  </TableCell>
                  <TableCell width={160}>
                    <TableSortLabel
                      active={sortField === "modTime"}
                      direction={sortField === "modTime" ? sortOrder : "asc"}
                      onClick={() => handleSort("modTime")}
                    >
                      {t("Modified")}
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
                    <TableCell sx={{ color: "text.secondary", fontSize: "typography.caption.fontSize" }}>
                      {file.isDir ? "--" : formatSize(file.size)}
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary", fontSize: "typography.caption.fontSize" }}>
                      {file.modTime}
                    </TableCell>
                    <TableCell padding="none" sx={{ pr: 1, textAlign: "right" }}>
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                        {!file.isDir && (
                          <IconButton size="small" title={t("Download")} onClick={() => handleDownload(file.name)}>
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

        {/* Upload Manager Dropdown Panel (Right Half) */}
        {isUploadPanelOpen && (
          <Box
            sx={{
              width: "50%",
              minWidth: 280,
              height: "100%",
              borderLeft: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              display: "flex",
              flexDirection: "column",
              zIndex: 10,
            }}
          >
            {/* Toolbar */}
            <Box
              sx={{
                p: 1,
                borderBottom: "1px solid",
                borderColor: "divider",
                bgcolor: "#f4f6f8",
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                flexWrap: "wrap",
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mr: "auto" }}>
                {t("Upload Queue")} ({uploadQueue.length})
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FileUploadIcon fontSize="small" />}
                onClick={() => fileInputRef.current?.click()}
                sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.3 }}
              >
                {t("Upload files")}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CreateNewFolderIcon fontSize="small" />}
                onClick={() => folderInputRef.current?.click()}
                sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.3 }}
              >
                {t("Upload folder")}
              </Button>
              <Button
                size="small"
                variant="text"
                color="inherit"
                startIcon={<DeleteSweepIcon fontSize="small" />}
                onClick={handleClearFinishedQueue}
                disabled={finishedCount === 0}
                sx={{ textTransform: "none", fontSize: "0.75rem", py: 0.3 }}
              >
                {t("Clear")}
              </Button>
              <IconButton size="small" onClick={() => setIsUploadPanelOpen(false)} title={t("Close panel")}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>

            {/* List of Queued Items */}
            <Box sx={{ flexGrow: 1, overflowY: "auto", p: 1 }}>
              {uploadQueue.length === 0 ? (
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "text.secondary",
                    gap: 1,
                  }}
                >
                  <CloudUploadIcon sx={{ fontSize: 48, opacity: 0.4 }} />
                  <Typography variant="body2">{t("No upload items in queue")}</Typography>
                  <Typography variant="caption" sx={{ textAlign: "center", px: 2 }}>
                    {t("Drag files/folders or press Ctrl+V to upload")}
                  </Typography>
                </Box>
              ) : (
                uploadQueue.map((item) => (
                  <Paper
                    key={item.id}
                    variant="outlined"
                    sx={{
                      p: 1,
                      mb: 1,
                      display: "flex",
                      flexDirection: "column",
                      gap: 0.5,
                      bgcolor: item.status === "uploading" ? "action.hover" : "background.paper",
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      {item.isDir ? (
                        <FolderIcon color="primary" fontSize="small" />
                      ) : (
                        <InsertDriveFileIcon color="action" fontSize="small" />
                      )}
                      <Box sx={{ flexGrow: 1, overflow: "hidden" }}>
                        <Typography
                          variant="body2"
                          noWrap
                          title={item.name}
                          sx={{ fontWeight: 500, fontSize: "0.825rem" }}
                        >
                          {item.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                          {item.isDir ? t("Folder") : formatSize(item.size)} • {t("To:")} {item.targetDir}
                        </Typography>
                      </Box>

                      {/* Status / Action */}
                      {item.status === "completed" && (
                        <Tooltip title={t("Completed")}>
                          <CheckCircleIcon color="success" fontSize="small" />
                        </Tooltip>
                      )}
                      {item.status === "error" && (
                        <Tooltip title={item.error || t("Upload error")}>
                          <ErrorIcon color="error" fontSize="small" />
                        </Tooltip>
                      )}
                      {item.status === "canceled" && (
                        <Typography variant="caption" color="text.secondary">
                          {t("Canceled")}
                        </Typography>
                      )}

                      {item.status === "pending" || item.status === "uploading" ? (
                        <IconButton
                          size="small"
                          onClick={() => handleCancelQueueItem(item.id)}
                          title={t("Cancel upload")}
                        >
                          <CancelIcon fontSize="small" />
                        </IconButton>
                      ) : (
                        <IconButton
                          size="small"
                          onClick={() => handleRemoveQueueItem(item.id)}
                          title={t("Remove from queue")}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>

                    {item.status === "uploading" && (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                        <LinearProgress
                          variant="determinate"
                          value={item.progress}
                          sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 32, textAlign: "right" }}>
                          {item.progress}%
                        </Typography>
                      </Box>
                    )}
                    {item.status === "pending" && (
                      <Typography variant="caption" color="text.secondary">
                        {t("Waiting in queue...")}
                      </Typography>
                    )}
                    {item.status === "error" && item.error && (
                      <Typography variant="caption" color="error" noWrap title={item.error}>
                        {item.error}
                      </Typography>
                    )}
                  </Paper>
                ))
              )}
            </Box>
          </Box>
        )}
      </Box>

      {/* Context Menu */}
      <Menu
        id="file-browser-item-menu"
        open={contextMenuOpen}
        onClose={() => setContextMenuOpen(false)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        {!(contextMenu?.file.isDir && /^[a-zA-Z]:\\?$/.test(contextMenu.file.name)) && (
          <>
            <MenuItem id="file-browser-item-menu-rename" onClick={() => contextMenu && handleRename(contextMenu.file)}>
              {t("Rename")} {contextMenu ? `${contextMenu.file.name}${contextMenu.file.isDir ? "/" : ""}` : ""}
            </MenuItem>
            <MenuItem
              id="file-browser-item-menu-delete"
              onClick={() => contextMenu && handleDelete(contextMenu.file)}
              sx={{ color: "error.main" }}
            >
              {t("Delete")}
            </MenuItem>
          </>
        )}
        <MenuItem id="file-browser-item-menu-copy-path" onClick={handleCopyPath}>
          {t("Copy Path")}
        </MenuItem>
        <MenuItem id="file-browser-item-menu-copy-name" onClick={handleCopyName}>
          {t("Copy Name")}
        </MenuItem>
        {contextMenu?.file.isDir && !(contextMenu.file.isDir && /^[a-zA-Z]:\\?$/.test(contextMenu.file.name)) && (
          <MenuItem
            id="file-browser-item-menu-download-archive"
            onClick={() => contextMenu && handleDownloadArchive(contextMenu.file.name)}
          >
            {t("Download as Archive")}
          </MenuItem>
        )}
        {!contextMenu?.file.isDir && (
          <MenuItem
            id="file-browser-item-menu-download"
            onClick={() => contextMenu && handleDownload(contextMenu.file.name)}
          >
            {t("Download")}
          </MenuItem>
        )}
        {!contextMenu?.file.isDir && contextMenu?.file.size !== undefined && contextMenu.file.size <= 1048576 && (
          <MenuItem
            id="file-browser-item-menu-edit-as-text"
            onClick={() => contextMenu && handleEditAsText(contextMenu.file)}
          >
            {t("Edit as text")}
          </MenuItem>
        )}
      </Menu>

      {/* Text Editor Dialog */}
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
