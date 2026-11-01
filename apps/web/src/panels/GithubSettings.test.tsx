import { expect, test } from "bun:test";
import { EN } from "@thinkrail/locales";
import { renderToStaticMarkup } from "react-dom/server";

import { GithubStatusView, githubProbe } from "./GithubSettings";

const notConnected = String(EN["settings.github.notConnected"]).slice(0, "Not connected".length);
const view = (props: Partial<Parameters<typeof GithubStatusView>[0]>) =>
	renderToStaticMarkup(
		<GithubStatusView
			status={null}
			checking={false}
			failed={false}
			onRefresh={() => {}}
			{...props}
		/>,
	);

test("an unanswered probe renders a checking skeleton, never Not connected", () => {
	const markup = view({ checking: true });
	expect(markup).toContain('data-testid="skeleton-rows"');
	expect(markup).toContain(`aria-label="${EN["settings.github.checking"]}"`);
	expect(markup).not.toContain(notConnected);
	expect(markup).not.toContain("data-connected");
});

test("a rejected probe with no answer says it could not check, not that gh is signed out", () => {
	const markup = view({ failed: true });
	expect(markup).toContain(String(EN["settings.github.checkFailed"]).replaceAll("'", "&#x27;"));
	expect(markup).toContain('data-testid="settings-gh-refresh"');
	expect(markup).not.toContain(notConnected);
	expect(markup).not.toContain("data-connected");
});

test("a known answer renders as itself while a probe runs or after one fails", () => {
	const connected = view({
		status: { connected: true, login: "octo" },
		checking: true,
		failed: true,
	});
	expect(connected).toContain('data-connected="true"');
	expect(connected).toContain("octo");
	expect(connected).not.toContain(notConnected);

	const signedOut = view({ status: { connected: false }, failed: true });
	expect(signedOut).toContain('data-connected="false"');
	expect(signedOut).toContain(notConnected);
});

test("a rejection keeps the last answer and marks the check failed", () => {
	const known = { status: { connected: true, login: "octo" }, failed: false, pending: null };
	const checking = githubProbe(known, { type: "start", id: 1 });
	expect(checking.status).toEqual({ connected: true, login: "octo" });

	const rejected = githubProbe(checking, { type: "reject", id: 1 });
	expect(rejected).toEqual({
		status: { connected: true, login: "octo" },
		failed: true,
		pending: null,
	});

	const answered = githubProbe(githubProbe(rejected, { type: "start", id: 2 }), {
		type: "answer",
		id: 2,
		status: { connected: false },
	});
	expect(answered).toEqual({ status: { connected: false }, failed: false, pending: null });
});

test("only the latest request settles the probe", () => {
	let probe = githubProbe({ status: null, failed: false, pending: null }, { type: "start", id: 1 });
	probe = githubProbe(probe, { type: "start", id: 2 });
	probe = githubProbe(probe, { type: "answer", id: 2, status: { connected: true } });
	probe = githubProbe(probe, { type: "answer", id: 1, status: { connected: false } });
	probe = githubProbe(probe, { type: "reject", id: 1 });
	expect(probe).toEqual({ status: { connected: true }, failed: false, pending: null });

	const stillChecking = githubProbe(githubProbe(probe, { type: "start", id: 3 }), {
		type: "answer",
		id: 2,
		status: { connected: false },
	});
	expect(stillChecking.pending).toBe(3);
});
