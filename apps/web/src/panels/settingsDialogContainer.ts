import { createContext, useContext } from "react";

export const SettingsDialogContainer = createContext<HTMLElement | null>(null);

export function useSettingsDialogContainer(): HTMLElement | null {
	return useContext(SettingsDialogContainer);
}
