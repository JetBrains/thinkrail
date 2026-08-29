import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SubagentStopButton } from "./SubagentTranscriptDialog";

describe("SubagentStopButton", () => {
	test("absent unless the run is live", () => {
		expect(
			renderToStaticMarkup(<SubagentStopButton live={false} stopping={false} onStop={() => {}} />),
		).toBe("");
	});

	test("a live run offers an enabled Stop action", () => {
		const markup = renderToStaticMarkup(
			<SubagentStopButton live stopping={false} onStop={() => {}} />,
		);
		expect(markup).toContain('data-testid="subagent-stop"');
		expect(markup).toContain("Stop");
		expect(markup).not.toContain('disabled=""');
	});

	test("an in-flight abort disables the control", () => {
		const markup = renderToStaticMarkup(<SubagentStopButton live stopping onStop={() => {}} />);
		expect(markup).toContain('disabled=""');
		expect(markup).toContain("Stopping…");
	});
});
