import { RiLoginBoxLine, RiLogoutBoxLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { SettingsGroup, SettingsPageContainer } from "@/panels/SettingsGroup";
import { SettingsRow } from "@/panels/SettingsRow";

const PROVIDERS = ["Anthropic", "OpenAI", "GitHub Copilot"];

export default function ConditionalGroups() {
	const t = useT();
	const [connected, setConnected] = useState<string[]>([]);
	const available = PROVIDERS.filter((name) => !connected.includes(name));
	return (
		<div className="w-full max-w-[40rem]">
			<SettingsPageContainer>
				{connected.length > 0 ? (
					<SettingsGroup key="connected" title={t("settings.providers.connectedGroup")}>
						{connected.map((name) => (
							<SettingsRow
								key={name}
								label={name}
								control={
									<Button
										variant="soft-primary"
										size="m"
										iconLeft={RiLogoutBoxLine}
										onClick={() => setConnected((list) => list.filter((item) => item !== name))}
									>
										{t("settings.providers.signOut")}
									</Button>
								}
							/>
						))}
					</SettingsGroup>
				) : null}
				{available.length > 0 ? (
					<SettingsGroup
						key="subscriptions"
						title={t("settings.providers.subscriptionsGroup")}
						description={t("settings.providers.subscriptionsDescription")}
					>
						{available.map((name) => (
							<SettingsRow
								key={name}
								label={name}
								control={
									<Button
										variant="soft-primary"
										size="m"
										iconLeft={RiLoginBoxLine}
										onClick={() => setConnected((list) => [...list, name])}
									>
										{t("settings.providers.signIn")}
									</Button>
								}
							/>
						))}
					</SettingsGroup>
				) : null}
			</SettingsPageContainer>
		</div>
	);
}
