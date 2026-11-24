import { RiQrScan2Line, RiTerminalBoxLine, RiWifiLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { RunningIcon } from "@thinkrail/ui/running-icon";
import type { PairState } from "./App";
import { PairForm } from "./PairForm";

export const BRAND = "ThinkRail";
const REMOTE_COMMAND = "thinkrail --remote";

/** How to reach a computer, as three one-line steps: which network, how to turn phone access on, scan. */
export function PairSteps() {
	const t = useT();
	const steps = [
		{ icon: RiWifiLine, text: t("mobile.welcome.stepNetwork") },
		{ icon: RiTerminalBoxLine, text: t("mobile.welcome.stepRun"), code: REMOTE_COMMAND },
		{ icon: RiQrScan2Line, text: t("mobile.welcome.stepScan") },
	];
	return (
		<ol className="m-0 flex list-none flex-col gap-16 p-0">
			{steps.map(({ icon: Icon, text, code }) => (
				<li key={text} className="flex items-start gap-12">
					<span className="flex size-32 shrink-0 items-center justify-center rounded-md border border-border-default bg-container-elevated-bg text-primary">
						<Icon aria-hidden className="size-16" />
					</span>
					<div className="flex min-w-0 flex-col gap-6 pt-6">
						<span className="text-text-default tr-text-ui">{text}</span>
						{code ? (
							<code className="self-start rounded-sm bg-container-content-bg px-8 py-4 text-text-default tr-code-text">
								{code}
							</code>
						) : null}
					</div>
				</li>
			))}
		</ol>
	);
}

/** First run: brand, the pairing steps and the scan button — sized to fit one phone screen without scrolling. */
export function Welcome({
	pair,
	onPair,
}: {
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
}) {
	const t = useT();
	return (
		<main className="flex h-full flex-col overflow-y-auto px-24 pt-safe-top pb-safe-bottom">
			<header className="flex flex-col items-center gap-8 pt-48 text-center">
				<h1 className="m-0 text-primary tr-brand-hero">{BRAND}</h1>
				<p className="m-0 text-text-default tr-heading-sm">{t("mobile.welcome.tagline")}</p>
			</header>

			<div className="my-auto py-24">
				<PairSteps />
			</div>

			<section className="pb-24">
				<PairForm pair={pair} onPair={onPair} />
			</section>
		</main>
	);
}

/** While a scanned or pasted link pairs and the computer's projects load: the brand mark, large, and whom it reaches. */
export function PairingSplash({ hostName }: { hostName?: string | undefined }) {
	const t = useT();
	return (
		<main
			role="status"
			data-testid="pairing-splash"
			className="flex h-full flex-col items-center justify-center gap-24 bg-container-workspace-bg px-24 pt-safe-top pb-safe-bottom text-center"
		>
			<RunningIcon className="size-96 text-primary" />
			<div className="flex flex-col gap-8">
				<h1 className="m-0 text-text-default tr-heading-sm">
					{hostName
						? t("mobile.pair.connectingTo", { name: hostName })
						: t("mobile.pair.connecting")}
				</h1>
				<p className="m-0 text-text-muted tr-text-reading">{t("mobile.pair.connectingHint")}</p>
			</div>
		</main>
	);
}
