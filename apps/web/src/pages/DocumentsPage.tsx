import { ArrowUp, Copy, ExternalLink, Folder, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Categories, DocumentDetail, DocumentSummary } from "../api/client";
import { deleteDocument, fetchContent, fetchDocument, fetchFolder, rawUrl, reprocessDocument } from "../api/client";
import { DocumentFilters, type Filters } from "../components/DocumentFilters";
import { DocumentTable } from "../components/DocumentTable";
import { StatusBadge } from "../components/StatusBadge";

const defaultFilters: Filters = { purpose: "", format: "", status: "", q: "" };

export function DocumentsPage({ categories, refreshKey }: { categories: Categories | null; refreshKey: number }) {
  const [filters, setFilters] = useState(defaultFilters);
  const [currentPath, setCurrentPath] = useState("/");
  const [folders, setFolders] = useState<{ name: string; path: string }[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const stats = useMemo(() => {
    return {
      total: documents.length,
      ready: documents.filter((doc) => doc.status === "ready").length,
      unprocessed: documents.filter((doc) => doc.status === "uploaded").length,
      failed: documents.filter((doc) => doc.status === "failed").length
    };
  }, [documents]);

  async function loadDocuments() {
    setLoading(true);
    try {
      const data = await fetchFolder(currentPath);
      let nextDocs = data.documents;
      if (filters.format) nextDocs = nextDocs.filter((doc) => doc.file_format === filters.format);
      if (filters.status) nextDocs = nextDocs.filter((doc) => doc.status === filters.status);
      if (filters.q) {
        const needle = filters.q.toLowerCase();
        nextDocs = nextDocs.filter((doc) => `${doc.title} ${doc.original_filename}`.toLowerCase().includes(needle));
      }
      setFolders(data.folders);
      setDocuments(nextDocs);
      if (!nextDocs.some((doc) => doc.id === selectedId)) setSelectedId(nextDocs[0]?.id ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取资料失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, [filters, refreshKey, currentPath]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setContent("");
      return;
    }
    fetchDocument(selectedId)
      .then(setDetail)
      .catch((error) => setMessage(error instanceof Error ? error.message : "读取详情失败。"));
    fetchContent(selectedId)
      .then(setContent)
      .catch(() => setContent(""));
  }, [selectedId]);

  async function handleReprocess(id: string) {
    await reprocessDocument(id);
    setMessage("已重新加入解析队列。");
    loadDocuments();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("确认删除这条资料记录？原文件会先保留在数据目录中，后续可做回收站。")) return;
    await deleteDocument(id);
    setSelectedId(null);
    loadDocuments();
  }

  function copyAgentLink() {
    if (!detail) return;
    const url = `${window.location.origin}/api/v1/documents/${detail.id}/content?format=markdown`;
    navigator.clipboard.writeText(url);
    setMessage("Agent 正文链接已复制。");
  }

  return (
    <section className="workspace">
      <div className="sectionHeader">
        <div>
          <h2>文件管理</h2>
          <p>像网盘一样按文件夹查看大家上传的原始资料；解析产物单独存放给 Agent 使用。</p>
        </div>
        <div className="metricStrip">
          <span>总数 {stats.total}</span>
          <span>可读 {stats.ready}</span>
          <span>未解析 {stats.unprocessed}</span>
          <span>失败 {stats.failed}</span>
        </div>
      </div>
      <div className="pathBar">
        <button className="iconButton" disabled={currentPath === "/"} onClick={() => setCurrentPath(parentPath(currentPath))} title="返回上级">
          <ArrowUp size={17} />
        </button>
        <button className={currentPath === "/" ? "breadcrumb active" : "breadcrumb"} onClick={() => setCurrentPath("/")}>
          全部文件
        </button>
        {currentPath
          .split("/")
          .filter(Boolean)
          .map((part, index, parts) => {
            const path = "/" + parts.slice(0, index + 1).join("/");
            return (
              <button key={path} className={path === currentPath ? "breadcrumb active" : "breadcrumb"} onClick={() => setCurrentPath(path)}>
                {part}
              </button>
            );
          })}
      </div>
      <DocumentFilters categories={categories} filters={filters} onChange={setFilters} onRefresh={loadDocuments} mode="file-manager" />
      {message && <div className="notice">{message}</div>}
      <div className="documentLayout">
        <div className="listPane">
          {loading && <div className="loadingLine">正在刷新资料...</div>}
          {!!folders.length && (
            <div className="folderGrid">
              {folders.map((folder) => (
                <button key={folder.path} className="folderCard" onClick={() => setCurrentPath(folder.path)}>
                  <Folder size={22} />
                  <span>{folder.name}</span>
                </button>
              ))}
            </div>
          )}
          <DocumentTable
            documents={documents}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReprocess={handleReprocess}
            onDelete={handleDelete}
          />
        </div>
        <aside className="detailPane">
          {detail ? (
            <>
              <div className="detailTop">
                <div>
                  <h3>{detail.title}</h3>
                  <p>{detail.original_filename}</p>
                </div>
                <StatusBadge status={detail.status} />
              </div>
              <dl className="detailGrid">
                <div>
                  <dt>文件作用</dt>
                  <dd>{detail.purpose}</dd>
                </div>
                <div>
                  <dt>所在文件夹</dt>
                  <dd>{detail.folder_path}</dd>
                </div>
                <div>
                  <dt>文件格式</dt>
                  <dd>{detail.file_format}</dd>
                </div>
                <div>
                  <dt>项目/客户</dt>
                  <dd>{detail.project || "未填写"}</dd>
                </div>
                <div>
                  <dt>上传人</dt>
                  <dd>{detail.uploader_name || "未填写"}</dd>
                </div>
              </dl>
              <div className="detailActions">
                <button className="secondaryButton" onClick={copyAgentLink} disabled={detail.status !== "ready"}>
                  <Copy size={16} />
                  复制正文链接
                </button>
                <a className="secondaryButton" href={rawUrl(detail.id)}>
                  <ExternalLink size={16} />
                  下载原文
                </a>
                <button className="secondaryButton" onClick={() => handleReprocess(detail.id)}>
                  <RefreshCcw size={16} />
                  重新解析
                </button>
                <button className="secondaryButton dangerText" onClick={() => handleDelete(detail.id)}>
                  <Trash2 size={16} />
                  删除记录
                </button>
              </div>
              {detail.error_message && <div className="errorBox">{detail.error_message}</div>}
              <div className="contentPreview">
                <div className="previewTitle">Markdown 预览</div>
                <pre>{content || "还没有解析。你可以在后台管理页统一解析所有未解析文件。"}</pre>
              </div>
            </>
          ) : (
            <div className="emptyDetail">选择一份资料查看详情。</div>
          )}
        </aside>
      </div>
    </section>
  );
}

function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}
