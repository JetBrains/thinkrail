// The release identity baked into the `thinkrail` bin. Run-from-source keeps the `-dev` default; the
// release workflow (.github/workflows) overwrites this file in its throwaway CI checkout before
// `build:binary`, stamping the computed version/channel/commit into the compiled binary — the Bun-native
// analogue of the old repo's generated `_version.py`. Surfaced via `thinkrail --version` and, threaded
// through `bootHost` → `createServer`, in the `server.welcome` push so a client can report host version.

export const version = "0.0.0-dev";
export const channel = "dev";
export const commit = "";
