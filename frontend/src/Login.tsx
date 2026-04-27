import { useState } from 'react';
import { Box, Button, TextField, Typography, Paper, ThemeProvider, createTheme, CssBaseline } from '@mui/material';

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' }, 
    background: { default: '#f4f6f8', paper: '#ffffff' },
  },
});

export default function Login({ onLoginSuccess }: { onLoginSuccess?: (data: any) => void }) {
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('cozy_token', data.token);
      if (onLoginSuccess && data.fulldata) {
        onLoginSuccess(data.fulldata);
      } else {
        window.location.href = '/';
      }
    } else {
      alert('Login failed. Please check the terminal output for the correct App Password.');
    }
  };

  const handleClearCache = async () => {
    if (!confirm("This will unregister the Service Worker, clear all caches and reload. Proceed?")) return;
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (let registration of registrations) {
        await registration.unregister();
      }
      if (window.caches) {
        const cacheNames = await caches.keys();
        for (let cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }
      window.location.reload();
    }
  };

  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline />
      <Box sx={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Paper elevation={3} sx={{ p: 4, width: 350, textAlign: 'center' }}>
          <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold' }}>CozySSH</Typography>
          <Box component="form" onSubmit={handleLogin} sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label="App Password"
              type="password"
              variant="outlined"
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <Button fullWidth variant="contained" type="submit" sx={{ mt: 3, mb: 1 }}>
              Sign In
            </Button>
          </Box>
          <Button 
            variant="text" 
            size="small" 
            color="error" 
            onClick={handleClearCache}
            sx={{ mt: 2, fontSize: '0.7rem', textTransform: 'none' }}
          >
            Force clear cache & unregister service worker
          </Button>
        </Paper>
      </Box>
    </ThemeProvider>
  );
}
