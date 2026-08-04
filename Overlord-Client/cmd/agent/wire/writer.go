package wire

import (
	"context"

	"github.com/vmihailenco/msgpack/v5"
	"nhooyr.io/websocket"
)

type Writer interface {
	Write(ctx context.Context, messageType websocket.MessageType, p []byte) error
}

type ControlWriter interface {
	WriteControl(ctx context.Context, messageType websocket.MessageType, p []byte) error
}

func WriteMsg(ctx context.Context, w Writer, v interface{}) error {
	//garble:controlflow block_splits=10 junk_jumps=10 flatten_passes=2
	payload, err := msgpack.Marshal(v)
	if err != nil {
		return err
	}
	return w.Write(ctx, websocket.MessageBinary, payload)
}

// WriteControlMsg sends a small control message with priority when the writer supports it.
func WriteControlMsg(ctx context.Context, w Writer, v interface{}) error {
	payload, err := msgpack.Marshal(v)
	if err != nil {
		return err
	}
	if cw, ok := w.(ControlWriter); ok {
		return cw.WriteControl(ctx, websocket.MessageBinary, payload)
	}
	return w.Write(ctx, websocket.MessageBinary, payload)
}
