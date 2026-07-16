//go:build windows

package handlers

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modUser32            = windows.NewLazySystemDLL("user32.dll")
	modShell32Open       = windows.NewLazySystemDLL("shell32.dll")
	procMessageBoxW      = modUser32.NewProc("MessageBoxW")
	procShellExecuteOpen = modShell32Open.NewProc("ShellExecuteW")
)

const (
	mbOK              = 0x00000000
	mbIconError       = 0x00000010
	mbIconQuestion    = 0x00000020
	mbIconWarning     = 0x00000030
	mbIconInformation = 0x00000040
	swShowNormal      = 1
)

func messageBoxFlags(icon string) uint32 {
	switch icon {
	case "error":
		return mbOK | mbIconError
	case "warning":
		return mbOK | mbIconWarning
	case "question":
		return mbOK | mbIconQuestion
	default:
		return mbOK | mbIconInformation
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

func showMessageBoxNative(title, text, icon string) error {
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
