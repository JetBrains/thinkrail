import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackSettings } from "./FeedbackSettings";
import { INTERVIEW_BOOKING_URL, INTERVIEW_INVITATION_COPY } from "./interview";

test("renders the approved feedback copy and external booking anchor", () => {
	const markup = renderToStaticMarkup(<FeedbackSettings />);

	expect(markup).toContain(INTERVIEW_INVITATION_COPY);
	expect(markup).toContain(`href="${INTERVIEW_BOOKING_URL}"`);
	expect(markup).toContain('target="_blank"');
	expect(markup).toContain('rel="noopener noreferrer"');
	expect(markup).toContain("Schedule an interview");
});
