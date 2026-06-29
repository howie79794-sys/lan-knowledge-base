import { FileText } from "lucide-react";
import type { DocumentSummary } from "../api/client";
import { StatusBadge } from "./StatusBadge";

const formatLabels: Record<string, string> = {
  pdf: "PDF",
  ppt: "PPT",
  excel: "Excel",
  word: "Word",
  csv: "CSV",
  text: "Text",
  markdown: "MD"
};

export function DocumentTable({
  documents,
  selectedId,
  onSelect,
  onReprocess: _onReprocess,
  onDelete: _onDelete
}: {
  documents: DocumentSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReprocess: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!documents.length) {
    return (
      <div className="emptyState">
        <FileText size={28} />
        <p>还没有资料，先上传一份 PDF、PPT 或 Excel。</p>
      </div>
    );
  }

  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>资料</th>
            <th>作用</th>
            <th>格式</th>
            <th>大小</th>
            <th>状态</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className={selectedId === doc.id ? "selectedRow" : ""} onClick={() => onSelect(doc.id)}>
              <td>
                <div className="docTitle">{doc.title}</div>
                <div className="docMeta">{doc.original_filename}</div>
              </td>
              <td>{doc.purpose}</td>
              <td>
                <span className="formatPill">{formatLabels[doc.file_format] ?? doc.file_format}</span>
              </td>
              <td>{formatBytes(doc.size_bytes)}</td>
              <td>
                <StatusBadge status={doc.status} />
              </td>
              <td>{formatDate(doc.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
