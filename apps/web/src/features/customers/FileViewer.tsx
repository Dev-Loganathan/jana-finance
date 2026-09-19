import { useQuery } from "@tanstack/react-query";
import { api, apiUrl } from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import type { CustomerFileInfo } from "./types";

/** Opens a document through a short-lived signed link (issued and audited by the API each time it opens). */
export function FileViewer({ file, onClose }: { file: CustomerFileInfo | null; onClose: () => void }) {
  const link = useQuery({
    queryKey: ["file-url", file?.id],
    queryFn: () => api<{ url: string }>(`/files/${file!.id}/url`),
    enabled: !!file,
    gcTime: 0,
    staleTime: 0,
  });
  return (
    <Modal
      open={!!file}
      onOpenChange={(o) => !o && onClose()}
      title={file ? `${file.label || "Document"} · ${file.originalName}` : "Document"}
      wide
    >
      {link.isLoading && <Skeleton className="h-64 w-full" />}
      {link.isError && (
        <p role="alert" className="text-sm text-danger">
          You do not have permission to view this file, or it is no longer available.
        </p>
      )}
      {link.data &&
        file &&
        (file.mimeType === "application/pdf" ? (
          <iframe
            title={file.originalName}
            src={apiUrl(link.data.url)}
            className="h-[70vh] w-full rounded-md border border-border"
          />
        ) : (
          <img
            src={apiUrl(link.data.url)}
            alt={file.originalName}
            className="mx-auto max-h-[70vh] rounded-md object-contain"
          />
        ))}
    </Modal>
  );
}
