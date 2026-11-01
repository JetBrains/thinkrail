import { RiAddLine, RiArrowRightSLine } from "@remixicon/react";
import { isSessionWorking } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { RemoteSessionItem } from "@thinkrail/remote-client";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import type { OpenSession } from "./SessionScreen";

type Status = "needsInput" | "working" | "idle";

const statusOf = (item: RemoteSessionItem): Status =>
	item.record.state.needsInput
		? "needsInput"
		: isSessionWorking(item.record.state)
			? "working"
			: "idle";

const STATUS_DOT: Record<Status, string> = {
	needsInput: "bg-feedback-warning",
	working: "bg-primary animate-pulse motion-reduce:animate-none",
	idle: "bg-text-disabled",
};

export function SessionList({
	items,
	unreachable,
	onOpen,
	adding,
	onAdd,
	pairForm,
}: {
	items: RemoteSessionItem[];
	unreachable: string[];
	onOpen: (session: OpenSession) => void;
	adding: boolean;
	onAdd: () => void;
	pairForm: ReactNode;
}) {
	const t = useT();
	const statusLabel: Record<Status, string> = {
		needsInput: t("mobile.sessions.needsInput"),
		working: t("mobile.sessions.working"),
		idle: t("mobile.sessions.idle"),
	};

	return (
		<main className="flex h-full flex-col pt-safe-top">
			<header className="flex items-center justify-between gap-12 border-b border-border-default bg-container-header-bg px-16 py-8">
				<h1 className="m-0 text-text-default tr-heading-lg">{t("mobile.sessions.title")}</h1>
				{adding ? null : (
					<Button
						variant="soft-primary"
						className="h-touch rounded-md"
						iconLeft={RiAddLine}
						onClick={onAdd}
					>
						{t("mobile.sessions.addHost")}
					</Button>
				)}
			</header>

			<div className="flex-1 overflow-y-auto pb-safe-bottom">
				{unreachable.map((host) => (
					<p
						key={host}
						role="status"
						className="m-0 border-b border-feedback-warning-muted bg-feedback-warning-subtle px-16 py-12 text-feedback-warning tr-text-metadata"
					>
						{t("mobile.sessions.unreachable", { host })}
					</p>
				))}
				{adding ? (
					<section className="border-b border-border-default bg-container-elevated-bg px-16 py-16">
						<p className="mt-0 mb-12 text-text-muted tr-text-ui">{t("mobile.sessions.addHint")}</p>
						{pairForm}
					</section>
				) : null}

				{items.length === 0 ? (
					<p className="m-0 px-24 py-40 text-center text-text-muted tr-text-reading">
						{t("mobile.sessions.empty")}
					</p>
				) : (
					<ul className="m-0 list-none p-0">
						{items.map((item) => {
							const status = statusOf(item);
							return (
								<li
									key={`${item.hostKey}:${item.record.sessionId}`}
									className="border-b border-border-muted"
								>
									<button
										type="button"
										onClick={() =>
											onOpen({
												hostKey: item.hostKey,
												sessionId: item.record.sessionId,
												workspaceId: item.record.workspaceId,
												title: item.record.firstPrompt ?? "",
											})
										}
										className="flex min-h-touch w-full items-center gap-12 border-0 bg-transparent px-16 py-12 text-left active:bg-control-bg-hovered"
									>
										<span
											aria-hidden
											className={cn("size-8 shrink-0 rounded-full", STATUS_DOT[status])}
										/>
										<span className="flex min-w-0 flex-1 flex-col gap-4">
											<span className="truncate text-text-default tr-title-card">
												{item.record.firstPrompt ?? t("mobile.sessions.untitled")}
											</span>
											<span className="truncate text-text-muted tr-text-metadata">
												{t("mobile.sessions.meta", {
													host: item.hostLabel,
													status: statusLabel[status],
												})}
											</span>
										</span>
										<RiArrowRightSLine aria-hidden className="size-20 shrink-0 text-text-subtle" />
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</main>
	);
}
