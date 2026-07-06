import { Copy, Database, Search } from "lucide-react";
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

export function KnowledgePage({ purpose }: { purpose: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [currentFolder, setCurrentFolder] = useState(`/${purpose}`);
  const [folderInfo, setFolderInfo] = useState<FolderResponse | null>(null);

  const overview = useMemo(() => {
    return {
      total: items.length,
      folders: new Set(items.map((item) => item.folder_path || "/")).size,
      sources: new Set(items.map((item) => item.original_filename)).size
    };
  }, [items]);

  async function load() {
    const requestFolder = normalizeFolderForPurpose(currentFolder, purpose);
    if (requestFolder !== currentFolder) {
      setCurrentFolder(requestFolder);
      return;
    }
    const data = await fetchKnowledge({ q, purpose, folder: currentFolder });
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
  }, [purpose]);

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "读取知识失败。"));
  }, [q, purpose, currentFolder]);

  useEffect(() => {
    loadFolder().catch((error) => setMessage(error instanceof Error ? error.message : "读取文件夹失败。"));
  }, [purpose, currentFolder]);

  useEffect(() => {
    setSelectedId(null);
  }, [currentFolder]);

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
          {items.length ? (
            <div className="tableWrap knowledgeTableWrap">
              <table className="knowledgeTable">
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
                  {items.map((item) => (
                    <tr key={item.id} className={selectedId === item.id ? "selectedRow" : ""} onClick={() => setSelectedId(item.id)}>
                      <td>
                        <div className="docTitle knowledgeDocTitle">{item.title}</div>
                        <div className="docMeta">{item.original_filename}</div>
                      </td>
                      <td>{item.purpose}</td>
                      <td>
                        <span className="formatPill">{formatLabels[item.file_format] ?? item.file_format}</span>
                      </td>
                      <td>{formatBytes(item.size_bytes)}</td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                      <td>{formatDate(item.updated_at)}</td>
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
