//go:build windows

package handlers

import (
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	modUser32            = windows.NewLazySystemDLL("user32.dll")
	modShell32Open       = windows.NewLazySystemDLL("shell32.dll")
	procMessageBoxW      = modUser32.NewProc("MessageBoxW")
	procShellExecuteOpen = modShell32Open.NewProc("ShellExecuteW")
	procSystemParametersInfoW = modUser32.NewProc("SystemParametersInfoW")
)

const (
	mbOK              = 0x00000000
	mbIconError       = 0x00000010
	mbIconQuestion    = 0x00000020
	mbIconWarning     = 0x00000030
	mbIconInformation = 0x00000040
	mbSystemModal     = 0x00001000
	mbSetForeground   = 0x00010000
	mbTopmost         = 0x00040000
	swShowNormal      = 1

	spiSetCursors   = 0x0057
	spifUpdateIni   = 0x0001
	spifSendChange  = 0x0002
	cursorBaseSizeMax = 256
	cursorBaseSizeDefault = 32
	cursorCursorsKey = `Control Panel\Cursors`
	cursorBaseSizeValue = "CursorBaseSize"
)

var (
	cursorBigMu       sync.Mutex
	cursorBigGen      uint64
	cursorBigOriginal *uint32
)

func messageBoxFlags(icon string) uint32 {
	var flags uint32 = mbOK | mbSystemModal | mbSetForeground | mbTopmost
	switch icon {
	case "error":
		return flags | mbIconError
	case "warning":
		return flags | mbIconWarning
	case "question":
		return flags | mbIconQuestion
	default:
		return flags | mbIconInformation
	}
}

func openURLNative(target string) error {
	verb, err := windows.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	r1, _, callErr := procShellExecuteOpen.Call(
		0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		0,
		0,
		uintptr(swShowNormal),
	)
	// ShellExecute returns value > 32 on success.
	if r1 <= 32 {
		if callErr != nil && callErr != syscall.Errno(0) {
			return fmt.Errorf("open url failed: %w", callErr)
		}
		return fmt.Errorf("open url failed: code %d", r1)
	}
	return nil
}

func showMessageBoxWinAPI(title, text, icon string) error {
	if err := procMessageBoxW.Find(); err != nil {
		return fmt.Errorf("message box api unavailable: %w", err)
	}
	textPtr, err := windows.UTF16PtrFromString(text)
	if err != nil {
		return err
	}
	titlePtr, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return err
	}
	r1, _, callErr := procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(textPtr)),
		uintptr(unsafe.Pointer(titlePtr)),
		uintptr(messageBoxFlags(icon)),
	)
	if r1 == 0 {
		if callErr != nil && callErr != syscall.Errno(0) {
			return fmt.Errorf("message box failed: %w", callErr)
		}
		return fmt.Errorf("message box failed")
	}
	return nil
}

func psSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func messageBoxIconPS(icon string) string {
	switch icon {
	case "error":
		return "Error"
	case "warning":
		return "Warning"
	case "question":
		return "Question"
	default:
		return "Information"
	}
}

func showMessageBoxPowerShell(title, text, icon string) error {
	script := fmt.Sprintf(
		"Add-Type -AssemblyName System.Windows.Forms; "+
			"[void][System.Windows.Forms.MessageBox]::Show(%s,%s,"+
			"[System.Windows.Forms.MessageBoxButtons]::OK,"+
			"[System.Windows.Forms.MessageBoxIcon]::%s,"+
			"[System.Windows.Forms.MessageBoxDefaultButton]::Button1,"+
			"[System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly)",
		psSingleQuote(text),
		psSingleQuote(title),
		messageBoxIconPS(icon),
	)
	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-WindowStyle", "Hidden",
		"-Command", script,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if out, err := cmd.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return fmt.Errorf("message box failed: %w", err)
		}
		return fmt.Errorf("message box failed: %w (%s)", err, msg)
	}
	return nil
}

// showMessageBoxNative displays a topmost message box. It returns nil once the
// dialog is confirmed visible (or immediately on failure), without waiting for
// the user to dismiss it so the agent can report status promptly.
func showMessageBoxNative(title, text, icon string) error {
	return showMessageBoxWithAck(func() error {
		if err := showMessageBoxWinAPI(title, text, icon); err == nil {
			return nil
		}
		return showMessageBoxPowerShell(title, text, icon)
	})
}

func showMessageBoxWithAck(show func() error) error {
	errCh := make(chan error, 1)
	go func() {
		errCh <- show()
	}()
	select {
	case err := <-errCh:
		// Closed immediately: either failed to open, or user dismissed instantly.
		return err
	case <-time.After(400 * time.Millisecond):
		// Still open after a short delay → successfully displayed.
		return nil
	}
}

func readCursorBaseSize() (uint32, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, cursorCursorsKey, registry.QUERY_VALUE)
	if err != nil {
		if err == registry.ErrNotExist {
			return cursorBaseSizeDefault, nil
		}
		return 0, err
	}
	defer k.Close()
	val, _, err := k.GetIntegerValue(cursorBaseSizeValue)
	if err != nil {
		if err == registry.ErrNotExist {
			return cursorBaseSizeDefault, nil
		}
		return 0, err
	}
	if val == 0 {
		return cursorBaseSizeDefault, nil
	}
	return uint32(val), nil
}

func writeCursorBaseSize(size uint32) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, cursorCursorsKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetDWordValue(cursorBaseSizeValue, size)
}

func applyCursorScheme() error {
	if err := procSystemParametersInfoW.Find(); err != nil {
		return fmt.Errorf("SystemParametersInfo unavailable: %w", err)
	}
	r1, _, callErr := procSystemParametersInfoW.Call(
		uintptr(spiSetCursors),
		0,
		0,
		uintptr(spifUpdateIni|spifSendChange),
	)
	if r1 == 0 {
		if callErr != nil && callErr != syscall.Errno(0) {
			return fmt.Errorf("reload cursors failed: %w", callErr)
		}
		return fmt.Errorf("reload cursors failed")
	}
	return nil
}

func setCursorBaseSize(size uint32) error {
	if err := writeCursorBaseSize(size); err != nil {
		return fmt.Errorf("set cursor size failed: %w", err)
	}
	if err := applyCursorScheme(); err != nil {
		return err
	}
	return nil
}

// applyBigCursorTimed sets the accessibility cursor size to max and restores
// the previous size after duration. Returns once applied (restore is async).
func applyBigCursorTimed(duration time.Duration) error {
	if duration < time.Duration(cursorBigMinSec)*time.Second {
		duration = time.Duration(cursorBigDefaultSec) * time.Second
	}

	cursorBigMu.Lock()
	defer cursorBigMu.Unlock()

	if cursorBigOriginal == nil {
		prev, err := readCursorBaseSize()
		if err != nil {
			return err
		}
		// If already huge from a prior interrupted run, fall back to default restore.
		if prev >= cursorBaseSizeMax {
			prev = cursorBaseSizeDefault
		}
		cursorBigOriginal = &prev
	}

	if err := setCursorBaseSize(cursorBaseSizeMax); err != nil {
		return err
	}

	cursorBigGen++
	gen := cursorBigGen
	restoreTo := *cursorBigOriginal
	go func() {
		time.Sleep(duration)
		cursorBigMu.Lock()
		defer cursorBigMu.Unlock()
		if gen != cursorBigGen {
			return
		}
		_ = setCursorBaseSize(restoreTo)
		cursorBigOriginal = nil
	}()
	return nil
}
