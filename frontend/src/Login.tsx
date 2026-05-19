import { useEffect, useState } from 'react';
import { Box, Button, TextField, Typography, Paper, ThemeProvider, CssBaseline } from '@mui/material';
import { version as PACKAGE_JSON_VERSION } from '../package.json';
import { loginTheme } from './common';

export default function Login({ onLoginSuccess }: { onLoginSuccess?: (data: any) => void }) {
  const [password, setPassword] = useState('');

  const [sitename, setSitename] = useState("CozySSH");
  useEffect(() => {
    fetch("/manifest.json").then((res) => res.json()).then((data) => {
      setSitename(data.name);
      document.title = data.name;
    }).catch(e => console.log(e))
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      alert('Please enter the App Password.');
      return;
    }
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
      alert('Login failed. Check the terminal output for the initial App Password.');
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
    <ThemeProvider theme={loginTheme}>
      <CssBaseline />
      <Box sx={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Paper elevation={3} sx={{ p: 4, width: 350, textAlign: 'center' }}>
          <Typography variant="h5" gutterBottom sx={{ textAlign: "left", fontWeight: 'bold' }}>{sitename}</Typography>
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
          <Typography variant="body2" sx={{ mt: 2, fontSize: '0.7rem' }}>
            v{PACKAGE_JSON_VERSION}&nbsp;|&nbsp;<a rel="noopener noreferrer" style={{ color: '#1976d2' }} href="https://github.com/sagan/cozyssh">GitHub</a>
          </Typography>
        </Paper>
      </Box>
    </ThemeProvider>
  );
}
