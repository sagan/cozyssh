# CozySSH Data

- [CozySSH Data](#cozyssh-data)
- [Overview](#overview)
- [Persistent Data](#persistent-data)
  - [App Data](#app-data)
    - [File List](#file-list)
    - [`config.json` file](#configjson-file)
    - [`passwords.json` file](#passwordsjson-file)
  - [SSH Data](#ssh-data)
- [Sync](#sync)

# Overview

CozySSH uses two kinds of persistent data on disk:

- `App Data`: The CozySSH application data directory. Defaults to `~/.config/cozyssh`.
- `SSH Data`: The local OpenSSH client data directory. Defaults to `~/.ssh`.

The `~` is user home dir, i.e. `$HOME` on Linux and `%USERPROFILE%` on Windows.

# Persistent Data

## App Data

`App Data` dir default to `~/.config/cozyssh`. You can change it by running `cozyssh` with `-config <dir>` flag.

### File List

All files in directory are plain text format. There are following files:

- `config.json` : The main config file.
- `buttons.json` : The buttons data.
- `scratchpad.json` : The Scratchpad data.
- `vars.json` : The variables data.
- `passwords.json` : The (encrypted) passwords data. Only exist if you use CozySSH Passstore feature.
- `sync-metadata.json` : The sync metadata. Only exist if you use CozySSH WebDAV sync feature.
- `app-config.json` : (Windows Desktop App only) The Windows App config file.

### `config.json` file

`config.json` is the main cconfig file. Notabilly, it stores the yescrypt hashed `App Password`. The `App Password` is used as authenticcation credential in Web UI login page.

When CozySSH starts, if `config.json` file doesn't exist, it will be automatically initialized with default values including a random generated initial `App Password` and output the initial password to stderr. You must save it and use it to login to the Web UI.

The `config.json` contains these key-value fields:

- `app_password_hash`: The BCrypt hashed app password. Run `cozyssh -do-reset-password` to reset it.
- `addr`: (optional) The address and port the server binds to. Defaults to `127.0.0.1:8022`.
- `sitename`: (optional) The sitename. Defaults to the backend `hostname`. Note it will be visible to everyone who can access the frontend, even unauthenticated.
- `sshdir`: (optional) The OpenSSH client config dir. Defaults to `~/.ssh`.

### `passwords.json` file

`passwords.json` store the SSH server passwords & identity file passphrases that you choose to save in CozySSH Passstore. All stored passwords are encrypted with CozySSH `App Password` using `XAES-256-GCM`.

CozySSH passstore needs to be unlocked to use stored passwords to connect to a SSH server. The passstore is automatically unlocked the first time you enter your `App Password` after CozySSH is started/restarted. The unlock state will persist until CozySSH restarts, or until you manually lock the passstore.

## SSH Data

`SSH data` dir default to `~/.ssh`. It is the standard OpenSSH client data directory. You can configure the `sshdir` field in `config.json` to change the `SSH data` dir.

- `~/.ssh/config` : CozySSH reads and writes servers config in ssh client `config` file directly in OpenSSH config format. It adds few comment lines to store CozySSH specific host configurations, like host tags. But most configurations are stored in standard OpenSSH way.
- `~/.ssh/known_hosts` : CozySSH uses this file to store and retrieve SSH host keys. It reads and writes `known_hosts` file in standard OpenSSH format.
- `~/.ssh/id_ed25519` or `~/.ssh/id_rsa` : CozySSH uses this file as the default identity file when connecting to server. CozySSH never update / write / generate identity files on it's own. Use standard `ssh-keygen` command to generate the identity file if you don't have one.

In short, CozySSH aims to work like the standard CLI OpenSSH client but through a Web UI.

# Sync

CozySSH provides an optional WebDAV Sync Feature. It synces some `App Data` dir files with a user-provided WebDAV server, optionally with E2EE (end to end encryption) using `XAES-256-GCM`.

The following files in `App Data` dir will be synced (full-automatic sync with other devices through WebDAV server):

- `buttons.json` : The buttons data.
- `scratchpad.json` : The Scratchpad data.
- `vars.json` : The variables data.

OpenSSH data can be configured to upload to WebDAV server (opt-in) but must be imported manually by user on the other side (via Import/Export page in Settings) (They don't support full automatic sync). These data includes:

- `~/.ssh/config` .
- `~/.ssh/known_hosts` .

The following files will NOT be synced:

- `config.json` and `passwords.json` in `App Data` dir.
- OpenSSH private keys ( `~/.ssh/id_*` ).
