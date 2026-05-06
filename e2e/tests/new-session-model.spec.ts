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

// Only models present in the static FALLBACK list are reliably testable —
// the dynamic Anthropic-API list is fetched lazily and on a fresh page
// boot may not arrive before the test selects the option. Opus 4.7 lives
// only in the dynamic list, so it's intentionally not covered here.
const MODELS = [
  { label: "Opus 4.6" },
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
