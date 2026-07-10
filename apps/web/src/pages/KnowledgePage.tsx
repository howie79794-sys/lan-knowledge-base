import { ChevronLeft, ChevronRight, Copy, Database, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DocumentSummary, FolderResponse } from "../api/client";
import { fetchContent, fetchDocument, fetchFolder, fetchKnowledge, type DocumentDetail } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { copyText } from "../utils/clipboard";
import { FolderNavigator } from "./DocumentsPage";

const formatLabels: Record<string, string> = {
  pdf: "PDF",
  ppt: "PPT",
  excel: "Excel",
  word: "Word",
  csv: "CSV",
  text: "Text",
  markdown: "MD"
};
const PAGE_SIZE_OPTIONS = [20, 50, 100];

export function KnowledgePage({ purpose }: { purpose: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [totalKnowledge, setTotalKnowledge] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [currentFolder, setCurrentFolder] = useState(`/${purpose}`);
  const [folderInfo, setFolderInfo] = useState<FolderResponse | null>(null);

  const overview = useMemo(() => {
    return {
      total: totalKnowledge,
      folders: new Set(items.map((item) => item.folder_path || "/")).size,
      sources: new Set(items.map((item) => item.original_filename)).size
    };
  }, [items, totalKnowledge]);

  const totalPages = Math.max(1, Math.ceil(totalKnowledge / pageSize));
  const pageStart = totalKnowledge ? (page - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(page * pageSize, totalKnowledge);

  async function load() {
    const requestFolder = normalizeFolderForPurpose(currentFolder, purpose);
    if (requestFolder !== currentFolder) {
      setCurrentFolder(requestFolder);
      return;
    }
    const data = await fetchKnowledge({
      q,
      purpose,
      folder: currentFolder,
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    setTotalKnowledge(data.total);
    const nextTotalPages = Math.max(1, Math.ceil(data.total / pageSize));
    if (page > nextTotalPages) {
      setPage(nextTotalPages);
      return;
    }
    setItems(data.documents);
    if (!data.documents.some((item) => item.id === selectedId)) {
      setSelectedId(data.documents[0]?.id ?? null);
    }
  }

  async function loadFolder() {
    const requestFolder = normalizeFolderForPurpose(currentFolder, purpose);
    if (requestFolder !== currentFolder) {
      setCurrentFolder(requestFolder);
      return;
    }
    const data = await fetchFolder(requestFolder, purpose);
    setFolderInfo(data);
    const nextPath = normalizeFolderForPurpose(data.path, purpose);
    if (nextPath !== currentFolder) setCurrentFolder(nextPath);
  }

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setContent("");
    setMessage("");
    setCurrentFolder(`/${purpose}`);
    setFolderInfo(null);
    setPage(1);
    setTotalKnowledge(0);
  }, [purpose]);

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "读取知识失败。"));
  }, [q, purpose, currentFolder, page, pageSize]);

  useEffect(() => {
    loadFolder().catch((error) => setMessage(error instanceof Error ? error.message : "读取文件夹失败。"));
  }, [purpose, currentFolder]);

  useEffect(() => {
    setSelectedId(null);
    setPage(1);
  }, [currentFolder]);

  useEffect(() => {
    setPage(1);
  }, [q, pageSize]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setContent("");
      return;
    }
    fetchDocument(selectedId).then(setDetail).catch(() => setDetail(null));
    fetchContent(selectedId).then(setContent).catch(() => setContent(""));
  }, [selectedId]);

  async function copyKnowledgeLink() {
    if (!detail) return;
    const url = `${window.location.origin}/api/v1/documents/${detail.id}/content?format=markdown`;
    const copied = await copyText(url);
    setMessage(copied ? "知识正文链接已复制。" : "浏览器限制了自动复制，请手动复制地址栏或正文链接。");
  }

  async function copyOriginalFilename() {
    if (!detail) return;
    const copied = await copyText(detail.original_filename);
    setMessage(copied ? "来源文件名已复制。" : "浏览器限制了自动复制，请手动复制来源文件名。");
  }

  return (
    <section className="workspace">
      <div className="sectionHeader">
        <div>
          <h2>知识管理 · {purpose}</h2>
          <p>当前类型的解析知识概览；Agent 后续读取这里的 Markdown/Text 产物。</p>
        </div>
        <div className="metricStrip">
          <span>知识 {overview.total}</span>
          <span>路径 {overview.folders}</span>
          <span>来源 {overview.sources}</span>
        </div>
      </div>

      <div className="knowledgeToolbar">
        <label className="searchBox">
          <Search size={17} />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索知识标题、来源文件或正文" />
        </label>
      </div>

      {message && <div className="notice">{message}</div>}

      <FolderNavigator
        currentFolder={currentFolder}
        purpose={purpose}
        folders={folderInfo?.folders ?? []}
        onEnter={setCurrentFolder}
      />

      <div className="knowledgeLayout">
        <div className="knowledgeList">
          <div className="listToolbar">
            <div className="listToolbarMeta">
              <strong>{totalKnowledge ? `${pageStart}-${pageEnd}` : "0"} / {totalKnowledge}</strong>
              <span>按更新时间倒序</span>
            </div>
            <div className="listToolbarActions">
              <label className="pageSizeControl">
                每页
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {items.length ? (
            <div className="tableWrap knowledgeTableWrap">
              <table className="knowledgeTable">
                <thead>
                  <tr>
                    <th className="knowledgeNameColumn">资料</th>
                    <th className="knowledgeFormatColumn">格式</th>
                    <th className="knowledgeSizeColumn">大小</th>
                    <th className="knowledgeStatusColumn">状态</th>
                    <th className="knowledgeIndexedColumn">已索引</th>
                    <th className="knowledgeUpdatedColumn">更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={selectedId === item.id ? "selectedRow" : ""} onClick={() => setSelectedId(item.id)}>
                      <td className="knowledgeNameColumn">
                        <div className="docTitle knowledgeDocTitle" title={item.title}>
                          {item.title}
                        </div>
                        <div className="docMeta" title={item.original_filename}>
                          {item.original_filename}
                        </div>
                      </td>
                      <td className="knowledgeFormatColumn">
                        <span className="formatPill">{formatLabels[item.file_format] ?? item.file_format}</span>
                      </td>
                      <td className="knowledgeSizeColumn">{formatBytes(item.size_bytes)}</td>
                      <td className="knowledgeStatusColumn">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="knowledgeIndexedColumn">
                        <span className={item.wiki_compiled ? "compilePill compiled" : "compilePill"}>
                          {item.wiki_compiled ? "是" : "否"}
                        </span>
                      </td>
                      <td className="knowledgeUpdatedColumn">{formatDate(item.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="emptyState">
              <Database size={28} />
              <p>这个分类下还没有解析好的知识。请先到对应原始文件分类上传，再到后台统一解析。</p>
            </div>
          )}
          <div className="paginationBar">
            <button className="iconButton" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
              <ChevronLeft size={17} />
            </button>
            <span>
              第 {page} / {totalPages} 页
            </span>
            <button className="iconButton" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>
              <ChevronRight size={17} />
            </button>
          </div>
        </div>

        <aside className="detailPane">
          {detail ? (
            <>
              <div className="detailTop">
                <div>
                  <h3>{detail.title}</h3>
                  <p className="detailFilename" title={detail.original_filename}>
                    来源：{detail.original_filename}
                  </p>
                </div>
                <StatusBadge status={detail.status} />
              </div>
              <dl className="detailGrid">
                <div>
                  <dt>知识类型</dt>
                  <dd>{detail.purpose}</dd>
                </div>
                <div>
                  <dt>知识路径</dt>
                  <dd>{detail.folder_path}</dd>
                </div>
                <div>
                  <dt>来源格式</dt>
                  <dd>{detail.file_format}</dd>
                </div>
                <div>
                  <dt>上传人</dt>
                  <dd>{detail.uploader_name || "未填写"}</dd>
                </div>
              </dl>
              <div className="detailActions">
                <button className="secondaryButton" onClick={copyKnowledgeLink}>
                  <Copy size={16} />
                  复制知识链接
                </button>
                <button className="secondaryButton" onClick={copyOriginalFilename}>
                  <Copy size={16} />
                  复制来源文件名
                </button>
              </div>
              <div className="contentPreview">
                <div className="previewTitle">知识正文概览</div>
                <pre>{content || detail.content_excerpt || "暂无可展示内容。"}</pre>
              </div>
            </>
          ) : (
            <div className="emptyDetail">选择一条知识查看概览。</div>
          )}
        </aside>
      </div>
    </section>
  );
}

function normalizeFolderForPurpose(folder: string, purpose: string) {
  const root = `/${purpose}`;
  return folder === root || folder.startsWith(`${root}/`) ? folder : root;
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
