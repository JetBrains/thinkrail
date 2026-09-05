import { type AppConfigUpdate, isLineWidth, LINE_WIDTH_COLUMNS } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsSwitch } from "./SettingsSwitch";

interface LineWidthControlProps {
	kind: "chat" | "file";
	title: string;
	description: string;
	value: number;
	bounded: boolean;
	onSave: (value: number) => Promise<void>;
	onBoundedChange: (bounded: boolean) => void;
}

function parsedWidth(draft: string): number | null {
	if (!/^\d+$/.test(draft)) return null;
	const value = Number(draft);
	return isLineWidth(value) ? value : null;
}

function LineWidthControl({
	kind,
	title,
	description,
	value,
	bounded,
	onSave,
	onBoundedChange,
}: LineWidthControlProps) {
	const [draft, setDraft] = useState(String(value));
	const [saving, setSaving] = useState(false);
	useEffect(() => setDraft(String(value)), [value]);
	const parsed = parsedWidth(draft);
	const canSave = parsed !== null && parsed !== value && !saving;
	const errorId = `${kind}-line-width-error`;

	const save = async () => {
		if (!canSave || parsed === null) return;
		setSaving(true);
		try {
			await onSave(parsed);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div
			data-testid={`${kind}-line-width-control`}
			className="flex flex-col gap-12 border-border-default border-t pt-16"
		>
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">{title}</h3>
				<p className="text-text-muted tr-text-metadata">{description}</p>
			</div>
			<div className="flex flex-wrap items-end gap-8">
				<label className="flex flex-col gap-4 text-text-muted tr-text-metadata">
					<span>Line width</span>
					<span className="flex items-center gap-8">
						<input
							type="number"
							min={LINE_WIDTH_COLUMNS.min}
							max={LINE_WIDTH_COLUMNS.max}
							step={1}
							value={draft}
							aria-label={`${title} line width`}
							aria-invalid={parsed === null}
							aria-describedby={parsed === null ? errorId : undefined}
							data-testid={`${kind}-line-width-input`}
							data-line-width-input
							onChange={(event) => setDraft(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									event.stopPropagation();
									setDraft(String(value));
								} else if (event.key === "Enter" && canSave) {
									event.preventDefault();
									void save();
								}
							}}
							className="w-96 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none focus:border-control-border-active focus:ring-2 focus:ring-primary aria-invalid:border-feedback-error"
						/>
						<span>symbols</span>
					</span>
				</label>
				<button
					type="button"
					disabled={!canSave}
					data-testid={`${kind}-line-width-save`}
					onClick={() => void save()}
					className="rounded-[var(--radius-sm)] border border-border-default px-12 py-4 tr-text-ui text-text-default outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text"
				>
					{saving ? "Saving…" : "Save"}
				</button>
			</div>
			{parsed === null ? (
				<p id={errorId} className="text-feedback-error tr-text-metadata">
					Enter a whole number from {LINE_WIDTH_COLUMNS.min} to {LINE_WIDTH_COLUMNS.max}.
				</p>
			) : null}
			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<div className="flex flex-col gap-2">
					<span className="tr-title-compact text-text-default">No bigger than pane width</span>
					<span className="text-text-muted tr-text-metadata">
						Wrap sooner when this pane is narrower than {value} symbols.
					</span>
				</div>
				<SettingsSwitch
					checked={bounded}
					label={`Keep ${title.toLowerCase()} lines within the pane width`}
					testId={`${kind}-line-width-bounded`}
					onChange={onBoundedChange}
				/>
			</div>
		</div>
	);
}

async function updateLineWidth(config: AppConfigUpdate, errorMessage: string): Promise<void> {
	try {
		await getTransport().request("settings.update", { config });
	} catch {
		toast.error(errorMessage);
	}
}

export function LineWidthSettings() {
	const chatLineWidth = useAppStore((state) => state.chatLineWidth);
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const chatLineWidthBounded = useAppStore((state) => state.chatLineWidthBounded);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);

	return (
		<section data-testid="settings-line-width" className="flex flex-col gap-16">
			<p className="text-text-muted tr-text-metadata">
				Set the visual wrap column for chats and source files. These preferences are saved on the
				host and follow you across connected devices.
			</p>
			<LineWidthControl
				kind="chat"
				title="Chat"
				description="Uses an approximate symbol measure while keeping the current reading font."
				value={chatLineWidth}
				bounded={chatLineWidthBounded}
				onSave={(chatLineWidth) =>
					updateLineWidth({ chatLineWidth }, "Couldn't change the chat line width")
				}
				onBoundedChange={(chatLineWidthBounded) => {
					void updateLineWidth({ chatLineWidthBounded }, "Couldn't change the chat line width");
				}}
			/>
			<LineWidthControl
				kind="file"
				title="Files"
				description="Soft-wraps source files and both sides of diffs without changing file contents."
				value={fileLineWidth}
				bounded={fileLineWidthBounded}
				onSave={(fileLineWidth) =>
					updateLineWidth({ fileLineWidth }, "Couldn't change the file line width")
				}
				onBoundedChange={(fileLineWidthBounded) => {
					void updateLineWidth({ fileLineWidthBounded }, "Couldn't change the file line width");
				}}
			/>
		</section>
	);
}
