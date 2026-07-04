import { ChevronDown, Database, FileText, Library, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { Categories } from "./api/client";
import { fetchCategories } from "./api/client";
import { AdminPage } from "./pages/AdminPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { KnowledgePage } from "./pages/KnowledgePage";

const FALLBACK_PURPOSES = [
  "招投标需求清单",
  "规划材料",
  "政策法规",
  "产品社区文档",
  "业务知识",
  "客户或特性案例",
  "业务材料",
  "竞品材料",
  "其他"
];

type View = "raw" | "knowledge" | "admin";

export function App() {
  const [view, setView] = useState<View>("raw");
  const [selectedPurpose, setSelectedPurpose] = useState("招投标需求清单");
  const [expandedSections, setExpandedSections] = useState({
    raw: true,
    knowledge: true,
    admin: true
  });
  const [categories, setCategories] = useState<Categories | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories(null));
  }, []);

  const purposes = categories?.purposes?.length ? categories.purposes : FALLBACK_PURPOSES;

  function toggleSection(section: keyof typeof expandedSections) {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  }

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
        <nav className="treeNav">
          <div className={view === "raw" ? "navGroup parentActive" : "navGroup"}>
            <button
              className="navParent"
              onClick={() => toggleSection("raw")}
              aria-expanded={expandedSections.raw}
              aria-controls="raw-nav"
            >
              <span>
                <FileText size={18} />
                原始文件
              </span>
              <ChevronDown className={expandedSections.raw ? "chevron expanded" : "chevron"} size={17} />
            </button>
            {expandedSections.raw && (
              <div className="navChildren" id="raw-nav">
                {purposes.map((purpose) => (
                  <button
                    key={`raw-${purpose}`}
                    className={view === "raw" && selectedPurpose === purpose ? "navItem level2 active" : "navItem level2"}
                    onClick={() => {
                      setView("raw");
                      setSelectedPurpose(purpose);
                    }}
                  >
                    {purpose}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={view === "knowledge" ? "navGroup parentActive" : "navGroup"}>
            <button
              className="navParent"
              onClick={() => toggleSection("knowledge")}
              aria-expanded={expandedSections.knowledge}
              aria-controls="knowledge-nav"
            >
              <span>
                <Library size={18} />
                知识管理
              </span>
              <ChevronDown className={expandedSections.knowledge ? "chevron expanded" : "chevron"} size={17} />
            </button>
            {expandedSections.knowledge && (
              <div className="navChildren" id="knowledge-nav">
                {purposes.map((purpose) => (
                  <button
                    key={`knowledge-${purpose}`}
                    className={view === "knowledge" && selectedPurpose === purpose ? "navItem level2 active" : "navItem level2"}
                    onClick={() => {
                      setView("knowledge");
                      setSelectedPurpose(purpose);
                    }}
                  >
                    {purpose}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={view === "admin" ? "navGroup parentActive" : "navGroup"}>
            <button
              className="navParent"
              onClick={() => toggleSection("admin")}
              aria-expanded={expandedSections.admin}
              aria-controls="admin-nav"
            >
              <span>
                <Settings size={18} />
                后台管理
              </span>
              <ChevronDown className={expandedSections.admin ? "chevron expanded" : "chevron"} size={17} />
            </button>
            {expandedSections.admin && (
              <div className="navChildren" id="admin-nav">
                <button className={view === "admin" ? "navItem level2 active" : "navItem level2"} onClick={() => setView("admin")}>
                  服务与解析
                </button>
              </div>
            )}
          </div>
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
