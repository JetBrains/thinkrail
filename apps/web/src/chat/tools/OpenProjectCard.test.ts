import { describe, expect, it } from "bun:test";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";
import { EN } from "@thinkrail/locales";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ChatActions, ChatActionsContext } from "../ChatActions";
import {
	OpenProjectCard,
	openProjectSummary,
	readOpenedProject,
	readOpenProjectStage,
} from "./OpenProjectCard";

const OPENED = {
	projectId: "p-1",
	name: "fastify",
	slug: "fastify",
	path: "/home/me/thinkrail/fastify",
	outcome: "cloned",
};

const STAGE = {
	stage: "approval",
	url: "https://github.com/fastify/fastify.git",
	destination: "/home/me/thinkrail/fastify",
	notice: true,
};

function props(status: ToolRenderProps["status"], result: unknown): ToolRenderProps {
	return {
		toolCallId: "open-call",
		toolName: "open_project",
		args: { repository: "fastify/fastify" },
		result,
		status,
		streaming: false,
	};
}

function render(node: ReactNode, actions: Partial<ChatActions> | null = null): string {
	return renderToStaticMarkup(
		createElement(ChatActionsContext.Provider, { value: actions as ChatActions | null }, node),
	);
}

const text = (key: keyof typeof EN) => String(EN[key]);

describe("OpenProjectCard", () => {
	it("reads the opened project and the running stage defensively", () => {
		expect(readOpenedProject({ details: { ...OPENED, notice: true } })).toEqual({
			projectId: "p-1",
			name: "fastify",
			path: "/home/me/thinkrail/fastify",
			outcome: "cloned",
			notice: true,
		});
		expect(readOpenedProject({ details: { ...OPENED, outcome: "other" } })).toBeNull();
		expect(readOpenedProject({ details: STAGE })).toBeNull();
		expect(readOpenProjectStage({ details: STAGE })?.stage).toBe("approval");
		expect(readOpenProjectStage({ details: { ...STAGE, destination: 3 } })).toBeNull();
		expect(readOpenProjectStage("text")).toBeNull();
	});

	it("summarizes by the requested repository", () => {
		expect(openProjectSummary(props("done", undefined))).toBe("fastify/fastify");
	});

	it("while waiting for approval it names the destination and links the folder setting", () => {
		const markup = render(createElement(OpenProjectCard, props("running", { details: STAGE })), {
			openWorkspacesSettings: () => {},
		});
		expect(markup).toContain('data-stage="approval"');
		expect(markup).toContain("/home/me/thinkrail/fastify");
		expect(markup).toContain(text("tools.openProject.defaultFolder"));
		expect(markup).toContain('data-testid="open-project-change-folder"');
	});

	it("after a clone it shows the project; the notice only when the host marked it", () => {
		const cloned = render(
			createElement(OpenProjectCard, props("done", { details: { ...OPENED, notice: true } })),
			{ openWorkspacesSettings: () => {} },
		);
		expect(cloned).toContain('data-testid="open-project-name"');
		expect(cloned).toContain("Cloned into /home/me/thinkrail/fastify");
		expect(cloned).toContain('data-testid="open-project-change-folder"');

		const known = render(
			createElement(OpenProjectCard, props("done", { details: { ...OPENED, outcome: "open" } })),
			{ openWorkspacesSettings: () => {} },
		);
		expect(known).toContain("Already open at /home/me/thinkrail/fastify");
		expect(known).not.toContain("open-project-notice");
	});

	it("without a settings action the notice stays as text, and an error shows the reason", () => {
		const bare = render(createElement(OpenProjectCard, props("running", { details: STAGE })));
		expect(bare).toContain(text("tools.openProject.defaultFolder"));
		expect(bare).not.toContain("open-project-change-folder");
		const failed = render(
			createElement(
				OpenProjectCard,
				props("error", { content: [{ type: "text", text: "nothing was cloned" }] }),
			),
		);
		expect(failed).toContain("nothing was cloned");
	});
});
