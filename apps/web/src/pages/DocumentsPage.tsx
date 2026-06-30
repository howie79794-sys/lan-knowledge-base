import { Copy, Download, RefreshCcw, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Categories, DocumentDetail, DocumentSummary } from "../api/client";
import { deleteDocument, fetchContent, fetchDocument, fetchDocuments, rawUrl, reprocessDocument, uploadDocument } from "../api/client";
import { DocumentFilters, type Filters } from "../components/DocumentFilters";
import { DocumentTable } from "../components/DocumentTable";
import { StatusBadge } from "../components/StatusBadge";

const defaultFilters: Filters = { purpose: "", format: "", status: "", q: "" };

export function DocumentsPage({
  categories,
  purpose,
  refreshKey,
  onUploaded
}: {
  categories: Categories | null;
  purpose: string;
  refreshKey: number;
  onUploaded: () => void;
}) {
  const [filters, setFilters] = useState(defaultFilters);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [folderPath, setFolderPath] = useState(`/${purpose}`);
  const [title, setTitle] = useState("");
  const [uploader, setUploader] = useState("");
  const [project, setProject] = useState("");
  const [source, setSource] = useState("");
  const [confidentiality, setConfidentiality] = useState("internal");
  const [uploading, setUploading] = useState(false);

  const stats = useMemo(() => {
    return {
      total: documents.length,
      ready: documents.filter((doc) => doc.status === "ready").length,
      unprocessed: documents.filter((doc) => doc.status === "uploaded").length,
      failed: documents.filter((doc) => doc.status === "failed").length
    };
  }, [documents]);

  async function loadDocuments(nextSelectedId?: string) {
    setLoading(true);
    try {
      const data = await fetchDocuments({
        purpose,
        format: filters.format,
        status: filters.status,
        q: filters.q
      });
      setDocuments(data.documents);
      const preferredId = nextSelectedId ?? selectedId;
      if (!data.documents.some((doc) => doc.id === preferredId)) setSelectedId(data.documents[0]?.id ?? null);
      if (nextSelectedId && data.documents.some((doc) => doc.id === nextSelectedId)) setSelectedId(nextSelectedId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取资料失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setContent("");
    setFolderPath(`/${purpose}`);
    setMessage("");
  }, [purpose]);

  useEffect(() => {
    loadDocuments();
  }, [filters, refreshKey, purpose]);

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

  async function handleUpload() {
    if (!file) {
      setMessage("请选择要上传的文件。");
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", purpose);
    body.set("folder_path", folderPath || `/${purpose}`);
    body.set("title", title);
    body.set("uploader_name", uploader);
    body.set("project", project);
    body.set("source", source);
    body.set("confidentiality", confidentiality);
    setUploading(true);
    setMessage("");
    try {
      const result = await uploadDocument(body);
      setFile(null);
      setTitle("");
      setMessage(`已上传到「${purpose}」，当前状态为未解析。`);
      onUploaded();
      await loadDocuments(result.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败。");
    } finally {
      setUploading(false);
    }
  }

  async function handleReprocess(id: string) {
    await reprocessDocument(id);
    setMessage("已重新加入解析队列。");
    loadDocuments(id);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("确认删除这条原始文件记录？")) return;
    await deleteDocument(id);
    setSelectedId(null);
    loadDocuments();
  }

  function copyAgentLink() {
    if (!detail) return;
    const url = `${window.location.origin}/api/v1/documents/${detail.id}/content?format=markdown`;
    navigator.clipboard.writeText(url);
    setMessage("解析正文链接已复制。");
  }

  return (
    <section className="workspace">
      <div className="sectionHeader">
        <div>
          <h2>原始文件 · {purpose}</h2>
          <p>当前类型的原始上传文件；解析产物会归入对应的知识分类。</p>
        </div>
        <div className="metricStrip">
          <span>总数 {stats.total}</span>
          <span>可读 {stats.ready}</span>
          <span>未解析 {stats.unprocessed}</span>
          <span>失败 {stats.failed}</span>
        </div>
      </div>

      <DocumentFilters categories={categories} filters={filters} onChange={setFilters} onRefresh={() => loadDocuments()} mode="file-manager" />
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

        <aside className="sidePanelStack">
          <div className="uploadCard">
            <div className="panelTitle">
              <h3>上传材料</h3>
              <span>{purpose}</span>
            </div>
            <label className="dropzone compactDropzone">
              <UploadCloud size={28} />
              <span>{file ? file.name : "选择文件"}</span>
              <small>上传后先保存为原始文件</small>
              <input
                type="file"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setFile(nextFile);
                  if (!title && nextFile) setTitle(nextFile.name.replace(/\.[^.]+$/, ""));
                }}
              />
            </label>
            <div className="compactForm">
              <label>
                文件夹路径
                <input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder={`/${purpose}/2026`} />
              </label>
              <label>
                标题
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="默认使用文件名" />
              </label>
              <label>
                上传人
                <input value={uploader} onChange={(event) => setUploader(event.target.value)} placeholder="例如 庄稼轩" />
              </label>
              <label>
                项目/客户
                <input value={project} onChange={(event) => setProject(event.target.value)} placeholder="可选" />
              </label>
              <label>
                来源
                <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="可选" />
              </label>
              <label>
                敏感等级
                <select value={confidentiality} onChange={(event) => setConfidentiality(event.target.value)}>
                  <option value="public">公开资料</option>
                  <option value="internal">内部资料</option>
                  <option value="sensitive">敏感资料</option>
                </select>
              </label>
              <button className="primaryButton" onClick={handleUpload} disabled={uploading}>
                {uploading ? "上传中..." : "上传到当前分类"}
              </button>
            </div>
          </div>

          <div className="detailPane">
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
                  <a className="secondaryButton" href={rawUrl(detail.id)}>
                    <Download size={16} />
                    下载原始文件
                  </a>
                  <button className="secondaryButton" onClick={copyAgentLink} disabled={detail.status !== "ready"}>
                    <Copy size={16} />
                    复制解析正文
                  </button>
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
                  <div className="previewTitle">解析内容预览</div>
                  <pre>{content || "还没有解析。你可以在后台管理页统一解析所有未解析文件。"}</pre>
                </div>
              </>
            ) : (
              <div className="emptyDetail">选择一份原始文件查看详情。</div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
