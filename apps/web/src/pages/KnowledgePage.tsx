import { Copy, Database, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DocumentSummary } from "../api/client";
import { fetchContent, fetchDocument, fetchKnowledge, type DocumentDetail } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function KnowledgePage({ purpose }: { purpose: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");

  const overview = useMemo(() => {
    return {
      total: items.length,
      folders: new Set(items.map((item) => item.folder_path || "/")).size,
      sources: new Set(items.map((item) => item.original_filename)).size
    };
  }, [items]);

  async function load() {
    const data = await fetchKnowledge({ q, purpose });
    setItems(data.documents);
    if (!data.documents.some((item) => item.id === selectedId)) {
      setSelectedId(data.documents[0]?.id ?? null);
    }
  }

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setContent("");
    setMessage("");
  }, [purpose]);

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "读取知识失败。"));
  }, [q, purpose]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setContent("");
      return;
    }
    fetchDocument(selectedId).then(setDetail).catch(() => setDetail(null));
    fetchContent(selectedId).then(setContent).catch(() => setContent(""));
  }, [selectedId]);

  function copyKnowledgeLink() {
    if (!detail) return;
    const url = `${window.location.origin}/api/v1/documents/${detail.id}/content?format=markdown`;
    navigator.clipboard.writeText(url);
    setMessage("知识正文链接已复制。");
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

      <div className="knowledgeLayout">
        <div className="knowledgeList">
          {!items.length && (
            <div className="emptyState">
              <Database size={28} />
              <p>这个分类下还没有解析好的知识。请先到对应原始文件分类上传，再到后台统一解析。</p>
            </div>
          )}
          {items.map((item) => (
            <button key={item.id} className={selectedId === item.id ? "knowledgeCard selected" : "knowledgeCard"} onClick={() => setSelectedId(item.id)}>
              <div className="knowledgeCardHeader">
                <strong>{item.title}</strong>
                <StatusBadge status={item.status} />
              </div>
              <p>{item.content_excerpt || "这条知识还没有可展示的概览。"}</p>
              <div className="knowledgeCardMeta">
                <span>{item.original_filename}</span>
                <span>{item.folder_path}</span>
              </div>
            </button>
          ))}
        </div>

        <aside className="detailPane">
          {detail ? (
            <>
              <div className="detailTop">
                <div>
                  <h3>{detail.title}</h3>
                  <p>来源：{detail.original_filename}</p>
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
