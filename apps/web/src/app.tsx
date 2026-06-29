import { Database, FolderOpen, Library, Settings, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { Categories } from "./api/client";
import { fetchCategories } from "./api/client";
import { AdminPage } from "./pages/AdminPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { UploadPage } from "./pages/UploadPage";

type View = "documents" | "upload" | "knowledge" | "admin";

export function App() {
  const [view, setView] = useState<View>("documents");
  const [categories, setCategories] = useState<Categories | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories(null));
  }, []);

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <Database size={22} />
          </div>
          <div>
            <strong>局域网知识库</strong>
            <span>LAN Knowledge Base</span>
          </div>
        </div>
        <nav>
          <div className="navSectionLabel">原始文件</div>
          <button className={view === "documents" ? "active" : ""} onClick={() => setView("documents")}>
            <FolderOpen size={18} />
            文件管理
          </button>
          <button className={view === "upload" ? "active" : ""} onClick={() => setView("upload")}>
            <Upload size={18} />
            上传资料
          </button>
          <div className="navSectionLabel">解析知识</div>
          <button className={view === "knowledge" ? "active" : ""} onClick={() => setView("knowledge")}>
            <Library size={18} />
            知识管理
          </button>
          <div className="navSectionLabel">系统</div>
          <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>
            <Settings size={18} />
            后台管理
          </button>
        </nav>
        <div className="agentBox">
          <span>Agent 读取知识</span>
          <code>/api/v1/manifest</code>
          <code>/openapi.json</code>
        </div>
      </aside>
      <main className="mainArea">
        {view === "documents" && <DocumentsPage categories={categories} refreshKey={refreshKey} />}
        {view === "knowledge" && <KnowledgePage />}
        {view === "upload" && (
          <UploadPage
            categories={categories}
            onUploaded={(id) => {
              setRefreshKey((key) => key + 1);
              setView("documents");
              window.setTimeout(() => {
                console.info("uploaded", id);
              }, 0);
            }}
          />
        )}
        {view === "admin" && <AdminPage />}
      </main>
    </div>
  );
}
