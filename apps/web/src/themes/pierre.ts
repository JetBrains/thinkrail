import type { Theme, ThemeStyle } from "@pierre/highlights";

type Syntax = NonNullable<ThemeStyle["syntax"]>;

const BASE_SYNTAX: Syntax = {
	comment: { color: "comment" },
	"comment.doc": { color: "comment-doc" },
	keyword: { color: "keyword" },
	"keyword.operator": { color: "operator" },
	string: { color: "string" },
	"string.regex": { color: "regexp" },
	"string.escape": { color: "string" },
	"string.special": { color: "string" },
	number: { color: "number" },
	boolean: { color: "keyword" },
	constant: { color: "constant" },
	"constant.builtin": { color: "keyword" },
	attribute: { color: "attribute-name" },
	"attribute.jsx": { color: "attribute-name" },
	preproc: { color: "annotation" },
	tag: { color: "tag" },
	property: { color: "variable" },
	"property.json_key": { color: "property" },
	function: { color: "function" },
	constructor: { color: "function" },
	type: { color: "type" },
	"type.builtin": { color: "type" },
	namespace: { color: "type" },
	variable: { color: "variable" },
	"variable.parameter": { color: "variable" },
	"variable.special": { color: "keyword" },
	operator: { color: "operator" },
	punctuation: { color: "punctuation" },
	selector: { color: "attribute-name" },
	link_text: { color: "string" },
	"diff.plus": { color: "inserted" },
	"diff.minus": { color: "deleted" },
};

export const THINKRAIL_PIERRE_THEME: Theme = {
	name: "thinkrail-css-variables",
	appearance: "dark",
	cssVariables: {
		prefix: "--code-",
		defaults: { background: "var(--container-content-bg)" },
	},
	style: { syntax: BASE_SYNTAX },
};
