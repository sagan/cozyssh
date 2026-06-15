import { useCallback, useEffect, useState } from "react";
import { Box, Button, TextField, Typography, Paper, ThemeProvider, CssBaseline } from "@mui/material";

import { version as PACKAGE_JSON_VERSION } from "../package.json";
import type { FullData, LoginRequest, LoginResponse, Manifest } from "./api";
import { APP_NAME, BROWSER_STORAGE_KEY_TOKEN, HEADER_CONTENT_TYPE, METHOD_POST, MIME_JSON } from "./constants";
import { forceReload, getKeyCombination, loginTheme } from "./common";
import { dialogs } from "./Dialogs";

export default function Login({ onLoginSuccess }: { onLoginSuccess: (data?: FullData) => void }) {
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const keycomb = getKeyCombination(e);

      if (e.key === "Alt" && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        return;
      }

      switch (keycomb) {
        case "ctrl+alt+shift+r": {
          e.preventDefault();
          forceReload();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    fetch("/manifest.json")
      .then((res) => res.json() as Promise<Manifest>)
      .then((data) => {
        let name = data.name;
        const prefix = APP_NAME + " ";
        if (name.startsWith(prefix)) {
          name = name.slice(prefix.length);
        }
        setName(name);
        document.title = prefix + name;
      })
      .catch((e) => console.log(e));
  }, []);

  const handleLogin = useCallback(
    async (e: React.SubmitEvent) => {
      e.preventDefault();
      if (!password) {
        dialogs.alert("Please enter the App Password.");
        return;
      }
      const res = await fetch("/api/login", {
        method: METHOD_POST,
        headers: {
          [HEADER_CONTENT_TYPE]: MIME_JSON,
        },
        body: JSON.stringify({ password } satisfies LoginRequest),
      });
      if (res.ok) {
        const data: LoginResponse = await res.json();
        localStorage.setItem(BROWSER_STORAGE_KEY_TOKEN, data.token);
        if (onLoginSuccess && data.fulldata) {
          onLoginSuccess(data.fulldata);
        } else {
          window.location.href = "/";
        }
      } else {
        dialogs.alert("Login failed. Check the terminal output for the initial App Password.");
      }
    },
    [onLoginSuccess, password],
  );

  const handleClearCache = useCallback(async () => {
    if (!(await dialogs.confirm("This will unregister the Service Worker, clear all caches and reload. Proceed?"))) {
      return;
    }
    forceReload();
  }, []);

  useEffect(() => {
    (async function () {
      if (!window.appAuth) {
        return;
      }
      const token = await window.appAuth();
      await dialogs.alert(
        `Welcome to CozySSH Desktop App`,
        `Please check the initial app password in "initial_password.txt" file of CozySSH data directory.

The default data dir path:

  %USERPROFILE%\\.config\\cozyssh(Windows)
  ~/.config/cozyssh</b> (Linux)

The app password can be changed from Dashboard menu - Settings. You can safely delete the initial_password.txt file after you remember or change the app password.

Please remember the app password. You will need it to access your saved SSH passwords.`,
      );
      localStorage.setItem(BROWSER_STORAGE_KEY_TOKEN, token);
      onLoginSuccess();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemeProvider theme={loginTheme}>
      <CssBaseline />
      <Box sx={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Paper elevation={3} sx={{ p: 4, width: 500, maxWidth: "80dvw", textAlign: "center" }}>
          <Typography variant="h5" gutterBottom sx={{ textAlign: "left", fontWeight: "bold" }}>
            {APP_NAME} {name}
          </Typography>
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
            sx={{ mt: 2, fontSize: "0.7rem", textTransform: "none" }}
          >
            Force clear cache & unregister service worker
          </Button>
          <Typography variant="body2" sx={{ mt: 2, fontSize: "0.7rem" }}>
            v{PACKAGE_JSON_VERSION}&nbsp;|&nbsp;
            <a rel="noopener noreferrer" style={{ color: "#1976d2" }} href="https://github.com/sagan/cozyssh">
              GitHub
            </a>
          </Typography>
        </Paper>
      </Box>
    </ThemeProvider>
  );
}
