import { ChevronDown, Clipboard, Database, FileText, Library, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Categories } from "./api/client";
import { fetchCategories } from "./api/client";
import { AdminPage } from "./pages/AdminPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { copyText } from "./utils/clipboard";

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
  const [showAgentGuide, setShowAgentGuide] = useState(false);
  const [agentMessage, setAgentMessage] = useState("");

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories(null));
  }, []);

  const purposes = categories?.purposes?.length ? categories.purposes : FALLBACK_PURPOSES;

  function toggleSection(section: keyof typeof expandedSections) {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  }

  async function copyAgentGuide(kind: "read" | "parse") {
    const baseUrl = window.location.origin;
    const text = kind === "read" ? buildReadAgentGuide(baseUrl) : buildParseAgentGuide(baseUrl);
    const copied = await copyText(text);
    if (copied) {
      setAgentMessage(kind === "read" ? "已复制：其他 Agent 读取知识说明。" : "已复制：Qoder Work 解析接口说明。");
      return;
    }
    setShowAgentGuide(true);
    setAgentMessage("浏览器限制了自动复制，请在弹窗中手动选中说明文字复制。");
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
          <div className="agentBoxHeader">
            <span>Agent 接入</span>
            <button className="agentTextButton" onClick={() => setShowAgentGuide(true)}>
              查看说明
            </button>
          </div>
          <p>给其他 Agent 读取知识，给 Qoder Work 领取解析任务并回写结果。</p>
          <code>/api/v1/manifest</code>
          <code>/api/v1/parse-jobs/next</code>
          <div className="agentQuickActions">
            <button onClick={() => copyAgentGuide("read")}>
              <Clipboard size={14} />
              复制读取说明
            </button>
            <button onClick={() => copyAgentGuide("parse")}>
              <Clipboard size={14} />
              复制解析说明
            </button>
          </div>
          {agentMessage && <small>{agentMessage}</small>}
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
      {showAgentGuide && (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Agent 接入说明">
          <div className="agentGuideModal">
            <div className="modalHeader">
              <div>
                <h3>Agent 接入说明</h3>
                <p>复制给其他 Agent 或 Qoder Work，一次接入后即可读取知识或处理解析队列。</p>
              </div>
              <button className="iconButton" onClick={() => setShowAgentGuide(false)} title="关闭">
                <X size={17} />
              </button>
            </div>
            <div className="agentGuideGrid">
              <section className="agentGuideCard">
                <div className="agentGuideTop">
                  <div>
                    <h4>读取已解析知识</h4>
                    <p>适用于局域网内其他 Agent 检索并读取网站中已解析完成的 Markdown 知识。</p>
                  </div>
                  <button className="secondaryButton" onClick={() => copyAgentGuide("read")}>
                    <Clipboard size={15} />
                    复制说明
                  </button>
                </div>
                <ol>
                  <li>请求 <code>GET /api/v1/manifest</code> 获取所有 <code>ready</code> 知识清单。</li>
                  <li>读取返回的 <code>content_url</code>，拿到 Markdown 正文。</li>
                  <li>如配置了 <code>KB_AGENT_READ_TOKEN</code>，请求头带 <code>Authorization: Bearer TOKEN</code>。</li>
                </ol>
                <pre>{`GET ${window.location.origin}/api/v1/manifest
GET ${window.location.origin}/api/v1/documents/{document_id}/content?format=markdown`}</pre>
              </section>

              <section className="agentGuideCard">
                <div className="agentGuideTop">
                  <div>
                    <h4>Qoder Work 解析接口</h4>
                    <p>适用于解析 Worker 获取待解析文件、下载原始文件、提交 Markdown/Text 结果。</p>
                  </div>
                  <button className="secondaryButton" onClick={() => copyAgentGuide("parse")}>
                    <Clipboard size={15} />
                    复制说明
                  </button>
                </div>
                <ol>
                  <li>请求 <code>GET /api/v1/parse-jobs/next?limit=5&amp;worker=qoder-work</code> 领取队列任务。</li>
                  <li>使用返回的 <code>raw_url</code> 下载原文件，或在同机环境读取 <code>raw_path</code>。</li>
                  <li>解析成功后提交 <code>POST /api/v1/parse-jobs/{`{job_id}`}/complete</code>。</li>
                  <li>解析失败后提交 <code>POST /api/v1/parse-jobs/{`{job_id}`}/fail</code>。</li>
                </ol>
                <pre>{`GET ${window.location.origin}/api/v1/parse-jobs/next?limit=5&worker=qoder-work
POST ${window.location.origin}/api/v1/parse-jobs/{job_id}/complete
POST ${window.location.origin}/api/v1/parse-jobs/{job_id}/fail`}</pre>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildReadAgentGuide(baseUrl: string) {
  return `# 局域网知识库 Agent 读取说明

目标：让局域网内其他 Agent 读取网站中已经解析完成的知识内容。

Base URL:
${baseUrl}

认证：
- 如果服务端配置了 KB_AGENT_READ_TOKEN，请在请求头加入：
  Authorization: Bearer <KB_AGENT_READ_TOKEN>
- 如果未配置或仍为默认 change-me，本地读取接口通常不会强制鉴权。

读取流程：
1. 获取已解析知识清单：
   GET ${baseUrl}/api/v1/manifest

2. 从返回结果中选择 document：
   - id: 文档 ID
   - title: 知识标题
   - purpose: 知识分类
   - folder_path: 知识路径
   - status: 只返回 ready
   - content_url: Markdown 正文读取地址
   - raw_url: 原始文件下载地址

3. 读取 Markdown 正文：
   GET ${baseUrl}/api/v1/documents/{document_id}/content?format=markdown
   或直接 GET manifest 返回的 content_url。

建议：
- 优先使用 manifest 发现知识，不要猜 document_id。
- 只把 status=ready 的内容当作可引用知识。
- 引用答案时保留 title、purpose、folder_path，方便追溯来源。

示例：
curl -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  "${baseUrl}/api/v1/manifest"

curl -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  "${baseUrl}/api/v1/documents/{document_id}/content?format=markdown"
`;
}

function buildParseAgentGuide(baseUrl: string) {
  return `# Qoder Work 解析接口说明

目标：让 Qoder Work 从网站解析队列领取待解析原始文件，解析完成后回写 Markdown/Text，更新网站状态。

Base URL:
${baseUrl}

认证：
- 如果服务端配置了 KB_AGENT_READ_TOKEN，请在请求头加入：
  Authorization: Bearer <KB_AGENT_READ_TOKEN>
- 如果未配置或仍为默认 change-me，本地开发环境通常不会强制鉴权。

一、查看解析队列（只读，供调试/观察）
GET ${baseUrl}/api/v1/parse-jobs/queue?limit=500

返回重点字段：
- document_id: 原始文件 ID
- title / original_filename: 文件标题与原始文件名
- purpose / folder_path: 所属知识分类与路径
- document_status: queued / processing / failed
- job_id / job_status / worker / attempts: 解析任务信息

注意：
- 上传后的文件默认只是 uploaded / 未解析，不会自动出现在解析队列。
- 需要在网站后台点击“创建未解析文件任务”，或在原始文件列表选择未解析文件后点击“入队”，任务才会进入解析队列。

二、领取待解析任务
GET ${baseUrl}/api/v1/parse-jobs/next?limit=5&worker=qoder-work

领取后任务和文件会变为 processing。

返回 jobs[] 重点字段：
- id: job_id，后续 complete/fail 使用
- document_id: 文件 ID
- title / original_filename / file_format / file_ext
- purpose / folder_path
- raw_url: 原文件下载地址
- raw_path: 原文件在服务器上的本地路径（同机或共享目录可用）

三、获取原文件
优先：
GET jobs[].raw_url

如果 Qoder Work 与服务端在同一机器或可访问同一挂载目录，也可以读取：
jobs[].raw_path

四、解析成功后回写结果
POST ${baseUrl}/api/v1/parse-jobs/{job_id}/complete
Content-Type: application/json

Body:
{
  "markdown": "# 解析后的 Markdown 正文",
  "text": "可选：纯文本正文；不传时默认使用 markdown",
  "metadata": {
    "parser": "qoder-work",
    "notes": "可选解析元信息"
  },
  "worker": "qoder-work"
}

成功后：
- document status 更新为 ready
- content.md / content.txt / metadata.json 写入 processed 目录
- 知识管理页可读取正文

五、解析失败后回写错误
POST ${baseUrl}/api/v1/parse-jobs/{job_id}/fail
Content-Type: application/json

Body:
{
  "error_message": "失败原因",
  "worker": "qoder-work"
}

失败后：
- document status 更新为 failed
- 网站后台解析队列显示错误信息

curl 示例：
curl -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  "${baseUrl}/api/v1/parse-jobs/next?limit=5&worker=qoder-work"

curl -X POST -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"markdown":"# title","text":"title","metadata":{},"worker":"qoder-work"}' \\
  "${baseUrl}/api/v1/parse-jobs/{job_id}/complete"
`;
}
