import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function Broken({ message }: { message: string }) {
	const t = useT();
	const [opened, setOpened] = useState(false);
	if (opened) throw new Error(message);
	return (
		<div className="flex h-full items-center justify-center">
			<Button variant="outline" size="m" onClick={() => setOpened(true)}>
				{t("panels.diffSurface.openFile")}
			</Button>
		</div>
	);
}

export default function WithoutLabel() {
	return (
		<div className="grid h-[12rem] w-full grid-cols-2 gap-16">
			<ErrorBoundary>
				<Broken message="x.localeCompare is not a function" />
			</ErrorBoundary>
			<ErrorBoundary>
				<Broken message="" />
			</ErrorBoundary>
		</div>
	);
}
