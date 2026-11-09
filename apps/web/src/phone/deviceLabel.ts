/** What this phone calls itself to the computer it pairs with: its kind from the user agent, renamable on the computer. */
export function deviceLabel(userAgent: string): string {
	if (/iPad/.test(userAgent)) return "iPad";
	if (/iPhone/.test(userAgent)) return "iPhone";
	if (/Android/.test(userAgent))
		return /Mobile/.test(userAgent) ? "Android phone" : "Android tablet";
	return "Phone";
}
