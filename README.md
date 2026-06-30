## CozySSH

CozySSH is a lightweight, mobile-friendly, full-fledged & self-hosted web-based SSH client and terminal multiplexer. It allows you to manage multiple SSH sessions and local shells from a single, modern web interface. It's intuitive and easy, ready to use out of the box, while also having advanced features and being highly configurable & extensible. It's core functions can be extened via [CozySSH Plugins][].

![CozySSH Screenshot 1](./docs/screenshot-1.png)

- [CozySSH](#cozyssh)
- [Screenshots](#screenshots)
- [Features](#features)
- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [Usage](#usage)
  - [Configuration](#configuration)
  - [Run as systemd service](#run-as-systemd-service)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Build](#build)
  - [Test](#test)
  - [Generate](#generate)
- [License](#license)

## Screenshots

<details>

<summary>Mobile View</summary>

![CozySSH Mobile View](./docs/screenshot-mobile-view.png)

</details>

<details>

<summary>Split Screen</summary>

![CozySSH Split Screen](./docs/screenshot-split-screen.png)

</details>

<details>

<summary>File Browser</summary>

![CozySSH File Browser](./docs/screenshot-file-browser.png)

</details>

<details>

<summary>Text Editor</summary>

![CozySSH Text Editor](./docs/screenshot-text-editor.png)

</details>

<details>

<summary>New Tab Dialog</summary>

![CozySSH Text Editor](./docs/screenshot-new-tab-dialog.png)

</details>

## Features

- **Use Host SSH Config**: It uses the host OpenSSH client config files (`~/.ssh/id_ed25519`, `~/.ssh/known_hosts`, `~/.ssh/config`) directly for ssh auth & server management.
  - It automatically displays plain text (non hashed name) servers of `~/.ssh/known_hosts`. It's recommended to disable known_hosts name hashing feature globally by modifying `/etc/ssh/ssh_config`:
    ```
    Host *
      HashKnownHosts no
    ```
- **Modern UI**: A sleek, concise, yet full-fledged UI based on React and [Material UI](https://github.com/mui/material-ui).
  - **High-contrast Light Theme**: Designed for readability.
  - **Multi-Tab Interface**: Run multiple concurrent SSH sessions and local shells in a single browser tab.
  - **Split Screen Window**: Display multiple ssh servers of a `#tag` in single split-screen tab. View up to 4 terminal panes in a single tab.
  - **New Tab Dialog** : Powerful "New Tab Dialog" (shortcut: `Alt + O`) to quickly create new session, navigate opened tabs, or execute custom button. Inspired by Notion New Tab dialog.
  - **Button Bar**: A scrollable toolbar at the bottom of the terminal window for quickly sending string to terminal or executing custom function. Inspired by [SecureCRT Button Bar](https://www.vandyke.com/support/tips/button_bar.html).
    - **Custom Snippets**: Send custom string to current terminal.
    - **Special Syntax**: Full support for control keys via `<ctrl-x>` syntax (e.g., `<ctrl-c>` for SIGINT), which are sent with precise timing to ensure they reach the shell correctly.
    - **Management**: Add, edit, delete, and reorder buttons directly from the UI context menu.
    - **Hover Tooltips**: Instant preview of the command payload.
    - **Common Terminal Functions**: Custom the button function to common terminal action, like copy terminal buffer, paste to terminal.
    - **Shortcut Invocation** : Use `<alt + shift + 1-9,0>` keyboard shortcut to invoke button directly.
    - **Custom Shortcut** : Set custom keyboard shortcut (e.g. `ctrl+shift+m`) for any button.
  - **Mobile-Friendly**: All features can be accessed seamlessly from mobile browser.
    - **Responsive sidebar and layout**.
    - **Mobile Input Toolbar**: Quick access to `Ctrl`, `Alt`, `Esc`, `Tab`, `Arrow keys` on mobile device. Click `...` to access more special chars from on-screen keyboard area.
    - **Keyboard-Aware Viewport**: Automatically resizes to fit your visible mobile screen perfectly even when the on-screen keyboard is active.
    - **Gesture Support** : Swipe left / right to switch tab in mobile browser.
  - **Accident-Proof Forms**: All "Add / Edit" dialogs prevent accidental closure via backdrop click if any data has been modified.
- **SFTP & Local File Management**: 📁
  - **SFTP & Local File Browser**: Browse, upload, download, filter or edit files directly from your terminal tabs.
  - **Split View**: Access the file browser via the terminal tab's context menu without losing your shell session.
  - **Text File Editor**: Edit text file of SFTP / local server directly in Browser.
- **Shell Integration**: Built-in Shell Integration features like cwd detection. An button in File Browser to navigate to shell cwd (`$PWD`) directly. It works best for newer Linux systems (Ubuntu 26.04+) out of the box using OSC 3008 sequence detection. For older Linux systems, you can add OSC 7 escape sequence to `~/.bashrc` to enable basic feature:

  ```sh
  # Standard OSC 7 (Recommended for most cases)
  export PS1="$PS1"'\[\e]7;file://$HOSTNAME$PWD\a\]'

  # Alternative OSC 7 (Used by some older terminal software)
  export PS1="$PS1\[\e]7;CurrentDir="'$(pwd)\a\]'
  ```

- **Full keyboard Shortcuts**: It supports a complete set of keyboard shortcuts.
  - `Alt + O` : Open new tab dialog, use `← →` (or `Alt + H/L`) to switch view, `↓ ↑` (or `Alt + J/K`) to select, `Enter` to open, `Alt + Enter` to open in current tab, `Ctrl + Enter` to open in new window. Use `Alt + ↓↑` (or `Alt + Shift + J/K`) to jump through items quickly; Hold `Ctrl` to jump to top/bottom
  - `Alt + A` : Open new tab dialog - tabs view
  - `Alt + E / Ctrl + Shift + P` : Open new tab dialog - buttons view
  - `Alt + P` : Open new tab dialog - tags view
  - `Alt + :` : Open new tab dialog - tunnels view
  - `Alt + ?` : Open new tab dialog - all view
  - `Alt + N` : Open new default local shell tab; Hold `Ctrl` to open in current tab
  - `Alt + Shift + N` : Open new alternative local shell tab; Hold `Ctrl` to open in current tab
  - `Alt + S` : Open scratchpad
  - `Alt + H / Alt + L` : Switch to previous / next pane
  - `Alt + Shift + H / Alt + Shift + L` : Switch to previous / next tab
  - `Alt + 1-9,0` : Switch to tab 1-9, last tab
  - `Alt + C` : Clone active pane in new tab
  - `Alt + Shift + C` : Clone active pane in same tab (Max 4 panes per tab)
  - `Alt + W` : Close active pane
  - `Alt + Shift + W` : Close active tab
  - `Ctrl + Alt + Shift + W` : Close other tabs
  - `Ctrl + Alt + Shift + L` : Toggle Lock/Unlock current tab
  - `Alt + I` : Focus sidebar search filter, then use `↑ ↓` to select, `Enter` to open, `Alt + Enter` to open in current tab, `Ctrl + Enter` to open in new window, `Shift + Enter` to open context menu
  - `Alt + Shift + I` : Focus sidebar search filter and clear current value
  - `Alt + G` : Focus active terminal session
  - `Alt + Shift + G` : Focus the first pane of the active tab
  - `Alt + Q` : Open input dialog
  - `Alt + V / Alt + Shift + V` : Switch to next / previous group in button bar. Hold `Ctrl` to include hidden groups
  - `Alt + Shift + 1-9,0` : Click the button in button bar
  - `Alt + J / Alt + K` : Scroll terminal down / up by a few lines
  - `Alt + Shift + J / Alt + Shift + K` : Scroll terminal down / up by a page
  - `Ctrl + Alt + Shift + J / Ctrl + Alt + Shift + K` : Scroll terminal to bottom / top
  - `Alt + Enter` : Toggle fullscreen of main terminal area
  - `Alt + Backquote` : Close any modal (Dialog / Menu / Popover). Similar to `Escape` but works even if terminal is in fullscreen mode
  - `Alt + Shift + Backquote` : Force close all modals. Also close all toasts.
  - `Alt + - / Alt + +` : Decrease / increase terminal font size
  - `Alt + Shift + - / Alt + Shift + +` : Decrease / increase global & terminal font size
  - `Ctrl + Alt + 0` : Reset to default global / terminal font size (14 / 15px)
  - `Ctrl + Shift + F` : Open terminal search box
  - `Ctrl + Shift + R` : Reconnect current terminal
  - `Ctrl + Shift + C` : Copy selected text in terminal
  - `Ctrl + Shift + V (Windows) / Cmd + V (Mac)` : Paste into terminal
  - `Ctrl + Alt + Shift + R` : Force clear service worker, cache and reload
  - `Mouse Select` in terminal to copy
  - `Mouse Right Click` in terminal to paste
  - `Mouse Middle Click` on a tab to close it
  - `Alt + Mouse Wheel` in terminal to fast scroll up / down
- **Advanced SSH Management**: 🔑
  - **ProxyJump Support**: Full support for OpenSSH standard `ProxyJump` configuration, allowing you to connect to hosts via intermediate jump servers.
  - **RemoteCommand Support**: Support ssh_config `RemoteCommand` configuration, execute a custom command on the remote ssh server after successfully connecting to it.
  - **Tagging System**: Organize your hosts using `### #tag` comments in your `~/.ssh/config`. Tags are fully filterable in the sidebar.
  - **Tag Context Menu**: Right-click any sidebar tag to **"Open All"** hosts associated with that tag simultaneously.
  - **Sidebar Tooltips**: General `###` comments in your config are automatically displayed as tooltips when hovering over hosts in the sidebar.
  - **Heartbeat & Keep-Alive**: Background heartbeat (`keepalive@openssh.com`) every 30 seconds ensures stable connections and prevents idle timeouts.
  - **Interactive Verification**: Full support for interactive Host Key verification and Keyboard-Interactive (Password) authentication.
  - **Smart Resize logic**: Optimized terminal resizing that preserves shell prompt integrity when switching between multiple active tabs.
- **Local Shell**: Open local shell tab. It uses `$SHELL`. If not set, on Linux it fallbacks to `bash`; on Windows it fallbacks to `pwsh.exe` (if present) or `powershell.exe`.
- **Terminal UX Enhancements**:
  - **Manual Reconnection**: If a terminal session is lost or "stolen" by another browser instance, simply press **Enter** to instantly reconnect.
  - **Auto-copy**: Selected text is automatically copied to your clipboard.
  - **Right-click Paste**: Quickly paste clipboard contents into any active terminal session.
  - **Selection Highlighting**: Clear visual feedback for selected text.
- **Tab Pinning & Persistence**:
  - **Persistent Sessions**: Right-click any tab and select **"Pin Tab"** to keep the terminal session (PTY or SSH) running in the background even if you close your browser or navigate away.
  - **Output Buffering**: Pinned sessions maintain a circular output buffer (approx. 50KB), ensuring you see the most recent activity immediately upon reconnection.
  - **Usage-Aware Auto-Restore**: Pinned tabs automatically resume when you re-open CozySSH, but only in the primary window to prevent duplicate UI clutter.
  - **Lock Tab**: Pinned tabs can be further locked to prevent accidental closing.
- **Scratchpad feature**: Open a "Scratchpad" text editor tab to write your notes or paste some configuration commands or other text. All data is auto-saving and cached in browser localStorage and automatically synced with and persisted in backend.
- **Secure by Default**:
  - **Stateless Authentication**: HMAC-SHA256 token-based authentication with a simple App Password.
  - **Non-Local Restriction**: Automatically blocks access from non-local, non-HTTPS environments to prevent credential sniffing.
  - **Password Management**: Reset your application password anytime via the CLI using the `-do-reset-password` flag.
- **Custom Scripting**: Fully programmable / extendable via a built-in powerful & TypeScript-capable scripting engine. See [Scripts Documentation](docs/SCRIPTS.md). It also has a [Plugins Repository][CozySSH Plugins] which includes many official scripts/plugins that can be installed directly from CozySSH frontend.
- **Self-Hosted**: Distributed as a single Go binary that embeds the entire React frontend.

## Getting Started

### Installation

Download from GitHub Releases and put `cozyssh` binary to any location.

### Usage

Run the CozySSH binary:

```bash
./cozyssh
```

On first run, CozySSH will generate a default configuration file at `~/.config/cozyssh/config.yaml` with an initial random **App Password**. Check the terminal output to find the initial password. The app password can be changed in UI. If you forget your app password, you can reset it to a new random value by running `cozyssh -do-reset-password`.

CozySSH listens on `127.0.0.1:8022` by default. By default, CozySSH can only be accessed from `localhost` hostname (e.g. http://localhost:8022 ) or from a `https` origin via running CozySSH behind a TLS enabled a reverse proxy (like [Traefik](https://github.com/traefik/traefik) or Nginx) and / or CDN provider (like Cloudflare). Start cozyssh with `--allow-insecure-http` flag to lift the restriction.

<details>

<summary>Example Traefik config to run as a reverse proxy for CozySSH (toml)</summary>

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

</details>

### Configuration

CozySSH stores its settings in `~/.config/cozyssh/config.yaml`. You can customize:

- `app_password_hash`: The BCrypt hashed app password. Run `cozyssh -do-reset-password` to reset it.
- `addr`: (optional) The address and port the server binds to. Defaults to `127.0.0.1:8022`.
- `sitename`: (optional) The sitename. Defaults to the backend `hostname`. Note it will be visible to everyone who can access the frontend, even unauthenticated.
- `sshdir`: (optional) The OpenSSH client config dir. Defaults to `~/.ssh`.

The default `~/.config/cozyssh` config dir path can be changed by `-config` command line flag.

### Run as systemd service

Example `cozyssh.service` file:

```
[Unit]
Description=cozyssh

[Service]
Type=exec
User=root
WorkingDirectory=/root
ExecStart=/usr/bin/cozyssh
Restart=always

[Install]
WantedBy=multi-user.target
```

Put it to `/etc/systemd/system/cozyssh.service` and put `cozyssh` binary to `/usr/bin/cozyssh`,
then run `systemctl enable --now cozyssh` to start the service.

## Development

### Prerequisites

- [Go](https://golang.org/doc/install) 1.25+ (for building the backend)
- [Node.js v24 & npm](https://nodejs.org/en/download/) (for building the frontend)

Older versions of Go or Node.js may also build but I didn't test them.

### Build

```bash
# Build the frontend
npm --prefix frontend install
npm --prefix frontend run build

# Build the Go binary
go build
```

### Test

See [docs/TEST.md](docs/TEST.md).

### Generate

Some files are generated by scripts.

- `frontend/csapi.d.ts` : The custom scripting API TypeScript definitions. It's used by [CozySSH Plugins][]. CozySSH itself doesn't use this file. Generated by `npm --prefix frontend run gen-csapi`.
- `frontend/src/api.ts` : The Go backend API TypeScript definitions. The frontend uses this file. Generated by `go run github.com/tkrajina/typescriptify-golang-structs/tscriptify@latest -interface -package=cozyssh/models -target="frontend/src/api.ts" models/models.go`.

## License

BSD 3-Clause License - See the [LICENSE](LICENSE) file for details.

[CozySSH Plugins]: https://github.com/sagan/cozyssh-plugins
