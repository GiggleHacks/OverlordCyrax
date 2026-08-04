package wire

import (
	"context"
	"sync/atomic"
	"time"

	"nhooyr.io/websocket"
)

const (
	writeTimeout        = 30 * time.Second
	controlWriteTimeout = 5 * time.Second
)

type SafeWriter struct {
	sem           chan struct{}
	controlSem    chan struct{}
	w             Writer
	mediaWaiting  atomic.Int32
	controlQueued atomic.Int32
}

func NewSafeWriter(w Writer) *SafeWriter {
	sem := make(chan struct{}, 1)
	sem <- struct{}{}
	controlSem := make(chan struct{}, 1)
	controlSem <- struct{}{}
	return &SafeWriter{sem: sem, controlSem: controlSem, w: w}
}

func (s *SafeWriter) Write(ctx context.Context, messageType websocket.MessageType, p []byte) error {
	s.mediaWaiting.Add(1)
	defer s.mediaWaiting.Add(-1)

	// Yield to pending control writes before taking the media lock.
	for s.controlQueued.Load() > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Millisecond):
		}
		if s.controlQueued.Load() == 0 {
			break
		}
	}

	select {
	case <-s.sem:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { s.sem <- struct{}{} }()

	// If control arrived while we waited, let it go first.
	for s.controlQueued.Load() > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Millisecond):
		}
		if s.controlQueued.Load() == 0 {
			break
		}
	}

	writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return s.w.Write(writeCtx, messageType, p)
}

// WriteControl sends a small control message with priority over media frames.
func (s *SafeWriter) WriteControl(ctx context.Context, messageType websocket.MessageType, p []byte) error {
	s.controlQueued.Add(1)
	defer s.controlQueued.Add(-1)

	select {
	case <-s.controlSem:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { s.controlSem <- struct{}{} }()

	select {
	case <-s.sem:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { s.sem <- struct{}{} }()

	writeCtx, cancel := context.WithTimeout(ctx, controlWriteTimeout)
	defer cancel()
	return s.w.Write(writeCtx, messageType, p)
}
