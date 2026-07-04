export type DocumentSummary = {
  id: string;
  title: string;
  original_filename: string;
  file_format: string;
  file_ext: string;
  folder_path: string;
  size_bytes: number;
  status: "uploaded" | "queued" | "processing" | "ready" | "failed" | "deleted";
  purpose: string;
  uploader_name?: string | null;
  confidentiality: string;
  content_excerpt?: string | null;
  error_message?: string | null;
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

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
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

export async function fetchKnowledge(filters: { q?: string; folder?: string; purpose?: string }) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.folder) params.set("folder", filters.folder);
  if (filters.purpose) params.set("purpose", filters.purpose);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ total: number; documents: DocumentSummary[] }>(`/api/v1/knowledge${suffix}`);
}

export async function fetchDocument(id: string) {
  return request<DocumentDetail>(`/api/v1/documents/${id}`);
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

export async function fetchParseQueue() {
  return request<{ total: number; items: ParseQueueItem[] }>("/api/v1/parse-jobs/queue?limit=500");
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

export function rawUrl(id: string) {
  return `${API_BASE}/api/v1/documents/${id}/raw`;
}
