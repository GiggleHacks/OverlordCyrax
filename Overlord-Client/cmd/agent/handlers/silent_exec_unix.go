//go:build !windows
// +build !windows

package handlers

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func hideCmdWindow(_ *exec.Cmd) {}

func isUnixRunnableExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".sh", ".bash", ".py", ".pl", ".rb", ".bin", ".run", ".appimage":
		return true
	case "":
		return true
	default:
		return false
	}
}

func openWithDesktop(path string, args []string, cwd string) error {
	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		cmd = exec.Command("open", append([]string{path}, args...)...)
	} else {
		cmd = exec.Command("xdg-open", path)
	}
	if cwd != "" {
		cmd.Dir = cwd
	}
	nullFile, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err == nil {
		cmd.Stdin = nullFile
		cmd.Stdout = nullFile
		cmd.Stderr = nullFile
	}
	return cmd.Start()
}

func startSilentProcess(command string, args []string, cwd string, _ bool) error {
	ext := strings.ToLower(filepath.Ext(command))

	// Documents/media: open with desktop association.
	if !isUnixRunnableExt(ext) {
		return openWithDesktop(command, args, cwd)
	}

	var cmd *exec.Cmd
	if ext == ".sh" || ext == ".bash" {
		cmd = exec.Command("sh", append([]string{command}, args...)...)
	} else if ext == ".py" {
		cmd = exec.Command("python3", append([]string{command}, args...)...)
	} else {
		cmd = exec.Command(command, args...)
	}

	if cwd != "" {
		cmd.Dir = cwd
	}

	nullFile, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err == nil {
		cmd.Stdin = nullFile
		cmd.Stdout = nullFile
		cmd.Stderr = nullFile
	}

	if err := cmd.Start(); err != nil {
		// Fallback: try desktop open (e.g. missing interpreter / non-exec binary).
		return openWithDesktop(command, args, cwd)
	}
	return nil
}
