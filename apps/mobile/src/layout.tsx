import { type RemixiconComponentType, RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { AttentionDot } from "@thinkrail/ui/attention-dot";
import { IconButton } from "@thinkrail/ui/button";
import { RunningIcon } from "@thinkrail/ui/running-icon";
import type { ReactNode } from "react";
import type { ScopeStatus } from "./status";
import type { Loaded } from "./useHostRequest";

export function Screen({
	title,
	back,
	action,
	footer,
	children,
}: {
	title: string;
	back?: { label: string; onBack: () => void };
	action?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
}) {
	return (
		<main className="flex h-full flex-col pt-safe-top">
			<header className="flex min-h-touch items-center gap-4 border-b border-border-default bg-container-header-bg px-8 py-4">
				{back ? (
					<IconButton
						size="l"
						className="size-touch shrink-0"
						icon={RiArrowLeftSLine}
						label={back.label}
						onClick={back.onBack}
					/>
				) : null}
				<h1
					className={
						back
							? "m-0 min-w-0 flex-1 truncate text-center text-text-default tr-heading-sm"
							: "m-0 min-w-0 flex-1 truncate px-8 text-text-default tr-heading-lg"
					}
				>
					{title}
				</h1>
				{action ?? (back ? <span aria-hidden className="size-touch shrink-0" /> : null)}
			</header>
			<div className={footer ? "flex-1 overflow-y-auto" : "flex-1 overflow-y-auto pb-safe-bottom"}>
				{children}
			</div>
			{footer}
		</main>
	);
}

/** A tappable list row in the IDE project tree's vocabulary: identity glyph (the running badge while working), label, optional second line, attention dot. */
export function ListRow({
	icon: Icon,
	title,
	tooltip,
	detail,
	status,
	trailing,
	onOpen,
}: {
	icon: RemixiconComponentType;
	title: string;
	tooltip?: string | undefined;
	detail?: string | undefined;
	status: ScopeStatus;
	trailing?: string | undefined;
	onOpen: () => void;
}) {
	return (
		<li className="border-b border-border-muted">
			<button
				type="button"
				onClick={onOpen}
				title={tooltip}
				className="flex min-h-touch w-full items-center gap-12 border-0 bg-transparent px-16 py-12 text-left active:bg-control-bg-hovered"
			>
				{status.running ? (
					<RunningIcon className="size-20 text-primary" />
				) : (
					<Icon aria-hidden className="size-20 shrink-0 text-text-muted" />
				)}
				<span className="flex min-w-0 flex-1 flex-col gap-2">
					<span className="truncate text-text-default tr-title-card">{title}</span>
					{detail ? (
						<span className="truncate text-text-subtle tr-text-metadata">{detail}</span>
					) : null}
				</span>
				{status.attention ? <AttentionDot /> : null}
				{trailing ? (
					<span className="shrink-0 text-text-subtle tr-text-metadata">{trailing}</span>
				) : null}
				<RiArrowRightSLine aria-hidden className="size-20 shrink-0 text-text-subtle" />
			</button>
		</li>
	);
}

/** The loading / failed / empty states every list screen shares; renders `children` with the loaded rows. */
export function LoadedList<T>({
	loaded,
	empty,
	loading,
	children,
}: {
	loaded: Loaded<T[]>;
	empty: string;
	/** Replaces the full-screen loader, e.g. with a row inside the tree. */
	loading?: ReactNode;
	children: (rows: T[]) => ReactNode;
}) {
	const t = useT();
	if (loaded.kind === "loading") return loading ?? <Loader text={t("mobile.list.loading")} />;
	if (loaded.kind === "failed")
		return <Notice text={t("mobile.list.failed", { reason: loaded.reason })} alert />;
	if (loaded.value.length === 0) return <Notice text={empty} />;
	return <ul className="m-0 list-none p-0">{children(loaded.value)}</ul>;
}

/** The full-screen wait: the IDE's animated R mark, large, over a caption. */
export function Loader({ text }: { text: string }) {
	return (
		<div role="status" className="flex flex-col items-center gap-16 px-24 pt-64 pb-40 text-center">
			<RunningIcon className="size-56 text-primary" />
			<span className="text-text-muted tr-text-reading">{text}</span>
		</div>
	);
}

export function Notice({ text, alert = false }: { text: string; alert?: boolean }) {
	return (
		<p
			role={alert ? "alert" : undefined}
			className={
				alert
					? "m-0 px-24 py-40 text-center text-feedback-error tr-text-ui"
					: "m-0 px-24 py-40 text-center text-text-muted tr-text-reading"
			}
		>
			{text}
		</p>
	);
}
