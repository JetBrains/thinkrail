import { useState } from "react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { useMonacoTheme } from "./useMonacoTheme.ts";
import { FrontmatterCard, extractFrontmatter } from "@/components/FileViewer/FrontmatterCard";
import { useFontSize } from "@/utils/fontScale.ts";
import "./MarkdownEditor.css";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string | number;
  /** Show Edit/Preview toggle tabs. Default: true */
  preview?: boolean;
  /** Initial mode when component mounts. Default: "edit" */
  initialMode?: "edit" | "preview";
  /** Enable minimap. Default: false */
  minimap?: boolean;
  /** Line numbers display. Default: "on" */
  lineNumbers?: "on" | "off";
}

export function MarkdownEditor({
  value,
  onChange,
  language = "markdown",
  height = "100%",
  preview = true,
  initialMode = "edit",
  minimap = false,
  lineNumbers = "on",
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"edit" | "preview">(initialMode);
  const monacoTheme = useMonacoTheme();
  const editorFontSize = useFontSize("body");

  return (
    <div className="markdown-editor">
      {preview && (
        <div className="markdown-editor-tabs">
          <button
            className={`markdown-editor-tab ${mode === "edit" ? "markdown-editor-tab--active" : ""}`}
            onClick={() => setMode("edit")}
          >
            Edit
          </button>
          <button
            className={`markdown-editor-tab ${mode === "preview" ? "markdown-editor-tab--active" : ""}`}
            onClick={() => setMode("preview")}
          >
            Preview
          </button>
        </div>
      )}
      {mode === "edit" ? (
        <div className="markdown-editor-body">
          <Editor
            value={value}
            onChange={(v) => onChange(v ?? "")}
            language={language}
            theme={monacoTheme}
            options={{
              minimap: { enabled: minimap },
              lineNumbers,
              wordWrap: "on",
              fontSize: editorFontSize,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true },
              padding: { top: 8, bottom: 8 },
              smoothScrolling: true,
              cursorSmoothCaretAnimation: "on",
              renderLineHighlight: "all",
              overviewRulerBorder: false,
            }}
            height={typeof height === "number" ? height : "100%"}
          />
        </div>
      ) : (
        <div className="markdown-editor-preview">
          <FrontmatterCard value={extractFrontmatter(value) ?? undefined} />
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>
            {value}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
