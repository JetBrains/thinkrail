import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { basename } from "node:path";
import { seedArchivedSession } from "../helpers/archivedSession";
import { chatStream, projectPicker } from "../helpers/selectors";

const BACKEND_URL = process.env.THINKRAIL_BACKEND_URL ?? "http://localhost:8000";

const SID = "e2e-propose-pipeline";
const SDK_SESSION_ID = "sdk-propose-pipeline";

const pipelineNodes = [
  { id: "product-design", title: "Product design", skill: "ticket-product-design" },
  {
    id: "technical-design",
    title: "Technical design",
    skill: "ticket-technical-design",
    dependsOn: ["product-design"],
  },
  {
    id: "implementation",
    title: "Implementation",
    skill: "ticket-implement",
    executesPlan: true,
    dependsOn: ["technical-design"],
  },
];

async function openProjectWithSeededSession(page: Page, path: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL.replace(/\/$/, "")}/api/projects/known`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name: basename(path) }),
  });
  if (!res.ok) {
    throw new Error(`Failed to register known project ${path}: ${res.status} ${await res.text()}`);
  }

  await page.goto("/");
  const recent = page.locator(projectPicker.recentItem, { hasText: path });
  await expect(recent).toBeVisible({ timeout: 15_000 });
  await recent.first().click();
  await expect(page.locator(chatStream.toolCard, { hasText: "propose_pipeline" })).toBeVisible({
    timeout: 30_000,
  });
}

test("propose_pipeline renders a readable diagram instead of raw JSON", async ({
  page,
  tempProject,
}, testInfo) => {
  seedArchivedSession(tempProject.path, {
    thinkrailSid: SID,
    name: "Pipeline visual regression",
    skillId: "ticket-orchestrator",
    events: [
      {
        thinkrailSid: SID,
        sessionId: SDK_SESSION_ID,
        eventType: "sessionStart",
        payload: {
          sessionId: SDK_SESSION_ID,
          systemPrompt: "E2E restored session.",
        },
      },
      {
        thinkrailSid: SID,
        sessionId: SDK_SESSION_ID,
        eventType: "textDelta",
        payload: {
          text: "I will propose the ticket pipeline.",
        },
      },
      {
        thinkrailSid: SID,
        sessionId: SDK_SESSION_ID,
        eventType: "toolCallStart",
        payload: {
          toolUseId: "toolu-pipeline",
          toolName: "propose_pipeline",
          toolInput: { nodes: pipelineNodes },
        },
      },
      {
        thinkrailSid: SID,
        sessionId: SDK_SESSION_ID,
        eventType: "toolCallEnd",
        payload: {
          toolUseId: "toolu-pipeline",
          toolName: "propose_pipeline",
          output: "✓ applied proposePipeline",
          isError: false,
        },
      },
      {
        thinkrailSid: SID,
        sessionId: SDK_SESSION_ID,
        eventType: "done",
        payload: {
          result: "done",
          costUsd: 0,
          turns: 1,
          durationMs: 1,
        },
      },
    ],
  });

  await openProjectWithSeededSession(page, tempProject.path);

  const toolCard = page.locator(".chat-tool", { hasText: "propose_pipeline" });
  await expect(toolCard).toBeVisible({ timeout: 30_000 });
  await expect(toolCard.locator(".chat-tool-input")).toContainText(
    "3 stages: Product design -> Technical design -> Implementation",
  );

  await toolCard.locator(".chat-tool-header").click();

  await expect(toolCard.locator(".vis-card", { hasText: "Pipeline proposal" })).toBeVisible();
  await expect(toolCard.locator(".vis-mermaid-wrapper")).toBeVisible();
  await expect(toolCard.locator(".tool-input-pipeline-list")).toBeVisible();
  await expect(toolCard.locator(".tool-input-pipeline-row")).toHaveCount(3);
  await expect(toolCard.locator(".tool-input-pipeline-row", { hasText: "Implementation" })).toContainText(
    "after technical-design",
  );
  await expect(toolCard.locator(".tool-input-value--nested")).toHaveCount(0);

  await testInfo.attach("propose-pipeline-visualization", {
    body: await toolCard.screenshot(),
    contentType: "image/png",
  });
});
