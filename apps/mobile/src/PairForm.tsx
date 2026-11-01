import { RiQrScan2Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";
import type { PairState } from "./App";
import { type ScanOutcome, scanPairLink } from "./scanPairLink";

type ScanProblem = Exclude<ScanOutcome, { kind: "link" } | { kind: "cancelled" }>;

export function PairForm({
	pair,
	onPair,
	onCancel,
}: {
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	onCancel?: () => void;
}) {
	const t = useT();
	const [link, setLink] = useState("");
	const [scanning, setScanning] = useState(false);
	const [scanProblem, setScanProblem] = useState<ScanProblem | null>(null);
	const pairing = pair.kind === "pairing";

	const submit = async (): Promise<void> => {
		const value = link.trim();
		setScanProblem(null);
		if (value && (await onPair(value))) setLink("");
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

	return (
		<form
			className="flex flex-col gap-12"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<Button
				type="button"
				className="h-touch rounded-md"
				iconLeft={RiQrScan2Line}
				loading={scanning}
				disabled={pairing}
				onClick={() => void scan()}
			>
				{t("mobile.pair.scan")}
			</Button>

			<div className="flex items-center gap-12 text-text-subtle tr-text-eyebrow">
				<span aria-hidden className="h-px flex-1 bg-border-default" />
				{t("mobile.pair.orPaste")}
				<span aria-hidden className="h-px flex-1 bg-border-default" />
			</div>

			<Textarea
				value={link}
				onChange={(event) => setLink(event.target.value)}
				placeholder={t("mobile.pair.placeholder")}
				aria-label={t("mobile.pair.linkLabel")}
				rows={2}
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				className="rounded-md px-12 py-12"
			/>
			{problem ? (
				<p
					role="alert"
					className="m-0 rounded-md bg-feedback-error-subtle px-12 py-8 text-feedback-error tr-text-metadata"
				>
					{problem}
				</p>
			) : null}
			<div className="flex gap-8">
				{onCancel ? (
					<Button
						type="button"
						variant="outline"
						className="h-touch flex-1 rounded-md"
						onClick={onCancel}
						disabled={pairing}
					>
						{t("mobile.pair.cancel")}
					</Button>
				) : null}
				<Button
					type="submit"
					variant="soft-primary"
					className="h-touch flex-1 rounded-md"
					loading={pairing && !scanning}
					disabled={!link.trim()}
				>
					{pairing ? t("mobile.pair.connecting") : t("mobile.pair.connect")}
				</Button>
			</div>
		</form>
	);
}
