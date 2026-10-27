import { RiRefreshLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";

export default function Refresh() {
	const t = useT();
	const [refreshing, setRefreshing] = useState(false);
	return (
		<Button
			variant="ghost"
			size="m"
			iconLeft={RiRefreshLine}
			loading={refreshing}
			spinIcon
			onClick={() => {
				setRefreshing(true);
				setTimeout(() => setRefreshing(false), 1500);
			}}
		>
			{t("chat.modelPicker.refresh")}
		</Button>
	);
}
