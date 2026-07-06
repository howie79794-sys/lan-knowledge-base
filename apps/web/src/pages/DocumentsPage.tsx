import { ChevronLeft, ChevronRight, Copy, Download, FileText, Folder, FolderPlus, ListPlus, MoveRight, RefreshCcw, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Categories, DocumentDetail, DocumentSummary, FolderResponse } from "../api/client";
import {
  createParseJobsBatch,
  createFolder,
  deleteDocument,
  deleteFolder,
  fetchContent,
  fetchDocument,
  fetchDuplicateDocuments,
  fetchDocuments,
  fetchFolder,
  importMarkdownKnowledge,
  moveDocument,
  rawUrl,
  reprocessDocument,
  uploadDocument
} from "../api/client";
import { DocumentFilters, type Filters } from "../components/DocumentFilters";
import { DocumentTable } from "../components/DocumentTable";
import { StatusBadge } from "../components/StatusBadge";
import { copyText } from "../utils/clipboard";

const defaultFilters: Filters = { purpose: "", format: "", status: "", q: "" };
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const documentStatusLabels: Record<DocumentSummary["status"], string> = {
  uploaded: "未解析",
  queued: "队列中",
  processing: "解析中",
  ready: "已解析",
  failed: "解析失败",
  deleted: "已删除"
};

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
  const [totalDocuments, setTotalDocuments] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [currentFolder, setCurrentFolder] = useState(`/${purpose}`);
  const [folderInfo, setFolderInfo] = useState<FolderResponse | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [moveTargetPath, setMoveTargetPath] = useState(`/${purpose}`);
  const [movingSelected, setMovingSelected] = useState(false);
  const [queueingSelected, setQueueingSelected] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);

  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [uploader, setUploader] = useState("");
  const [project, setProject] = useState("");
  const [source, setSource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState<"raw" | "markdown">("raw");
  const [markdownFiles, setMarkdownFiles] = useState<File[]>([]);
  const [markdownText, setMarkdownText] = useState("");

  const stats = useMemo(() => {
    return {
      total: totalDocuments,
      pageTotal: documents.length,
      ready: documents.filter((doc) => doc.status === "ready").length,
      unprocessed: documents.filter((doc) => doc.status === "uploaded").length,
      queued: documents.filter((doc) => doc.status === "queued").length,
      failed: documents.filter((doc) => doc.status === "failed").length
    };
  }, [documents, totalDocuments]);

  const totalPages = Math.max(1, Math.ceil(totalDocuments / pageSize));
  const pageStart = totalDocuments ? (page - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(page * pageSize, totalDocuments);
  const selectedDocuments = useMemo(
    () => documents.filter((doc) => selectedDocumentIds.includes(doc.id)),
    [documents, selectedDocumentIds]
  );
  const normalizedMoveTarget = normalizeTypedFolderPath(moveTargetPath, purpose);
  const canMoveSelected =
    selectedDocumentIds.length > 0 &&
    !movingSelected &&
    normalizedMoveTarget.length > 0 &&
    selectedDocuments.some((doc) => doc.folder_path !== normalizedMoveTarget);
  const canQueueSelected = selectedDocumentIds.length > 0 && !queueingSelected;
  const canDeleteSelected = selectedDocumentIds.length === 1 && !deletingSelected;

  async function loadDocuments(nextSelectedId?: string) {
    const requestFolder = normalizeFolderForPurpose(currentFolder, purpose);
    if (requestFolder !== currentFolder) {
      setCurrentFolder(requestFolder);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchDocuments({
        purpose,
        format: filters.format,
        status: filters.status,
        q: filters.q,
        folder: currentFolder,
        limit: pageSize,
        offset: (page - 1) * pageSize
      });
      setTotalDocuments(data.total);
      setDocuments(data.documents);
      setSelectedDocumentIds((current) => current.filter((id) => data.documents.some((doc) => doc.id === id)));
      const preferredId = nextSelectedId ?? selectedId;
      if (!data.documents.some((doc) => doc.id === preferredId)) setSelectedId(data.documents[0]?.id ?? null);
      if (nextSelectedId && data.documents.some((doc) => doc.id === nextSelectedId)) setSelectedId(nextSelectedId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取资料失败。");
    } finally {
      setLoading(false);
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
    setCurrentFolder(`/${purpose}`);
    setFolderInfo(null);
    setNewFolderName("");
    setMessage("");
    setPage(1);
    setSelectedDocumentIds([]);
    setMoveTargetPath(`/${purpose}`);
  }, [purpose]);

  useEffect(() => {
    loadDocuments();
  }, [filters, refreshKey, purpose, page, pageSize, currentFolder]);

  useEffect(() => {
    loadFolder().catch((error) => setMessage(error instanceof Error ? error.message : "读取文件夹失败。"));
  }, [purpose, currentFolder, refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [filters.format, filters.status, filters.q, pageSize]);

  useEffect(() => {
    setPage(1);
    setSelectedId(null);
    setSelectedDocumentIds([]);
    setMoveTargetPath(currentFolder);
  }, [currentFolder]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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
    if (!files.length) {
      setMessage("请选择要上传的文件。");
      return;
    }
    setUploading(true);
    setMessage("");
    try {
      const uploadedIds: string[] = [];
      const overwrittenFiles: string[] = [];
      const skippedFiles: string[] = [];
      for (const selectedFile of files) {
        const duplicateData = await fetchDuplicateDocuments({
          purpose,
          folder: currentFolder,
          filename: selectedFile.name
        });
        const shouldOverwrite =
          duplicateData.documents.length > 0
            ? window.confirm(
                `${selectedFile.name}文件已经存在，是否要覆盖？如果覆盖，原来已经解析的内容将被删除。${
                  files.length > 1 ? "\n\n选择“取消”会跳过这个重复文件，并继续上传后面的文件。" : ""
                }`
              )
            : false;
        if (duplicateData.documents.length > 0 && !shouldOverwrite) {
          skippedFiles.push(selectedFile.name);
          continue;
        }

        const body = new FormData();
        body.set("file", selectedFile);
        body.set("purpose", purpose);
        body.set("folder_path", currentFolder);
        body.set("title", files.length === 1 ? title : "");
        body.set("uploader_name", uploader);
        body.set("project", project);
        body.set("source", source);
        if (shouldOverwrite) body.set("overwrite", "true");
        const result = await uploadDocument(body);
        uploadedIds.push(result.id);
        if (shouldOverwrite) overwrittenFiles.push(selectedFile.name);
      }
      if (!uploadedIds.length) {
        setMessage(skippedFiles.length ? `已跳过 ${skippedFiles.length} 个重复文件，没有上传新文件。` : "没有上传新文件。");
        return;
      }
      setFiles([]);
      setTitle("");
      const summaryParts = [`已上传 ${uploadedIds.length} 个文件到「${purpose}」，当前状态为未解析。`];
      if (overwrittenFiles.length) summaryParts.push(`覆盖 ${overwrittenFiles.length} 个重复文件。`);
      if (skippedFiles.length) summaryParts.push(`跳过 ${skippedFiles.length} 个重复文件。`);
      setMessage(summaryParts.join(""));
      onUploaded();
      await loadFolder();
      await loadDocuments(uploadedIds[uploadedIds.length - 1]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败。");
    } finally {
      setUploading(false);
    }
  }

  async function handleMarkdownImport() {
    const trimmedMarkdown = markdownText.trim();
    if (!markdownFiles.length && !trimmedMarkdown) {
      setMessage("请选择 Markdown 文件，或粘贴 Markdown 正文。");
      return;
    }
    if (markdownFiles.length && trimmedMarkdown) {
      setMessage("请在 Markdown 文件和粘贴正文中选择一种方式导入。");
      return;
    }
    if (!markdownFiles.length && !title.trim()) {
      setMessage("粘贴 Markdown 正文时，请先填写标题。");
      return;
    }

    setUploading(true);
    setMessage("");
    try {
      const importedIds: string[] = [];
      const overwrittenFiles: string[] = [];
      const skippedFiles: string[] = [];
      const entries = markdownFiles.length
        ? markdownFiles.map((file) => ({ file, filename: file.name }))
        : [{ file: null, filename: `${safeMarkdownFilename(title)}.md` }];

      for (const entry of entries) {
        const duplicateData = await fetchDuplicateDocuments({
          purpose,
          folder: currentFolder,
          filename: entry.filename
        });
        const shouldOverwrite =
          duplicateData.documents.length > 0
            ? window.confirm(
                `${entry.filename}文件已经存在，是否要覆盖？如果覆盖，原来已经解析的内容将被删除。${
                  entries.length > 1 ? "\n\n选择“取消”会跳过这个重复文件，并继续导入后面的文件。" : ""
                }`
              )
            : false;
        if (duplicateData.documents.length > 0 && !shouldOverwrite) {
          skippedFiles.push(entry.filename);
          continue;
        }

        const body = new FormData();
        if (entry.file) {
          body.set("file", entry.file);
        } else {
          body.set("markdown", trimmedMarkdown);
          body.set("filename", entry.filename);
        }
        body.set("purpose", purpose);
        body.set("folder_path", currentFolder);
        body.set("title", markdownFiles.length === 1 || !entry.file ? title : "");
        body.set("uploader_name", uploader);
        body.set("project", project);
        body.set("source", source);
        if (shouldOverwrite) body.set("overwrite", "true");
        const result = await importMarkdownKnowledge(body);
        importedIds.push(result.id);
        if (shouldOverwrite) overwrittenFiles.push(entry.filename);
      }

      if (!importedIds.length) {
        setMessage(skippedFiles.length ? `已跳过 ${skippedFiles.length} 个重复 Markdown，没有导入新知识。` : "没有导入新知识。");
        return;
      }
      setMarkdownFiles([]);
      setMarkdownText("");
      setTitle("");
      const summaryParts = [`已导入 ${importedIds.length} 条 Markdown 知识到「${purpose}」，状态为已解析。`];
      if (overwrittenFiles.length) summaryParts.push(`覆盖 ${overwrittenFiles.length} 个重复知识。`);
      if (skippedFiles.length) summaryParts.push(`跳过 ${skippedFiles.length} 个重复知识。`);
      setMessage(summaryParts.join(""));
      onUploaded();
      await loadFolder();
      await loadDocuments(importedIds[importedIds.length - 1]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入 Markdown 知识失败。");
    } finally {
      setUploading(false);
    }
  }

  async function handleReprocess(id: string) {
    const result = await reprocessDocument(id);
    setMessage(`已创建解析任务 ${result.job_id}，等待 Qoder Work 领取。`);
    loadDocuments(id);
  }

  async function handleDelete(id: string) {
    const doc = documents.find((item) => item.id === id) ?? (detail?.id === id ? detail : null);
    const titleText = doc?.title || "这条原始文件";
    const message =
      doc?.status === "uploaded"
        ? `确认删除「${titleText}」？该文件还没有被解析。`
        : `确认删除「${titleText}」？该文件不是未解析状态，删除原始文件会连已经解析的知识、解析结果和相关解析任务一起删除。`;
    if (!window.confirm(message)) return;
    await deleteDocument(id);
    setMessage(`已删除「${titleText}」。`);
    setSelectedId(null);
    setSelectedDocumentIds((current) => current.filter((selected) => selected !== id));
    await loadFolder();
    loadDocuments();
  }

  async function handleDeleteSelectedDocument() {
    if (selectedDocumentIds.length !== 1) {
      setMessage("暂时只支持选中单个文件删除，请只勾选一个原始文件。");
      return;
    }
    setDeletingSelected(true);
    try {
      await handleDelete(selectedDocumentIds[0]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除文件失败。");
    } finally {
      setDeletingSelected(false);
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) {
      setMessage("请输入文件夹名称。");
      return;
    }
    setCreatingFolder(true);
    setMessage("");
    try {
      const folder = await createFolder({ purpose, parent_path: currentFolder, name: newFolderName });
      setNewFolderName("");
      setMessage(`已创建文件夹：${folder.path}`);
      await loadFolder();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建文件夹失败。");
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleDeleteFolder(path: string) {
    const folderName = path.split("/").filter(Boolean).pop();
    if (!window.confirm(`确认删除空文件夹「${folderName || path}」？文件夹内有文件或下级文件夹时不会删除。`)) return;
    try {
      const deleted = await deleteFolder(purpose, path);
      setMessage(`已删除文件夹：${deleted.path}`);
      await loadFolder();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除文件夹失败。");
    }
  }

  async function handleMoveToCurrentFolder() {
    if (!detail || detail.folder_path === currentFolder) return;
    if (!window.confirm(`确认把「${detail.title}」移动到 ${currentFolder}？知识管理中的路径也会同步变化。`)) return;
    try {
      const moved = await moveDocument(detail.id, currentFolder);
      setDetail(moved);
      setMessage("已移动文件，知识管理中的路径会同步保持一致。");
      await loadFolder();
      await loadDocuments(moved.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移动文件失败。");
    }
  }

  function toggleDocumentSelection(id: string, checked: boolean) {
    setSelectedDocumentIds((current) => {
      if (checked) return [...new Set([...current, id])];
      return current.filter((selected) => selected !== id);
    });
  }

  function toggleAllVisibleDocuments(checked: boolean) {
    if (checked) {
      setSelectedDocumentIds((current) => [...new Set([...current, ...documents.map((doc) => doc.id)])]);
      return;
    }
    setSelectedDocumentIds((current) => current.filter((id) => !documents.some((doc) => doc.id === id)));
  }

  async function handleMoveSelectedDocuments() {
    if (!selectedDocumentIds.length) {
      setMessage("请先选择要移动的文件。");
      return;
    }
    const targetPath = normalizeTypedFolderPath(moveTargetPath, purpose);
    if (!targetPath) {
      setMessage("请输入目标文件夹路径。");
      return;
    }
    const idsToMove = selectedDocuments.filter((doc) => doc.folder_path !== targetPath).map((doc) => doc.id);
    if (!idsToMove.length) {
      setMessage("选中的文件已经在目标路径中。");
      return;
    }
    if (!window.confirm(`确认把 ${idsToMove.length} 个文件移动到 ${targetPath}？知识管理中的路径也会同步变化。`)) return;

    setMovingSelected(true);
    setMessage("");
    try {
      let movedCount = 0;
      let latestMovedId: string | undefined;
      for (const id of idsToMove) {
        const moved = await moveDocument(id, targetPath);
        latestMovedId = moved.id;
        movedCount += 1;
      }
      setSelectedDocumentIds([]);
      setMoveTargetPath(targetPath);
      setMessage(`已移动 ${movedCount} 个文件到 ${targetPath}。`);
      await loadFolder();
      await loadDocuments(latestMovedId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移动选中文件失败。");
    } finally {
      setMovingSelected(false);
    }
  }

  async function handleQueueSelectedDocuments() {
    if (!selectedDocumentIds.length) {
      setMessage("请先选择要添加至解析队列的文件。");
      return;
    }
    const invalidDocuments = selectedDocuments.filter((doc) => doc.status !== "uploaded");
    if (invalidDocuments.length) {
      const invalidNames = invalidDocuments
        .slice(0, 3)
        .map((doc) => `「${doc.title}」是${documentStatusLabels[doc.status] ?? doc.status}`)
        .join("、");
      const suffix = invalidDocuments.length > 3 ? ` 等 ${invalidDocuments.length} 个文件` : "";
      const text = `${invalidNames}${suffix}，不是未解析状态，不能添加至队列。请只选择未解析文件。`;
      setMessage(text);
      window.alert(text);
      return;
    }
    if (!window.confirm(`确认把选中的 ${selectedDocumentIds.length} 个未解析文件添加至解析队列？`)) return;

    setQueueingSelected(true);
    setMessage("");
    try {
      const result = await createParseJobsBatch({
        document_ids: selectedDocumentIds,
        limit: selectedDocumentIds.length,
        requested_by: "web"
      });
      setSelectedDocumentIds([]);
      setMessage(`已把 ${result.queued} 个未解析文件添加至解析队列，等待 Qoder Work 领取。`);
      await loadDocuments(result.document_ids[0] ?? selectedId ?? undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加至解析队列失败。");
    } finally {
      setQueueingSelected(false);
    }
  }

  function enterFolder(path: string) {
    setCurrentFolder(path);
  }

  async function copyAgentLink() {
    if (!detail) return;
    const url = `${window.location.origin}/api/v1/documents/${detail.id}/content?format=markdown`;
    const copied = await copyText(url);
    setMessage(copied ? "解析正文链接已复制。" : "浏览器限制了自动复制，请手动复制正文链接。");
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
          <span>本页 {stats.pageTotal}</span>
          <span>未解析 {stats.unprocessed}</span>
          <span>队列中 {stats.queued}</span>
        </div>
      </div>

      <DocumentFilters categories={categories} filters={filters} onChange={setFilters} onRefresh={() => loadDocuments()} mode="file-manager" />
      {message && <div className="notice">{message}</div>}

      <FolderNavigator
        currentFolder={currentFolder}
        purpose={purpose}
        folders={folderInfo?.folders ?? []}
        onEnter={enterFolder}
        onCreate={handleCreateFolder}
        newFolderName={newFolderName}
        onNewFolderNameChange={setNewFolderName}
        creating={creatingFolder}
        writable
        onDeleteFolder={handleDeleteFolder}
      />

      <div className="documentLayout">
        <div className="listPane">
          <div className="listToolbar">
            <div className="listToolbarMeta">
              <strong>{totalDocuments ? `${pageStart}-${pageEnd}` : "0"} / {totalDocuments}</strong>
              <span>{selectedDocumentIds.length ? `已选择 ${selectedDocumentIds.length} 个文件` : "按更新时间倒序"}</span>
            </div>
            <div className="listToolbarActions">
              <div className="bulkMoveControls">
                <input
                  className="compactPathInput"
                  value={moveTargetPath}
                  onChange={(event) => setMoveTargetPath(event.target.value)}
                  placeholder={`目标路径，如 /${purpose}/2026`}
                  title="目标文件夹路径"
                />
                <button className="compactButton" onClick={() => setMoveTargetPath(currentFolder)} title="填入当前路径">
                  当前
                </button>
                <button className="compactButton primaryCompact" onClick={handleMoveSelectedDocuments} disabled={!canMoveSelected}>
                  <MoveRight size={14} />
                  {movingSelected ? "移动中" : "移动"}
                </button>
              </div>
              <div className="selectionActionGroup">
                <button className="compactButton" onClick={handleQueueSelectedDocuments} disabled={!canQueueSelected}>
                  <ListPlus size={14} />
                  {queueingSelected ? "添加中" : "入队"}
                </button>
                <button className="compactButton dangerText" onClick={handleDeleteSelectedDocument} disabled={!canDeleteSelected}>
                  <Trash2 size={14} />
                  {deletingSelected ? "删除中" : "删除"}
                </button>
              </div>
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
          {loading && <div className="loadingLine">正在刷新资料...</div>}
          <DocumentTable
            documents={documents}
            selectedId={selectedId}
            selectedIds={selectedDocumentIds}
            onSelect={setSelectedId}
            onToggleSelect={toggleDocumentSelection}
            onToggleSelectAll={toggleAllVisibleDocuments}
            onReprocess={handleReprocess}
            onDelete={handleDelete}
          />
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

        <aside className="sidePanelStack">
          <div className="uploadCard">
            <div className="panelTitle">
              <h3>{uploadMode === "raw" ? "上传材料" : "导入 Markdown 知识"}</h3>
              <span>{purpose}</span>
            </div>
            <div className="uploadModeSwitch" role="tablist" aria-label="上传方式">
              <button className={uploadMode === "raw" ? "active" : ""} onClick={() => setUploadMode("raw")} type="button">
                原始文件
              </button>
              <button className={uploadMode === "markdown" ? "active" : ""} onClick={() => setUploadMode("markdown")} type="button">
                Markdown 知识
              </button>
            </div>
            {uploadMode === "raw" ? (
              <label className="dropzone compactDropzone">
                <UploadCloud size={28} />
                <span>{files.length ? selectedFileLabel(files) : "选择文件（可多选）"}</span>
                <small>上传后先保存为原始文件，批量上传默认使用各自文件名</small>
                <input
                  type="file"
                  multiple
                  onChange={(event) => {
                    const nextFiles = Array.from(event.target.files ?? []);
                    setFiles(nextFiles);
                    if (!title && nextFiles.length === 1) setTitle(nextFiles[0].name.replace(/\.[^.]+$/, ""));
                  }}
                />
              </label>
            ) : (
              <div className="markdownImportBox">
                <label className="dropzone compactDropzone">
                  <FileText size={28} />
                  <span>{markdownFiles.length ? selectedFileLabel(markdownFiles) : "选择 Markdown 文件（可多选）"}</span>
                  <small>导入后直接进入已解析状态，并出现在知识管理中</small>
                  <input
                    type="file"
                    accept=".md,.markdown,.txt,text/markdown,text/plain"
                    multiple
                    onChange={(event) => {
                      const nextFiles = Array.from(event.target.files ?? []);
                      setMarkdownFiles(nextFiles);
                      if (!title && nextFiles.length === 1) setTitle(nextFiles[0].name.replace(/\.[^.]+$/, ""));
                    }}
                  />
                </label>
                <label className="markdownTextField">
                  <span>或粘贴 Markdown 正文</span>
                  <textarea
                    value={markdownText}
                    onChange={(event) => setMarkdownText(event.target.value)}
                    placeholder="粘贴 Markdown 正文时，请填写标题；系统会保存为一份 .md 知识。"
                    disabled={markdownFiles.length > 0}
                  />
                </label>
              </div>
            )}
            <div className="compactForm">
              <label>
                当前上传位置
                <input value={currentFolder} readOnly />
              </label>
              <label>
                标题
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="单文件可填写；多文件默认使用各自文件名" />
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
              {uploadMode === "raw" ? (
                <button className="primaryButton" onClick={handleUpload} disabled={uploading}>
                  {uploading ? "上传中..." : files.length > 1 ? `上传 ${files.length} 个文件` : "上传到当前分类"}
                </button>
              ) : (
                <button className="primaryButton" onClick={handleMarkdownImport} disabled={uploading}>
                  {uploading ? "导入中..." : markdownFiles.length > 1 ? `导入 ${markdownFiles.length} 条知识` : "导入为已解析知识"}
                </button>
              )}
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
                    创建解析任务
                  </button>
                  <button className="secondaryButton" onClick={handleMoveToCurrentFolder} disabled={detail.folder_path === currentFolder}>
                    <MoveRight size={16} />
                    移动到当前文件夹
                  </button>
                  <button className="secondaryButton dangerText" onClick={() => handleDelete(detail.id)}>
                    <Trash2 size={16} />
                    删除记录
                  </button>
                </div>
                {detail.error_message && <div className="errorBox">{detail.error_message}</div>}
                <div className="contentPreview">
                  <div className="previewTitle">解析内容预览</div>
                  <pre>{content || "还没有解析。你可以在后台管理页创建解析任务，再由 Qoder Work 领取并回写结果。"}</pre>
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

export function FolderNavigator({
  currentFolder,
  purpose,
  folders,
  onEnter,
  onCreate,
  newFolderName,
  onNewFolderNameChange,
  creating,
  writable,
  onDeleteFolder
}: {
  currentFolder: string;
  purpose: string;
  folders: { name: string; path: string }[];
  onEnter: (path: string) => void;
  onCreate?: () => void;
  newFolderName?: string;
  onNewFolderNameChange?: (value: string) => void;
  creating?: boolean;
  writable?: boolean;
  onDeleteFolder?: (path: string) => void;
}) {
  const crumbs = buildBreadcrumbs(currentFolder, purpose);
  return (
    <div className="folderBrowser">
      <div className="folderBrowserTop">
        <div className="pathBlock">
          <span className="pathLabel">当前路径</span>
          <div className="pathBar">
            {crumbs.map((crumb, index) => (
              <button
                key={crumb.path}
                className={index === crumbs.length - 1 ? "breadcrumb active" : "breadcrumb"}
                onClick={() => onEnter(crumb.path)}
                title={crumb.path}
              >
                {crumb.name}
              </button>
            ))}
          </div>
        </div>
        {writable && (
          <div className="newFolderControls">
            <input
              value={newFolderName ?? ""}
              onChange={(event) => onNewFolderNameChange?.(event.target.value)}
              placeholder="新建文件夹名称"
              onKeyDown={(event) => {
                if (event.key === "Enter") onCreate?.();
              }}
            />
            <button className="secondaryButton" onClick={onCreate} disabled={creating}>
              <FolderPlus size={16} />
              {creating ? "创建中" : "新建文件夹"}
            </button>
          </div>
        )}
      </div>
      <div className="folderGrid">
        {folders.map((folder) => (
          <div key={folder.path} className="folderCard">
            <button className="folderOpenButton" onClick={() => onEnter(folder.path)} title={folder.path}>
              <Folder size={19} />
              <span>{folder.name}</span>
            </button>
            {writable && onDeleteFolder && (
              <button className="iconButton danger folderDeleteButton" onClick={() => onDeleteFolder(folder.path)} title="删除空文件夹">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        {!folders.length && <div className="folderEmpty">当前层级还没有下级文件夹。</div>}
      </div>
    </div>
  );
}

function buildBreadcrumbs(currentFolder: string, purpose: string) {
  const root = `/${purpose}`;
  const normalized = normalizeFolderForPurpose(currentFolder, purpose);
  const relativeParts = normalized.slice(root.length).split("/").filter(Boolean);
  const crumbs = [{ name: purpose, path: root }];
  let path = root;
  relativeParts.forEach((part) => {
    path = `${path}/${part}`;
    crumbs.push({ name: part, path });
  });
  return crumbs;
}

function normalizeFolderForPurpose(folder: string, purpose: string) {
  const root = `/${purpose}`;
  return folder === root || folder.startsWith(`${root}/`) ? folder : root;
}

function normalizeTypedFolderPath(value: string, purpose: string) {
  const root = `/${purpose}`;
  const trimmed = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!trimmed) return "";
  if (trimmed === root || trimmed.startsWith(`${root}/`)) return trimmed;
  const withoutSlash = trimmed.replace(/^\/+/, "");
  if (!withoutSlash) return root;
  if (withoutSlash === purpose || withoutSlash.startsWith(`${purpose}/`)) return `/${withoutSlash}`;
  return `${root}/${withoutSlash}`;
}

function selectedFileLabel(files: File[]) {
  if (files.length === 1) return files[0].name;
  const firstName = files[0]?.name ?? "";
  return `已选择 ${files.length} 个文件，首个：${firstName}`;
}

function safeMarkdownFilename(title: string) {
  return (title.trim() || "未命名知识").replace(/\.(md|markdown|txt)$/i, "").replace(/[\\/:*?"<>|]+/g, "_");
}
