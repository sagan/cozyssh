# CozySSH

CozySSH is a lightweight, self-hosted web-based SSH client and terminal multiplexer. It allows you to manage multiple SSH sessions and local shells from a single, modern web interface.

![CozySSH Screenshot 1](./docs/screenshot-1.png)

## Features

- **Use Host SSH Config**: It uses the host OpenSSH client config files (`~/.ssh/id_ed25519`, `~/.ssh/known_hosts`, `~/.ssh/config`) directly for ssh auth & server management.
- **Multi-Tab Interface**: Run multiple concurrent SSH sessions and local shells in a single browser tab.
- **Modern UI**: A sleek, concise, yet full-fledged high-contrast Light Theme, designed for readability.
- **Mobile-Friendly**:
  - Responsive sidebar and layout.
  - **Mobile Input Toolbar**: Quick access to Esc, Tab, Arrow keys, and a stateful **Ctrl toggle** for mobile touch keyboards.
  - **Keyboard-Aware Viewport**: Automatically resizes to fit your visible mobile screen perfectly even when the on-screen keyboard is active.
- **Terminal Button Bar**: 💻
  - **Custom Snippets**: A scrollable toolbar at the bottom of the terminal window for quick command execution.
  - **Management**: Add, edit, delete, and **reorder buttons** directly from the UI context menu.
  - **Hover Tooltips**: Instant preview of the command payload.
- **Advanced SSH Management**: 🔑
  - **Tagging System**: Organize your hosts using `### #tag` comments in your `~/.ssh/config`. Tags are displayed inline and are fully filterable in the sidebar.
  - **Heartbeat & Keep-Alive**: Background heartbeat (`keepalive@openssh.com`) every 30 seconds ensures stable connections and prevents idle timeouts.
  - **Interactive Verification**: Full support for interactive Host Key verification and Keyboard-Interactive (Password) authentication.
  - **Smart Resize logic**: Optimized terminal resizing that preserves shell prompt integrity when switching between multiple active tabs.
- **Terminal UX Enhancements**:
  - **Auto-copy**: Selected text is automatically copied to your clipboard.
  - **Right-click Paste**: Quickly paste clipboard contents into any active terminal session.
  - **Selection Highlighting**: Clear visual feedback for selected text.
- **Tab Pinning & Persistence**:
  - **Persistent Sessions**: Right-click any tab and select **"Pin Tab"** to keep the terminal session (PTY or SSH) running in the background even if you close your browser or navigate away.
  - **Output Buffering**: Pinned sessions maintain a circular output buffer (approx. 50KB), ensuring you see the most recent activity immediately upon reconnection.
  - **Usage-Aware Auto-Restore**: Pinned tabs automatically resume when you re-open CozySSH, but only in the primary window to prevent duplicate UI clutter.
- **Editable SSH Config**: Directly manage your `~/.ssh/config` from the web UI. CozySSH uses surgical text replacement to ensure your custom comments and formatting remain intact.
- **Secure**: Stateless HMAC-SHA256 token-based authentication with a simple App Password.
- **Self-Hosted**: Distributed as a single Go binary that embeds the entire React frontend.

## Getting Started

### Installation

Download from GitHub Releases and put `cozyssh` binary to PATH location.

### Usage

Run the CozySSH binary:
```bash
./cozyssh
```

On first run, CozySSH will generate a default configuration and an **App Password**. Check the terminal output to secure your credentials.

It listens to `127.0.0.1:8022` by default. In test environment you can visit http://localhost:8022 directly in your local browser. In production environment it's mandatory to deploy CozySSH behind a TLS enabled a reverse proxy (like [Traefik](https://github.com/traefik/traefik) or Nginx) and / or CDN provider (like Cloudflare).

Example Traefik config (toml):

```toml
[core]
  defaultRuleSyntax = "v2"

[entryPoints.websecure]
  address = ":443"

[[tls.certificates]]
  certFile = "/certs/example.com.pem"
  keyFile = "/certs/example.com.key"

[http.routers.cozyssh]
rule = "Host(`cozyssh.example.com`)&&PathPrefix(`/`)"
service = "cozyssh"

[http]
  [http.services]
    [http.services.cozyssh]
      [http.services.cozyssh.loadBalancer]
        [[http.services.cozyssh.loadBalancer.servers]]
          url = "http://127.0.0.1:8022/"
```

### Configuration

CozySSH stores its settings in `~/.config/cozyssh/config.yaml`. You can customize:
- `addr`: The address and port the server binds to (default: `127.0.0.1:8022`).
- `password`: The BCrypt hashed app password.

The default `~/.config/cozyssh` config dir path can be changed by `-config` command line flag.

## Development

Prerequisites

- [Go](https://golang.org/doc/install) 1.21+ (for building the backend)
- [Node.js & npm](https://nodejs.org/en/download/) (for building the frontend)

To run CozySSH in development mode:

1. **Start the backend**:
   ```bash
   go run main.go
   ```

2. **Start the frontend (Vite dev server)**:
   ```bash
   cd frontend
   npm run dev
   ```
   Vite is configured to proxy API requests to the Go backend running on port 8022.

To build the project:

```bash
# Build the frontend
cd frontend
npm install
npm run build
cd ..

# Build the Go binary
go build -o cozyssh
```

## License

BSD 3-Clause License - See the [LICENSE](LICENSE) file for details.
