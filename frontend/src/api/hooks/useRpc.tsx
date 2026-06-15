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

// Exported so tests/stories can provide a mock client without a live WebSocket.
export const RpcContext = createContext<RpcClient | null>(null);

export function useRpc(): RpcClient {
  const client = useContext(RpcContext);
  if (!client) {
    throw new Error("useRpc must be used within a RpcProvider");
  }
  return client;
}

/** Like {@link useRpc} but returns null instead of throwing when there is no
 *  provider — for components that may render before a project/RPC exists
 *  (e.g. the pre-navigation new-project form). */
export function useRpcOptional(): RpcClient | null {
  return useContext(RpcContext);
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

    // Defer connect to a macrotask so StrictMode's synchronous
    // unmount→remount cycle completes before any WebSocket is created.
    // The cleanup cancels the timer if the component unmounts first.
    const timer = setTimeout(() => {
      if (client.state === "disconnected" || client.state === "failed") {
        client.connect().catch(() => {
          // Connection failures handled by state machine (reconnect)
        });
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      client.disconnect();
    };
  }, []);

  return (
    <RpcContext.Provider value={clientRef.current}>
      {children}
    </RpcContext.Provider>
  );
}
