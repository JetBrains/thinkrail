import { useCallback, useEffect, useState } from "react";
import type { RegistryEntry, SpecDetail, SpecGraph } from "../types.ts";
import type { RpcError } from "../errors.ts";
import { createSpecApi } from "../methods/specs.ts";
import { useRpc } from "./useRpc.tsx";

export function useSpecs() {
  const client = useRpc();
  const [specs, setSpecs] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RpcError | null>(null);

  const fetch = useCallback(async () => {
    const api = createSpecApi(client);
    try {
      setLoading(true);
      const result = await api.list();
      setSpecs(result);
      setError(null);
    } catch (e) {
      setError(e as RpcError);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetch();
    const unsubs = [
      client.on("spec/didChange", () => fetch()),
      client.on("spec/didCreate", () => fetch()),
      client.on("spec/didDelete", () => fetch()),
      client.on("registry/didUpdate", () => fetch()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [client, fetch]);

  return { specs, loading, error, refetch: fetch };
}

export function useSpec(id: string | null) {
  const client = useRpc();
  const [spec, setSpec] = useState<SpecDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RpcError | null>(null);

  useEffect(() => {
    if (!id) {
      setSpec(null);
      return;
    }
    const api = createSpecApi(client);
    let cancelled = false;
    setLoading(true);
    api
      .get(id)
      .then((result) => {
        if (!cancelled) {
          setSpec(result);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e as RpcError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, id]);

  return { spec, loading, error };
}

export function useGraph() {
  const client = useRpc();
  const [graph, setGraph] = useState<SpecGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RpcError | null>(null);

  const fetch = useCallback(async () => {
    const api = createSpecApi(client);
    try {
      setLoading(true);
      const result = await api.graph();
      setGraph(result);
      setError(null);
    } catch (e) {
      setError(e as RpcError);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetch();
    const unsubs = [
      client.on("spec/didChange", () => fetch()),
      client.on("spec/didCreate", () => fetch()),
      client.on("spec/didDelete", () => fetch()),
      client.on("registry/didUpdate", () => fetch()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [client, fetch]);

  return { graph, loading, error, refetch: fetch };
}
