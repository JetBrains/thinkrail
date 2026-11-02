import { useT } from "@thinkrail/locales/react";
import { SkeletonRows } from "@thinkrail/ui/skeleton";

export default function SettingsSection() {
	const t = useT();
	return (
		<div className="grid w-full grid-cols-2 gap-24">
			<div data-testid="settings-templates">
				<SkeletonRows rows={3} />
			</div>
			<SkeletonRows rows={3} label={t("mcp.settings.loading")} />
		</div>
	);
}
