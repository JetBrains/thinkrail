import { expect, test } from "bun:test";
import type { SpecGraphNode, WorkspaceArtifactsSnapshot } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { artifactsWatermark, selectArtifactsUnseen } from "../store";
import { artifactRows, artifactTimeLabel, mentionText } from "./artifactsModel";

const snapshot: WorkspaceArtifactsSnapshot = {
	workspaceId: "w1",
	dir: ".thinkrail/context",
	artifacts: [
		{
			path: ".thinkrail/context/mockups/a.html",
			state: "live",
			size: 1,
			changedAt: 30,
			firstSeenAt: 30,
			sessionId: "s1",
		},
		{
			path: ".thinkrail/context/TASK-x.md",
			state: "deleted",
			size: 1,
			changedAt: 20,
			firstSeenAt: 10,
			sessionId: "s2",
		},
		{ path: ".thinkrail/context/notes.md", state: "live", size: 1, changedAt: 5, firstSeenAt: 5 },
	],
	outputs: [
		{
			path: "test-results",
			kind: "dir",
			files: 3,
			filesTruncated: false,
			changedAt: 40,
			sessionId: "s1",
		},
	],
};

const spec = (path: string, status?: string): SpecGraphNode => ({
	id: path,
	type: "task-spec",
	title: path,
	path,
	dependsOn: [],
	references: [],
	implements: [],
	tags: [],
	...(status ? { status } : {}),
});

test("rows carry the name, the folder inside the artifacts folder and a task-spec's status", () => {
	const rows = artifactRows(snapshot, {
		sessionId: null,
		highlightSince: 25,
		showIgnored: true,
		specs: [spec(".thinkrail/context/TASK-x.md", "done")],
	});
	expect(
		rows.artifacts.map(({ name, folder, taskSpecStatus, fresh }) => ({
			name,
			folder,
			taskSpecStatus,
			fresh,
		})),
	).toEqual([
		{ name: "a.html", folder: "mockups", taskSpecStatus: null, fresh: true },
		{ name: "TASK-x.md", folder: "", taskSpecStatus: "done", fresh: false },
		{ name: "notes.md", folder: "", taskSpecStatus: null, fresh: false },
	]);
	expect(rows.outputs?.map((row) => [row.output.path, row.fresh])).toEqual([
		["test-results", true],
	]);
});

test("the chat filter keeps that chat's rows and the toggle hides ignored outputs", () => {
	const rows = artifactRows(snapshot, {
		sessionId: "s2",
		highlightSince: 0,
		showIgnored: false,
		specs: undefined,
	});
	expect(rows.artifacts.map((row) => row.name)).toEqual(["TASK-x.md"]);
	expect(rows.outputs).toBeNull();
	expect(rows.otherChats).toBe(2);
	expect(
		artifactRows(snapshot, {
			sessionId: "s1",
			highlightSince: 0,
			showIgnored: true,
			specs: undefined,
		}).otherChats,
	).toBe(2);
	expect(
		artifactRows(snapshot, {
			sessionId: null,
			highlightSince: 0,
			showIgnored: true,
			specs: undefined,
		}).otherChats,
	).toBe(0);
	expect(
		artifactRows(
			{ ...snapshot, outputs: null },
			{
				sessionId: null,
				highlightSince: 0,
				showIgnored: true,
				specs: undefined,
			},
		).outputs,
	).toBeNull();
});

test("the watermark is the newest arrival, and only something newer than what was seen is unseen", () => {
	expect(artifactsWatermark(snapshot)).toBe(40);
	const state = (seen: number | undefined) => ({
		artifactsByWorkspace: { w1: snapshot },
		artifactsSeenByWorkspace: seen === undefined ? {} : { w1: seen },
	});
	expect(selectArtifactsUnseen(state(40), "w1")).toBe(false);
	expect(selectArtifactsUnseen(state(39), "w1")).toBe(true);
	expect(selectArtifactsUnseen(state(undefined), "w2")).toBe(false);
});

test("a mention is the composer's own @path form", () => {
	expect(mentionText(".thinkrail/context/a.md")).toBe("@.thinkrail/context/a.md ");
});

test("a row's change time reads as a localized date and time", () => {
	const label = artifactTimeLabel(currentTranslator(), Date.UTC(2026, 10, 13, 14, 32));
	expect(label).toStartWith("Changed ");
	expect(label).toContain("2026");
});
