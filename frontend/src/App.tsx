import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";

import type { FullData, PreflightResponse } from "./api";
import { BROWSER_STORAGE_KEY_TOKEN } from "./constants";
import Login from "./Login";
import Dashboard from "./Dashboard";
import InsecureWarning from "./InsecureWarning";
import { AsyncDialogProvider } from "./Dialogs";
import { DynamicMenuProvider } from "./DynamicMenu";

function App() {
  const [securityCheck, setSecurityCheck] = useState<PreflightResponse | undefined>(undefined);
  const [hasAuth, setHasAuth] = useState(!!localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN));
  const [fullData, setFullData] = useState<FullData | undefined>(undefined);

  useEffect(() => {
    if (!window.isSecureContext) {
      fetch("/api/preflight")
        .then((res) => res.json() as Promise<PreflightResponse>)
        .then(setSecurityCheck)
        .catch((err) => {
          console.error("Failed to fetch preflight info", err);
        });
    }
  }, []);

  if (securityCheck && !securityCheck.isSecure && !securityCheck.insecureAllowed) {
    return <InsecureWarning />;
  }

  const handleLoginSuccess = (data?: FullData) => {
    setFullData(data);
    setHasAuth(true);
  };

  return (
    <AsyncDialogProvider>
      <DynamicMenuProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={!hasAuth ? <Login onLoginSuccess={handleLoginSuccess} /> : <Navigate to="/" />}
            />
            <Route path="/" element={hasAuth ? <Dashboard initialData={fullData} /> : <Navigate to="/login" />} />
          </Routes>
        </BrowserRouter>
      </DynamicMenuProvider>
    </AsyncDialogProvider>
  );
}

export default App;
