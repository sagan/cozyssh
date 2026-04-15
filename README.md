# CozySSH

CozySSH is a lightweight, self-hosted web-based SSH client and terminal multiplexer. It allows you to manage multiple SSH sessions and local shells from a single, modern web interface.

![CozySSH Screenshot 1](./docs/screenshot-1.png)

## Features

- **Multi-Tab Interface**: Run multiple concurrent SSH sessions and local shells in a single browser tab.
- **Modern UI**: A sleek, high-contrast Light Theme designed for readability.
- **Mobile-Friendly**:
  - Responsive sidebar and layout.
  - **Mobile Input Toolbar**: Quick access to Esc, Tab, Arrow keys, and a stateful **Ctrl toggle** for mobile touch keyboards.
  - **Keyboard-Aware Viewport**: Automatically resizes to fit your visible mobile screen perfectly even when the on-screen keyboard is active.
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

**Command Line Flags**:
- `-config`: Specify a custom configuration directory (default: `~/.config/cozyssh`).

### Configuration

CozySSH stores its settings in `~/.config/cozyssh/config.yaml`. You can customize:
- `addr`: The address and port the server binds to (default: `127.0.0.1:8022`).
- `password`: The BCrypt hashed app password.

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
