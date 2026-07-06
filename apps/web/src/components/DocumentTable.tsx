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
  selectedIds,
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onReprocess: _onReprocess,
  onDelete: _onDelete
}: {
  documents: DocumentSummary[];
  selectedId: string | null;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
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

  const selectedIdSet = new Set(selectedIds);
  const allVisibleSelected = documents.length > 0 && documents.every((doc) => selectedIdSet.has(doc.id));

  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th className="selectColumn">
              <input
                className="rowCheckbox"
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(event) => onToggleSelectAll(event.target.checked)}
                aria-label="选择本页全部文件"
              />
            </th>
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
              <td className="selectColumn" onClick={(event) => event.stopPropagation()}>
                <input
                  className="rowCheckbox"
                  type="checkbox"
                  checked={selectedIdSet.has(doc.id)}
                  onChange={(event) => onToggleSelect(doc.id, event.target.checked)}
                  aria-label={`选择 ${doc.title}`}
                />
              </td>
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
