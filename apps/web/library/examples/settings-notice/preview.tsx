import { RiRefreshLine } from "@remixicon/react";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { SettingsNotice } from "@/panels/SettingsNotice";

export default function Preview() {
	const t = useT();
	const [refreshing, setRefreshing] = useState(false);
	const refresh = () => {
		setRefreshing(true);
		setTimeout(() => setRefreshing(false), 1500);
	};
	return (
		<SettingsNotice
			variant="warning"
			action={
				<Button
					variant="outline"
					size="m"
					iconLeft={RiRefreshLine}
					loading={refreshing}
					spinIcon
					onClick={refresh}
				>
					{t("settings.github.refresh")}
				</Button>
			}
		>
			<p>
				<T
					i18nKey="settings.github.notConnected"
					components={[<code key="command" className="tr-code-text" />]}
				/>
			</p>
		</SettingsNotice>
	);
}
