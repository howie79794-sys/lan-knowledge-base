import { RotateCw, Search } from "lucide-react";
import type { Categories } from "../api/client";

export type Filters = {
  purpose: string;
  format: string;
  status: string;
  q: string;
};

export function DocumentFilters({
  categories,
  filters,
  onChange,
  onRefresh,
  mode = "default"
}: {
  categories: Categories | null;
  filters: Filters;
  onChange: (filters: Filters) => void;
  onRefresh: () => void;
  mode?: "default" | "file-manager";
}) {
  return (
    <div className={`filters ${mode === "file-manager" ? "fileManagerFilters" : ""}`}>
      <label className="searchBox">
        <Search size={17} />
        <input
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
          placeholder="搜索标题、文件名或正文"
        />
      </label>
      {mode === "default" && (
        <select value={filters.purpose} onChange={(event) => onChange({ ...filters, purpose: event.target.value })}>
          <option value="">全部作用</option>
          {categories?.purposes.map((purpose) => (
            <option key={purpose} value={purpose}>
              {purpose}
            </option>
          ))}
        </select>
      )}
      <select value={filters.format} onChange={(event) => onChange({ ...filters, format: event.target.value })}>
        <option value="">全部格式</option>
        {categories?.formats.map((format) => (
          <option key={format} value={format}>
            {format}
          </option>
        ))}
      </select>
      <select value={filters.status} onChange={(event) => onChange({ ...filters, status: event.target.value })}>
        <option value="">全部状态</option>
        <option value="ready">可读取</option>
        <option value="processing">解析中</option>
        <option value="failed">解析失败</option>
      </select>
      <button className="iconButton" onClick={onRefresh} title="刷新">
        <RotateCw size={17} />
      </button>
    </div>
  );
}
