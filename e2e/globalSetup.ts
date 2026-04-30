import type { FullConfig } from "@playwright/test";

const BACKEND_URL = process.env.BONSAI_BACKEND_URL ?? "http://localhost:8000";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // The backend exposes /api/server-info without auth. Use it as a liveness probe.
  const url = `${BACKEND_URL.replace(/\/$/, "")}/api/server-info`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `e2e globalSetup: cannot reach backend at ${url} — start the project with ./run.sh first.\n` +
        `Underlying error: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `e2e globalSetup: backend at ${url} responded ${res.status} — expected 200.`,
    );
  }
}
