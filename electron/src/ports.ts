import { createServer, Server, Socket } from 'node:net';

const PORT_RANGE_START = 9100;
const PORT_RANGE_END = 9199;

export interface ReservedPort {
  port: number;
  release(): Promise<void>;
}

// Reserve a free port by holding the listening socket open. The caller MUST
// invoke release() immediately before spawning the backend; closing-then-
// spawning leaves a microsecond-wide race instead of the millisecond-wide
// window between port discovery and uvicorn's bind().
export async function reserveFreePort(
  start: number = PORT_RANGE_START,
  end: number = PORT_RANGE_END,
): Promise<ReservedPort> {
  for (let port = start; port <= end; port++) {
    const server = await tryListen(port);
    if (server) {
      return {
        port,
        release: () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      };
    }
  }
  throw new Error(`No free port in range ${start}-${end}`);
}

function tryListen(port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    const onError = () => {
      server.removeListener('listening', onListening);
      resolve(null);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: '127.0.0.1', port, exclusive: true });
  });
}

export function waitForPort(
  port: number,
  host: string = '127.0.0.1',
  timeoutMs: number = 30_000,
  intervalMs: number = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = new Socket();
      let settled = false;
      const onFail = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(tryConnect, intervalMs);
        }
      };
      socket.setTimeout(intervalMs);
      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve();
      });
      socket.once('error', onFail);
      socket.once('timeout', onFail);
      socket.connect(port, host);
    };
    tryConnect();
  });
}
