import {
	RiLoader4Line as Loader,
	RiRobot2Line as Robot,
	RiSearchEyeLine as SearchEye,
} from "@remixicon/react";
import type { PrBabysitSessionState } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import {
	prBabysitCounts,
	selectPrBabysit,
	selectPrBabysitSupported,
	toast,
	useAppStore,
} from "../../store";
import { getTransport } from "../../transport";
import { PrBabysitDrawer } from "./PrBabysitDrawer";
import { chipClass, splitFrameClass, splitPartClass } from "./Segment";

type Pending = "toggle" | "review" | null;

/** The topbar's "Babysit PR" toggle + one-click "Review PR", and the counts pill that opens the drawer. */
export function BabysitControl({
	workspaceId,
	prNumber,
}: {
	workspaceId: string;
	prNumber: number;
}) {
	const t = useT();
	const supported = useAppStore(selectPrBabysitSupported);
	const generation = useAppStore((s) => s.connectionGeneration);
	const session = useAppStore((s) => selectPrBabysit(s, workspaceId));
	const [pending, setPending] = useState<Pending>(null);
	const [drawerOpen, setDrawerOpen] = useState(false);

	useEffect(() => {
		if (!supported) return;
		let cancelled = false;
		getTransport()
			.request("prBabysit.get", { workspaceId })
			.then(
				(state) => {
					if (!cancelled) useAppStore.getState().installPrBabysitState(workspaceId, state);
				},
				() => {},
			);
		return () => {
			cancelled = true;
		};
	}, [supported, generation, workspaceId]);

	if (!supported) return null;

	const active = session?.active === true;
	const counts = prBabysitCounts(session);
	const install = (state: PrBabysitSessionState | null) =>
		useAppStore.getState().installPrBabysitState(workspaceId, state);

	const toggle = () => {
		setPending("toggle");
		const call = active
			? getTransport().request("prBabysit.stop", { workspaceId })
			: getTransport().request("prBabysit.start", { workspaceId });
		call
			.then(install, () =>
				toast.error(active ? t("prBabysit.topbar.stopFailed") : t("prBabysit.topbar.startFailed")),
			)
			.finally(() => setPending(null));
	};

	const review = () => {
		setPending("review");
		const run = async () => {
			if (!active) install(await getTransport().request("prBabysit.start", { workspaceId }));
			install(await getTransport().request("prBabysit.review", { workspaceId }));
		};
		run()
			.catch(() => toast.error(t("prBabysit.topbar.reviewFailed")))
			.finally(() => setPending(null));
	};

	const tone = active ? "primary" : "neutral";
	return (
		<>
			<span data-testid="pr-babysit-control" data-active={active} className={splitFrameClass(tone)}>
				<button
					type="button"
					data-testid="pr-babysit-toggle"
					aria-pressed={active}
					aria-label={active ? t("prBabysit.topbar.stop") : t("prBabysit.topbar.start")}
					title={active ? t("prBabysit.topbar.stop") : t("prBabysit.topbar.start")}
					disabled={pending !== null}
					onClick={toggle}
					className={cn(splitPartClass(tone), "px-8 tr-text-emphasis")}
				>
					{pending === "toggle" ? (
						<Loader className="animate-spin" />
					) : active ? (
						<span
							aria-hidden
							data-neon="pulse"
							data-testid="pr-babysit-indicator"
							className="size-8 shrink-0 rounded-full bg-primary"
						/>
					) : (
						<Robot />
					)}
					<span className="hidden md:inline">
						{active ? t("prBabysit.topbar.babysitting") : t("prBabysit.topbar.babysit")}
					</span>
				</button>
				<button
					type="button"
					data-testid="pr-babysit-review"
					aria-label={t("prBabysit.topbar.reviewHint")}
					title={t("prBabysit.topbar.reviewHint")}
					disabled={pending !== null || session?.reviewing === true}
					onClick={review}
					className={cn(splitPartClass(tone), "border-current/20 border-l px-8")}
				>
					{pending === "review" || session?.reviewing ? (
						<Loader className="animate-spin" />
					) : (
						<SearchEye />
					)}
					<span className="hidden lg:inline">{t("prBabysit.topbar.review")}</span>
				</button>
			</span>
			{session ? (
				<button
					type="button"
					data-testid="pr-babysit-pill"
					aria-label={t("prBabysit.topbar.openDrawer", counts)}
					onClick={() => setDrawerOpen(true)}
					className={chipClass(
						session.status === "needs_human" ? "warning" : active ? "info" : "neutral",
						true,
					)}
				>
					{t("prBabysit.topbar.counts", counts)}
				</button>
			) : null}
			<PrBabysitDrawer
				workspaceId={workspaceId}
				prNumber={prNumber}
				open={drawerOpen}
				onOpenChange={setDrawerOpen}
			/>
		</>
	);
}
