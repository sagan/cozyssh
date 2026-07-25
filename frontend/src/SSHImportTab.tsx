import React, { useState, useCallback, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Checkbox,
  Alert,
  Collapse,
  IconButton,
  Tooltip,
  Divider,
  Stack,
  FormControlLabel,
  TextField,
  InputAdornment,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import RefreshIcon from "@mui/icons-material/Refresh";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlined";
import EditIcon from "@mui/icons-material/Edit";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import SearchIcon from "@mui/icons-material/Search";
import FileUploadIcon from "@mui/icons-material/FileUpload";

import { METHOD_DELETE, METHOD_POST } from "./constants";
import { notify, refreshData } from "./store";
import type { DeviceSSHData, RemoteHostEntry, RemoteKnownHostEntry } from "./api";
import { apiReqHeaders, t, triggerDownloadString } from "./common";
import { dialogs } from "./Dialogs";

function keyFingerprint(keyData: string): string {
  try {
    const raw = atob(keyData);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    // SHA-256 would need SubtleCrypto; for display just show first/last 8 chars
    return keyData.slice(0, 8) + "…" + keyData.slice(-8);
  } catch {
    return keyData.slice(0, 16) + "…";
  }
}

// ─── Device List View ─────────────────────────────────────────────────────────

function DeviceListView({ onSelectDevice }: { onSelectDevice: (device: DeviceSSHData) => void }) {
  const [devices, setDevices] = useState<DeviceSSHData[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/settings/webdav/devices", { headers: apiReqHeaders() });
      if (r.ok) {
        const data = await r.json();
        setDevices(data.devices ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }

      const filename = file.name;
      let fileType: "" | "csv" | "config" | "known_hosts" = "";
      if (filename.toLowerCase().endsWith(".csv")) {
        fileType = "csv";
      } else if (/^config(\b|_)/.test(filename)) {
        fileType = "config";
      } else if (/^known_hosts(\b|_)/.test(filename)) {
        fileType = "known_hosts";
      }
      if (!fileType) {
        notify(t(`Acceptable files are OpenSSH format "config", "known_hosts" or a "CSV" file.`), "error");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }
      if (file.size >= 10 << 20) {
        notify(t("File is too large. Maximum size is 10MiB. The file size:") + " " + file.size, "error");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      setLoading(true);
      try {
        const res = await fetch(`/api/settings/webdav/devices/upload?type=${fileType}`, {
          method: METHOD_POST,
          headers: apiReqHeaders(true),
          body: formData,
        });
        if (!res.ok) {
          throw new Error(`status=${res.status}, msg=${await res.text()}`);
        }
        load();
        notify(t("File uploaded successfully."), "success");
      } catch (err: unknown) {
        notify(t("Upload failed:") + ` ${err}`, "error");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
        setLoading(false);
      }
    },
    [load],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!(await dialogs.confirm(t("Are you sure you want to delete those files?") + ` (${id})`))) {
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/settings/webdav/devices/upload?id=${id}`, {
          method: METHOD_DELETE,
          headers: apiReqHeaders(),
        });
        if (!res.ok) {
          throw new Error(`status=${res.status}, msg=${await res.text()}`);
        }
        load();
      } catch (err: unknown) {
        notify(t("Delete failed:") + ` ${err}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  const downloadCSVTemplate = useCallback(() => {
    const csvContent =
      "name,host,port,user,password,comment,tags,ProxyJump\n" +
      "web-server-1,192.168.1.10,22,ubuntu,ubuntu_pass,Production web server,prod;web,\n" +
      "db-server-1,10.0.0.15,22,postgres,,Database server with SSH key,db;internal,192.168.1.10\n";
    triggerDownloadString(csvContent, "cozyssh_import_template.csv");
  }, []);

  if (loading && devices.length === 0) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  const actionButtons = (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} />
      <Button
        size="small"
        variant="outlined"
        title={t("Download sample CSV template for importing hosts")}
        startIcon={<CloudDownloadIcon />}
        onClick={downloadCSVTemplate}
      >
        {t("CSV Template")}
      </Button>
      <Button
        size="small"
        variant="outlined"
        title={t("Upload files to import. Supported formats: OpenSSH config, known_hosts, and CSV (.csv)")}
        startIcon={<FileUploadIcon />}
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
      >
        {t("Upload")}
      </Button>
      <IconButton size="small" onClick={load} title={t("Refresh")}>
        <RefreshIcon fontSize="small" />
      </IconButton>
    </Stack>
  );

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: "bold" }}>
          {t("Devices")}
        </Typography>
        {actionButtons}
      </Box>

      {devices.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
          <CloudDownloadIcon sx={{ fontSize: 48, mb: 1, opacity: 0.4 }} />
          <Typography variant="body1" gutterBottom>
            {t("No SSH data from other devices yet.")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("Other devices with WebDAV sync enabled can choose to upload their SSH data.")} + " " +
            {t("Once fetched, they'll appear here.")}
          </Typography>
        </Box>
      ) : (
        <TableContainer
          component={Paper}
          sx={{ border: "1px solid", borderColor: "divider", boxShadow: "none", borderRadius: 1 }}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>{t("Device Name")}</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("SSH Config")}</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("Known Hosts")}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.deviceName} hover>
                  <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{d.deviceName}</TableCell>
                  <TableCell>
                    {d.hasSSHConfig ? (
                      <Chip
                        label={new Date(d.sshConfigMtime).toLocaleString()}
                        size="small"
                        color="success"
                        variant="outlined"
                      />
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {d.hasKnownHosts ? (
                      <Chip
                        label={new Date(d.knownHostsMtime).toLocaleString()}
                        size="small"
                        color="success"
                        variant="outlined"
                      />
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", alignItems: "center" }}>
                      {d.deviceName.startsWith("$") && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => handleDelete(d.deviceName)}
                          disabled={loading}
                        >
                          {t("Delete")}
                        </Button>
                      )}
                      <Button size="small" variant="contained" disableElevation onClick={() => onSelectDevice(d)}>
                        {t("Import")}
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

// ─── SSH Config Import View ───────────────────────────────────────────────────

function SSHConfigImportView({
  device,
  onDone,
  onBack,
}: {
  device: DeviceSSHData;
  onDone: () => void;
  onBack: () => void;
}) {
  const [entries, setEntries] = useState<RemoteHostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [showModified, setShowModified] = useState(true);
  const [showNew, setShowNew] = useState(true);
  const [showSame, setShowSame] = useState(false);
  const [filterText, setFilterText] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/settings/webdav/devices/sshconfig/${encodeURIComponent(device.deviceName)}`, {
          headers: apiReqHeaders(),
        });
        if (r.ok) {
          const data = await r.json();
          setEntries(data.hosts ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [device.deviceName]);

  const filtered = entries.filter((e) => {
    if (e.isNew && !showNew) {
      return false;
    }
    if (e.isModified && !showModified) {
      return false;
    }
    if (!e.isNew && !e.isModified && !showSame) {
      return false;
    }
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      const hostMatch = e.host.toLowerCase().includes(q);
      const hostnameMatch = (e.directives["hostname"] ?? "").toLowerCase().includes(q);
      const userMatch = (e.directives["user"] ?? "").toLowerCase().includes(q);
      return hostMatch || hostnameMatch || userMatch;
    }
    return true;
  });

  const isAllFilteredSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.host));
  const isSomeFilteredSelected = filtered.some((e) => selected.has(e.host)) && !isAllFilteredSelected;

  const handleSelectAllClick = () => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (isAllFilteredSelected) {
        filtered.forEach((e) => s.delete(e.host));
      } else {
        filtered.forEach((e) => s.add(e.host));
      }
      return s;
    });
  };

  const toggleSelect = (host: string) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(host)) {
        s.delete(host);
      } else {
        s.add(host);
      }
      return s;
    });

  const toggleExpand = (host: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(host)) {
        s.delete(host);
      } else {
        s.add(host);
      }
      return s;
    });

  const handleImport = async () => {
    if (selected.size === 0) {
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/settings/webdav/import/sshconfig", {
        method: METHOD_POST,
        headers: apiReqHeaders(),
        body: JSON.stringify({ deviceName: device.deviceName, hostNames: Array.from(selected) }),
      });
      if (res.ok) {
        notify(t("Imported hosts into ~/.ssh/config:") + " " + selected.size, "success");
        onDone();
        refreshData({ sync: 2 });
      } else {
        notify(t("Import failed:") + ` status=${res.status}, msg=${await res.text()}`, "error");
      }
    } finally {
      setImporting(false);
    }
  };

  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        <IconButton size="small" onClick={onBack} sx={{ mr: -0.5 }}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2" sx={{ fontWeight: "bold", mr: 1 }}>
          Import from: <span style={{ fontFamily: "monospace" }}>{device.deviceName}</span>
        </Typography>

        <FormControlLabel
          control={<Checkbox size="small" checked={showNew} onChange={(e) => setShowNew(e.target.checked)} />}
          label={<Typography variant="body2">New ({entries.filter((e) => e.isNew).length})</Typography>}
        />
        <FormControlLabel
          control={<Checkbox size="small" checked={showModified} onChange={(e) => setShowModified(e.target.checked)} />}
          label={<Typography variant="body2">Modified ({entries.filter((e) => e.isModified).length})</Typography>}
        />
        <FormControlLabel
          control={<Checkbox size="small" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />}
          label={
            <Typography variant="body2">Same ({entries.filter((e) => !e.isNew && !e.isModified).length})</Typography>
          }
        />
        <TextField
          size="small"
          placeholder="Filter hosts..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          sx={{
            width: 180,
            "& .MuiInputBase-root": {
              fontSize: "typography.body2.fontSize",
            },
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ opacity: 0.5 }} />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          disableElevation
          size="small"
          onClick={handleImport}
          disabled={selected.size === 0 || importing}
          sx={{ textTransform: "none" }}
        >
          {importing ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
          {t("Import Hosts")} ({selected.size})
        </Button>
      </Stack>

      {filtered.length === 0 ? (
        <Box sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
          <Typography variant="body2">{t("No hosts to display with current filters.")}</Typography>
        </Box>
      ) : (
        <TableContainer
          component={Paper}
          sx={{
            border: "1px solid",
            borderColor: "divider",
            boxShadow: "none",
            borderRadius: 1,
            maxHeight: 380,
            overflow: "auto",
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    indeterminate={isSomeFilteredSelected}
                    checked={isAllFilteredSelected}
                    onChange={handleSelectAllClick}
                  />
                </TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("Host Alias")}</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("Hostname")}</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("User / Port")}</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("Status")}</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((entry) => (
                <React.Fragment key={entry.host}>
                  <TableRow
                    hover
                    selected={selected.has(entry.host)}
                    sx={{ cursor: "pointer" }}
                    onClick={() => toggleSelect(entry.host)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selected.has(entry.host)}
                        onChange={() => toggleSelect(entry.host)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{entry.host}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>{entry.directives["hostname"] ?? "—"}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>
                      {entry.directives["user"] ?? "—"} / {entry.directives["port"] ?? "22"}
                    </TableCell>
                    <TableCell>
                      {entry.isNew && (
                        <Chip
                          icon={<AddCircleOutlineIcon />}
                          label={t("New")}
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      )}
                      {entry.isModified && (
                        <Chip
                          icon={<EditIcon />}
                          label={t("Modified")}
                          size="small"
                          color="warning"
                          variant="outlined"
                        />
                      )}
                      {!entry.isNew && !entry.isModified && (
                        <Chip icon={<CheckCircleOutlineIcon />} label={t("Same")} size="small" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell padding="checkbox">
                      {entry.isModified && (
                        <Tooltip title={expanded.has(entry.host) ? "Hide diff" : "Show diff"}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(entry.host);
                            }}
                          >
                            {expanded.has(entry.host) ? (
                              <ExpandLessIcon fontSize="small" />
                            ) : (
                              <ExpandMoreIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                  {entry.isModified && expanded.has(entry.host) && (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ p: 0 }}>
                        <Collapse in timeout="auto">
                          <Box
                            sx={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 1,
                              p: 2,
                              bgcolor: "action.hover",
                              borderTop: "1px solid",
                              borderColor: "divider",
                            }}
                          >
                            <Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ fontWeight: "bold", display: "block", mb: 0.5 }}
                              >
                                {t("REMOTE")} ({device.deviceName})
                              </Typography>
                              {Object.entries(entry.directives).map(([k, v]) => (
                                <Typography
                                  key={k}
                                  variant="caption"
                                  sx={{ display: "block", fontFamily: "monospace", color: "success.main" }}
                                >
                                  {k} = {v}
                                </Typography>
                              ))}
                            </Box>
                            <Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ fontWeight: "bold", display: "block", mb: 0.5 }}
                              >
                                {t("LOCAL")}
                              </Typography>
                              {entry.localDirectives &&
                                Object.entries(entry.localDirectives).map(([k, v]) => (
                                  <Typography
                                    key={k}
                                    variant="caption"
                                    sx={{ display: "block", fontFamily: "monospace", color: "warning.main" }}
                                  >
                                    {k} = {v}
                                  </Typography>
                                ))}
                            </Box>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

// ─── Known Hosts Import View ──────────────────────────────────────────────────

function KnownHostsImportView({
  device,
  onDone,
  onBack,
}: {
  device: DeviceSSHData;
  onDone: () => void;
  onBack: () => void;
}) {
  const [entries, setEntries] = useState<RemoteKnownHostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [conflictAcked, setConflictAcked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [showNew, setShowNew] = useState(true);
  const [showConflict, setShowConflict] = useState(false);
  const [showSame, setShowSame] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/settings/webdav/devices/knownhosts/${encodeURIComponent(device.deviceName)}`, {
          headers: apiReqHeaders(),
        });
        if (r.ok) {
          const data = await r.json();
          setEntries(data.entries ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [device.deviceName]);

  const toggleSelect = (line: string) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(line)) {
        s.delete(line);
      } else {
        s.add(line);
      }
      return s;
    });

  const filtered = entries.filter((e) => {
    if (e.isNew && !showNew) {
      return false;
    }
    if (e.isConflict && !showConflict) {
      return false;
    }
    if (!e.isNew && !e.isConflict && !showSame) {
      return false;
    }
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      const patternMatch = e.patterns.toLowerCase().includes(q);
      const typeMatch = e.keyType.toLowerCase().includes(q);
      const commentMatch = (e.comment ?? "").toLowerCase().includes(q);
      return patternMatch || typeMatch || commentMatch;
    }
    return true;
  });

  const nonConflictFiltered = filtered.filter((e) => !e.isConflict);

  const isAllFilteredSelected =
    nonConflictFiltered.length > 0 && nonConflictFiltered.every((e) => selected.has(e.line));
  const isSomeFilteredSelected = nonConflictFiltered.some((e) => selected.has(e.line)) && !isAllFilteredSelected;

  const handleSelectAllClick = () => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (isAllFilteredSelected) {
        nonConflictFiltered.forEach((e) => s.delete(e.line));
      } else {
        nonConflictFiltered.forEach((e) => s.add(e.line));
      }
      return s;
    });
  };

  const conflictedSelected = entries.filter((e) => e.isConflict && selected.has(e.line));
  const allConflictsAcked = conflictedSelected.every((e) => conflictAcked.has(e.line));

  const handleImport = async () => {
    if (selected.size === 0) {
      return;
    }
    setImporting(true);
    try {
      const lines = Array.from(selected);
      const hasConflicts = entries.some((e) => e.isConflict && selected.has(e.line));
      const res = await fetch("/api/settings/webdav/import/knownhosts", {
        method: METHOD_POST,
        headers: apiReqHeaders(),
        body: JSON.stringify({ deviceName: device.deviceName, lines, force: hasConflicts }),
      });
      if (!res.ok) {
        throw new Error(`status=${res.status}, msg=${await res.text()}`);
      }
      notify(t("Imported known_hosts entry/entries:") + ` (${lines.length}})`, "success");
      onDone();
      refreshData({ sync: 2 });
    } catch (e: unknown) {
      notify(t("Import failed:") + ` ${e}`, "error");
    } finally {
      setImporting(false);
    }
  };

  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        <IconButton size="small" onClick={onBack} sx={{ mr: -0.5 }}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2" sx={{ fontWeight: "bold", mr: 1 }}>
          {t("Import from:")} <span style={{ fontFamily: "monospace" }}>{device.deviceName}</span>
        </Typography>

        <FormControlLabel
          control={<Checkbox size="small" checked={showNew} onChange={(e) => setShowNew(e.target.checked)} />}
          label={<Typography variant="body2">New ({entries.filter((e) => e.isNew).length})</Typography>}
        />
        <FormControlLabel
          control={<Checkbox size="small" checked={showConflict} onChange={(e) => setShowConflict(e.target.checked)} />}
          label={<Typography variant="body2">Conflict ({entries.filter((e) => e.isConflict).length})</Typography>}
        />
        <FormControlLabel
          control={<Checkbox size="small" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />}
          label={
            <Typography variant="body2">Same ({entries.filter((e) => !e.isNew && !e.isConflict).length})</Typography>
          }
        />

        <TextField
          size="small"
          placeholder={t("Filter entries...")}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          sx={{
            width: 180,
            "& .MuiInputBase-root": {
              fontSize: "typography.body2.fontSize",
            },
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ opacity: 0.5 }} />
                </InputAdornment>
              ),
            },
          }}
        />

        <Box sx={{ flex: 1 }} />
        {conflictedSelected.length > 0 && (
          <Typography color="error.main" variant="body2" sx={{ mr: 1, fontWeight: "bold" }}>
            {conflictedSelected.length} conflict{conflictedSelected.length > 1 ? "s" : ""} selected
          </Typography>
        )}
        <Button
          variant="contained"
          disableElevation
          size="small"
          color={conflictedSelected.length > 0 ? "error" : "primary"}
          onClick={handleImport}
          disabled={selected.size === 0 || importing || (conflictedSelected.length > 0 && !allConflictsAcked)}
          sx={{ textTransform: "none" }}
        >
          {importing ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
          {t("Import entries")} ({selected.size})
        </Button>
      </Stack>

      {filtered.length === 0 ? (
        <Box sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
          <Typography variant="body2">{t("No known_hosts entries to display.")}</Typography>
        </Box>
      ) : (
        <TableContainer
          component={Paper}
          sx={{
            border: "1px solid",
            borderColor: "divider",
            boxShadow: "none",
            borderRadius: 1,
            maxHeight: 360,
            overflow: "auto",
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    indeterminate={isSomeFilteredSelected}
                    checked={isAllFilteredSelected}
                    onChange={handleSelectAllClick}
                  />
                </TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("Hostname Pattern(s)")}</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("Key Type")}</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("Key (partial)")}</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("Status")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((entry) => (
                <React.Fragment key={entry.line}>
                  <TableRow
                    hover
                    selected={selected.has(entry.line)}
                    sx={{
                      cursor: "pointer",
                      bgcolor: entry.isConflict ? "error.dark" : undefined,
                      "&:hover": entry.isConflict ? { bgcolor: "error.main" } : undefined,
                    }}
                    onClick={() => toggleSelect(entry.line)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selected.has(entry.line)}
                        onChange={() => toggleSelect(entry.line)}
                        onClick={(e) => e.stopPropagation()}
                        color={entry.isConflict ? "error" : "primary"}
                      />
                    </TableCell>
                    <TableCell
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "typography.caption.fontSize",
                        maxWidth: 240,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.patterns}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: "typography.caption.fontSize" }}>
                      {entry.keyType}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: "typography.caption.fontSize" }}>
                      {keyFingerprint(entry.keyData)}
                    </TableCell>
                    <TableCell>
                      {entry.isNew && (
                        <Chip
                          icon={<AddCircleOutlineIcon />}
                          label={t("New")}
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      )}
                      {entry.isConflict && (
                        <Chip icon={<WarningAmberIcon />} label={t("CONFLICT")} size="small" color="error" />
                      )}
                      {!entry.isNew && !entry.isConflict && <Chip label={t("Same")} size="small" variant="outlined" />}
                    </TableCell>
                  </TableRow>
                  {entry.isConflict && selected.has(entry.line) && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ p: 0 }}>
                        <Alert
                          severity="error"
                          variant="filled"
                          icon={<WarningAmberIcon />}
                          sx={{ borderRadius: 0, "& .MuiAlert-message": { width: "100%" } }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: "bold", mb: 0.5 }}>
                            ⛔ {t("KEY CONFLICT:")} {entry.patterns}
                          </Typography>
                          <Typography variant="caption" sx={{ display: "block", mb: 1 }}>
                            {t("A known_hosts record for this host already exists locally with a DIFFERENT key.")} + " "
                            +{t("This could indicate a man-in-the-middle attack or a server re-key.")} + " " +
                            {t("Only proceed if you know this is expected.")}
                          </Typography>
                          <Typography variant="caption" sx={{ fontFamily: "monospace", display: "block", mb: 0.5 }}>
                            {t("Local:")} {entry.localKeyType} {entry.localKeyData?.slice(0, 16)}…
                          </Typography>
                          <Typography variant="caption" sx={{ fontFamily: "monospace", display: "block", mb: 1 }}>
                            {t("Remote:")} {entry.keyType} {entry.keyData.slice(0, 16)}…
                          </Typography>
                          <FormControlLabel
                            control={
                              <Checkbox
                                size="small"
                                checked={conflictAcked.has(entry.line)}
                                onChange={(e) => {
                                  setConflictAcked((prev) => {
                                    const s = new Set(prev);
                                    if (e.target.checked) {
                                      s.add(entry.line);
                                    } else {
                                      s.delete(entry.line);
                                    }
                                    return s;
                                  });
                                }}
                                sx={{ color: "inherit" }}
                              />
                            }
                            label={
                              <Typography variant="caption" sx={{ fontWeight: "bold" }}>
                                {t("I understand and confirm this replacement")}
                              </Typography>
                            }
                          />
                        </Alert>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

// ─── Device Detail View ───────────────────────────────────────────────────────

type DetailTab = "sshconfig" | "knownhosts";

function DeviceDetailView({ device, onBack }: { device: DeviceSSHData; onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<DetailTab>(device.hasSSHConfig ? "sshconfig" : "knownhosts");
  const [importDone, setImportDone] = useState(false);

  const handleDone = () => {
    setImportDone(true);
    setTimeout(() => onBack(), 800);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        {device.hasSSHConfig && (
          <Button
            variant={activeTab === "sshconfig" ? "contained" : "outlined"}
            disableElevation
            size="small"
            onClick={() => setActiveTab("sshconfig")}
          >
            {t("SSH Config")}
          </Button>
        )}
        {device.hasKnownHosts && (
          <Button
            variant={activeTab === "knownhosts" ? "contained" : "outlined"}
            disableElevation
            size="small"
            onClick={() => setActiveTab("knownhosts")}
          >
            {t("Known Hosts")}
          </Button>
        )}
      </Box>

      <Divider sx={{ mb: 2 }} />

      {importDone ? (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48 }} />
          <Typography variant="body1" sx={{ mt: 1 }}>
            Import successful!
          </Typography>
        </Box>
      ) : activeTab === "sshconfig" ? (
        <SSHConfigImportView device={device} onDone={handleDone} onBack={onBack} />
      ) : (
        <KnownHostsImportView device={device} onDone={handleDone} onBack={onBack} />
      )}
    </Box>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function SSHImportTab() {
  const [selectedDevice, setSelectedDevice] = useState<DeviceSSHData | null>(null);

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: -1 }}>
        <b>{t("SSH Data Import")}</b>:{" "}
        {t("Import SSH data from other devices of same WebDAV server, or upload a file directly.")} (
        {t(`Supported file formats: OpenSSH "config", "known_hosts"; csv file`)}).
      </Typography>

      {selectedDevice ? (
        <DeviceDetailView device={selectedDevice} onBack={() => setSelectedDevice(null)} />
      ) : (
        <DeviceListView onSelectDevice={setSelectedDevice} />
      )}
    </Box>
  );
}
