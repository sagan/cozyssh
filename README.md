# CozySSH

CozySSH is a lightweight, self-hosted & full-fledged web-based SSH client and terminal multiplexer. It allows you to manage multiple SSH sessions and local shells from a single, modern web interface.

![CozySSH Screenshot 1](./docs/screenshot-1.png)

## Screenshots

<details>

<summary>Mobile View</summary>

![CozySSH Mobile View](./docs/screenshot-mobile-view.png)

</details>

<details>

<summary>Split Window</summary>

![CozySSH Split Window](./docs/screenshot-split-window.png)

</details>

<details>

<summary>File Browser</summary>

![CozySSH File Browser](./docs/screenshot-file-browser.png)

</details>

<details>

<summary>Text Editor</summary>

![CozySSH Text Editor](./docs/screenshot-text-editor.png)

</details>

## Features

- **Use Host SSH Config**: It uses the host OpenSSH client config files (`~/.ssh/id_ed25519`, `~/.ssh/known_hosts`, `~/.ssh/config`) directly for ssh auth & server management.
  - It automatically displays plain text (non hashed name) servers of `~/.ssh/known_hosts`. It's recommended to disable known_hosts name hashing feature by adding the below two lines to `~/.ssh/config`:
    ```
    Host *
      HashKnownHosts no
    ```
- **Multi-Tab Interface**: Run multiple concurrent SSH sessions and local shells in a single browser tab.
- **Modern UI**: A sleek, concise, yet full-fledged high-contrast Light Theme, designed for readability.
- **SFTP & Local File Management**: 📁 🆕
  - **SFTP & Local File Browser**: Browse, upload, download, and edit files directly from your terminal tabs.
- **Custom Scripting (JS/TS)**: Fully programmable automation via a built-in TypeScript-capable scripting engine. See [Scripts Documentation](docs/SCRIPTS.md).
- **Split-Screen Layouts**: View up to 4 terminal panes in a single tab.
  - **Split View**: Access the file browser via the terminal tab's context menu without losing your shell session.
  - **Text File Editor**: Edit text file of SFTP / local server directly in Browser.
  - **Shell CWD Follow**: An button to navigate to shell cwd (`$PWD`) directly. It uses standard OSC 7 escape sequence. Requires adding the below line to `~/.bashrc` :
    ```sh
    # Standard OSC 7 (Recommended for most cases)
    export PS1="$PS1"'\[\e]7;file://$HOSTNAME$PWD\a\]'

    # Alternative OSC 7 (Used by some older terminal software)
    export PS1="$PS1\[\e]7;CurrentDir="'$(pwd)\a\]'
    ```
- **Full keyboard Shortcuts**: It supports a complete set of keyboard shortcuts.
  - `Alt + T` : Open new local shell tab
  - `Alt + J` : Switch to next tab
  - `Alt + K` : Switch to previous tab
  - `Alt + 1-9` : Switch to tab 1-9
  - `Alt + 0` : Switch to last tab
  - `Alt + W` : Close current tab
  - `Alt + I` : Focus sidebar search filter, then Use `↑ ↓` to select, `Enter` to open
  - `Alt + G` : Focus active terminal session
  - `Alt + Shift + 1-9,0` : Click the button in button bar
  - `Alt + ↑ / ↓` : Scroll terminal up / down
- **Mobile-Friendly**:
  - Responsive sidebar and layout.
  - **Mobile Input Toolbar**: Quick access to Esc, Tab, Arrow keys, and a stateful **Ctrl toggle** for mobile touch keyboards.
  - **Keyboard-Aware Viewport**: Automatically resizes to fit your visible mobile screen perfectly even when the on-screen keyboard is active.
- **Terminal Button Bar**: 💻
  - **Custom Snippets**: A scrollable toolbar at the bottom of the terminal window for quick command execution.
  - **Special Syntax**: Full support for control keys via `<ctrl-x>` syntax (e.g., `<ctrl-c>` for SIGINT), which are sent with precise timing to ensure they reach the shell correctly.
  - **Management**: Add, edit, delete, and **reorder buttons** directly from the UI context menu.
  - **Hover Tooltips**: Instant preview of the command payload.
  - **Custom Terminal Function Button**: Custom the button function to common terminal action, like copy terminal buffer, paste to terminal.
- **Advanced SSH Management**: 🔑
  - **ProxyJump Support**: Full support for OpenSSH standard `ProxyJump` configuration, allowing you to connect to hosts via intermediate jump servers.
  - **Tagging System**: Organize your hosts using `### #tag` comments in your `~/.ssh/config`. Tags are fully filterable in the sidebar.
  - **Tag Context Menu**: Right-click any sidebar tag to **"Open All"** hosts associated with that tag simultaneously.
  - **Sidebar Tooltips**: General `###` comments in your config are automatically displayed as tooltips when hovering over hosts in the sidebar.
  - **Heartbeat & Keep-Alive**: Background heartbeat (`keepalive@openssh.com`) every 30 seconds ensures stable connections and prevents idle timeouts.
  - **Interactive Verification**: Full support for interactive Host Key verification and Keyboard-Interactive (Password) authentication.
  - **Smart Resize logic**: Optimized terminal resizing that preserves shell prompt integrity when switching between multiple active tabs.
  - **Accident-Proof Forms**: All "Add / Edit" dialogs prevent accidental closure via backdrop click if any data has been modified.
- **Terminal UX Enhancements**:
  - **Manual Reconnection**: If a terminal session is lost or "stolen" by another browser instance, simply press **Enter** to instantly reconnect.
  - **Auto-copy**: Selected text is automatically copied to your clipboard.
  - **Right-click Paste**: Quickly paste clipboard contents into any active terminal session.
  - **Selection Highlighting**: Clear visual feedback for selected text.
- **Split Screen Window**: Display multiple ssh servers of a `#tag` in single split-screen tab.
- **Tab Pinning & Persistence**:
  - **Persistent Sessions**: Right-click any tab and select **"Pin Tab"** to keep the terminal session (PTY or SSH) running in the background even if you close your browser or navigate away.
  - **Output Buffering**: Pinned sessions maintain a circular output buffer (approx. 50KB), ensuring you see the most recent activity immediately upon reconnection.
  - **Usage-Aware Auto-Restore**: Pinned tabs automatically resume when you re-open CozySSH, but only in the primary window to prevent duplicate UI clutter.
- **Scratchpad feature**: Open a "Scratchpad" text editor tab to write your notes or paste some configuration commands or other text. All data is auto-saving and cached in browser localStorage and automatically synced with and persisted in backend host.
- **Secure by Default**: 
  - Stateless HMAC-SHA256 token-based authentication with a simple App Password.
  - **Non-Local Restriction**: Automatically blocks access from non-local, non-HTTPS environments to prevent credential sniffing.
  - **Password Management**: Reset your application password anytime via the CLI using the `-do-reset-password` flag.
- **Self-Hosted**: Distributed as a single Go binary that embeds the entire React frontend.

## Getting Started

### Installation

Download from GitHub Releases and put `cozyssh` binary to any location.

### Usage

Run the CozySSH binary:
```bash
./cozyssh
```

On first run, CozySSH will generate a default configuration and an **App Password**. Check the terminal output to secure your credentials. The app password can be changed in UI. If you forget your app password, you can reset it to a new random value by running `cozyssh -do-reset-password`.

CozySSH listens on `127.0.0.1:8022` by default. By default, CozySSH can only be accessed from `localhost` hostname (e.g. http://localhost:8022 ) or from a `https` origin via running CozySSH behind a TLS enabled a reverse proxy (like [Traefik](https://github.com/traefik/traefik) or Nginx) and / or CDN provider (like Cloudflare). Start cozyssh with `--allow-insecure-http` flag to lift the restriction.

Example Traefik config to run as a reverse proxy for CozySSH (toml):

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

Prerequisites:

- [Go](https://golang.org/doc/install) 1.25+ (for building the backend)
- [Node.js v24 & npm](https://nodejs.org/en/download/) (for building the frontend)

Older versions of Go or Node.js may also build but I didn't test them.

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
