import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";

export default function Toggle() {
	const t = useT();
	const [hidden, setHidden] = useState(false);
	return (
		<Button
			variant="outline"
			size="m"
			selected={hidden}
			aria-pressed={hidden}
			onClick={() => setHidden((value) => !value)}
		>
			{t("panels.diffPane.hideWhitespace")}
		</Button>
	);
}
