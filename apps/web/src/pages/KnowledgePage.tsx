import { Copy, Database, ExternalLink, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DocumentSummary } from "../api/client";
import { fetchContent, fetchDocument, fetchKnowledge, rawUrl, type DocumentDetail } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function KnowledgePage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");

  const grouped = useMemo(() => {
    const groups = new Map<string, DocumentSummary[]>();
    for (const item of items) {
      const key = item.folder_path || "/";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, "zh-CN"));
  }, [items]);

  async function load() {
    const data = await fetchKnowledge({ q });
    setItems(data.documents);
    if (!data.documents.some((item) => item.id === selectedId)) {
      setSelectedId(data.documents[0]?.id ?? null);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "读取知识失败。"));
  }, [q]);

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
          <h2>知识管理</h2>
          <p>管理由原始文件解析生成的知识内容。未来 Agent 只需要读取这里的知识。</p>
        </div>
        <div className="metricStrip">
          <span>知识 {items.length}</span>
          <span>来源 {new Set(items.map((item) => item.id)).size}</span>
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
              <p>还没有可用知识。请先在后台解析未解析文件。</p>
            </div>
          )}
          {grouped.map(([folder, docs]) => (
            <div className="knowledgeGroup" key={folder}>
              <div className="knowledgeFolder">{folder}</div>
              {docs.map((item) => (
                <button key={item.id} className={selectedId === item.id ? "knowledgeItem selected" : "knowledgeItem"} onClick={() => setSelectedId(item.id)}>
                  <strong>{item.title}</strong>
                  <span>{item.original_filename}</span>
                  <StatusBadge status={item.status} />
                </button>
              ))}
            </div>
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
                  <dt>知识路径</dt>
                  <dd>{detail.folder_path}</dd>
                </div>
                <div>
                  <dt>来源类型</dt>
                  <dd>{detail.file_format}</dd>
                </div>
                <div>
                  <dt>文件作用</dt>
                  <dd>{detail.purpose}</dd>
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
                <a className="secondaryButton" href={rawUrl(detail.id)}>
                  <ExternalLink size={16} />
                  查看原文件
                </a>
              </div>
              <div className="contentPreview">
                <div className="previewTitle">知识正文 Markdown</div>
                <pre>{content}</pre>
              </div>
            </>
          ) : (
            <div className="emptyDetail">选择一条知识查看内容。</div>
          )}
        </aside>
      </div>
    </section>
  );
}
