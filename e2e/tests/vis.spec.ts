import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { buildSpec, seedProject } from "../helpers/specs";
import { visTab } from "../helpers/selectors";

/**
 * Visualization dashboard smoke. The dashboard is pinned via the right-panel
 * chart icon and surfaces the `vis/state` + `vis/recompute` RPCs. We exercise
 * the toggle, render, and recompute path here.
 */

test.describe("Visualization dashboard", () => {
  test("toggles the dashboard pin and renders coverage", async ({
    page,
    tempProject,
  }) => {
    // Seed a single spec so the vis service has something non-empty to compute
    // (a totally empty project still produces a valid dashboard, but the
    // assertions are easier to read with a real entry).
    seedProject(tempProject.path, [
      {
        relPath: "specs/sample.md",
        content: buildSpec({
          id: "sample",
          type: "module-design",
          status: "active",
          title: "Sample Module",
          body: "# Sample\n",
        }),
      },
    ]);

    // To prove the refresh click actually drove a *successful* `vis/recompute`
    // round-trip we have to defend against four backend behaviors:
    //
    //   1. A background `vis_service.refresh()` runs on every WS connect
    //      (`backend/app/rpc/server.py`), so `_state.computed_at` may already
    //      be populated by the time we click — a plain "non-empty" assertion
    //      is a false positive.
    //   2. `vis/state` is served straight from `_state` *without* awaiting the
    //      background refresh, so the response can carry the default
    //      `computed_at=""`. That means tracking only `vis/state` responses
    //      can leave `priorComputedAt` empty, and a strict-greater check
    //      against `""` is satisfied by *any* non-empty timestamp.
    //   3. `VisualizationService.recompute()` swallows exceptions and returns
    //      the cached `_state` unchanged on failure
    //      (`backend/app/vis/service.py`). So a broken recompute can return
    //      success with a stale `computed_at` from the background refresh
    //      that completed in between.
    //   4. The connect-time background refresh runs concurrently with the
    //      dispatch loop. If it completes *after* `clickTimeMs` is captured
    //      but before a broken recompute's response, `_state.computed_at`
    //      becomes a value > `clickTimeMs` even though the click's recompute
    //      itself swallowed an exception — defeating the wall-clock guard.
    //
    // To close all four gaps we:
    //
    //   - Drive an explicit *warmup* `vis/recompute` (via a first refresh-
    //     button click) and wait until we observe a frame with a non-empty
    //     `computed_at`. This forces a deterministic `_compute()` call so
    //     the cache is populated and the background refresh has had time to
    //     flush, eliminating gap (4)'s race window before the armed click.
    //   - Pin the armed click against a wall-clock baseline (`clickTimeMs`,
    //     captured immediately before the second click) — `_compute()`
    //     stamps `computed_at = datetime.now(UTC)` *during* the request, so
    //     a healthy recompute always returns a timestamp strictly after
    //     `clickTimeMs`. A swallowed-exception recompute returns the cached
    //     warmup timestamp, which is strictly *before* `clickTimeMs`.
    //   - Retain the `priorComputedAt` strict-greater check as a secondary
    //     guard for the (now negligible) case of two recomputes colliding
    //     on the same millisecond.
    let armed = false;
    let pendingRecomputeId: number | string | null = null;
    let priorComputedAt: string = "";
    let resolveAck: (computedAt: string) => void = () => {};
    let rejectAck: (err: Error) => void = () => {};
    let resolveBaseline: () => void = () => {};
    const recomputeAck = new Promise<string>((resolve, reject) => {
      resolveAck = resolve;
      rejectAck = reject;
    });
    const baselineReady = new Promise<void>((resolve) => {
      resolveBaseline = resolve;
    });
    const decode = (payload: string | Buffer): string =>
      typeof payload === "string" ? payload : payload.toString("utf8");
    const onSent = (data: { payload: string | Buffer }) => {
      if (!armed || pendingRecomputeId !== null) return;
      const text = decode(data.payload);
      if (!text.includes('"vis/recompute"')) return;
      let msg: { id?: number | string; method?: string };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.method !== "vis/recompute" || msg.id === undefined) return;
      pendingRecomputeId = msg.id;
    };
    const onReceived = (data: { payload: string | Buffer }) => {
      const text = decode(data.payload);
      // Cheap pre-filter: every dashboard payload carries `computed_at`.
      // Skip the filter once a recompute is in flight — a JSON-RPC error
      // response for the armed `vis/recompute` carries `error` instead of
      // `result.computed_at`, and we need the error branch below to reach
      // it (otherwise the test hangs to its 30s timeout and swallows the
      // real backend message).
      const hasPendingRecompute = pendingRecomputeId !== null;
      if (!hasPendingRecompute && !text.includes('"computed_at"')) return;
      let msg: {
        id?: number | string;
        method?: string;
        result?: { computed_at?: unknown };
        params?: { computed_at?: unknown };
        error?: { message?: string };
      };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      // Pre-arm: track the latest `computed_at` from any vis dashboard
      // payload (vis/state reply, vis/stateChanged push). We freeze
      // tracking once armed because `recompute()` publishes
      // `vis/stateChanged` BEFORE returning the response — both frames
      // carry the same new computed_at, and we don't want the push to
      // poison the strict-greater check on the response.
      const isAwaitedRecompute =
        pendingRecomputeId !== null && msg.id === pendingRecomputeId;
      if (!isAwaitedRecompute) {
        if (!armed) {
          const ca = msg.result?.computed_at ?? msg.params?.computed_at;
          // Only count NON-EMPTY computed_at as a valid baseline. The
          // initial vis/state response can carry computed_at="" if the
          // connect-time background refresh hasn't flushed yet, and a
          // strict-greater check against "" would be satisfied by any
          // later string. Resolving baselineReady gates the armed click
          // until we've observed at least one completed _compute().
          if (typeof ca === "string" && ca !== "" && ca > priorComputedAt) {
            priorComputedAt = ca;
            resolveBaseline();
          }
        }
        return;
      }

      if (msg.error) {
        rejectAck(
          new Error(
            `vis/recompute failed: ${msg.error.message ?? JSON.stringify(msg.error)}`,
          ),
        );
        return;
      }
      const computedAt = msg.result?.computed_at;
      if (typeof computedAt !== "string" || computedAt === "") {
        rejectAck(
          new Error(
            `vis/recompute response missing computed_at: ${text.slice(0, 200)}`,
          ),
        );
        return;
      }
      // Strictly newer than every prior observation. ISO-8601 with
      // microsecond precision sorts lexicographically.
      if (computedAt <= priorComputedAt) {
        rejectAck(
          new Error(
            `vis/recompute returned a non-advancing computed_at: ` +
              `prior=${priorComputedAt} got=${computedAt} ` +
              `(backend likely swallowed an exception and returned cached state)`,
          ),
        );
        return;
      }
      resolveAck(computedAt);
    };
    page.on("websocket", (ws) => {
      ws.on("framesent", onSent);
      ws.on("framereceived", onReceived);
    });

    await openProject(page, tempProject.path);

    // The dashboard opens as a modal from the header Dashboard button; it
    // hosts the same VisTab.
    await page.locator("button.header-dashboard-btn").click();
    const dashModal = page.locator(".dashboard-modal");
    await expect(dashModal).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".dashboard-modal__title")).toContainText("Dashboard");

    // Wait specifically for the LOADED summary (not the transient empty
    // state) before arming. VisTab renders empty → loading → loaded as
    // its initial fetchState() resolves, and the empty-state "Compute
    // now" button shares the `vis-tab-refresh-btn` class with the
    // loaded-state refresh button. Waiting on `summary` proves dashboard
    // is non-null, which means fetchState already resolved and the click
    // path will fire `vis/recompute` (not the empty-state path).
    const summary = page.locator(visTab.pct);
    const empty = page.locator(visTab.empty);
    await expect(summary).toBeVisible({ timeout: 30_000 });

    // Refresh button in the loaded-state header (VisTab.tsx).
    const refreshBtn = page.locator(visTab.refreshBtn).first();
    await expect(refreshBtn).toBeVisible({ timeout: 30_000 });

    // Warmup click: drive an explicit `vis/recompute` to establish a
    // known-fresh `priorComputedAt` baseline. Without this the connect-time
    // background `refresh()` can complete *after* clickTimeMs is captured,
    // letting a broken recompute return cached `_state` whose computed_at
    // happens to be > clickTimeMs (silent-pass). The warmup forces a
    // deterministic _compute() and flushes any pending background refresh
    // before we arm.
    await refreshBtn.click();
    await Promise.race([
      baselineReady,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "warmup vis/recompute never produced a non-empty computed_at within 30s",
              ),
            ),
          30_000,
        ),
      ),
    ]);
    // Wait for the warmup's loading state to clear so the next click is
    // not swallowed by `disabled={loading}` on the button.
    await expect(refreshBtn).toBeEnabled({ timeout: 10_000 });

    // Arm the WS frame listeners: from this point forward, the next
    // outgoing `vis/recompute` request id is captured, and the matching
    // response (by id) resolves `recomputeAck`.
    armed = true;

    // Wall-clock baseline captured immediately before the click. The
    // backend stamps `computed_at = datetime.now(UTC)` inside the
    // recompute path, so any successful response must carry a timestamp
    // strictly after this. A swallowed-exception recompute returns the
    // cached warmup state stamped *before* the click, which fails the
    // check.
    const clickTimeMs = Date.now();
    await refreshBtn.click();
    // Wait for the response that carries the click's request id AND a
    // `computed_at` strictly newer than any previously observed value
    // (including the startup `vis/state` reply and any background-refresh
    // `vis/stateChanged` push). This rules out the silent-failure path
    // where `recompute()` swallows an exception and returns cached state.
    const newComputedAt = await Promise.race([
      recomputeAck,
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                pendingRecomputeId === null
                  ? "vis/recompute request never sent within 30s of click"
                  : `vis/recompute response (id=${String(pendingRecomputeId)}) not received within 30s`,
              ),
            ),
          30_000,
        ),
      ),
    ]);
    expect(typeof newComputedAt).toBe("string");
    expect(newComputedAt.length).toBeGreaterThan(0);
    // Wall-clock guard: the response's `computed_at` must be strictly
    // after the moment we issued the click. This catches the case where
    // `priorComputedAt` was empty (background refresh had not flushed
    // through to a `vis/state` response yet) and `recompute()` silently
    // swallowed an exception, returning a cached state stamped earlier.
    const newTimeMs = new Date(newComputedAt).getTime();
    if (Number.isNaN(newTimeMs)) {
      throw new Error(
        `vis/recompute returned an unparseable computed_at: ${newComputedAt}`,
      );
    }
    expect(newTimeMs).toBeGreaterThan(clickTimeMs);
    // Dashboard should still be rendered after recompute.
    await expect(summary.or(empty)).toBeVisible({ timeout: 30_000 });

    // Closing the modal dismisses the dashboard.
    await page.locator(".dashboard-modal__close").click();
    await expect(dashModal).toHaveCount(0);
  });
});
