import { AlertCircle, CheckCircle2, Clock, LoaderCircle } from "lucide-react";
import type { DocumentSummary } from "../api/client";

const statusText: Record<DocumentSummary["status"], string> = {
  uploaded: "未解析",
  queued: "队列中",
  processing: "解析中",
  ready: "可读取",
  failed: "解析失败",
  deleted: "已删除"
};

export function StatusBadge({ status }: { status: DocumentSummary["status"] }) {
  const Icon = status === "ready" ? CheckCircle2 : status === "failed" ? AlertCircle : status === "processing" ? LoaderCircle : Clock;
  return (
    <span className={`status status-${status}`}>
      <Icon size={14} />
      {statusText[status]}
    </span>
  );
}
