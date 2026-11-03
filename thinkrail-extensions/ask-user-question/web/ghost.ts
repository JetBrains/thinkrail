import { createContext, useContext } from "react";

const GhostPageContext = createContext(false);

export const GhostPage = GhostPageContext.Provider;

export function useTestId(): (id: string) => string | undefined {
	const ghost = useContext(GhostPageContext);
	return ghost ? () => undefined : (id) => id;
}
