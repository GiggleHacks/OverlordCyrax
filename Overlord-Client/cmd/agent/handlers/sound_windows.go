//go:build windows

package handlers

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modWinmm         = windows.NewLazySystemDLL("winmm.dll")
	procMciSendStringW = modWinmm.NewProc("mciSendStringW")
)

const soundMCIAlias = "overlord_soundboard"

var (
	soundPlayMu sync.Mutex
)

func mciSend(command string) error {
	if err := procMciSendStringW.Find(); err != nil {
		return fmt.Errorf("mci unavailable: %w", err)
	}
	cmdPtr, err := windows.UTF16PtrFromString(command)
	if err != nil {
		return err
	}
	var buf [256]uint16
	r1, _, callErr := procMciSendStringW.Call(
		uintptr(unsafe.Pointer(cmdPtr)),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		0,
	)
	if r1 != 0 {
		msg := windows.UTF16ToString(buf[:])
		if msg == "" && callErr != nil && callErr != syscall.Errno(0) {
			return fmt.Errorf("mci error %d: %w", r1, callErr)
		}
		if msg == "" {
			return fmt.Errorf("mci error %d", r1)
		}
		return fmt.Errorf("mci error %d: %s", r1, msg)
	}
	return nil
}

func stopSoundNative() error {
	soundPlayMu.Lock()
	defer soundPlayMu.Unlock()
	_ = mciSend("stop " + soundMCIAlias)
	_ = mciSend("close " + soundMCIAlias)
	return nil
}

func playSoundNative(path string) error {
	cleaned := filepath.Clean(path)
	info, err := os.Stat(cleaned)
	if err != nil || info.IsDir() {
		return fmt.Errorf("sound file not found")
	}
	ext := strings.ToLower(filepath.Ext(cleaned))
	if ext != ".mp3" && ext != ".wav" {
		return fmt.Errorf("unsupported sound format")
	}

	soundPlayMu.Lock()
	defer soundPlayMu.Unlock()
	_ = mciSend("stop " + soundMCIAlias)
	_ = mciSend("close " + soundMCIAlias)

	// Escape quotes in path for MCI command string.
	escaped := strings.ReplaceAll(cleaned, `"`, `\"`)
	openCmd := fmt.Sprintf(`open "%s" type mpegvideo alias %s`, escaped, soundMCIAlias)
	if err := mciSend(openCmd); err != nil {
		// WAV sometimes prefers waveaudio.
		if ext == ".wav" {
			openCmd = fmt.Sprintf(`open "%s" type waveaudio alias %s`, escaped, soundMCIAlias)
			if err2 := mciSend(openCmd); err2 != nil {
				return err
			}
		} else {
			return err
		}
	}
	if err := mciSend("play " + soundMCIAlias); err != nil {
		_ = mciSend("close " + soundMCIAlias)
		return err
	}
	return nil
}

func getSystemVolumeNative() (level int, muted bool, err error) {
	out, runErr := runVolumePowerShell(`
$r = [Audio]::Get()
Write-Output ("level=" + $r.Item1)
Write-Output ("muted=" + $r.Item2.ToString().ToLower())
`)
	if runErr != nil {
		return 0, false, runErr
	}
	level = -1
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "level=") {
			n, parseErr := strconv.Atoi(strings.TrimPrefix(line, "level="))
			if parseErr == nil {
				level = n
			}
		}
		if strings.HasPrefix(line, "muted=") {
			muted = strings.TrimPrefix(line, "muted=") == "true"
		}
	}
	if level < 0 {
		return 0, false, fmt.Errorf("failed to read system volume")
	}
	if level > 100 {
		level = 100
	}
	return level, muted, nil
}

func setSystemVolumeNative(level int) error {
	if level < 0 {
		level = 0
	}
	if level > 100 {
		level = 100
	}
	_, err := runVolumePowerShell(fmt.Sprintf(`[Audio]::Set(%d)`, level))
	return err
}

func runVolumePowerShell(body string) (string, error) {
	script := audioVolumeTypeDef + "\n" + body
	cmd := exec.Command("powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-Command", script,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		if text == "" {
			return "", fmt.Errorf("volume control failed: %w", err)
		}
		return "", fmt.Errorf("volume control failed: %s", text)
	}
	return text, nil
}

// Core Audio endpoint volume helper (default render device).
const audioVolumeTypeDef = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class Audio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  private class MMDeviceEnumeratorComObject { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  }

  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IAudioEndpointVolume {
    int NotImpl1();
    int NotImpl2();
    [PreserveSig] int GetChannelCount(out uint pnChannelCount);
    [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    [PreserveSig] int GetMute(out bool pbMute);
  }

  private static IAudioEndpointVolume GetVolume() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0 /*eRender*/, 1 /*eMultimedia*/, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 1 /*CLSCTX_INPROC_SERVER*/, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }

  public static Tuple<int,bool> Get() {
    var vol = GetVolume();
    float scalar;
    bool muted;
    Marshal.ThrowExceptionForHR(vol.GetMasterVolumeLevelScalar(out scalar));
    Marshal.ThrowExceptionForHR(vol.GetMute(out muted));
    int level = (int)Math.Round(scalar * 100.0);
    if (level < 0) level = 0;
    if (level > 100) level = 100;
    return Tuple.Create(level, muted);
  }

  public static void Set(int level) {
    if (level < 0) level = 0;
    if (level > 100) level = 100;
    var vol = GetVolume();
    Guid g = Guid.Empty;
    Marshal.ThrowExceptionForHR(vol.SetMasterVolumeLevelScalar(level / 100f, g));
    Marshal.ThrowExceptionForHR(vol.SetMute(false, g));
  }
}
"@ -ErrorAction Stop
`
