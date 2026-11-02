import {
	type RemixiconComponentType,
	RiArrowRightSLine,
	RiLinkM,
	RiQrScan2Line,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { RunningIcon } from "@thinkrail/ui/running-icon";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";
import type { PairState } from "./App";
import { type ScanOutcome, scanPairLink } from "./scanPairLink";

type ScanProblem = Exclude<ScanOutcome, { kind: "link" } | { kind: "cancelled" }>;

/** The pairing flow both entry points share: the in-app QR scan, the pasted link, and the one problem line. */
function usePairing(pair: PairState, onPair: (link: string) => Promise<boolean>) {
	const t = useT();
	const [link, setLink] = useState("");
	const [scanning, setScanning] = useState(false);
	const [scanProblem, setScanProblem] = useState<ScanProblem | null>(null);

	const submit = async (): Promise<boolean> => {
		const value = link.trim();
		setScanProblem(null);
		if (!value || !(await onPair(value))) return false;
		setLink("");
		return true;
	};

	const scan = async (): Promise<void> => {
		setScanProblem(null);
		setScanning(true);
		const outcome = await scanPairLink({
			instructions: t("mobile.pair.scanInstructions"),
			cancel: t("mobile.pair.cancel"),
		});
		setScanning(false);
		if (outcome.kind === "link") await onPair(outcome.link);
		else if (outcome.kind !== "cancelled") setScanProblem(outcome);
	};

	const problem =
		scanProblem?.kind === "notPairLink"
			? t("mobile.pair.scanNotPairLink")
			: scanProblem?.kind === "cameraDenied"
				? t("mobile.pair.scanCameraDenied")
				: scanProblem?.kind === "failed"
					? t("mobile.pair.scanFailed", { reason: scanProblem.reason })
					: pair.kind === "failed"
						? t("mobile.pair.failed", { reason: pair.reason })
						: null;

	return { link, setLink, scanning, pairing: pair.kind === "pairing", scan, submit, problem };
}

type Pairing = ReturnType<typeof usePairing>;

function LinkField({ pairing }: { pairing: Pairing }) {
	const t = useT();
	return (
		<Textarea
			value={pairing.link}
			onChange={(event) => pairing.setLink(event.target.value)}
			placeholder={t("mobile.pair.placeholder")}
			aria-label={t("mobile.pair.linkLabel")}
			rows={2}
			autoCapitalize="off"
			autoCorrect="off"
			spellCheck={false}
			className="rounded-md px-12 py-12"
		/>
	);
}

function ConnectButton({ pairing }: { pairing: Pairing }) {
	const t = useT();
	return (
		<Button
			type="submit"
			variant="soft-primary"
			className="h-touch flex-1 rounded-md"
			loading={pairing.pairing && !pairing.scanning}
			disabled={!pairing.link.trim()}
		>
			{pairing.pairing ? t("mobile.pair.connecting") : t("mobile.pair.connect")}
		</Button>
	);
}

function Problem({ text }: { text: string | null }) {
	return text ? (
		<p
			role="alert"
			className="m-0 rounded-md bg-feedback-error-subtle px-12 py-8 text-feedback-error tr-text-metadata"
		>
			{text}
		</p>
	) : null;
}

/** First run: the scan button, then the paste field. */
export function PairForm({
	pair,
	onPair,
}: {
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
}) {
	const t = useT();
	const pairing = usePairing(pair, onPair);
	return (
		<form
			className="flex flex-col gap-12"
			onSubmit={(event) => {
				event.preventDefault();
				void pairing.submit();
			}}
		>
			<Button
				type="button"
				className="h-touch rounded-md"
				iconLeft={RiQrScan2Line}
				loading={pairing.scanning}
				disabled={pairing.pairing}
				onClick={() => void pairing.scan()}
			>
				{t("mobile.pair.scan")}
			</Button>
			<div className="flex items-center gap-12 text-text-subtle tr-text-eyebrow">
				<span aria-hidden className="h-px flex-1 bg-border-default" />
				{t("mobile.pair.orPaste")}
				<span aria-hidden className="h-px flex-1 bg-border-default" />
			</div>
			<LinkField pairing={pairing} />
			<Problem text={pairing.problem} />
			<div className="flex">
				<ConnectButton pairing={pairing} />
			</div>
		</form>
	);
}

/** Settings: the same flow as two grouped rows — scan, or open the paste field. */
export function PairActions({
	pair,
	onPair,
}: {
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
}) {
	const t = useT();
	const pairing = usePairing(pair, onPair);
	const [manual, setManual] = useState(false);
	return (
		<div className="flex flex-col gap-12">
			<ul className="m-0 list-none overflow-hidden rounded-lg border border-border-default bg-container-elevated-bg p-0">
				<ActionRow
					icon={RiQrScan2Line}
					label={t("mobile.pair.scan")}
					busy={pairing.scanning}
					disabled={pairing.pairing}
					onClick={() => void pairing.scan()}
				/>
				<ActionRow
					icon={RiLinkM}
					label={t("mobile.pair.manual")}
					expanded={manual}
					disabled={pairing.pairing && !manual}
					onClick={() => setManual((open) => !open)}
				/>
			</ul>
			{manual ? (
				<form
					className="flex flex-col gap-12"
					onSubmit={(event) => {
						event.preventDefault();
						void pairing.submit().then((paired) => {
							if (paired) setManual(false);
						});
					}}
				>
					<LinkField pairing={pairing} />
					<div className="flex">
						<ConnectButton pairing={pairing} />
					</div>
				</form>
			) : null}
			<Problem text={pairing.problem} />
		</div>
	);
}

function ActionRow({
	icon: Icon,
	label,
	busy = false,
	expanded,
	disabled,
	onClick,
}: {
	icon: RemixiconComponentType;
	label: string;
	busy?: boolean;
	expanded?: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<li className="border-b border-border-muted last:border-b-0">
			<button
				type="button"
				aria-expanded={expanded}
				disabled={disabled}
				onClick={onClick}
				className="flex min-h-touch w-full items-center gap-12 border-0 bg-transparent px-16 py-12 text-left active:bg-control-bg-hovered disabled:text-control-disabled-text"
			>
				{busy ? (
					<RunningIcon className="size-24 text-primary" />
				) : (
					<Icon aria-hidden className="size-24 shrink-0 text-primary" />
				)}
				<span className="min-w-0 flex-1 truncate text-text-default tr-text-ui">{label}</span>
				<RiArrowRightSLine
					aria-hidden
					className={`size-20 shrink-0 text-text-subtle ${expanded ? "rotate-90" : ""}`}
				/>
			</button>
		</li>
	);
}
