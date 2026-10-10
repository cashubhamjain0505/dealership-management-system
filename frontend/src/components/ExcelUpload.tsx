import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileUp } from "lucide-react";

import { ApiError, apiUpload } from "@/lib/api";
import type { UploadResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  endpoint: string;
  templateKind: string;
  label: string;
  onUploaded: () => void;
  testId: string;
}

export default function ExcelUpload({ endpoint, templateKind, label, onUploaded, testId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const result = await apiUpload<UploadResult>(endpoint, file);
      const parts = [`${result.created} created`];
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.lines !== undefined) parts.push(`${result.lines} lines`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      if (result.errors.length) {
        toast.warning(
          `${parts.join(", ")} — ${result.errors.length} issue(s): ${result.errors.slice(0, 3).join(" · ")}`,
        );
      } else {
        toast.success(`Excel uploaded: ${parts.join(", ")}`);
      }
      onUploaded();
    } catch (error) {
      const message = error instanceof ApiError ? JSON.stringify(error.body) : String(error);
      toast.error(`Upload failed: ${message}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      data-testid={testId}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFile(e.dataTransfer.files[0]);
      }}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-dashed px-3 py-2 transition-colors duration-150",
        dragging ? "border-sky-500 bg-sky-50" : "border-slate-300 bg-white",
      )}
    >
      <FileUp className="h-5 w-5 shrink-0 text-sky-600" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{busy ? "Uploading…" : label}</p>
        <p className="truncate text-xs text-muted-foreground">Drop an .xlsx file here or browse</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
        data-testid={`${testId}-input`}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        data-testid={`${testId}-browse-button`}
      >
        Browse
      </Button>
      <a
        href={`/api/templates/${templateKind}`}
        className="flex shrink-0 items-center gap-1 text-xs font-medium text-sky-700 underline-offset-2 hover:underline"
        data-testid={`${testId}-template-link`}
      >
        <Download className="h-3.5 w-3.5" />
        Template
      </a>
    </div>
  );
}
