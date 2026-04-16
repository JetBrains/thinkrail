import { useCallback, useState } from "react";

interface CopyButtonProps {
  text: string;
  className?: string;
  children?: React.ReactNode;
}

/** Button that copies `text` to clipboard and shows a brief "Copied" confirmation. */
export function CopyButton({ text, className, children }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button className={className} onClick={handleClick} type="button">
      {copied ? "Copied" : (children ?? "Copy")}
    </button>
  );
}
