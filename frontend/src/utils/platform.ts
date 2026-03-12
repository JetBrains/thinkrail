export const IS_MAC: boolean =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export function isMod(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return IS_MAC ? e.ctrlKey : e.altKey;
}

export const MOD_LABEL: string = IS_MAC ? "Ctrl" : "Alt";

export function modLabel(key: string): string {
  return `${MOD_LABEL}+${key}`;
}
