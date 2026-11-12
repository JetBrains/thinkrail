import {
	RiCheckboxCircleFill as ApproveIcon,
	RiErrorWarningFill as ChangesIcon,
} from "@remixicon/react";
import { isPlanReviewResult, type PlanReviewResult } from "@thinkrail/contracts";
import { resultText, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import type { ReactNode } from "react";
import { ReviewPackageComments } from "../ReviewPackageComments";
import { reviewFixCommentsToItems } from "../reviewPackage";

export function readPlanReview(raw: unknown): PlanReviewResult | null {
	if (
		raw &&
		typeof raw === "object" &&
		isPlanReviewResult((raw as { details?: unknown }).details)
	) {
		return (raw as { details: PlanReviewResult }).details;
	}
	return isPlanReviewResult(raw) ? raw : null;
}

export function requestReviewSummary({ result }: ToolRenderProps, t: Translator): string {
	const review = readPlanReview(result);
	if (!review) return "";
	if (review.verdict === "approve") {
		const open = review.blockedByOpenFindings ?? 0;
		return open > 0
			? t("tools.requestReview.summaryApprovedOpen", { title: review.itemTitle, open })
			: t("tools.requestReview.summaryApproved", { title: review.itemTitle });
	}
	return t("tools.requestReview.summaryChanges", {
		title: review.itemTitle,
		count: review.findings.length,
	});
}

export function RequestReviewCard({ toolCallId, result, status }: ToolRenderProps): ReactNode {
	const t = useT();
	const review = readPlanReview(result);
	if (!review) {
		if (status === "running") {
			return <span className="tr-text-ui text-text-muted">{t("tools.requestReview.running")}</span>;
		}
		const failure = status === "error" ? resultText(result) : "";
		return failure ? (
			<pre
				data-testid="request-review-error"
				className="overflow-auto px-8 py-4 text-feedback-error tr-code-text"
			>
				{failure}
			</pre>
		) : (
			<span className="tr-text-ui text-text-muted">{t("tools.requestReview.noVerdict")}</span>
		);
	}
	const blocked = review.blockedByOpenFindings ?? 0;
	const approved = review.verdict === "approve" && blocked === 0;
	const items = reviewFixCommentsToItems(review.findings);
	return (
		<div data-testid="request-review-card" data-verdict={review.verdict} className="tr-text-ui">
			<div className="flex items-start gap-4">
				{approved ? (
					<ApproveIcon className="mt-2 size-16 shrink-0 text-feedback-success" />
				) : (
					<ChangesIcon className="mt-2 size-16 shrink-0 text-feedback-warning" />
				)}
				<div className="min-w-0 flex-1">
					<span data-testid="request-review-verdict" className="block text-text-default">
						{review.verdict === "approve"
							? t("tools.requestReview.approved")
							: t("tools.requestReview.changesRequested")}
						<span className="text-text-muted">
							{t("tools.requestReview.itemTitle", { title: review.itemTitle })}
						</span>
						{blocked > 0 ? (
							<span data-testid="request-review-blocked" className="text-feedback-warning">
								{" "}
								{t("tools.requestReview.blocked", { count: blocked })}
							</span>
						) : null}
					</span>
					{review.summary ? (
						<p className="mt-4 whitespace-pre-wrap text-text-muted">{review.summary}</p>
					) : null}
				</div>
			</div>
			<ReviewPackageComments foldPrefix={toolCallId} items={items} />
		</div>
	);
}
