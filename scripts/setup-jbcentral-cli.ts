#!/usr/bin/env bun
// Thin wrapper — the real logic lives in the CLI (`apps/cli/src/jbcentral.ts`) so it ships inside the
// compiled `thinkrail` binary and works on any device (mac/linux/windows) with no preinstalled bun:
//     thinkrail jbcentral            # wire anthropic + openai at the proxy
//     thinkrail jbcentral --remove   # undo
//
// This wrapper keeps `bun run setup-jbcentral-cli [--remove]` working for run-from-source dev.

import { runJbcentral } from "../apps/cli/src/jbcentral";

process.exit(await runJbcentral(process.argv.slice(2), process.env));
