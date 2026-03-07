interface QuestionPreviewPanelProps {
  description: string;
}

export function QuestionPreviewPanel({ description }: QuestionPreviewPanelProps) {
  return (
    <div className="chat-question-preview-panel">
      {description || (
        <span className="chat-question-preview-empty">
          Hover or navigate to an option to see its description
        </span>
      )}
    </div>
  );
}
