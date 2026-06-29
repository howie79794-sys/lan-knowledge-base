import { Database, FolderOpen, Settings, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { Categories } from "./api/client";
import { fetchCategories } from "./api/client";
import { AdminPage } from "./pages/AdminPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { UploadPage } from "./pages/UploadPage";

type View = "documents" | "upload" | "admin";

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
          <button className={view === "documents" ? "active" : ""} onClick={() => setView("documents")}>
            <FolderOpen size={18} />
            资料总览
          </button>
          <button className={view === "upload" ? "active" : ""} onClick={() => setView("upload")}>
            <Upload size={18} />
            上传资料
          </button>
          <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>
            <Settings size={18} />
            后台管理
          </button>
        </nav>
        <div className="agentBox">
          <span>Agent 入口</span>
          <code>/api/v1/manifest</code>
          <code>/openapi.json</code>
        </div>
      </aside>
      <main className="mainArea">
        {view === "documents" && <DocumentsPage categories={categories} refreshKey={refreshKey} />}
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
