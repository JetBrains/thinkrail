import {
	RiAddLine as Add,
	RiAlertLine as Alert,
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiCloseLine as Close,
} from "@remixicon/react";
import {
	FONT_FALLBACKS_MAX,
	type FontFamilyRef,
	type FontRole,
	isFontFamilyName,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton, withIconClass } from "@thinkrail/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { type FontProbe, previewStack } from "@/fonts";
import {
	choiceKey,
	displayFamily,
	type FontOption,
	type FontSource,
	type InstalledFonts,
	isRoleDefault,
} from "./fontCatalog";
import { SettingsNotice } from "./SettingsNotice";

const WarningIcon = withIconClass(Alert, "text-feedback-warning");

export function FamilyName({
	family,
	role,
	className,
	textClass = "tr-text-ui",
	children,
}: {
	family: string;
	role: FontRole;
	className?: string;
	textClass?: string;
	children: ReactNode;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		ref.current?.style.setProperty("--tr-font-family-interface", previewStack(family, role));
	}, [family, role]);
	return (
		<span ref={ref} className={cn(textClass, className)}>
			{children}
		</span>
	);
}

export function FontBadge({ children }: { children: ReactNode }) {
	return (
		<span className="shrink-0 rounded-full bg-control-bg-selected px-8 text-text-muted tr-text-metadata">
			{children}
		</span>
	);
}

function InstalledStatus({ state, onRetry }: { state: InstalledFonts; onRetry: () => void }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-8 px-8 py-4">
			<span className="py-4 text-text-muted tr-text-eyebrow">
				{t("settings.appearance.fonts.picker.installed")}
			</span>
			{state.status === "failed" ? (
				<SettingsNotice
					variant="warning"
					testId="font-installed-failed"
					action={
						<Button variant="outline" size="m" onClick={onRetry}>
							{t("settings.appearance.fonts.picker.retry")}
						</Button>
					}
				>
					{t("settings.appearance.fonts.picker.readFailed")}
				</SettingsNotice>
			) : (
				<SkeletonRows rows={4} label={t("settings.appearance.fonts.picker.reading")} />
			)}
		</div>
	);
}

interface FontListProps {
	role: FontRole;
	options: readonly FontOption[];
	currentKey: string | null;
	installed: InstalledFonts;
	probe: (family: string) => FontProbe;
	sharesHostFonts: boolean;
	monoOnly: boolean;
	onPick: (ref: FontFamilyRef) => void;
	onRetry: () => void;
	testId: string;
}

export function FontList({
	role,
	options,
	currentKey,
	installed,
	probe,
	sharesHostFonts,
	monoOnly,
	onPick,
	onRetry,
	testId,
}: FontListProps) {
	const t = useT();
	const [search, setSearch] = useState("");
	const typed = search.trim();
	const lowered = typed.toLowerCase();
	const offerTyped =
		isFontFamilyName(typed) &&
		!options.some(
			(option) => option.label.toLowerCase() === lowered || option.family.toLowerCase() === lowered,
		);
	const groups: readonly [FontSource, string][] = [
		["builtin", t("settings.appearance.fonts.picker.builtin")],
		["custom", t("settings.appearance.fonts.picker.custom")],
		["installed", t("settings.appearance.fonts.picker.installed")],
	];
	return (
		<Command loop>
			<CommandInput
				placeholder={t("settings.appearance.fonts.picker.search")}
				value={search}
				onValueChange={setSearch}
				data-testid={`${testId}-search`}
			/>
			<CommandList label={t("settings.appearance.fonts.picker.label")} className="max-h-[320px]">
				{offerTyped ? null : (
					<CommandEmpty>
						<span className="flex flex-col gap-4 px-12">
							<span>{t("settings.appearance.fonts.picker.empty")}</span>
							<span className="text-text-muted tr-text-metadata">
								{t("settings.appearance.fonts.picker.emptyHint")}
							</span>
						</span>
					</CommandEmpty>
				)}
				{groups.map(([source, heading]) => {
					if (source === "installed" && installed.status !== "ready") {
						return <InstalledStatus key={source} state={installed} onRetry={onRetry} />;
					}
					const items = options.filter((option) => option.source === source);
					if (items.length === 0) return null;
					return (
						<CommandGroup key={source} heading={<span className="tr-text-eyebrow">{heading}</span>}>
							{items.map((option) => (
								<CommandItem
									key={option.key}
									value={option.key}
									keywords={[option.label]}
									onSelect={() => onPick(option.ref)}
									data-testid={`${testId}-option`}
									data-font-family={option.family}
									className="gap-8"
								>
									<FamilyName
										family={option.family}
										role={role}
										className="min-w-0 flex-1 truncate"
									>
										{option.label}
									</FamilyName>
									{option.defaultFor === role ? <FontBadge>{t("common.default")}</FontBadge> : null}
									{role === "interface" && option.monospace ? (
										<FontBadge>{t("settings.appearance.fonts.picker.mono")}</FontBadge>
									) : null}
									{!option.renders && !sharesHostFonts ? (
										<FontBadge>{t("settings.appearance.fonts.picker.notOnDevice")}</FontBadge>
									) : null}
									{option.key === currentKey ? (
										<Check className="size-14 shrink-0 text-primary" />
									) : (
										<span className="size-14 shrink-0" />
									)}
								</CommandItem>
							))}
						</CommandGroup>
					);
				})}
				{offerTyped ? (
					<CommandGroup
						forceMount
						heading={
							<span className="tr-text-eyebrow">
								{t("settings.appearance.fonts.picker.notInList")}
							</span>
						}
					>
						<CommandItem
							forceMount
							value={`typed:${typed}`}
							onSelect={() => onPick({ name: typed })}
							data-testid={`${testId}-typed`}
							className="gap-8"
						>
							<FamilyName family={typed} role={role} className="min-w-0 flex-1 truncate">
								{t("settings.appearance.fonts.picker.use", { family: typed })}
							</FamilyName>
							{probe(typed).renders ? null : (
								<FontBadge>{t("settings.appearance.fonts.picker.notOnDevice")}</FontBadge>
							)}
						</CommandItem>
					</CommandGroup>
				) : null}
			</CommandList>
			{monoOnly ? (
				<div className="border-border-muted border-t px-12 py-8 text-text-muted tr-text-metadata">
					{t("settings.appearance.fonts.picker.monoOnly")}
				</div>
			) : null}
		</Command>
	);
}

interface PickerSharedProps {
	role: FontRole;
	options: readonly FontOption[];
	installed: InstalledFonts;
	probe: (family: string) => FontProbe;
	sharesHostFonts: boolean;
	disabled: boolean;
	onOpen: () => void;
	onRetry: () => void;
	testId: string;
}

export function FontPicker({
	label,
	family,
	value,
	unavailable,
	onSelect,
	...shared
}: PickerSharedProps & {
	label: string;
	family: string;
	value: FontFamilyRef | null;
	unavailable: boolean;
	onSelect: (ref: FontFamilyRef | null) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) shared.onOpen();
			}}
		>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="l"
					iconRight={ChevronDown}
					{...(unavailable ? { iconLeft: WarningIcon } : {})}
					aria-label={label}
					disabled={shared.disabled}
					data-testid={`${shared.testId}-trigger`}
					data-font-family={family}
					className="w-240"
				>
					<FamilyName
						family={family}
						role={shared.role}
						textClass="tr-text-button"
						className="min-w-0 flex-1 truncate text-left"
					>
						{displayFamily(family)}
					</FamilyName>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-320 p-0">
				<FontList
					{...shared}
					currentKey={choiceKey(value, shared.role)}
					monoOnly={shared.role === "code"}
					onPick={(ref) => {
						onSelect(isRoleDefault(ref, shared.role) ? null : ref);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

export function FallbackChips({
	values,
	familyOf,
	onChange,
	...shared
}: PickerSharedProps & {
	values: readonly FontFamilyRef[];
	familyOf: (ref: FontFamilyRef) => string;
	onChange: (next: FontFamilyRef[]) => void;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<div className="flex max-w-320 flex-wrap items-center justify-end gap-4">
			{values.map((ref, index) => {
				const family = familyOf(ref);
				return (
					<span
						key={choiceKey(ref, shared.role)}
						data-testid={`${shared.testId}-chip`}
						data-font-family={family}
						className="flex h-24 items-center gap-4 rounded-sm border border-border-default bg-control-bg pr-2 pl-8"
					>
						<FamilyName family={family} role={shared.role} className="text-text-default">
							{displayFamily(family)}
						</FamilyName>
						<IconButton
							icon={Close}
							label={t("settings.appearance.fonts.removeFallback", {
								family: displayFamily(family),
							})}
							size="s"
							variant="ghost"
							disabled={shared.disabled}
							onClick={() => onChange(values.filter((_, other) => other !== index))}
						/>
					</span>
				);
			})}
			{values.length < FONT_FALLBACKS_MAX ? (
				<Popover
					open={open}
					onOpenChange={(next) => {
						setOpen(next);
						if (next) shared.onOpen();
					}}
				>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							size="m"
							iconLeft={Add}
							disabled={shared.disabled}
							data-testid={`${shared.testId}-add`}
						>
							{values.length === 0
								? t("settings.appearance.fonts.addFallback")
								: t("settings.appearance.fonts.add")}
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" className="w-320 p-0">
						<FontList
							{...shared}
							currentKey={null}
							monoOnly={false}
							onPick={(ref) => {
								onChange([...values, ref]);
								setOpen(false);
							}}
						/>
					</PopoverContent>
				</Popover>
			) : null}
		</div>
	);
}
