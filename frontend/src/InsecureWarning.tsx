import { Box, Typography, Button, Paper, Container } from "@mui/material";

export default function InsecureWarning() {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        minHeight: "100vh",
        bgcolor: "#f4f6f8",
        p: 2,
      }}
    >
      <Container maxWidth="sm" sx={{ px: 2 }}>
        <Paper
          elevation={0}
          sx={{
            p: 1,
            borderRadius: 4,
            textAlign: "center",
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "#ffffff",
          }}
        >
          <Typography variant={"h5"} component="h1" gutterBottom sx={{ fontWeight: 700 }}>
            Access Restricted
          </Typography>

          <Typography variant="body1" color="text.secondary" sx={{ mb: 4, lineHeight: 1.6, px: 1 }}>
            CozySSH has detected that it is running in a <strong>non-local HTTP environment</strong>. For your security,
            access is blocked by default to prevent credential interception.
          </Typography>

          <Box
            sx={{
              textAlign: "left",
              bgcolor: "action.hover",
              p: 1,
              borderRadius: 3,
              mb: 1,
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              How to resolve:
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5, color: "text.secondary" }}>
              <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                Use <strong>HTTPS</strong> via a reverse proxy (Traefik, Nginx, Caddy, etc.)
              </Typography>
              <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                Access via <strong>localhost</strong> (127.0.0.1)
              </Typography>
              <Typography component="li" variant="body2">
                If you understand the risks, start with <code>--allow-insecure-http</code>
              </Typography>
            </Box>
          </Box>

          <Button
            variant="contained"
            size="large"
            onClick={() => window.location.reload()}
            sx={{
              px: 1,
              py: 1,
              borderRadius: 3,
              textTransform: "none",
              fontWeight: 600,
              boxShadow: "none",
              width: "auto",
              "&:hover": { boxShadow: "none" },
            }}
          >
            Check Again
          </Button>
        </Paper>
      </Container>
    </Box>
  );
}
