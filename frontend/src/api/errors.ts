import type { JsonRpcError } from "@/types/rpc.ts";

export class RpcError extends Error {
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export class RpcTimeoutError extends RpcError {
  constructor(method: string) {
    super(-32000, `Request timeout: ${method}`);
    this.name = "RpcTimeoutError";
  }
}

export class RpcConnectionError extends RpcError {
  constructor() {
    super(-32001, "Not connected");
    this.name = "RpcConnectionError";
  }
}

const ERROR_MESSAGES: Record<number, string> = {
  [-32700]: "Protocol error: invalid JSON",
  [-32601]: "Unknown method",
  [-32602]: "Invalid request parameters",
  [-32603]: "Server error",
  [-32001]: "Spec not found",
  [-32002]: "Registry error",
  [-32003]: "Validation error",
  [-32011]: "Agent task not found",
  [-32012]: "No pending request",
};

export function toRpcError(err: JsonRpcError): RpcError {
  const message = ERROR_MESSAGES[err.code] ?? err.message;
  return new RpcError(err.code, message, err.data);
}
