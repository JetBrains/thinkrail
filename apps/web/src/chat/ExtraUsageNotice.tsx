import {
	RiCloseLine as Close,
	RiExternalLinkLine as ExternalLink,
	RiAlertLine as TriangleAlert,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

export const CLAUDE_USAGE_URL = "https://claude.ai/settings/usage";

const LINK =
	"inline-flex items-center gap-2 rounded-sm text-primary underline underline-offset-2 outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary";

function NoticeLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
			{children}
			<ExternalLink className="size-12 shrink-0" aria-hidden />
		</a>
	);
}

export function ExtraUsageNotice({
	context,
	onDismiss,
	onDisable,
	disabling = false,
	className,
}: {
	context: "chat" | "signIn";
	onDismiss?: () => void;
	onDisable?: () => void;
	disabling?: boolean;
	className?: string;
}) {
	const t = useT();
	const chat = context === "chat";
	return (
		<div
			role="note"
			data-testid="extra-usage-notice"
			data-context={context}
			className={cn(
				"flex items-start gap-8 rounded-sm border border-feedback-warning-muted bg-feedback-warning-subtle px-12 py-8 text-left",
				className,
			)}
		>
			<TriangleAlert className="mt-2 size-14 shrink-0 text-feedback-warning" aria-hidden />
			<div className="flex min-w-0 flex-1 flex-col gap-4 tr-text-ui text-text-default">
				<p>
					<strong className="tr-text-emphasis">
						{t(chat ? "chat.extraUsage.chatTitle" : "chat.extraUsage.signInTitle")}
					</strong>{" "}
					{t(chat ? "chat.extraUsage.chatBody" : "chat.extraUsage.signInBody")}
				</p>
				<div className="flex flex-wrap items-center gap-x-16 gap-y-4">
					<NoticeLink href={CLAUDE_USAGE_URL}>{t("chat.extraUsage.manage")}</NoticeLink>
					{onDisable ? (
						<button
							type="button"
							data-testid="extra-usage-disable"
							disabled={disabling}
							onClick={onDisable}
							className={cn(LINK, "disabled:opacity-50")}
						>
							{t("chat.extraUsage.disable")}
						</button>
					) : null}
				</div>
			</div>
			{onDismiss ? (
				<IconButton
					variant="ghost"
					size="s"
					icon={Close}
					label={t("common.dismiss")}
					data-testid="extra-usage-dismiss"
					onClick={onDismiss}
					className="shrink-0"
				/>
			) : null}
		</div>
	);
}
