/**
 * Simplified Chinese catalog. Keys are the English source strings; values are the translations.
 *
 * Terminology follows one rule: action words are translated, proper nouns and the concepts a
 * developer already reads in English stay English. So "Send" → 发送, but Spec, Workspace, Commit,
 * Review, Token, Terminal, Provider, Plugin, Skill, agent and pi stay as they are. Translated nouns
 * are usually longer than the English ones and these panels are dense, so keeping them short is also
 * what keeps the layout intact.
 *
 * Placeholders (`{0}`) are positional and may be reordered freely — Chinese frequently puts the
 * count or the object somewhere else than English does.
 *
 * `IDENTICAL_KEYS` lists keys whose translation intentionally equals the source: brand names and
 * technical tokens such as `PR`, `PDF` or `URL`. `i18n:coverage` counts a key as translated when the
 * catalog carries it, so without that list those keys would read as untranslated.
 */
import type { Catalog } from "../translate";

export const IDENTICAL_KEYS: ReadonlySet<string> = new Set(["Visualize"]);

export const zhCN: Catalog = {
	"Interface copy in English, exactly as shipped upstream.":
		"界面文案保持英文，与上游发布版本完全一致。",
	"Interface language": "界面语言",
	Language: "语言",
	"Lets the agent draw Mermaid diagrams, side-by-side option comparisons, and rendered file previews or before/after mockups in chat.":
		"让 agent 在会话中绘制 Mermaid 图表、并排的方案对比，以及渲染后的文件预览或前后对比示意图。",
	"Switching reloads the app, menu bar included, because both read their copy once at startup.":
		"切换后应用会重新加载，菜单栏也会一并切换，因为两者的文案都在启动时读取一次。",
	app: "应用",
};
