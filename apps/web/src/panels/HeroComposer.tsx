import { RiArrowUpLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useState } from "react";

/**
 * Project Home's prompt-first start: a centred composer that asks what to build. Submitting hands the
 * prompt to the New workspace dialog, so the environment (worktree or project folder), branch and
 * model stay one decision away and every existing creation path is reused.
 */
export function HeroComposer({
	projectName,
	onSubmit,
}: {
	projectName: string;
	onSubmit: (prompt: string) => void;
}) {
	const t = useT();
	const [value, setValue] = useState("");
	const prompt = value.trim();
	const submit = () => {
		if (prompt) onSubmit(prompt);
	};
	return (
		<form
			data-testid="hero-composer"
			className="mt-24 flex w-full max-w-[640px] flex-col gap-12 text-left"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<h2 className="text-center tr-title-dialog text-text-default">
				{t("panels.welcome.heroQuestion", { project: projectName })}
			</h2>
			<div className="flex flex-col gap-8 rounded-2xl border border-control-border-default bg-control-bg p-12 shadow-[var(--shadow-md)]">
				<textarea
					data-testid="hero-composer-input"
					value={value}
					rows={3}
					aria-label={t("panels.welcome.heroLabel")}
					placeholder={t("panels.welcome.heroPlaceholder")}
					className="min-h-64 w-full resize-none rounded-md bg-transparent p-4 tr-text-ui text-text-default placeholder:text-text-muted focus-visible:focus-ring-inset"
					onChange={(event) => setValue(event.target.value)}
					onKeyDown={(event) => {
						if (isImeComposing(event.nativeEvent)) return;
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							submit();
						}
					}}
				/>
				<div className="flex items-center justify-end gap-8">
					<span className="tr-text-metadata text-text-subtle">{t("panels.welcome.heroHint")}</span>
					<IconButton
						type="submit"
						variant="primary"
						size="l"
						icon={RiArrowUpLine}
						label={t("panels.welcome.heroSubmit")}
						tooltip={t("panels.welcome.heroSubmit")}
						disabled={!prompt}
						data-testid="hero-composer-submit"
					/>
				</div>
			</div>
		</form>
	);
}
