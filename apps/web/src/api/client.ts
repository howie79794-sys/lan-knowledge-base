export type DocumentSummary = {
  id: string;
  title: string;
  original_filename: string;
  file_format: string;
  file_ext: string;
  source_kind?: "file" | "direct_markdown" | "markdown_bundle" | string;
  folder_path: string;
  size_bytes: number;
  status: "uploaded" | "queued" | "processing" | "ready" | "failed" | "deleted";
  purpose: string;
  uploader_name?: string | null;
  confidentiality: string;
  content_excerpt?: string | null;
  error_message?: string | null;
  wiki_compiled?: boolean;
  wiki_updated_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentDetail = DocumentSummary & {
  source?: string | null;
  project?: string | null;
  storage_path: string;
  checksum_sha256: string;
  mime_type?: string | null;
};

export type Categories = {
  purposes: string[];
  formats: string[];
};

export type FolderEntry = {
  name: string;
  path: string;
};

export type FolderResponse = {
  path: string;
  parent: string | null;
  folders: FolderEntry[];
  documents: DocumentSummary[];
};

export type AuditLog = {
  id: string;
  actor?: string | null;
  action: string;
  document_id?: string | null;
  ip?: string | null;
  message?: string | null;
  created_at: string;
};

export type ParseQueueItem = {
  document_id: string;
  title: string;
  original_filename: string;
  file_format: string;
  source_kind?: string;
  job_type?: string | null;
  folder_path: string;
  purpose: string;
  size_bytes: number;
  document_status: DocumentSummary["status"];
  document_updated_at: string;
  job_id?: string | null;
  job_status?: string | null;
  worker?: string | null;
  attempts?: number | null;
  error_message?: string | null;
  job_updated_at?: string | null;
};

export type WikiPage = {
  id: string;
  page_type: "category_overview" | "document_summary";
  title: string;
  purpose?: string | null;
  source_document_id?: string | null;
  summary: string;
  content: string;
  keywords: string[];
  compile_method?: "local" | "smart";
  status: string;
  created_at: string;
  updated_at: string;
  page_url?: string;
  content_url?: string;
  raw_url?: string;
};

export type WikiCompileJob = {
  id: string;
  status: string;
  job_type?: string;
  source_document_id?: string | null;
  purpose?: string | null;
  total_documents: number;
  compiled_pages: number;
  worker?: string | null;
  attempts?: number | null;
  requested_by?: string | null;
  result_page_id?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  created_at: string;
  finished_at?: string | null;
  updated_at: string;
};

export type WikiCompileQueueItem = WikiCompileJob & {
  document: {
    id: string;
    title: string;
    original_filename: string;
    file_format: string;
    folder_path: string;
    purpose?: string | null;
    size_bytes: number;
    updated_at: string;
  };
};

export type WikiIndex = {
  overview_pages: WikiPage[];
  summary_counts: { purpose: string; count: number; updated_at: string }[];
  latest_job?: WikiCompileJob | null;
  stale_documents: { id: string; title: string; purpose: string; updated_at: string }[];
};

export type WorkGuideSummary = {
  slug: string;
  title: string;
  summary: string;
  categories: string[];
  version?: string | null;
  effective_date?: string | null;
  updated_at: string;
  status: string;
  pinned: boolean;
};

export type WorkGuideDetail = WorkGuideSummary & {
  content: string;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const AGENT_TOKEN_STORAGE_KEY = "kb_agent_read_token";

export function getAgentReadToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AGENT_TOKEN_STORAGE_KEY) ?? "";
}

export function saveAgentReadToken(token: string) {
  if (typeof window === "undefined") return;
  const value = token.trim();
  if (value) {
    window.localStorage.setItem(AGENT_TOKEN_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(AGENT_TOKEN_STORAGE_KEY);
  }
}

function withAgentToken(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  const token = getAgentReadToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return { ...init, headers };
}

async function request<T>(path: string, init?: RequestInit, options?: { agentToken?: boolean }): Promise<T> {
  const requestInit = options?.agentToken ? withAgentToken(init) : init;
  const response = await fetch(`${API_BASE}${path}`, requestInit);
  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = data.detail ?? message;
    } catch {
      // Keep the response status text when the body is not JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

export async function fetchHealth() {
  return request<{ ok: boolean; service: string }>("/api/v1/health");
}

export async function fetchCategories() {
  return request<Categories>("/api/v1/categories");
}

export async function fetchWorkGuides(filters?: { q?: string; category?: string }) {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.category) params.set("category", filters.category);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ total: number; categories: string[]; guides: WorkGuideSummary[] }>(`/api/v1/work-guides${suffix}`);
}

export async function fetchWorkGuide(slug: string) {
  return request<WorkGuideDetail>(`/api/v1/work-guides/${encodeURIComponent(slug)}`);
}

export function workGuideAssetUrl(slug: string, source?: string) {
  if (!source || /^(?:[a-z]+:)?\/\//i.test(source) || source.startsWith("data:") || source.startsWith("/")) return source ?? "";
  const normalized = source.replace(/^\.\//, "").split(/[?#]/, 1)[0];
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.some((segment) => segment === "..")) return "";
  return `${API_BASE}/api/v1/work-guides/${encodeURIComponent(slug)}/assets/${segments.map(encodeURIComponent).join("/")}`;
}

export async function fetchDocuments(filters: {
  purpose?: string;
  format?: string;
  q?: string;
  status?: string;
  folder?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ total: number; documents: DocumentSummary[] }>(`/api/v1/documents${suffix}`);
}

export async function fetchFolder(path: string, purpose?: string) {
  const params = new URLSearchParams({ path });
  if (purpose) params.set("purpose", purpose);
  return request<FolderResponse>(`/api/v1/folders?${params.toString()}`);
}

export async function createFolder(payload: { purpose: string; parent_path: string; name: string }) {
  return request<FolderEntry>("/api/v1/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function deleteFolder(purpose: string, path: string) {
  const params = new URLSearchParams({ purpose, path });
  return request<FolderEntry>(`/api/v1/folders?${params.toString()}`, { method: "DELETE" });
}

export async function fetchKnowledge(filters: { q?: string; folder?: string; purpose?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ total: number; documents: DocumentSummary[] }>(`/api/v1/knowledge${suffix}`);
}

export async function fetchDocument(id: string) {
  return request<DocumentDetail>(`/api/v1/documents/${id}`);
}

export async function fetchDuplicateDocuments(filters: { purpose: string; folder: string; filename: string }) {
  const params = new URLSearchParams({
    purpose: filters.purpose,
    folder: filters.folder,
    filename: filters.filename
  });
  return request<{ documents: DocumentSummary[] }>(`/api/v1/documents/duplicates?${params.toString()}`);
}

export async function fetchContent(id: string) {
  const response = await fetch(`${API_BASE}/api/v1/documents/${id}/content?format=markdown`);
  if (!response.ok) throw new Error(await response.text());
  return response.text();
}

export async function uploadDocument(formData: FormData) {
  return request<{ id: string; status: string }>("/api/v1/documents", {
    method: "POST",
    body: formData
  });
}

export async function importMarkdownKnowledge(formData: FormData) {
  return request<{ id: string; status: string }>("/api/v1/knowledge/import-markdown", {
    method: "POST",
    body: formData
  });
}

export async function importMarkdownBundle(formData: FormData) {
  return request<{
    bundle_id: string;
    document_ids: string[];
    documents: number;
    image_references: number;
    missing_references: { document: string; reference: string }[];
    folder_path: string;
  }>("/api/v1/knowledge/import-markdown-bundle", {
    method: "POST",
    body: formData
  });
}

export async function reprocessDocument(id: string) {
  return request<{ id: string; status: string; job_id: string }>(`/api/v1/documents/${id}/reprocess`, { method: "POST" });
}

export async function moveDocument(id: string, folderPath: string) {
  return request<DocumentDetail>(`/api/v1/documents/${id}/folder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_path: folderPath })
  });
}

export async function processUnprocessed() {
  return request<{ queued: number; document_ids: string[]; job_ids: string[] }>("/api/v1/processing/run-unprocessed", { method: "POST" });
}

export async function createParseJobsBatch(payload: {
  document_ids?: string[];
  purpose?: string;
  limit?: number;
  include_failed?: boolean;
  requested_by?: string;
}) {
  return request<{ queued: number; document_ids: string[]; job_ids: string[] }>("/api/v1/parse-jobs/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function fetchParseQueue(options?: { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 20));
  params.set("offset", String(options?.offset ?? 0));
  return request<{ total: number; items: ParseQueueItem[] }>(`/api/v1/parse-jobs/queue?${params.toString()}`, undefined, { agentToken: true });
}

export async function cancelParseJob(jobId: string) {
  return request<{ id: string; document_id: string; status: string }>(`/api/v1/parse-jobs/${jobId}`, { method: "DELETE" });
}

export async function deleteDocument(id: string) {
  return request<{ id: string; status: string }>(`/api/v1/documents/${id}`, { method: "DELETE" });
}

export async function fetchAuditLogs() {
  return request<{ logs: AuditLog[] }>("/api/v1/audit-logs");
}

export async function clearOldAuditLogs(days = 7) {
  return request<{ deleted: number; cutoff: string }>(`/api/v1/audit-logs/older-than?days=${days}`, { method: "DELETE" });
}

export async function fetchWikiIndex() {
  return request<WikiIndex>("/api/v1/wiki/index");
}

export async function compileWiki(purpose?: string) {
  const suffix = purpose ? `?${new URLSearchParams({ purpose }).toString()}` : "";
  return request<WikiCompileJob>(`/api/v1/wiki/compile${suffix}`, { method: "POST" });
}

export async function createWikiCompileJobs(payload: {
  document_ids?: string[];
  purpose?: string;
  include_current?: boolean;
  requested_by?: string;
  limit?: number;
}) {
  return request<{ queued: number; job_ids: string[]; document_ids: string[] }>("/api/v1/wiki/compile-jobs/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function fetchWikiCompileQueue(options?: { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 20));
  params.set("offset", String(options?.offset ?? 0));
  return request<{ total: number; items: WikiCompileQueueItem[] }>(`/api/v1/wiki/compile-jobs/queue?${params.toString()}`, undefined, { agentToken: true });
}

export async function releaseWikiCompileJob(jobId: string) {
  return request<WikiCompileJob>(`/api/v1/wiki/compile-jobs/${jobId}/release`, { method: "POST" }, { agentToken: true });
}

export function rawUrl(id: string) {
  return `${API_BASE}/api/v1/documents/${id}/raw`;
}
