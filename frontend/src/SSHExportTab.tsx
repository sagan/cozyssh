import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import SettingsIcon from "@mui/icons-material/Settings";
import ShieldIcon from "@mui/icons-material/Shield";

import { BROWSER_STORAGE_KEY_TOKEN } from "./constants";

export default function SSHExportTab() {
  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleExportSSHConfig = () => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN) ?? "";
    triggerDownload(`/api/settings/export/sshconfig?token=${encodeURIComponent(token)}`, "config");
  };

  const handleExportKnownHosts = () => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN) ?? "";
    triggerDownload(`/api/settings/export/knownhosts?token=${encodeURIComponent(token)}`, "known_hosts");
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4, mt: -1 }}>
        <b>SSH Data Export</b>: Download your local OpenSSH configuration files to your computer for backup, migration, or sharing.
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: 3,
        }}
      >
        {/* Card 1: Export SSH Config */}
        <Card
          variant="outlined"
          sx={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            borderRadius: 2,
            borderColor: "divider",
            bgcolor: "background.paper",
            transition: "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out",
            "&:hover": {
              transform: "translateY(-4px)",
              boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
              borderColor: "primary.main",
            },
          }}
        >
          <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 2, p: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: 1.5,
                  color: "primary.main",
                  backgroundColor: "action.selected",
                }}
              >
                <SettingsIcon />
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
                Export SSH Config
              </Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ minHeight: 48 }}>
              Download your local OpenSSH configuration file (<code>~/.ssh/config</code>). This contains all of your configured host aliases, hostnames, usernames, ports, and custom directives.
            </Typography>

            <Box sx={{ flexGrow: 1 }} />

            <Button
              id="export-sshconfig-btn"
              variant="contained"
              size="medium"
              startIcon={<DownloadIcon />}
              onClick={handleExportSSHConfig}
              sx={{
                alignSelf: "flex-start",
                textTransform: "none",
                fontWeight: "bold",
                px: 3,
                boxShadow: "none",
                "&:hover": {
                  boxShadow: "none",
                },
              }}
            >
              Export Config
            </Button>
          </CardContent>
        </Card>

        {/* Card 2: Export known_hosts */}
        <Card
          variant="outlined"
          sx={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            borderRadius: 2,
            borderColor: "divider",
            bgcolor: "background.paper",
            transition: "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out",
            "&:hover": {
              transform: "translateY(-4px)",
              boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
              borderColor: "primary.main",
            },
          }}
        >
          <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 2, p: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: 1.5,
                  color: "primary.main",
                  backgroundColor: "action.selected",
                }}
              >
                <ShieldIcon />
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
                Export known_hosts
              </Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ minHeight: 48 }}>
              Download your local known hosts file (<code>~/.ssh/known_hosts</code>). This contains the cryptographic host key signatures verifying the identity of servers you have connected to.
            </Typography>

            <Box sx={{ flexGrow: 1 }} />

            <Button
              id="export-knownhosts-btn"
              variant="contained"
              size="medium"
              startIcon={<DownloadIcon />}
              onClick={handleExportKnownHosts}
              sx={{
                alignSelf: "flex-start",
                textTransform: "none",
                fontWeight: "bold",
                px: 3,
                boxShadow: "none",
                "&:hover": {
                  boxShadow: "none",
                },
              }}
            >
              Export known_hosts
            </Button>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
