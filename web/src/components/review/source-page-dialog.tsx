"use client";

import { SourceViewer, type SourceRef } from "@/components/review/source-viewer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type { SourceRef } from "@/components/review/source-viewer";

interface SourcePageDialogProps {
  source: SourceRef | null;
  open: boolean;
  onClose: () => void;
}

/** Full-size modal version of the source viewer (also the mobile fallback). */
export function SourcePageDialog({ source, open, onClose }: SourcePageDialogProps) {
  return (
    <Dialog open={open && Boolean(source)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Source document</DialogTitle>
          <DialogDescription className="font-mono text-xs">{source?.caption}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
          <SourceViewer source={source} size="modal" className="max-h-[75vh]" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
