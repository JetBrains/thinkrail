import { test } from "@playwright/test";
import { endAllSessions, workflowTest } from "./harness";
import { HOST_GUIDE_SCENARIOS } from "./hostGuideScenarios";

test.afterAll(() => endAllSessions());

for (const scenario of HOST_GUIDE_SCENARIOS) {
	workflowTest(scenario);
}
