import { RiPencilLine, RiSmartphoneLine } from "@remixicon/react";
import type { RemoteDeviceAccess, RemotePairedDevice } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";

function calendarDate(epochMs: number): string {
	return new Date(epochMs).toLocaleDateString([], { dateStyle: "medium" });
}

export interface PhoneDeviceRowProps {
	device: RemotePairedDevice;
	onRename: (deviceId: string, label: string) => void;
	onSetAccess: (deviceId: string, access: RemoteDeviceAccess) => void;
	onRevoke: (deviceId: string) => void;
}

/** One paired phone: its name (renamed in place), when it paired and whether it is live, Read / Write access, Revoke. */
export function PhoneDeviceRow({ device, onRename, onSetAccess, onRevoke }: PhoneDeviceRowProps) {
	const t = useT();
	const [draft, setDraft] = useState<string | null>(null);
	const commit = (): void => {
		const label = draft?.trim();
		setDraft(null);
		if (label && label !== device.label) onRename(device.id, label);
	};
	return (
		<div
			data-testid={`phone-access-device-${device.id}`}
			data-connected={device.connected}
			data-access={device.access}
			className="flex items-center gap-8 border-border-muted border-b py-12"
		>
			<RiSmartphoneLine className="size-14 shrink-0 text-text-muted" />
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				{draft === null ? (
					<span className="flex min-w-0 items-center gap-4">
						<span className="truncate tr-text-ui text-text-default">{device.label}</span>
						<IconButton
							size="s"
							icon={RiPencilLine}
							label={t("common.rename")}
							data-testid={`phone-access-rename-${device.id}`}
							onClick={() => setDraft(device.label)}
						/>
					</span>
				) : (
					<input
						ref={(node) => node?.focus()}
						value={draft}
						maxLength={64}
						aria-label={t("common.rename")}
						data-testid={`phone-access-name-${device.id}`}
						onChange={(event) => setDraft(event.target.value)}
						onBlur={commit}
						onKeyDown={(event) => {
							if (isImeComposing(event.nativeEvent)) return;
							if (event.key === "Enter") commit();
							else if (event.key === "Escape") setDraft(null);
						}}
						className="min-w-0 rounded-sm border border-control-border-active bg-control-bg px-4 tr-text-ui text-text-default outline-none"
					/>
				)}
				<span className="tr-text-metadata text-text-muted">
					{device.connected ? (
						<span className="text-feedback-success">
							{t("settings.phone.connectedNow")}
							{" · "}
						</span>
					) : null}
					{t("settings.phone.pairedOn", { date: calendarDate(device.pairedAt) })}
				</span>
			</div>
			<fieldset
				aria-label={t("settings.phone.access")}
				title={t("settings.phone.accessHint")}
				className="m-0 flex shrink-0 items-center gap-2 rounded-md border border-border-default p-2"
			>
				<ToggleSegment
					testid={`phone-access-read-${device.id}`}
					label={t("settings.phone.accessRead")}
					active={device.access === "read"}
					onClick={() => onSetAccess(device.id, "read")}
				/>
				<ToggleSegment
					testid={`phone-access-write-${device.id}`}
					label={t("settings.phone.accessWrite")}
					active={device.access === "write"}
					onClick={() => onSetAccess(device.id, "write")}
				/>
			</fieldset>
			<Button
				variant="outline"
				tone="danger"
				size="m"
				data-testid={`phone-access-revoke-${device.id}`}
				onClick={() => onRevoke(device.id)}
			>
				{t("settings.phone.revoke")}
			</Button>
		</div>
	);
}
