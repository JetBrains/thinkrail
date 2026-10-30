import type { AppConfigUpdate } from "@thinkrail/contracts";
import { toast } from "@/store";
import { errorText, getTransport } from "@/transport";

export function saveSettings(config: AppConfigUpdate, failure: string): Promise<boolean> {
	return getTransport()
		.request("settings.update", { config })
		.then(
			() => true,
			(error: unknown) => {
				toast.error(errorText(error), failure);
				return false;
			},
		);
}
