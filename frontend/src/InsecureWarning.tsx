import React from 'react';

const InsecureWarning: React.FC = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '2rem',
      textAlign: 'center'
    }}>
      <div style={{
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '1.5rem',
        padding: '3rem',
        maxWidth: '600px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{
          fontSize: '4rem',
          marginBottom: '1rem'
        }}>
          🛡️
        </div>
        <h1 style={{
          fontSize: '2rem',
          fontWeight: '700',
          marginBottom: '1.5rem',
          background: 'linear-gradient(to right, #ff416c, #ff4b2b)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Security Restriction
        </h1>
        <p style={{
          fontSize: '1.1rem',
          lineHeight: '1.6',
          color: '#cbd5e1',
          marginBottom: '2rem'
        }}>
          CozySSH has detected that it is running in a <strong>non-local HTTP environment</strong>.
          For your security, access is blocked by default to prevent credential interception.
        </p>

        <div style={{
          textAlign: 'left',
          background: 'rgba(0, 0, 0, 0.2)',
          padding: '1.5rem',
          borderRadius: '1rem',
          marginBottom: '2rem',
          fontSize: '0.95rem'
        }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', color: '#fff' }}>How to resolve:</h2>
          <ul style={{ paddingLeft: '1.25rem', color: '#94a3b8' }}>
            <li style={{ marginBottom: '0.5rem' }}>Use <strong>HTTPS</strong> via a reverse proxy (Traefik, Nginx, Caddy, etc.)</li>
            <li style={{ marginBottom: '0.5rem' }}>Access via <strong>localhost</strong> (127.0.0.1)</li>
            <li>If you understand the risks, start with <code>--allow-insecure-http</code></li>
          </ul>
        </div>

        <button
          onClick={() => window.location.reload()}
          style={{
            background: 'linear-gradient(to right, #4facfe 0%, #00f2fe 100%)',
            border: 'none',
            borderRadius: '0.75rem',
            padding: '0.75rem 2rem',
            color: '#000',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'transform 0.2s',
          }}
          onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          Check Again
        </button>
      </div>
    </div>
  );
};

export default InsecureWarning;
