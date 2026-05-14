import { test } from "../fixtures";
import { openProject } from "../helpers/project";
import {
  startSessionConnectivityCheck,
  waitForSessionActivity,
} from "../helpers/session";

/**
 * Per-model smoke: each supported model id must accept a tiny prompt and
 * begin producing output without an SDK error banner.
 *
 * Uses a temp project (not the repo root). The previous version pinned
 * REPO_ROOT as a side check of the CWD bootstrap path, but the repo's
 * leftover session state slows agent startup unpredictably and produces
 * flaky failures. The connectivity check itself only cares about a fresh
 * project + new draft, so a temp dir is the right scope.
 */

// Cover the three "current" models the backend ships as its hardcoded
// fallback (`runtime/claude/models.py:_FALLBACK`). The picker is wired
// straight to the backend's `models/list`, so this set is what's
// guaranteed-renderable even if the live Anthropic API is unreachable.
const MODELS = [
  { label: "Opus 4.7" },
  { label: "Sonnet 4.6" },
  { label: "Haiku 4.5" },
] as const;

test.describe.configure({ mode: "serial" });

for (const model of MODELS) {
  test(`new session with ${model.label} starts without API error`, async ({
    page,
    tempProject,
  }) => {
    test.slow();
    await openProject(page, tempProject.path);

    // Use the DraftConfigCard's "Start Session" button — connectivity-only.
    // Pin the model by label so this works against both the dynamic Anthropic
    // model list (which uses dated ids) and the static fallback.
    await startSessionConnectivityCheck(page, { label: model.label });
    // waitForSessionActivity throws if an SDK error banner appears.
    await waitForSessionActivity(page);
  });
}
