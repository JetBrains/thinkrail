/**
 * Direct JSON-RPC helper for the app-scope `appSettings/*` methods.
 *
 * Bonsai's frontend talks to the backend over a WebSocket. Tests can
 * borrow that protocol to seed or read the user-scoped session-defaults
 * record without driving the UI — useful when you need a known
 * pre-condition before opening a project (e.g. to assert the new draft
 * picker reflects a non-default model).
 */

export interface SessionDefaults {
  model: string;
  permissionMode: string;
  effort: string;
  flags?: Record<string, boolean>;
}

const BACKEND_URL = process.env.BONSAI_BACKEND_URL ?? "http://localhost:8000";

function wsUrl(projectPath: string): string {
  const base = BACKEND_URL
    .replace(/^http:\/\//, "ws://")
    .replace(/^https:\/\//, "wss://")
    .replace(/\/$/, "");
  return `${base}/ws?project=${encodeURIComponent(projectPath)}`;
}

/** Open the WS, send one RPC, return the result. Closes on resolve/reject. */
async function callRpc<T = unknown>(
  projectPath: string,
  method: string,
  params: object = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(wsUrl(projectPath));
    const id = Math.floor(Math.random() * 1_000_000);
    let settled = false;

    const cleanup = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`appSettings RPC ${method} timed out after 10s`));
    }, 10_000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
    ws.addEventListener("message", (ev) => {
      if (settled) return;
      let msg: { id?: number; result?: T; error?: { message: string } };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      // The server also broadcasts notifications (no id) on the same WS —
      // ignore anything that isn't our reply.
      if (msg.id !== id) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result as T);
    });
    ws.addEventListener("error", (ev) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error(`appSettings WS error: ${String(ev)}`));
    });
  });
}

export async function seedSessionDefaults(
  projectPath: string,
  cfg: SessionDefaults,
): Promise<SessionDefaults> {
  return callRpc<SessionDefaults>(
    projectPath,
    "appSettings/setSessionDefaults",
    cfg,
  );
}

export async function getSessionDefaults(
  projectPath: string,
): Promise<SessionDefaults> {
  return callRpc<SessionDefaults>(
    projectPath,
    "appSettings/getSessionDefaults",
  );
}
