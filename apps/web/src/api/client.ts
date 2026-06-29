export type DocumentSummary = {
  id: string;
  title: string;
  original_filename: string;
  file_format: string;
  file_ext: string;
  folder_path: string;
  size_bytes: number;
  status: "uploaded" | "processing" | "ready" | "failed" | "deleted";
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

export async function fetchDocuments(filters: { purpose?: string; format?: string; q?: string; status?: string }) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ total: number; documents: DocumentSummary[] }>(`/api/v1/documents${suffix}`);
}

export async function fetchFolder(path: string) {
  return request<FolderResponse>(`/api/v1/folders?path=${encodeURIComponent(path)}`);
}

export async function fetchKnowledge(filters: { q?: string; folder?: string }) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.folder) params.set("folder", filters.folder);
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
  return request<{ id: string; status: string }>(`/api/v1/documents/${id}/reprocess`, { method: "POST" });
}

export async function processUnprocessed() {
  return request<{ queued: number; document_ids: string[] }>("/api/v1/processing/run-unprocessed", { method: "POST" });
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
