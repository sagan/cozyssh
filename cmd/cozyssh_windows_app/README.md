# CozySSH Windows App

## Build

Generate `rsrc.syso` resource file

```
go install github.com/akavel/rsrc@latest

cd cmd\cozyssh_windows_app
rsrc -manifest app.manifest -ico ../../frontend/public/favicon.ico -o rsrc_windows_amd64.syso
rsrc -manifest app.manifest -ico ../../frontend/public/favicon.ico -arch arm64 -o rsrc_windows_arm64.syso
```
