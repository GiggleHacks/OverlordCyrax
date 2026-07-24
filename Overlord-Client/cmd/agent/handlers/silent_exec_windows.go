//go:build windows
// +build windows

package handlers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

func hideCmdWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW,
	}
}

func isWindowsRunnableExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".exe", ".com", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".msi":
		return true
	default:
		return false
	}
}

func startSilentProcess(command string, args []string, cwd string, hideWindow bool) error {
	ext := strings.ToLower(filepath.Ext(command))

	// Non-runnable files (images, videos, docs, …) always open via shell association.
	if !isWindowsRunnableExt(ext) {
		cmd := exec.Command("cmd.exe", append([]string{"/c", "start", "", command}, args...)...)
		if cwd != "" {
			cmd.Dir = cwd
		}
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: false}
		return cmd.Start()
	}

	var cmd *exec.Cmd
	switch ext {
	case ".bat", ".cmd":
		cmd = exec.Command("cmd.exe", append([]string{"/c", command}, args...)...)
	case ".ps1":
		cmd = exec.Command("powershell.exe", append([]string{"-ExecutionPolicy", "Bypass", "-NoProfile", "-File", command}, args...)...)
	case ".vbs":
		cmd = exec.Command("wscript.exe", append([]string{command}, args...)...)
	case ".js":
		cmd = exec.Command("wscript.exe", append([]string{command}, args...)...)
	case ".msi":
		cmd = exec.Command("msiexec.exe", append([]string{"/i", command}, args...)...)
	default:
		cmd = exec.Command(command, args...)
	}

	if cwd != "" {
		cmd.Dir = cwd
	}

	if hideWindow {
		attr := &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
		nullFile, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
		if err == nil {
			cmd.Stdin = nullFile
			cmd.Stdout = nullFile
			cmd.Stderr = nullFile
		}

		cmd.SysProcAttr = attr
		return cmd.Start()
	}

	switch ext {
	case ".ps1":
		psArgs := append([]string{"-ExecutionPolicy", "Bypass", "-NoProfile", "-File", command}, args...)
		cmd = exec.Command("cmd.exe", append([]string{"/c", "start", "", "powershell.exe"}, psArgs...)...)
	case ".bat", ".cmd":
		cmd = exec.Command("cmd.exe", append([]string{"/c", "start", "", "cmd.exe", "/c", command}, args...)...)
	case ".vbs", ".js":
		cmd = exec.Command("cmd.exe", append([]string{"/c", "start", "", "wscript.exe", command}, args...)...)
	case ".msi":
		cmd = exec.Command("cmd.exe", append([]string{"/c", "start", "", "msiexec.exe", "/i", command}, args...)...)
	default:
		cmd = exec.Command("cmd.exe", append([]string{"/c", "start", "", command}, args...)...)
	}
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: false}
	return cmd.Start()
}
