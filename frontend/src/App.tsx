import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import Login from './Login';
import Dashboard from './Dashboard';
import InsecureWarning from './InsecureWarning';

function App() {
  const [securityCheck, setSecurityCheck] = useState<{ is_secure: boolean, insecure_allowed: boolean } | null>(null);
  const hasAuth = !!localStorage.getItem('cozy_token');

  useEffect(() => {
    fetch('/api/sysinfo')
      .then(res => res.json())
      .then(data => {
        setSecurityCheck({
          is_secure: data.is_secure,
          insecure_allowed: data.insecure_allowed
        });
      })
      .catch(err => {
        console.error("Failed to fetch security info", err);
        // Fallback to secure if it fails? Or block?
        // If it fails, maybe the server is down or blocked.
      });
  }, []);

  if (securityCheck && !securityCheck.is_secure && !securityCheck.insecure_allowed) {
    return <InsecureWarning />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={hasAuth ? <Dashboard /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
