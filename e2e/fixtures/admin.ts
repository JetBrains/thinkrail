import { test as base } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

export type AdminUser = { id: string; token: string };

const BACKEND_DIR = resolve(__dirname, "..", "..", "backend");

function createAdminViaCli(id: string): string {
  const out = execFileSync(
    "uv",
    ["run", "python", "-m", "app.cli", "create-user", "--id", id, "--name", `E2E ${id}`, "--admin"],
    { cwd: BACKEND_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const m = out.match(/Token:\s*(bns_[A-Za-z0-9]+)/);
  if (!m) {
    throw new Error(`Could not parse token from CLI output:\n${out}`);
  }
  return m[1];
}

export const test = base.extend<{ admin: AdminUser }>({
  admin: async ({}, use) => {
    const id = `e2e_${randomBytes(4).toString("hex")}`;
    const token = createAdminViaCli(id);
    await use({ id, token });
  },
});

export { expect } from "@playwright/test";
