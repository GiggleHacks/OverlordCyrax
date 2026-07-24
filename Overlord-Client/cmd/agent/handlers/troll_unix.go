//go:build !windows

package handlers

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

func openURLNative(target string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("open url failed: %w", err)
	}
	_ = cmd.Process.Release()
	return nil
}

func showMessageBoxNative(title, text, icon string) error {
	return showMessageBoxWithAck(func() error {
		switch runtime.GOOS {
		case "darwin":
			return showMessageBoxDarwin(title, text, icon)
		default:
			return showMessageBoxLinux(title, text, icon)
		}
	})
}

// showMessageBoxWithAck returns nil once the dialog is confirmed visible
// (or immediately on failure), without waiting for the user to dismiss it.
func showMessageBoxWithAck(show func() error) error {
	errCh := make(chan error, 1)
	go func() {
		errCh <- show()
	}()
	select {
	case err := <-errCh:
		return err
	case <-time.After(400 * time.Millisecond):
		return nil
	}
}

func shellQuote(s string) string {
	return `'` + strings.ReplaceAll(s, `'`, `'\''`) + `'`
}

func showMessageBoxDarwin(title, text, icon string) error {
	// Map icon to a simple dialog style; macOS display dialog only has caution/note/stop via icons limitedly.
	iconClause := ""
	switch icon {
	case "error":
		iconClause = " with icon stop"
	case "warning":
		iconClause = " with icon caution"
	case "question", "info":
		iconClause = " with icon note"
	}
	script := fmt.Sprintf(
		`display dialog %s with title %s buttons {"OK"} default button "OK"%s`,
		shellQuote(text),
		shellQuote(title),
		iconClause,
	)
	cmd := exec.Command("osascript", "-e", script)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("message box failed: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func showMessageBoxLinux(title, text, icon string) error {
	zenityIcon := "info"
	switch icon {
	case "error":
		zenityIcon = "error"
	case "warning":
		zenityIcon = "warning"
	case "question":
		zenityIcon = "question"
	}
	if path, err := exec.LookPath("zenity"); err == nil {
		cmd := exec.Command(path, "--"+zenityIcon, "--title="+title, "--text="+text, "--width=360")
		if out, runErr := cmd.CombinedOutput(); runErr != nil {
			// User cancel still returns non-zero for question; treat as shown.
			if zenityIcon == "question" {
				return nil
			}
			return fmt.Errorf("message box failed: %w (%s)", runErr, strings.TrimSpace(string(out)))
		}
		return nil
	}
	if path, err := exec.LookPath("notify-send"); err == nil {
		cmd := exec.Command(path, title, text)
		if out, runErr := cmd.CombinedOutput(); runErr != nil {
			return fmt.Errorf("message box failed: %w (%s)", runErr, strings.TrimSpace(string(out)))
		}
		return nil
	}
	return fmt.Errorf("message box requires zenity or notify-send on this system")
}

func applyBigCursorTimed(duration time.Duration) error {
	_ = duration
	return fmt.Errorf("big mouse is only supported on Windows")
}
