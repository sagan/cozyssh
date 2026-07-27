//go:build windows

package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows"

	"cozyssh"
)

const (
	GITHUB_REPO = "sagan/cozyssh"
)

// Standard Win32 Dialog Box command IDs missing from x/sys/windows
const (
	idYes = 6
	idNo  = 7
)

type GitHubRelease struct {
	TagName string `json:"tag_name"`
}

// checkAppUpdate queries GitHub releases and patches the running binary safely.
func checkAppUpdate(hwnd uintptr) {
	client := &http.Client{Timeout: 20 * time.Second}

	// 1. Query the latest release metadata
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", GITHUB_REPO)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		showUpdateMsg(hwnd, "Update Error", "Failed to prepare update check: "+err.Error(), windows.MB_ICONERROR)
		return
	}
	req.Header.Set("User-Agent", "cozyssh-updater")

	resp, err := client.Do(req)
	if err != nil {
		showUpdateMsg(hwnd, "Update Error", "Failed to connect to GitHub: "+err.Error(), windows.MB_ICONERROR)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		showUpdateMsg(hwnd, "Update Error", "Unexpected server response: "+resp.Status, windows.MB_ICONERROR)
		return
	}

	var release GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		showUpdateMsg(hwnd, "Update Error", "Failed to read release information: "+err.Error(), windows.MB_ICONERROR)
		return
	}

	// 2. Version Comparison
	latestVer := strings.TrimPrefix(release.TagName, "v")
	currVer := strings.TrimPrefix(cozyssh.Version, "v")

	if !isNewerVersion(currVer, latestVer) {
		showUpdateMsg(hwnd, "Check Update", "You are up to date! Version "+cozyssh.Version+" is the latest release.", windows.MB_ICONINFORMATION)
		return
	}

	// 3. Prompt user for authorization
	confirmPrompt := fmt.Sprintf("A new update (%s) is available. Would you like to download and install it now?\n\nNote: The application will close automatically to complete installation.", release.TagName)
	if !showUpdateConfirm(hwnd, "Update Available", confirmPrompt) {
		return
	}

	i18nSuffix := ""
	if lang := t("$LANG"); lang != "" && lang != "$LANG" && lang != "en" {
		i18nSuffix = "_" + lang
	}

	// 4. Download targeted architecture zip file
	downloadURL := fmt.Sprintf("https://github.com/%s/releases/download/%s/cozyssh-app-%s-windows-%s%s.zip",
		GITHUB_REPO, release.TagName, release.TagName, runtime.GOARCH, i18nSuffix)

	dlResp, err := client.Get(downloadURL)
	if err != nil {
		showUpdateMsg(hwnd, "Download Error", "Failed to download package: "+err.Error(), windows.MB_ICONERROR)
		return
	}
	defer dlResp.Body.Close()

	if dlResp.StatusCode != http.StatusOK {
		showUpdateMsg(hwnd, "Download Error", "Download server responded with: "+dlResp.Status, windows.MB_ICONERROR)
		return
	}

	zipBuffer, err := io.ReadAll(dlResp.Body)
	if err != nil {
		showUpdateMsg(hwnd, "Download Error", "Failed to parse download payload: "+err.Error(), windows.MB_ICONERROR)
		return
	}

	// 5. Read ZIP from memory buffer to extract the new executable
	zipReader, err := zip.NewReader(bytes.NewReader(zipBuffer), int64(len(zipBuffer)))
	if err != nil {
		showUpdateMsg(hwnd, "Extraction Error", "Corrupted zip archive package: "+err.Error(), windows.MB_ICONERROR)
		return
	}

	var newExeBytes []byte
	for _, file := range zipReader.File {
		if strings.HasSuffix(strings.ToLower(file.Name), ".exe") {
			rc, err := file.Open()
			if err != nil {
				showUpdateMsg(hwnd, "Extraction Error", "Failed to access executable file inside zip: "+err.Error(), windows.MB_ICONERROR)
				return
			}
			newExeBytes, err = io.ReadAll(rc)
			rc.Close()
			if err != nil {
				showUpdateMsg(hwnd, "Extraction Error", "Failed to process binary content: "+err.Error(), windows.MB_ICONERROR)
				return
			}
			break
		}
	}

	if len(newExeBytes) == 0 {
		showUpdateMsg(hwnd, "Extraction Error", "Could not locate the executable file inside the update package.", windows.MB_ICONERROR)
		return
	}

	// 6. Handle Windows active binary swapping
	currentExePath, err := os.Executable()
	if err != nil {
		showUpdateMsg(hwnd, "Update Error", "Failed to verify current executable target path: "+err.Error(), windows.MB_ICONERROR)
		return
	}

	// Windows locks running files, but allows renaming them on the fly!
	oldBackupPath := currentExePath + ".old"
	_ = os.Remove(oldBackupPath) // Purge previous update garbage entries if any

	if err := os.Rename(currentExePath, oldBackupPath); err != nil {
		showUpdateMsg(hwnd, "Update Error", "Failed to decouple old binary descriptor. Ensure all other running instances are closed: "+err.Error(), windows.MB_ICONERROR)
		return
	}

	// Write new executable cleanly into the target path location
	if err := os.WriteFile(currentExePath, newExeBytes, 0755); err != nil {
		// Rollback safe rescue deployment if write fails
		_ = os.Rename(oldBackupPath, currentExePath)
		showUpdateMsg(hwnd, "Update Error", "Failed to deploy new program binary asset: "+err.Error(), windows.MB_ICONERROR)
		return
	}

	showUpdateMsg(hwnd, "Success", "Update successfully applied! Please restart CozySSH manually.", windows.MB_ICONINFORMATION)
	os.Exit(0)
}

// isNewerVersion returns true if latest version contains a higher numerical value than current
func isNewerVersion(current, latest string) bool {
	if current == "dev" {
		return false
	}
	cParts := strings.Split(current, ".")
	lParts := strings.Split(latest, ".")

	for i := 0; i < len(cParts) && i < len(lParts); i++ {
		cN, _ := strconv.Atoi(cParts[i])
		lN, _ := strconv.Atoi(lParts[i])
		if lN > cN {
			return true
		}
		if cN > lN {
			return false
		}
	}
	return len(lParts) > len(cParts)
}

func showUpdateMsg(hwnd uintptr, title, message string, flags uint32) {
	tPtr, _ := windows.UTF16PtrFromString(title)
	mPtr, _ := windows.UTF16PtrFromString(message)

	_, _ = windows.MessageBox(windows.HWND(hwnd), mPtr, tPtr, flags)
}

func showUpdateConfirm(hwnd uintptr, title, message string) bool {
	tPtr, _ := windows.UTF16PtrFromString(title)
	mPtr, _ := windows.UTF16PtrFromString(message)

	result, _ := windows.MessageBox(
		windows.HWND(hwnd),
		mPtr,
		tPtr,
		windows.MB_YESNO|windows.MB_ICONQUESTION,
	)

	return result == idYes
}
