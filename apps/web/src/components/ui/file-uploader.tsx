import { useId, useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileUploaderProps {
  label: string;
  accept?: string;
  maxSizeMB?: number;
  multiple?: boolean;
  value: File[];
  onChange: (files: File[]) => void;
  hint?: string;
}

/**
 * Drag-and-drop or click/keyboard to pick files, with client-side type and size checks.
 * Server-side validation and the virus-scan hook remain the source of truth.
 * Image crop/rotate/compress plugs in here in the KYC phase.
 */
export function FileUploader({
  label,
  accept = "image/*,application/pdf",
  maxSizeMB = 5,
  multiple = false,
  value,
  onChange,
  hint,
}: FileUploaderProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = (f: File) =>
    accept.split(",").some((a) => {
      const t = a.trim();
      return t.endsWith("/*") ? f.type.startsWith(t.slice(0, -1)) : f.type === t || f.name.toLowerCase().endsWith(t);
    });

  function take(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const bad = incoming.find((f) => !matches(f));
    if (bad) return setError(`${bad.name}: file type not allowed`);
    const big = incoming.find((f) => f.size > maxSizeMB * 1024 * 1024);
    if (big) return setError(`${big.name}: larger than ${maxSizeMB} MB`);
    setError(null);
    onChange(multiple ? [...value, ...incoming] : incoming.slice(0, 1));
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          "flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-4 text-center text-sm",
          dragging ? "border-primary bg-primary-soft" : "border-border-strong bg-surface",
        )}
      >
        <UploadCloud className="h-5 w-5 text-fg-muted" aria-hidden />
        <button
          type="button"
          className="min-h-touch font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => inputRef.current?.click()}
        >
          Choose file{multiple ? "s" : ""}
        </button>
        <span className="text-fg-muted">or drag and drop{hint ? ` · ${hint}` : ` · max ${maxSizeMB} MB`}</span>
        <input
          id={id}
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          onChange={(e) => take(e.target.files)}
        />
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
      {value.length > 0 && (
        <ul className="mt-2 space-y-1">
          {value.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-md bg-surface-muted px-2 py-1 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="ml-auto rounded p-1 hover:bg-neutral-soft"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
