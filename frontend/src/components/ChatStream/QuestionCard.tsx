import { useState, useRef, useCallback, useEffect } from "react";
import type { Question } from "@/types/agent.ts";
import { isMod, modLabel } from "@/utils/platform.ts";
import { AnsweredTable } from "./AnsweredTable.tsx";
import { QuestionTabBar } from "./QuestionTabBar.tsx";
import { QuestionOptionsPanel } from "./QuestionOptionsPanel.tsx";
import { QuestionPreviewPanel } from "./QuestionPreviewPanel.tsx";

interface QuestionCardProps {
  questions: Question[];
  answered: boolean;
  interrupted?: boolean;
  expired?: boolean;
  selectedAnswers?: Record<string, string>;
  onSubmit: (response: Record<string, unknown>) => void;
  compact?: boolean;
  requestId?: string;
}

export function QuestionCard({
  questions,
  answered,
  interrupted,
  expired,
  selectedAnswers,
  onSubmit,
  compact = false,
  requestId,
}: QuestionCardProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [highlighted, setHighlighted] = useState<Record<number, number>>(() =>
    Object.fromEntries(questions.map((_, i) => [i, 0])),
  );
  const [selectedSingle, setSelectedSingle] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(questions.map((_, i) => [i, null])),
  );
  const [checkedItems, setCheckedItems] = useState<Record<number, Set<number>>>(() =>
    Object.fromEntries(questions.map((_, i) => [i, new Set<number>()])),
  );
  const [otherText, setOtherText] = useState<Record<number, string>>(() =>
    Object.fromEntries(questions.map((_, i) => [i, ""])),
  );
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs always hold the latest state so callbacks that fire asynchronously
  // (e.g. the 150ms auto-advance timer) never read stale closures.
  const selectedSingleRef = useRef(selectedSingle);
  selectedSingleRef.current = selectedSingle;
  const checkedItemsRef = useRef(checkedItems);
  checkedItemsRef.current = checkedItems;
  const otherTextRef = useRef(otherText);
  otherTextRef.current = otherText;

  // Focus container on mount so keyboard works immediately
  useEffect(() => {
    if (!answered) containerRef.current?.focus();
  }, [answered]);

  const q = questions[activeTab];
  const isMulti = q?.multiSelect ?? false;
  const optionCount = (q?.options.length ?? 0) + 1; // +1 for "Other"
  const otherIndex = q?.options.length ?? 0;

  // Always reads current state via refs — safe to call from stale closures.
  const getAnswerForQuestion = useCallback(
    (qIdx: number): string | null => {
      const question = questions[qIdx];
      if (question.multiSelect) {
        const checked = checkedItemsRef.current[qIdx];
        if (!checked || checked.size === 0) return null;
        const labels: string[] = [];
        for (const idx of checked) {
          if (idx === question.options.length) {
            labels.push(`Other: ${otherTextRef.current[qIdx] || ""}`);
          } else {
            labels.push(question.options[idx].label);
          }
        }
        return labels.join(", ");
      } else {
        const sel = selectedSingleRef.current[qIdx];
        if (sel === null || sel === undefined) return null;
        if (sel === question.options.length) {
          return `Other: ${otherTextRef.current[qIdx] || ""}`;
        }
        return question.options[sel].label;
      }
    },
    [questions],
  );

  const answeredIndices = new Set<number>();
  for (let i = 0; i < questions.length; i++) {
    if (getAnswerForQuestion(i) !== null) answeredIndices.add(i);
  }

  // Keep a ref so advanceToNext always checks the latest answered state.
  const answeredIndicesRef = useRef(answeredIndices);
  answeredIndicesRef.current = answeredIndices;

  // Reset confirming when tab changes or answers change
  useEffect(() => setConfirmingSubmit(false), [activeTab, answeredIndices.size]);

  const submitAll = useCallback(() => {
    const answers: Record<string, string> = {};
    for (let i = 0; i < questions.length; i++) {
      const a = getAnswerForQuestion(i);
      if (a !== null) answers[questions[i].question] = a;
    }
    onSubmit({ questions, answers });
  }, [questions, getAnswerForQuestion, onSubmit]);

  const handleSubmit = useCallback(() => {
    if (answeredIndicesRef.current.size < questions.length && !confirmingSubmit) {
      setConfirmingSubmit(true);
      return;
    }
    submitAll();
  }, [questions.length, confirmingSubmit, submitAll]);

  const advanceToNext = useCallback(() => {
    for (let offset = 1; offset <= questions.length; offset++) {
      const next = (activeTab + offset) % questions.length;
      if (!answeredIndicesRef.current.has(next)) {
        setActiveTab(next);
        return;
      }
    }
    // All answered — submit
    submitAll();
  }, [activeTab, questions.length, submitAll]);

  const handleOptionClick = useCallback(
    (index: number) => {
      setHighlighted((prev) => ({ ...prev, [activeTab]: index }));
      if (isMulti) {
        setCheckedItems((prev) => {
          const next = new Set(prev[activeTab]);
          if (next.has(index)) next.delete(index);
          else next.add(index);
          return { ...prev, [activeTab]: next };
        });
      } else {
        setSelectedSingle((prev) => ({ ...prev, [activeTab]: index }));
        // Cancel any pending auto-advance before scheduling a new one,
        // so changing selection before the timer fires doesn't submit the old choice.
        if (autoAdvanceTimer.current !== null) clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = setTimeout(() => {
          autoAdvanceTimer.current = null;
          advanceToNext();
        }, 150);
      }
      if (index === otherIndex) {
        setTimeout(() => otherInputRef.current?.focus(), 0);
      }
    },
    [activeTab, isMulti, otherIndex, advanceToNext],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // When other input is focused, only handle Escape
      if (document.activeElement === otherInputRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          containerRef.current?.focus();
        }
        return;
      }

      if (isMod(e) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setActiveTab((prev) => (prev - 1 + questions.length) % questions.length);
          break;
        case "ArrowRight":
          e.preventDefault();
          setActiveTab((prev) => (prev + 1) % questions.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlighted((prev) => ({
            ...prev,
            [activeTab]: ((prev[activeTab] ?? 0) - 1 + optionCount) % optionCount,
          }));
          break;
        case "ArrowDown":
          e.preventDefault();
          setHighlighted((prev) => ({
            ...prev,
            [activeTab]: ((prev[activeTab] ?? 0) + 1) % optionCount,
          }));
          break;
        case "Enter": {
          e.preventDefault();
          const hi = highlighted[activeTab] ?? 0;
          handleOptionClick(hi);
          break;
        }
      }
    },
    [activeTab, questions.length, optionCount, highlighted, handleOptionClick, handleSubmit],
  );

  // Expired state (timeout): compact single-line
  if (compact && expired) {
    const firstQ = questions[0];
    return (
      <div className="compact-log" style={{ borderLeftColor: "var(--comment)" }} data-question-request-id={requestId}>
        <span className="compact-log-icon">{"\u23F1"}</span>
        <span className="compact-log-name" style={{ color: "var(--comment)" }}>Question</span>
        <span className="compact-log-detail" style={{ opacity: 0.6 }}>
          {firstQ?.question ?? "Question"}
          {questions.length > 1 ? ` (+${questions.length - 1} more)` : ""}
        </span>
        <span
          className="compact-approval-badge"
          style={{
            background: "rgba(128, 128, 128, 0.12)",
            color: "var(--comment)",
          }}
        >
          timed out
        </span>
      </div>
    );
  }

  // Expired state (timeout): classic
  if (expired) {
    return (
      <div className="chat-question chat-question-answered" style={{ opacity: 0.6 }} data-question-request-id={requestId}>
        <div className="chat-question-answered-header-row">
          <span className="chat-question-header">AskUserQuestion</span>
          <span className="chat-question-answered-done chat-question-answered-interrupted">
            {"\u23F1"} timed out
          </span>
        </div>
      </div>
    );
  }

  // Compact answered state: single log-line with answer badge
  if (compact && answered && (selectedAnswers || interrupted)) {
    const firstQ = questions[0];
    const firstAnswer = selectedAnswers?.[firstQ?.question ?? ""];
    const answerLabel = interrupted
      ? "interrupted"
      : firstAnswer
        ? (firstAnswer.length > 40 ? firstAnswer.slice(0, 40) + "\u2026" : firstAnswer)
        : "answered";
    return (
      <div className="compact-log" style={{ borderLeftColor: interrupted ? "var(--red)" : "var(--blue)" }} data-question-request-id={requestId}>
        <span className="compact-log-icon">{"\u2753"}</span>
        <span className="compact-log-name" style={{ color: "var(--blue)" }}>Question</span>
        <span className="compact-log-detail">
          {firstQ?.question ?? "Question"}
          {questions.length > 1 ? ` (+${questions.length - 1} more)` : ""}
        </span>
        <span
          className="compact-approval-badge"
          style={{
            background: interrupted ? "rgba(247, 118, 142, 0.12)" : "rgba(122, 162, 247, 0.12)",
            color: interrupted ? "var(--red)" : "var(--blue)",
          }}
        >
          {interrupted ? "\u2718" : ""} {answerLabel}
        </span>
      </div>
    );
  }

  // Answered state (classic)
  if (answered && (selectedAnswers || interrupted)) {
    return (
      <div className="chat-question chat-question-answered" data-question-request-id={requestId}>
        <div className="chat-question-answered-header-row">
          <span className="chat-question-header">AskUserQuestion</span>
          <span className={`chat-question-answered-done${interrupted ? " chat-question-answered-interrupted" : ""}`}>
            {interrupted ? "\u2718 interrupted" : "\u2713 done"}
          </span>
        </div>
        {!interrupted && selectedAnswers && (
          <AnsweredTable questions={questions} answers={selectedAnswers} />
        )}
      </div>
    );
  }

  // Get description for currently highlighted option
  const hi = highlighted[activeTab] ?? 0;
  const previewDesc =
    hi < (q?.options.length ?? 0)
      ? (q?.options[hi]?.description ?? "")
      : "";

  return (
    <div
      className="chat-question"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {questions.length > 1 && (
        <QuestionTabBar
          questions={questions}
          activeIndex={activeTab}
          answeredIndices={answeredIndices}
          onTabClick={setActiveTab}
        />
      )}

      {q && (
        <>
          <div className="chat-question-header">{q.header}</div>
          <div className="chat-question-text">{q.question}</div>

          <div className="chat-question-body">
            <QuestionOptionsPanel
              question={q}
              highlightedIndex={highlighted[activeTab] ?? 0}
              selectedIndex={selectedSingle[activeTab] ?? null}
              checkedIndices={checkedItems[activeTab] ?? new Set()}
              otherText={otherText[activeTab] ?? ""}
              onOptionClick={handleOptionClick}
              onOtherTextChange={(text) =>
                setOtherText((prev) => ({ ...prev, [activeTab]: text }))
              }
              otherInputRef={otherInputRef}
            />
            <QuestionPreviewPanel description={previewDesc} />
          </div>

          <div className="chat-question-submit-hint">
            {confirmingSubmit ? (
              <>
                <span className="chat-question-warning">
                  {questions.length - answeredIndices.size} of {questions.length} unanswered
                </span>
                <button className="chat-btn chat-btn-primary" onClick={submitAll}>
                  Submit anyway
                </button>
                <button className="chat-btn" onClick={() => setConfirmingSubmit(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                {questions.length > 1 && answeredIndices.size < questions.length && (
                  <button className="chat-btn" onClick={advanceToNext}>
                    Next &rarr;
                  </button>
                )}
                <button className="chat-btn chat-btn-primary" onClick={handleSubmit}>
                  {questions.length === 1 ? "Submit" : "Submit all"}
                </button>
                <span>
                  {isMulti ? "Enter toggles" : "Enter selects"}
                  {questions.length > 1 ? " / \u2190\u2192 switches" : ""}
                  {` / ${modLabel("Enter")} submits`}
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
