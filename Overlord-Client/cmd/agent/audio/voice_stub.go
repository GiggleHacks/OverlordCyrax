//go:build !cgo

package audio

import (
	"context"
	"errors"
)

type Session struct{}

func ProbeCapabilities() Capabilities {
	return Capabilities{
		Available:     false,
		RequiresCGO:   true,
		Sources:       []string{"default"},
		DefaultSource: "default",
		Detail:        "native voice support requires a CGO-enabled build",
	}
}

func StartVoiceSession(_ context.Context, _ string, _ func([]byte)) (*Session, error) {
	return nil, errors.New("native voice support requires a CGO-enabled build")
}

func StartVoiceSessionWithQuality(_ context.Context, _ string, _ string, _ int, _ func([]byte)) (*Session, error) {
	return nil, errors.New("native voice support requires a CGO-enabled build")
}

func ResolveVoiceSampleRate(_ string, requested int) int {
	if requested == 8000 || requested == 16000 || requested == 24000 {
		return requested
	}
	return 16000
}

func (s *Session) SampleRate() int { return 16000 }

func (s *Session) Quality() string { return "balanced" }

func (s *Session) WritePlayback(_ []byte) error {
	return errors.New("voice session is unavailable")
}

func (s *Session) Close() error {
	return nil
}

func StartCaptureOnlySession(_ context.Context, _ string, _ func([]byte)) (*Session, error) {
	return nil, errors.New("native voice support requires a CGO-enabled build")
}
