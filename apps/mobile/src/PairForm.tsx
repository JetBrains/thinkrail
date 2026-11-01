import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";
import type { PairState } from "./App";

export function PairForm({
	pair,
	onPair,
	onCancel,
	autoFocus = false,
}: {
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	onCancel?: () => void;
	autoFocus?: boolean;
}) {
	const t = useT();
	const [link, setLink] = useState("");
	const pairing = pair.kind === "pairing";
	const submit = async (): Promise<void> => {
		const value = link.trim();
		if (value && (await onPair(value))) setLink("");
	};

	return (
		<form
			className="flex flex-col gap-12"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<Textarea
				value={link}
				onChange={(event) => setLink(event.target.value)}
				placeholder={t("mobile.pair.placeholder")}
				aria-label={t("mobile.pair.linkLabel")}
				rows={2}
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				autoFocus={autoFocus}
				className="rounded-md px-12 py-12"
			/>
			{pair.kind === "failed" ? (
				<p
					role="alert"
					className="m-0 rounded-md bg-feedback-error-subtle px-12 py-8 text-feedback-error tr-text-metadata"
				>
					{t("mobile.pair.failed", { reason: pair.reason })}
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
					className="h-touch flex-1 rounded-md"
					loading={pairing}
					disabled={!link.trim()}
				>
					{pairing ? t("mobile.pair.connecting") : t("mobile.pair.connect")}
				</Button>
			</div>
		</form>
	);
}
