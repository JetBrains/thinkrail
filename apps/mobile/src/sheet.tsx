import type { RemixiconComponentType } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@thinkrail/ui/dialog";
import { type ReactNode, useState } from "react";

/** The phone's action sheet: the shared dialog, docked to the bottom edge, with a Cancel row. */
export function Sheet({
	open,
	onOpenChange,
	title,
	description,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	children: ReactNode;
}) {
	const t = useT();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				hideClose
				{...(description ? {} : { "aria-describedby": undefined })}
				className="top-auto bottom-0 left-0 max-w-none translate-x-0 translate-y-0 gap-0 rounded-b-none p-0 pb-safe-bottom"
			>
				<div className="flex flex-col gap-4 border-b border-border-muted px-16 py-12 text-center">
					<DialogTitle className="truncate text-text-muted tr-text-metadata">{title}</DialogTitle>
					{description ? (
						<DialogDescription className="text-text-muted tr-text-metadata">
							{description}
						</DialogDescription>
					) : null}
				</div>
				{children}
				<button
					type="button"
					onClick={() => onOpenChange(false)}
					className="min-h-touch w-full border-0 border-t border-border-default bg-transparent px-16 py-12 text-text-default tr-title-card active:bg-control-bg-hovered"
				>
					{t("common.cancel")}
				</button>
			</DialogContent>
		</Dialog>
	);
}

export function SheetAction({
	icon: Icon,
	label,
	detail,
	destructive = false,
	disabled = false,
	onSelect,
}: {
	icon: RemixiconComponentType;
	label: string;
	detail?: string | undefined;
	destructive?: boolean;
	disabled?: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onSelect}
			className={`flex min-h-touch w-full items-center gap-12 border-0 border-b border-border-muted bg-transparent px-16 py-12 text-left active:bg-control-bg-hovered disabled:opacity-50 ${destructive ? "text-feedback-error" : "text-text-default"}`}
		>
			<Icon aria-hidden className="size-22 shrink-0" />
			<span className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="truncate tr-text-reading">{label}</span>
				{detail ? <span className="text-text-subtle tr-text-metadata">{detail}</span> : null}
			</span>
		</button>
	);
}

/** A destructive confirmation: the title asks, the description says what happens, one red action does it. */
export function ConfirmSheet({
	open,
	onOpenChange,
	title,
	description,
	icon,
	confirmLabel,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	icon: RemixiconComponentType;
	confirmLabel: string;
	onConfirm: () => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange} title={title} description={description}>
			<SheetAction
				icon={icon}
				label={confirmLabel}
				destructive
				onSelect={() => {
					onOpenChange(false);
					onConfirm();
				}}
			/>
		</Sheet>
	);
}

/** Rename in a sheet: the field starts on the current name each time it opens; Save sends only a real change. */
export function RenameSheet({
	open,
	onOpenChange,
	title,
	label,
	current,
	onRename,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	label: string;
	current: string;
	onRename: (name: string) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange} title={title}>
			<RenameForm
				label={label}
				current={current}
				onRename={(name) => {
					onOpenChange(false);
					onRename(name);
				}}
			/>
		</Sheet>
	);
}

function RenameForm({
	label,
	current,
	onRename,
}: {
	label: string;
	current: string;
	onRename: (name: string) => void;
}) {
	const t = useT();
	const [value, setValue] = useState(current);
	const name = value.trim();
	const changed = name !== "" && name !== current;
	return (
		<form
			className="flex flex-col gap-12 p-16"
			onSubmit={(event) => {
				event.preventDefault();
				if (changed) onRename(name);
			}}
		>
			<input
				aria-label={label}
				value={value}
				onChange={(event) => setValue(event.target.value)}
				onFocus={(event) => event.currentTarget.select()}
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				className="h-touch w-full rounded-md border border-control-border-default bg-control-bg px-12 text-text-default tr-text-reading outline-none focus:border-control-border-active"
			/>
			<Button type="submit" variant="primary" className="h-touch rounded-md" disabled={!changed}>
				{t("common.save")}
			</Button>
		</form>
	);
}
