/** Map file extension → Monaco language identifier. */
export function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python",
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    htm: "html",
    json: "json",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    ini: "ini",
    cfg: "ini",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    sql: "sql",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    rb: "ruby",
    xml: "xml",
    svg: "xml",
    txt: "plaintext",
    gitignore: "plaintext",
    dockerfile: "dockerfile",
  };
  return map[ext] ?? "plaintext";
}

/** Display name for the language badge in the toolbar. */
export function languageLabel(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const labels: Record<string, string> = {
    py: "Python",
    ts: "TypeScript",
    tsx: "TSX",
    js: "JavaScript",
    jsx: "JSX",
    css: "CSS",
    html: "HTML",
    json: "JSON",
    md: "Markdown",
    yaml: "YAML",
    yml: "YAML",
    toml: "TOML",
    sh: "Shell",
    sql: "SQL",
    rs: "Rust",
    go: "Go",
    java: "Java",
    kt: "Kotlin",
    rb: "Ruby",
    xml: "XML",
  };
  return labels[ext] ?? (ext.toUpperCase() || "Text");
}
