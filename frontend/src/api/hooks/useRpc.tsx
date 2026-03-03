import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RpcClient, type RpcClientOptions } from "../client.ts";
import type { ConnectionState } from "../types.ts";

const RpcContext = createContext<RpcClient | null>(null);

export function useRpc(): RpcClient {
  const client = useContext(RpcContext);
  if (!client) {
    throw new Error("useRpc must be used within a RpcProvider");
  }
  return client;
}

export function useConnectionState(): ConnectionState {
  const client = useRpc();
  const [state, setState] = useState<ConnectionState>(client.state);

  useEffect(() => {
    setState(client.state);
    return client.onStateChange(setState);
  }, [client]);

  return state;
}

export function RpcProvider({
  url,
  options,
  children,
}: {
  url: string;
  options?: Partial<RpcClientOptions>;
  children: ReactNode;
}) {
  // Create client once (survives StrictMode double-mount)
  const clientRef = useRef<RpcClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new RpcClient(url, options);
  }

  useEffect(() => {
    const client = clientRef.current!;
    // Only connect if not already connected (handles StrictMode re-mount)
    if (client.state === "disconnected" || client.state === "failed") {
      client.connect().catch(() => {
        // Connection failures handled by state machine (reconnect)
      });
    }
    // Don't disconnect on cleanup — the client is shared via ref and
    // survives StrictMode unmount/remount cycles.
    // Disconnect only on actual page unload.
  }, []);

  return (
    <RpcContext.Provider value={clientRef.current}>
      {children}
    </RpcContext.Provider>
  );
}
