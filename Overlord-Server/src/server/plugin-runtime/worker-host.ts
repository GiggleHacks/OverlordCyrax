import { Database } from "bun:sqlite";
import path from "path";
import { pathToFileURL } from "url";
import type { WorkerInbound, WorkerOutbound } from "./types";

declare const self: {
  postMessage: (msg: WorkerOutbound) => void;
  onmessage: ((e: MessageEvent<WorkerInbound>) => void) | null;
};

type PluginExports = {
  setup?: (ctx: PluginContext) => unknown | Promise<unknown>;
  onEvent?: (ctx: PluginContext, clientId: string, event: string, payload: unknown) => unknown | Promise<unknown>;
  rpc?: Record<string, (ctx: PluginContext, params: unknown, meta: { caller: { id: number; role: string } }) => unknown | Promise<unknown>>;
  teardown?: (ctx: PluginContext) => unknown | Promise<unknown>;
};

type PluginContext = {
  pluginId: string;
  db: Database;
  dataDir: string;
  log: {
    debug: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
  broadcast: (channel: string, data: unknown) => void;
};

let plugin: PluginExports | null = null;
let db: Database | null = null;
let ctx: PluginContext | null = null;
let pluginId = "";

function send(msg: WorkerOutbound) {
  self.postMessage(msg);
}

function makeLogger(): PluginContext["log"] {
  return {
    debug: (m) => send({ type: "log", level: "debug", message: m }),
    info: (m) => send({ type: "log", level: "info", message: m }),
    warn: (m) => send({ type: "log", level: "warn", message: m }),
    error: (m) => send({ type: "log", level: "error", message: m }),
  };
}

self.onmessage = async (e: MessageEvent<WorkerInbound>) => {
  const msg = e.data;

  if (msg.type === "boot") {
    try {
      pluginId = msg.pluginId;
      db = new Database(msg.dbPath, { create: true });
      try {
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("PRAGMA synchronous = NORMAL");
        db.exec("PRAGMA foreign_keys = ON");
      } catch {}

      const dataDir = path.join(msg.pluginRoot, msg.pluginId, "data");
      ctx = {
        pluginId,
        db,
        dataDir,
        log: makeLogger(),
        broadcast: (channel, data) => send({ type: "broadcast", channel, data }),
      };

      const moduleUrl = `${pathToFileURL(msg.serverScript).href}?v=${Date.now()}`;
      const mod = await import(/* @vite-ignore */ moduleUrl);
      plugin = (mod.default || mod) as PluginExports;

      if (typeof plugin.setup === "function") {
        await plugin.setup(ctx);
      }

      send({ type: "ready" });
    } catch (err) {
      const error = err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err);
      send({ type: "boot_error", error });
    }
    return;
  }

  if (msg.type === "event") {
    if (!plugin || !ctx) return;
    if (typeof plugin.onEvent !== "function") return;
    try {
      await plugin.onEvent(ctx, msg.clientId, msg.event, msg.payload);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      send({ type: "log", level: "error", message: `onEvent(${msg.event}) failed: ${error}` });
    }
    return;
  }

  if (msg.type === "rpc") {
    if (!plugin || !ctx) {
      send({ type: "rpc_reply", id: msg.id, ok: false, error: "Plugin not initialised" });
      return;
    }
    const handler = plugin.rpc?.[msg.method];
    if (typeof handler !== "function") {
      send({ type: "rpc_reply", id: msg.id, ok: false, error: `Unknown RPC method: ${msg.method}` });
      return;
    }
    try {
      const result = await handler(ctx, msg.params, { caller: msg.caller });
      send({ type: "rpc_reply", id: msg.id, ok: true, result: result ?? null });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      send({ type: "rpc_reply", id: msg.id, ok: false, error });
    }
    return;
  }

  if (msg.type === "shutdown") {
    if (plugin && ctx && typeof plugin.teardown === "function") {
      try {
        await plugin.teardown(ctx);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        send({ type: "log", level: "warn", message: `teardown failed: ${error}` });
      }
    }
    try { db?.close(); } catch {}
    db = null;
    plugin = null;
    ctx = null;
    return;
  }
};
