import { Copy, ExternalLink, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Categories, DocumentDetail, DocumentSummary } from "../api/client";
import { deleteDocument, fetchContent, fetchDocument, fetchDocuments, rawUrl, reprocessDocument } from "../api/client";
import { DocumentFilters, type Filters } from "../components/DocumentFilters";
import { DocumentTable } from "../components/DocumentTable";
import { StatusBadge } from "../components/StatusBadge";

const defaultFilters: Filters = { purpose: "", format: "", status: "", q: "" };

export function DocumentsPage({ categories, refreshKey }: { categories: Categories | null; refreshKey: number }) {
  const [filters, setFilters] = useState(defaultFilters);
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
      failed: documents.filter((doc) => doc.status === "failed").length
    };
  }, [documents]);

  async function loadDocuments() {
    setLoading(true);
    try {
      const data = await fetchDocuments(filters);
      setDocuments(data.documents);
      if (!selectedId && data.documents[0]) setSelectedId(data.documents[0].id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取资料失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, [filters, refreshKey]);

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
          <h2>资料总览</h2>
          <p>按作用、格式、状态和关键词检索局域网资料。</p>
        </div>
        <div className="metricStrip">
          <span>总数 {stats.total}</span>
          <span>可读 {stats.ready}</span>
          <span>失败 {stats.failed}</span>
        </div>
      </div>
      <DocumentFilters categories={categories} filters={filters} onChange={setFilters} onRefresh={loadDocuments} />
      {message && <div className="notice">{message}</div>}
      <div className="documentLayout">
        <div className="listPane">
          {loading && <div className="loadingLine">正在刷新资料...</div>}
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
                <button className="secondaryButton" onClick={copyAgentLink}>
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
                <pre>{content || "解析完成后，这里会显示 Agent 可读正文。"}</pre>
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
