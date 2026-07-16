package handlers

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"strings"

	"overlord-client/cmd/agent/runtime"
)

const (
	maxOpenURLLength      = 2048
	maxMessageBoxTitleLen = 256
	maxMessageBoxTextLen  = 2048
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
	if !strings.Contains(value, "://") {
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

	// Acknowledge immediately; modal display can block until the user clicks OK.
	sendCommandResultSafe(env, cmdID, true, "")
	goSafe("message_box", env.Cancel, func() {
		if err := showMessageBoxNative(title, text, icon); err != nil {
			log.Printf("message_box: display failed: %v", err)
		}
	})
	return nil
}
