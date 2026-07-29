package resources

import "embed"

// Scripts holds the embedded shell integration scripts from the resources/scripts directory.
// From VS Code:
// https://github.com/microsoft/vscode/tree/main/src/vs/workbench/contrib/terminal/common/scripts
//
//go:embed all:scripts
var Scripts embed.FS
