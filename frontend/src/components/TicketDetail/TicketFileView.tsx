import { useEffect, useState } from "react";
import { useFileStore } from "@/store/fileStore.ts";
import { FileViewer } from "@/components/FileViewer/FileViewer.tsx";

interface Props {
  filePath: string;
}

export function TicketFileView({ filePath }: Props) {
  const file = useFileStore((s) => s.openFiles.get(filePath));
  const openFile = useFileStore((s) => s.openFile);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    setAttempted(false);
    if (!file) {
      openFile(filePath).finally(() => setAttempted(true));
    }
  }, [filePath, file, openFile]);

  if (!file) {
    return (
      <div className="center-placeholder">
        {attempted
          ? `Waiting for ${filePath}… (agent hasn't written it yet)`
          : `Loading ${filePath}…`}
      </div>
    );
  }
  return <FileViewer file={file} />;
}
