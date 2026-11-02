import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";

type Order = "oldest-first" | "newest-first";

export default function Basic() {
	const t = useT();
	const [order, setOrder] = useState<Order>("oldest-first");
	return (
		<SegmentedControl
			name="chat-message-order"
			label={t("settings.chat.messageOrder")}
			options={[
				{ id: "oldest-first", label: t("settings.chat.order.oldestFirst") },
				{ id: "newest-first", label: t("settings.chat.order.newestFirst") },
			]}
			value={order}
			onSelect={setOrder}
			testId="chat-message-order-control"
		/>
	);
}
