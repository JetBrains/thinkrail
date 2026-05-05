import type { RefObject } from "react";
import type { Question } from "@/types/agent.ts";

interface QuestionOptionsPanelProps {
  question: Question;
  highlightedIndex: number;
  selectedIndex: number | null;
  checkedIndices: Set<number>;
  otherText: string;
  onOptionClick: (index: number) => void;
  onOtherTextChange: (text: string) => void;
  otherInputRef: RefObject<HTMLInputElement | null>;
}

export function QuestionOptionsPanel({
  question,
  highlightedIndex,
  selectedIndex,
  checkedIndices,
  otherText,
  onOptionClick,
  onOtherTextChange,
  otherInputRef,
}: QuestionOptionsPanelProps) {
  const otherIndex = question.options.length;
  const isMulti = question.multiSelect;

  return (
    <div className="chat-question-options-panel">
      {question.options.map((opt, i) => {
        const isHighlighted = i === highlightedIndex;
        const isSelected = isMulti ? checkedIndices.has(i) : i === selectedIndex;
        return (
          <button
            key={opt.label}
            className={`chat-question-option${isHighlighted ? " chat-question-option-highlighted" : ""}${isSelected ? " chat-question-option-selected" : ""}`}
            onClick={() => onOptionClick(i)}
          >
            <span className="chat-question-option-indicator">
              {isMulti
                ? (isSelected ? "\u2611" : "\u2610")
                : (isSelected ? "\u25CF" : "\u25CB")}
            </span>
            <span className="chat-question-option-label">{opt.label}</span>
          </button>
        );
      })}
      {/* Other option */}
      <div
        className={`chat-question-option${highlightedIndex === otherIndex ? " chat-question-option-highlighted" : ""}${(isMulti ? checkedIndices.has(otherIndex) : selectedIndex === otherIndex) ? " chat-question-option-selected" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => onOptionClick(otherIndex)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOptionClick(otherIndex);
          }
        }}
      >
        <span className="chat-question-option-indicator">
          {isMulti
            ? ((checkedIndices.has(otherIndex)) ? "\u2611" : "\u2610")
            : (selectedIndex === otherIndex ? "\u25CF" : "\u25CB")}
        </span>
        <span className="chat-question-option-label">Other:</span>
        <input
          ref={otherInputRef}
          className="chat-question-other-input"
          type="text"
          value={otherText}
          onChange={(e) => onOtherTextChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Type your answer..."
        />
      </div>
    </div>
  );
}
