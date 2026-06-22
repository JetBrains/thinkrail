#!/usr/bin/env bun
// The `thinkrail-pi` bin: boots the engine host in-process and opens the browser.
// Real bootstrap (resolveShellEnv → createServer → open browser → signals) lands at M14; M0 stub.

import { createServer } from "@thinkrail-pi/server";

createServer();
