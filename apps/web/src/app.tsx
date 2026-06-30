import { Database, FileText, Library, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { Categories } from "./api/client";
import { fetchCategories } from "./api/client";
import { AdminPage } from "./pages/AdminPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { KnowledgePage } from "./pages/KnowledgePage";

const FALLBACK_PURPOSES = [
  "招投标需求清单",
  "用户详细需求清单",
  "规划材料",
  "政策法规",
  "产品社区文档",
  "业务知识",
  "客户案例",
  "业务材料",
  "其他"
];

type View = "raw" | "knowledge" | "admin";

export function App() {
  const [view, setView] = useState<View>("raw");
  const [selectedPurpose, setSelectedPurpose] = useState("招投标需求清单");
  const [categories, setCategories] = useState<Categories | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories(null));
  }, []);

  const purposes = categories?.purposes?.length ? categories.purposes : FALLBACK_PURPOSES;

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
          {purposes.map((purpose) => (
            <button
              key={`raw-${purpose}`}
              className={view === "raw" && selectedPurpose === purpose ? "active" : ""}
              onClick={() => {
                setView("raw");
                setSelectedPurpose(purpose);
              }}
            >
              <FileText size={16} />
              {purpose}
            </button>
          ))}
          <div className="navSectionLabel">知识管理</div>
          {purposes.map((purpose) => (
            <button
              key={`knowledge-${purpose}`}
              className={view === "knowledge" && selectedPurpose === purpose ? "active" : ""}
              onClick={() => {
                setView("knowledge");
                setSelectedPurpose(purpose);
              }}
            >
              <Library size={16} />
              {purpose}
            </button>
          ))}
          <div className="navSectionLabel">后台管理</div>
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
        {view === "raw" && (
          <DocumentsPage
            categories={categories}
            purpose={selectedPurpose}
            refreshKey={refreshKey}
            onUploaded={() => setRefreshKey((key) => key + 1)}
          />
        )}
        {view === "knowledge" && <KnowledgePage purpose={selectedPurpose} />}
        {view === "admin" && <AdminPage />}
      </main>
    </div>
  );
}
