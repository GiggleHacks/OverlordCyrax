package handlers

import (
	"strings"
	"testing"

	"overlord-client/cmd/agent/config"
	agentRuntime "overlord-client/cmd/agent/runtime"
)

func TestSensitiveTransfersRejectPlaintextByDefault(t *testing.T) {
	env := &agentRuntime.Env{Cfg: config.Config{
		ServerURLs: []string{"ws://server.example.test:5173"},
	}}

	if _, err := resolveUploadPullURL(env, "/api/file/upload/pull/id"); err == nil ||
		!strings.Contains(err.Error(), "plaintext") {
		t.Fatalf("expected plaintext file transfer rejection, got %v", err)
	}
	if _, err := resolvePluginPullURL(env, "/api/plugins/pull/id"); err == nil ||
		!strings.Contains(err.Error(), "plaintext") {
		t.Fatalf("expected plaintext plugin transfer rejection, got %v", err)
	}
	if _, err := buildWhipURL(env, "/api/webrtc/whip"); err == nil ||
		!strings.Contains(err.Error(), "plaintext") {
		t.Fatalf("expected plaintext WebRTC signaling rejection, got %v", err)
	}
}

func TestSensitiveTransfersAllowExplicitDevelopmentOptOut(t *testing.T) {
	env := &agentRuntime.Env{Cfg: config.Config{
		ServerURLs:            []string{"ws://127.0.0.1:5173"},
		TLSInsecureSkipVerify: true,
	}}

	if resolved, err := resolveUploadPullURL(env, "/api/file/upload/pull/id"); err != nil ||
		!strings.HasPrefix(resolved, "http://") {
		t.Fatalf("expected explicit plaintext file transfer, got %q, %v", resolved, err)
	}
	if resolved, err := resolvePluginPullURL(env, "/api/plugins/pull/id"); err != nil ||
		!strings.HasPrefix(resolved, "http://") {
		t.Fatalf("expected explicit plaintext plugin transfer, got %q, %v", resolved, err)
	}
	if resolved, err := buildWhipURL(env, "/api/webrtc/whip"); err != nil ||
		!strings.HasPrefix(resolved, "http://") {
		t.Fatalf("expected explicit plaintext signaling, got %q, %v", resolved, err)
	}
}

func TestResolveUploadPullURL_RewritesHttpPullOriginOntoWSSAgent(t *testing.T) {
	env := &agentRuntime.Env{Cfg: config.Config{
		ServerURLs: []string{"wss://agent-live.example:5173"},
	}}

	// Absolute http pull origins must rewrite before plaintext rejection so the
	// agent still pulls via its live wss→https server.
	resolved, err := resolveUploadPullURL(env, "http://public.example/api/file/upload/pull/id?token=1")
	if err != nil {
		t.Fatalf("expected rewrite of http pull origin, got %v", err)
	}
	if resolved != "https://agent-live.example:5173/api/file/upload/pull/id?token=1" {
		t.Fatalf("unexpected resolved url: %q", resolved)
	}

	resolved, err = resolveUploadPullURL(env, "/api/file/upload/pull/id")
	if err != nil {
		t.Fatalf("expected relative pull rewrite, got %v", err)
	}
	if resolved != "https://agent-live.example:5173/api/file/upload/pull/id" {
		t.Fatalf("unexpected relative rewrite: %q", resolved)
	}
}

func TestResolveUploadPullURL_MissingHostIncludesRaw(t *testing.T) {
	env := &agentRuntime.Env{Cfg: config.Config{}}
	_, err := resolveUploadPullURL(env, "/not-a-pull-path")
	if err == nil || !strings.Contains(err.Error(), "invalid upload url") || !strings.Contains(err.Error(), "/not-a-pull-path") {
		t.Fatalf("expected detailed invalid upload url error, got %v", err)
	}
}
