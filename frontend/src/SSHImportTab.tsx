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
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlined";
import EditIcon from "@mui/icons-material/Edit";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import SearchIcon from "@mui/icons-material/Search";

import { HEADER_AUTHORIZATION, HEADER_AUTHORIZATION_BEARER_PREFIX, BROWSER_STORAGE_KEY_TOKEN } from "./constants";
import { notify, refreshData } from "./store";

// ─── Types (mirrors models/models.go) ────────────────────────────────────────

interface DeviceSSHData {
  deviceName: string;
  hasSSHConfig: boolean;
  hasKnownHosts: boolean;
  sshConfigMtime: number;
  knownHostsMtime: number;
}

interface RemoteHostEntry {
  host: string;
  directives: Record<string, string>;
  isNew: boolean;
  isModified: boolean;
  localDirectives?: Record<string, string>;
}

interface RemoteKnownHostEntry {
  line: string;
  patterns: string;
  keyType: string;
  keyData: string;
  comment?: string;
  isNew: boolean;
  isConflict: boolean;
  localKeyType?: string;
  localKeyData?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders() {
  const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN) ?? "";
  return { [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token };
}

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/settings/webdav/devices", { headers: authHeaders() });
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
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (devices.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
        <CloudDownloadIcon sx={{ fontSize: 48, mb: 1, opacity: 0.4 }} />
        <Typography variant="body1" gutterBottom>
          No SSH data from other devices yet.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Other devices with WebDAV sync enabled will upload their SSH data automatically. Once fetched, they'll appear
          here.
        </Typography>
        <Button variant="outlined" sx={{ mt: 2 }} size="small" onClick={load}>
          Refresh
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: "bold" }}>
          Available Devices
        </Typography>
        <Button size="small" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </Box>
      <TableContainer
        component={Paper}
        sx={{ border: "1px solid", borderColor: "divider", boxShadow: "none", borderRadius: 1 }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: "bold" }}>Device Name</TableCell>
              <TableCell sx={{ fontWeight: "bold" }}>SSH Config</TableCell>
              <TableCell sx={{ fontWeight: "bold" }}>Known Hosts</TableCell>
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
                  <Button size="small" variant="contained" disableElevation onClick={() => onSelectDevice(d)}>
                    Import
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
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
          headers: authHeaders(),
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
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const r = await fetch("/api/settings/webdav/import/sshconfig", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName: device.deviceName, hostNames: Array.from(selected) }),
      });
      if (r.ok) {
        notify(`Imported ${selected.size} host(s) into ~/.ssh/config`, "success");
        onDone();
        refreshData({ sync: 2 });
      } else {
        notify("Import failed: " + (await r.text()), "error");
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
              height: 32,
              fontSize: "0.875rem",
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
          sx={{ height: 32, textTransform: "none" }}
        >
          {importing ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
          Import {selected.size} hosts
        </Button>
      </Stack>

      {filtered.length === 0 ? (
        <Box sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
          <Typography variant="body2">No hosts to display with current filters.</Typography>
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
                <TableCell sx={{ fontWeight: "bold" }}>Host Alias</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>Hostname</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>User / Port</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>Status</TableCell>
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
                          label="New"
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      )}
                      {entry.isModified && (
                        <Chip icon={<EditIcon />} label="Modified" size="small" color="warning" variant="outlined" />
                      )}
                      {!entry.isNew && !entry.isModified && (
                        <Chip icon={<CheckCircleOutlineIcon />} label="Same" size="small" variant="outlined" />
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
                                REMOTE ({device.deviceName})
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
                                LOCAL
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
          headers: authHeaders(),
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
    if (e.isNew && !showNew) return false;
    if (e.isConflict && !showConflict) return false;
    if (!e.isNew && !e.isConflict && !showSame) return false;
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
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const lines = Array.from(selected);
      const hasConflicts = entries.some((e) => e.isConflict && selected.has(e.line));
      const r = await fetch("/api/settings/webdav/import/knownhosts", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName: device.deviceName, lines, force: hasConflicts }),
      });
      if (r.ok) {
        notify(`Imported ${lines.length} known_hosts entry/entries`, "success");
        onDone();
        refreshData({ sync: 2 });
      } else {
        notify("Import failed: " + (await r.text()), "error");
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
          placeholder="Filter entries..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          sx={{
            width: 180,
            "& .MuiInputBase-root": {
              height: 32,
              fontSize: "0.875rem",
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
          sx={{ height: 32, textTransform: "none" }}
        >
          {importing ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
          Import {selected.size} entries
        </Button>
      </Stack>

      {filtered.length === 0 ? (
        <Box sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
          <Typography variant="body2">No known_hosts entries to display.</Typography>
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
                <TableCell sx={{ fontWeight: "bold" }}>Hostname Pattern(s)</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>Key Type</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>Key (partial)</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>Status</TableCell>
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
                        fontSize: "0.75rem",
                        maxWidth: 240,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.patterns}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{entry.keyType}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                      {keyFingerprint(entry.keyData)}
                    </TableCell>
                    <TableCell>
                      {entry.isNew && (
                        <Chip
                          icon={<AddCircleOutlineIcon />}
                          label="New"
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      )}
                      {entry.isConflict && (
                        <Chip icon={<WarningAmberIcon />} label="CONFLICT" size="small" color="error" />
                      )}
                      {!entry.isNew && !entry.isConflict && <Chip label="Same" size="small" variant="outlined" />}
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
                            ⛔ KEY CONFLICT: {entry.patterns}
                          </Typography>
                          <Typography variant="caption" sx={{ display: "block", mb: 1 }}>
                            A known_hosts record for this host already exists locally with a DIFFERENT key. This could
                            indicate a man-in-the-middle attack or a server re-key. Only proceed if you know this is
                            expected.
                          </Typography>
                          <Typography variant="caption" sx={{ fontFamily: "monospace", display: "block", mb: 0.5 }}>
                            Local: {entry.localKeyType} {entry.localKeyData?.slice(0, 16)}…
                          </Typography>
                          <Typography variant="caption" sx={{ fontFamily: "monospace", display: "block", mb: 1 }}>
                            Remote: {entry.keyType} {entry.keyData.slice(0, 16)}…
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
                                I understand and confirm this replacement
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
      {/* Sub-tabs */}
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        {device.hasSSHConfig && (
          <Button
            variant={activeTab === "sshconfig" ? "contained" : "outlined"}
            disableElevation
            size="small"
            onClick={() => setActiveTab("sshconfig")}
          >
            SSH Config
          </Button>
        )}
        {device.hasKnownHosts && (
          <Button
            variant={activeTab === "knownhosts" ? "contained" : "outlined"}
            disableElevation
            size="small"
            onClick={() => setActiveTab("knownhosts")}
          >
            Known Hosts
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
        <b>SSH Data Import</b>: Import SSH hosts or known_hosts entries from other devices that use the same WebDAV sync
        server. Data is fetched automatically during periodic sync.
      </Typography>

      {selectedDevice ? (
        <DeviceDetailView device={selectedDevice} onBack={() => setSelectedDevice(null)} />
      ) : (
        <DeviceListView onSelectDevice={setSelectedDevice} />
      )}
    </Box>
  );
}
