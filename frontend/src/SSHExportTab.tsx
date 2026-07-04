import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DownloadIcon from "@mui/icons-material/Download";

export default function SSHExportTab() {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, mt: -1 }}>
        <b>SSH Data Export</b>: Export features allow you to backup your CozySSH configuration locally or upload your local SSH data to your configured WebDAV sync server.
      </Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 3 }}>
        <Card 
          variant="outlined" 
          sx={{ 
            height: "100%", 
            display: "flex", 
            flexDirection: "column",
            borderRadius: 2,
            borderColor: "divider",
            bgcolor: "background.paper",
            transition: "transform 0.2s, box-shadow 0.2s",
            "&:hover": {
              transform: "translateY(-4px)",
              boxShadow: 2,
              borderColor: "primary.main",
            }
          }}
        >
          <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 1.5, p: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box 
                sx={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center", 
                  width: 40, 
                  height: 40, 
                  borderRadius: 1.5, 
                  bgcolor: "action.hover",
                  color: "primary.main" 
                }}
              >
                <DownloadIcon />
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
                Backup CozySSH Config
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              Export all your connections, custom buttons, variables, and application settings into a single backup file.
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button 
              variant="outlined" 
              size="small" 
              disabled 
              sx={{ mt: 2, alignSelf: "flex-start", textTransform: "none" }}
            >
              Coming Soon
            </Button>
          </CardContent>
        </Card>

        <Card 
          variant="outlined" 
          sx={{ 
            height: "100%", 
            display: "flex", 
            flexDirection: "column",
            borderRadius: 2,
            borderColor: "divider",
            bgcolor: "background.paper",
            transition: "transform 0.2s, box-shadow 0.2s",
            "&:hover": {
              transform: "translateY(-4px)",
              boxShadow: 2,
              borderColor: "primary.main",
            }
          }}
        >
          <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 1.5, p: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box 
                sx={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center", 
                  width: 40, 
                  height: 40, 
                  borderRadius: 1.5, 
                  bgcolor: "action.hover",
                  color: "secondary.main" 
                }}
              >
                <CloudUploadIcon />
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
                Manual SSH Upload
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              Immediately upload your local OpenSSH configuration (~/.ssh/config) and known_hosts to the WebDAV sync server.
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button 
              variant="outlined" 
              size="small" 
              disabled 
              sx={{ mt: 2, alignSelf: "flex-start", textTransform: "none" }}
            >
              Coming Soon
            </Button>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
