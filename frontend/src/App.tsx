import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import Login from './Login';
import Dashboard from './Dashboard';
import InsecureWarning from './InsecureWarning';

function App() {
  const [securityCheck, setSecurityCheck] = useState<{ is_secure: boolean, insecure_allowed: boolean } | null>(null);
  const [hasAuth, setHasAuth] = useState(!!localStorage.getItem('cozy_token'));
  const [fullData, setFullData] = useState<any>(null);

  useEffect(() => {
    const isHttpNonLocal = window.location.protocol === 'http:' && 
                           window.location.hostname !== 'localhost' && 
                           window.location.hostname !== '127.0.0.1';
    
    if (isHttpNonLocal) {
      fetch('/api/preflight')
        .then(res => res.json())
        .then(data => {
          setSecurityCheck({
            is_secure: data.is_secure,
            insecure_allowed: data.insecure_allowed
          });
        })
        .catch(err => {
          console.error("Failed to fetch preflight info", err);
        });
    } else {
      setSecurityCheck({ is_secure: true, insecure_allowed: true });
    }
  }, []);

  if (securityCheck && !securityCheck.is_secure && !securityCheck.insecure_allowed) {
    return <InsecureWarning />;
  }

  const handleLoginSuccess = (data: any) => {
    setFullData(data);
    setHasAuth(true);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!hasAuth ? <Login onLoginSuccess={handleLoginSuccess} /> : <Navigate to="/" />} />
        <Route path="/" element={hasAuth ? <Dashboard initialData={fullData} /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
