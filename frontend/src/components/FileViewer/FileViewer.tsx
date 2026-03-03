import { useCallback, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useFileStore, type OpenFile } from "@/store/fileStore.ts";
import { intellijDarcula } from "./intellijTheme.ts";
import { detectLanguage, languageLabel } from "./languageMap.ts";
import { EditDropdown } from "./EditDropdown.tsx";
import { MarkdownPreview } from "./MarkdownPreview.tsx";
import "./FileViewer.css";

const THEME_NAME = "intellij-darcula";

export function FileViewer({ file }: { file: OpenFile }) {
  const setMode = useFileStore((s) => s.setMode);
  const updateContent = useFileStore((s) => s.updateContent);
  const saveFile = useFileStore((s) => s.saveFile);
  const openExternal = useFileStore((s) => s.openExternal);
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const themeRegistered = useRef(false);

  const handleMount: OnMount = (_editor, monaco) => {
    if (!themeRegistered.current) {
      monaco.editor.defineTheme(THEME_NAME, intellijDarcula);
      themeRegistered.current = true;
    }
    monaco.editor.setTheme(THEME_NAME);
  };

  const handleEditInPlace = useCallback(() => {
    setMode(file.path, "edit");
    setShowDropdown(false);
  }, [file.path, setMode]);

  const handleOpenIdea = useCallback(() => {
    openExternal(file.path, "idea");
    setShowDropdown(false);
  }, [file.path, openExternal]);

  const handleOpenVscode = useCallback(() => {
    openExternal(file.path, "code");
    setShowDropdown(false);
  }, [file.path, openExternal]);

  const handleOpenVim = useCallback(() => {
    openExternal(file.path, "vim");
    setShowDropdown(false);
  }, [file.path, openExternal]);

  const handleSave = useCallback(() => {
    saveFile(file.path);
  }, [file.path, saveFile]);

  const handleCancel = useCallback(() => {
    updateContent(file.path, file.originalContent);
    setMode(file.path, "preview");
  }, [file.path, file.originalContent, updateContent, setMode]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [file.content]);

  const language = detectLanguage(file.name);
  const langLabel = languageLabel(file.name);
  const isMarkdown = file.name.endsWith(".md") || file.name.endsWith(".markdown");
  const showMarkdownPreview = isMarkdown && file.mode === "preview";
  const lineCount = file.content.split("\n").length;
  const sizeKb = (new TextEncoder().encode(file.content).length / 1024).toFixed(1);

  return (
    <div className="fv">
      {/* Toolbar */}
      <div className="fv-toolbar">
        <div className="fv-toolbar-left">
          <span className="fv-path">{file.path}</span>
          <span className="fv-lang-badge">{langLabel}</span>
          <span className="fv-meta">{lineCount} lines</span>
          <span className="fv-meta">{sizeKb} KB</span>
        </div>
        <div className="fv-actions">
          <button className="fv-btn" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy"}
          </button>
          {file.mode === "edit" ? (
            <>
              <button
                className="fv-btn fv-btn-save"
                onClick={handleSave}
                disabled={!file.isDirty || file.saving}
              >
                {file.saving ? "Saving..." : "Save"}
              </button>
              <button className="fv-btn" onClick={handleCancel}>
                Cancel
              </button>
            </>
          ) : (
            <div style={{ position: "relative" }}>
              <button
                className="fv-btn fv-btn-edit"
                onClick={() => setShowDropdown(!showDropdown)}
              >
                Edit
              </button>
              {showDropdown && (
                <EditDropdown
                  onEditInPlace={handleEditInPlace}
                  onOpenIdea={handleOpenIdea}
                  onOpenVscode={handleOpenVscode}
                  onOpenVim={handleOpenVim}
                  onClose={() => setShowDropdown(false)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content: Markdown preview OR Monaco Editor */}
      {showMarkdownPreview ? (
        <div className="fv-editor-container">
          <MarkdownPreview content={file.content} />
        </div>
      ) : (
      <div className="fv-editor-container">
        <Editor
          value={file.content}
          language={language}
          theme={THEME_NAME}
          onMount={handleMount}
          onChange={(val) => {
            if (file.mode === "edit") {
              updateContent(file.path, val ?? "");
            }
          }}
          options={{
            readOnly: file.mode === "preview",
            minimap: { enabled: true },
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
            renderLineHighlight: "all",
            bracketPairColorization: { enabled: true },
            guides: { indentation: true, bracketPairs: true },
            padding: { top: 8 },
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            wordWrap: "off",
            automaticLayout: true,
          }}
          loading={<div className="fv-loading">Loading editor...</div>}
        />
      </div>
      )}
    </div>
  );
}
