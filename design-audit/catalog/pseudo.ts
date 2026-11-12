// Fixture mechanism for frozen pseudo-states. For every production CSS rule whose selector uses a
// dynamic pseudo-class, insert an identical rule directly after it in which that pseudo-class is
// replaced by a marker class (`:hover` → `.dsa-force-hover`). Specimens then put the marker class on
// the element the state applies to. Declarations, specificity class count and cascade order are
// preserved; only the trigger changes. Nothing in the catalog chrome stylesheet is touched.

export const PSEUDO = ["hover", "focus-visible", "focus-within", "focus", "active"] as const;
export type ForcedPseudo = (typeof PSEUDO)[number];

const PATTERN = /:(focus-visible|focus-within|focus|hover|active)(?![\w-])/g;

function rewrite(selector: string): string | null {
	if (!PATTERN.test(selector)) return null;
	PATTERN.lastIndex = 0;
	return selector.replace(PATTERN, (_m, p: string) => `.dsa-force-${p}`);
}

function walk(list: CSSRuleList, owner: CSSStyleSheet | CSSGroupingRule): number {
	let added = 0;
	for (let i = 0; i < list.length; i++) {
		const rule = list[i];
		if (rule instanceof CSSStyleRule) {
			const next = rewrite(rule.selectorText);
			if (next) {
				try {
					owner.insertRule(`${next}{${rule.style.cssText}}`, i + 1);
					i++;
					added++;
				} catch {
					/* selector the engine rejects after rewrite — leave the original untouched */
				}
			}
			if (rule.cssRules?.length) added += walk(rule.cssRules, rule as unknown as CSSGroupingRule);
		} else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
			added += walk((rule as CSSGroupingRule).cssRules, rule as CSSGroupingRule);
		}
	}
	return added;
}

/** Rewrites every stylesheet tagged `data-dsa-production`. Returns the number of forced-state rules added. */
export function installForcedPseudoStates(): number {
	let added = 0;
	for (const sheet of Array.from(document.styleSheets)) {
		const node = sheet.ownerNode as Element | null;
		if (!node?.hasAttribute("data-dsa-production")) continue;
		added += walk(sheet.cssRules, sheet);
	}
	return added;
}

// `@media (hover: hover)` wraps production hover rules; the forced copies sit inside the same block,
// so they apply exactly where the production hover would.
