//go:build !windows

package handlers

import "fmt"

func getSystemVolumeNative() (level int, muted bool, err error) {
	return 0, false, fmt.Errorf("system volume is only supported on Windows")
}

func setSystemVolumeNative(level int) error {
	_ = level
	return fmt.Errorf("system volume is only supported on Windows")
}

func playSoundNative(path string) error {
	_ = path
	return fmt.Errorf("play sound is only supported on Windows")
}

func stopSoundNative() error {
	return fmt.Errorf("stop sound is only supported on Windows")
}
