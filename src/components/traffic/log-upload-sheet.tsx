"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ingestLogsAction } from "@/server/actions/traffic";

interface Props {
  projectId: string;
}

const MAX_BYTES = 4 * 1024 * 1024;

export function LogUploadSheet({ projectId }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const file = fileRef.current?.files?.[0];
      if (!file) {
        toast.error("Pick a log file first");
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.error("File is larger than 4MB — split it or use the beacon");
        return;
      }
      setBusy(true);
      const body = await file.text();
      const res = await ingestLogsAction({ projectId, body, format: "auto" });
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error ?? "Upload failed");
        return;
      }
      const { parsed, persisted, skipped } = res.data;
      toast.success(
        `Ingested ${persisted.toLocaleString()} AI-bot visits ` +
          `(parsed ${parsed.toLocaleString()}, skipped ${skipped.toLocaleString()})`,
      );
      setOpen(false);
      router.refresh();
    },
    [projectId, router],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Upload className="size-3.5" />
          Upload logs
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Upload access logs</SheetTitle>
        </SheetHeader>
        <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 p-4">
          <p className="text-xs text-muted-foreground">
            Accepts nginx/apache combined access logs or a CSV export from Cloudflare. Max
            4MB per upload — split larger files. Only rows matching a known AI crawler user
            agent are stored.
          </p>
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Log file</span>
            <input
              ref={fileRef}
              type="file"
              accept=".log,.txt,.csv,text/plain,text/csv,application/x-log"
              className="text-xs file:mr-3 file:rounded file:border-0 file:bg-muted/60 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
            />
          </label>
          <div className="mt-auto flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="ai" size="sm" disabled={busy}>
              {busy ? "Parsing…" : "Upload"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
