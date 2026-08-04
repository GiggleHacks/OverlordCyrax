package handlers

import (
	"context"
	"log"
	"overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
	"time"
)

func HandlePing(ctx context.Context, env *runtime.Env, envelope map[string]interface{}) error {

	ts, ok := extractTimestampIfPresent(envelope["ts"])
	if !ok {
		ts = time.Now().UnixMilli()
	}
	env.SetLastPong(time.Now().UnixMilli())

	pong := wire.Pong{Type: "pong", TS: ts}
	// Send inline on the control-priority path so RTT is not inflated by media frames.
	if err := wire.WriteControlMsg(ctx, env.Conn, pong); err != nil {
		log.Printf("ping: failed to send pong: %v", err)
		return err
	}
	return nil
}
