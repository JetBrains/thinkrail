#!/usr/bin/env bun
import { allStyles, loadTypography, validate } from "./typography";

const typography = loadTypography();
const errors = validate(typography);

if (errors.length > 0) {
	console.error(`typography: INVALID (${errors.length})`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

const styles = allStyles(typography);
console.log(
	`typography: valid — v${typography.metadata.version}, ` +
		`${Object.keys(typography.fontFamilies).length} families, ${Object.keys(typography.fontSizes).length} sizes, ` +
		`${Object.keys(typography.lineHeights).length} line-heights, ${styles.length} semantic styles ` +
		`(${styles.filter((s) => s.prose).length} prose across ` +
		`${Object.keys(typography.proseSystems).length} systems)`,
);
