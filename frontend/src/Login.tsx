import { useState } from 'react';
import { Box, Button, TextField, Typography, Paper, ThemeProvider, createTheme, CssBaseline } from '@mui/material';

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' }, 
    background: { default: '#f4f6f8', paper: '#ffffff' },
  },
});

export default function Login() {
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
      window.location.href = '/';
    } else {
      alert('Login failed. Please check the terminal output for the correct App Password.');
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
        </Paper>
      </Box>
    </ThemeProvider>
  );
}
