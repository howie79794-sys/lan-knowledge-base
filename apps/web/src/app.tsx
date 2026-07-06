import { ChevronDown, Clipboard, Database, Download, FileText, Library, Settings, X } from "lucide-react";
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
            <strong>司库知识库</strong>
            <span>好记性不如MarkDown</span>
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
          <code>/api/v1/wiki/index</code>
          <code>/api/v1/wiki/context</code>
          <code>/api/v1/wiki/compile-jobs/queue</code>
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
                  <li>优先请求 <code>GET /api/v1/wiki/index</code> 获取知识总览。</li>
                  <li>按问题请求 <code>GET /api/v1/wiki/context?query=...</code> 获取推荐阅读包。</li>
                  <li>需要证据时再读取返回的 <code>content_url</code> 或 manifest 原文。</li>
                  <li>如配置了 <code>KB_AGENT_READ_TOKEN</code>，请求头带 <code>Authorization: Bearer TOKEN</code>。</li>
                </ol>
                <pre>{`GET ${window.location.origin}/api/v1/wiki/index
GET ${window.location.origin}/api/v1/wiki/context?query=项目管理
GET ${window.location.origin}/api/v1/manifest
GET ${window.location.origin}/api/v1/documents/{document_id}/content?format=markdown`}</pre>
              </section>

              <section className="agentGuideCard">
                <div className="agentGuideTop">
                  <div>
                    <h4>Qoder Work 解析接口</h4>
                    <p>适用于先查看队列、由用户选择任务，再领取原文件并回写 Markdown/Text。</p>
                  </div>
                  <button className="secondaryButton" onClick={() => copyAgentGuide("parse")}>
                    <Clipboard size={15} />
                    复制说明
                  </button>
                </div>
                <ol>
                  <li>请求 <code>GET /api/v1/parse-jobs/queue?limit=500</code> 查看待解析清单。</li>
                  <li>让用户选择一个或多个 <code>job_id</code> 后，调用 <code>POST /api/v1/parse-jobs/claim</code>。</li>
                  <li>使用 claim 返回的 <code>raw_url</code> 下载原文件。</li>
                  <li>解析成功后提交 <code>POST /api/v1/parse-jobs/{`{job_id}`}/complete</code>。</li>
                  <li>解析失败后提交 <code>POST /api/v1/parse-jobs/{`{job_id}`}/fail</code>。</li>
                  <li>智能编译使用 <code>/api/v1/wiki/compile-jobs/queue</code>、<code>claim</code>、<code>complete</code>。</li>
                </ol>
                <pre>{`GET ${window.location.origin}/api/v1/parse-jobs/queue?limit=500
POST ${window.location.origin}/api/v1/parse-jobs/claim
POST ${window.location.origin}/api/v1/parse-jobs/{job_id}/complete
POST ${window.location.origin}/api/v1/parse-jobs/{job_id}/fail
GET ${window.location.origin}/api/v1/wiki/compile-jobs/queue?limit=500
POST ${window.location.origin}/api/v1/wiki/compile-jobs/claim
POST ${window.location.origin}/api/v1/wiki/compile-jobs/{job_id}/complete`}</pre>
              </section>

              <section className="agentGuideCard skillDownloadCard">
                <div className="agentGuideTop">
                  <div>
                    <h4>文档转 Markdown Skill</h4>
                    <p>给 Qoder Work 安装使用，支持把 PDF、PPTX、DOCX、XLSX 等原始文件转换为 Markdown，并补充图片识别结果。</p>
                  </div>
                  <a className="secondaryButton" href="/downloads/doc-to-markdown.skill" download>
                    <Download size={15} />
                    下载 Skill
                  </a>
                </div>
                <ol>
                  <li>下载后交给 Qoder Work 导入或安装。</li>
                  <li>配合上方解析接口使用：领取任务后下载 <code>raw_url</code>，转换为 Markdown，再回写 <code>complete</code>。</li>
                </ol>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildReadAgentGuide(baseUrl: string) {
  return `# 司库知识库 Agent 读取说明

目标：让局域网内其他 Agent 读取网站中已经解析完成的知识内容。

Base URL:
${baseUrl}

认证：
- 如果服务端配置了 KB_AGENT_READ_TOKEN，请在请求头加入：
  Authorization: Bearer <KB_AGENT_READ_TOKEN>
- 如果未配置或仍为默认 change-me，本地读取接口通常不会强制鉴权。

推荐读取流程：
1. 优先读取 Wiki 编译层索引：
   GET ${baseUrl}/api/v1/wiki/index

   返回重点字段：
   - overview_pages: 各知识分类的总览页
   - summary_counts: 各分类已编译的单文件摘要数量
   - stale_documents: 已解析但尚未编译或需要更新的文档

2. 带着用户问题读取上下文包：
   GET ${baseUrl}/api/v1/wiki/context?query=<用户问题或关键词>&limit=8

   返回重点字段：
   - pages: 推荐阅读的分类总览页和单文件摘要页
   - sources: 可回源的原始资料，包含 content_url/raw_url

3. 需要精确引用或证据时，再读取 sources[].content_url。

4. 兜底获取全部已解析知识清单：
   GET ${baseUrl}/api/v1/manifest

从 manifest 返回结果中选择 document：
   - id: 文档 ID
   - title: 知识标题
   - purpose: 知识分类
   - folder_path: 知识路径
   - status: 只返回 ready
   - content_url: Markdown 正文读取地址
   - raw_url: 原始文件下载地址

读取 Markdown 正文：
   GET ${baseUrl}/api/v1/documents/{document_id}/content?format=markdown
   或直接 GET manifest 返回的 content_url。

建议：
- 优先使用 wiki/index 和 wiki/context，不要一上来读取全部原文。
- manifest 作为兜底清单使用，不要猜 document_id。
- 只把 status=ready 的内容当作可引用知识。
- 引用答案时保留 title、purpose、folder_path，方便追溯来源。

示例：
curl -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  "${baseUrl}/api/v1/wiki/index"

curl -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  "${baseUrl}/api/v1/wiki/context?query=项目管理&limit=8"

curl -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  "${baseUrl}/api/v1/manifest"

curl -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  "${baseUrl}/api/v1/documents/{document_id}/content?format=markdown"
`;
}

function buildParseAgentGuide(baseUrl: string) {
  return `# Qoder Work 解析接口说明

目标：让 Qoder Work 先查看待解析队列，询问用户选择要解析的文件，再只领取并解析用户指定的任务。

Base URL:
${baseUrl}

认证：
- 如果服务端配置了 KB_AGENT_READ_TOKEN，请在请求头加入：
  Authorization: Bearer <KB_AGENT_READ_TOKEN>
- 如果未配置或仍为默认 change-me，本地开发环境通常不会强制鉴权。

一、查看解析队列（只读，不改变任务状态）
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
- Qoder Work 应先把 queue 返回的清单展示给用户，并询问要解析哪些 job_id。

二、按用户选择领取任务（推荐交互式方式）
POST ${baseUrl}/api/v1/parse-jobs/claim
Content-Type: application/json

Body:
{
  "job_ids": ["job_xxx", "job_yyy"],
  "worker": "qoder-work"
}

只会领取 job_ids 中指定的 queued 任务。领取后这些任务和文件会变为 processing；未选择的任务仍留在队列中。

返回 jobs[] 重点字段：
- id: job_id，后续 complete/fail 使用
- document_id: 文件 ID
- title / original_filename / file_format / file_ext
- purpose / folder_path
- raw_url: 原文件下载地址
- raw_path: 原文件在服务器上的本地路径（同机或共享目录可用）

三、自动领取下一批任务（可选，不推荐人工交互时使用）
GET ${baseUrl}/api/v1/parse-jobs/next?limit=5&worker=qoder-work

这个接口会直接领取队列前 N 个任务，适合无人值守 Worker，不适合需要用户选择文件的场景。

四、获取原文件
优先：
GET jobs[].raw_url

如果 Qoder Work 与服务端在同一机器或可访问同一挂载目录，也可以读取：
jobs[].raw_path

五、解析成功后回写结果
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
- 只有提交 complete 的任务会从解析队列消失，未解析的任务仍保留原状态。

六、解析失败后回写错误
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

七、智能编译 Wiki 知识层
当网站后台创建“智能编译任务”后，Qoder Work 或其他 Agent 可领取已经解析完成的文档，生成更高质量的 Wiki 摘要页。

1. 查看智能编译队列：
   GET ${baseUrl}/api/v1/wiki/compile-jobs/queue?limit=500

2. 让用户选择一个或多个 job_id 后领取：
   POST ${baseUrl}/api/v1/wiki/compile-jobs/claim
   Body:
   {
     "job_ids": ["wiki_job_xxx"],
     "worker": "qoder-work"
   }

3. 读取 claim 返回的 content_url，生成：
   - summary: 3-8 句高质量摘要
   - content: 可直接作为 Wiki 页面读取的 Markdown
   - keywords: 关键词数组

4. 回写智能编译结果：
   POST ${baseUrl}/api/v1/wiki/compile-jobs/{job_id}/complete
   Body:
   {
     "summary": "这份材料的核心摘要...",
     "content": "# Wiki 页面\\n\\n## 核心观点\\n...",
     "keywords": ["项目", "验收", "风险"],
     "worker": "qoder-work"
   }

5. 失败时：
   POST ${baseUrl}/api/v1/wiki/compile-jobs/{job_id}/fail
   Body:
   {
     "error_message": "失败原因",
     "worker": "qoder-work"
   }

curl 示例：
curl -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  "${baseUrl}/api/v1/parse-jobs/queue?limit=500"

curl -X POST -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"job_ids":["job_xxx"],"worker":"qoder-work"}' \\
  "${baseUrl}/api/v1/parse-jobs/claim"

curl -X POST -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"markdown":"# title","text":"title","metadata":{},"worker":"qoder-work"}' \\
  "${baseUrl}/api/v1/parse-jobs/{job_id}/complete"

curl -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  "${baseUrl}/api/v1/wiki/compile-jobs/queue?limit=500"

curl -X POST -H "Authorization: Bearer <KB_AGENT_READ_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"job_ids":["wiki_job_xxx"],"worker":"qoder-work"}' \\
  "${baseUrl}/api/v1/wiki/compile-jobs/claim"
`;
}
