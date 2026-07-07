import { Activity, BookOpen, Database, KeyRound, Network, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditLog, ParseQueueItem, WikiCompileQueueItem, WikiIndex } from "../api/client";
import { cancelParseJob, clearOldAuditLogs, compileWiki, createWikiCompileJobs, fetchAuditLogs, fetchDocuments, fetchHealth, fetchParseQueue, fetchWikiCompileQueue, fetchWikiIndex, getAgentReadToken, processUnprocessed, saveAgentReadToken } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function AdminPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [clearingAudit, setClearingAudit] = useState(false);
  const [queueItems, setQueueItems] = useState<ParseQueueItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [unprocessed, setUnprocessed] = useState(0);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [wikiIndex, setWikiIndex] = useState<WikiIndex | null>(null);
  const [wikiQueueItems, setWikiQueueItems] = useState<WikiCompileQueueItem[]>([]);
  const [wikiQueueTotal, setWikiQueueTotal] = useState(0);
  const [compilingWiki, setCompilingWiki] = useState(false);
  const [creatingWikiJobs, setCreatingWikiJobs] = useState(false);
  const [health, setHealth] = useState<string>("检测中");
  const [message, setMessage] = useState("");
  const [agentTokenInput, setAgentTokenInput] = useState(() => getAgentReadToken());
  const [agentTokenSaved, setAgentTokenSaved] = useState(() => Boolean(getAgentReadToken()));

  const queued = queueItems.filter((item) => item.document_status === "queued").length;
  const processing = queueItems.filter((item) => item.document_status === "processing").length;
  const failed = queueItems.filter((item) => item.document_status === "failed").length;
  const wikiQueued = wikiQueueItems.filter((item) => item.status === "queued").length;
  const wikiProcessing = wikiQueueItems.filter((item) => item.status === "processing").length;
  const selectedJobs = queueItems.filter((item) => item.job_id && selectedJobIds.includes(item.job_id));
  const canCancelSelected = selectedJobs.length > 0 && selectedJobs.every((item) => item.document_status === "queued" && item.job_id);

  async function load() {
    fetchHealth()
      .then((data) => setHealth(data.ok ? "正常" : "异常"))
      .catch(() => setHealth("异常"));
    fetchParseQueue()
      .then((data) => {
        setQueueItems(data.items);
        setQueueTotal(data.total);
        setSelectedJobIds((current) => current.filter((id) => data.items.some((item) => item.job_id === id)));
      })
      .catch((error) => {
        setQueueItems([]);
        setQueueTotal(0);
        setMessage(error instanceof Error ? `解析队列读取失败：${error.message}` : "解析队列读取失败。");
      });
    fetchDocuments({ status: "uploaded", limit: 1, offset: 0 })
      .then((data) => setUnprocessed(data.total))
      .catch(() => setUnprocessed(0));
    fetchWikiIndex()
      .then(setWikiIndex)
      .catch(() => setWikiIndex(null));
    fetchWikiCompileQueue()
      .then((data) => {
        setWikiQueueItems(data.items);
        setWikiQueueTotal(data.total);
      })
      .catch((error) => {
        setWikiQueueItems([]);
        setWikiQueueTotal(0);
        setMessage(error instanceof Error ? `知识索引队列读取失败：${error.message}` : "知识索引队列读取失败。");
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function runProcessing() {
    setMessage("正在创建解析任务...");
    try {
      const result = await processUnprocessed();
      setMessage(`已把 ${result.queued} 个未解析文件加入队列。Qoder Work 只会领取队列中的文件。`);
      window.setTimeout(load, 1000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交解析任务失败。");
    }
  }

  async function saveAgentToken() {
    saveAgentReadToken(agentTokenInput);
    const saved = Boolean(agentTokenInput.trim());
    setAgentTokenSaved(saved);
    setMessage(saved ? "Agent Token 已保存在当前浏览器，队列接口会自动携带 Authorization。" : "已清除当前浏览器保存的 Agent Token。");
    await load();
  }

  async function runWikiCompile() {
    setCompilingWiki(true);
    setMessage("正在建立知识索引...");
    try {
      const job = await compileWiki();
      const index = await fetchWikiIndex();
      setWikiIndex(index);
      setMessage(`已建立知识索引：处理 ${job.total_documents} 条已解析知识，生成/更新 ${job.compiled_pages} 个 Wiki 页面。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "建立知识索引失败。");
    } finally {
      setCompilingWiki(false);
    }
  }

  async function createSmartWikiJobs() {
    setCreatingWikiJobs(true);
    setMessage("正在创建知识索引任务...");
    try {
      const result = await createWikiCompileJobs({ include_current: false, requested_by: "web" });
      setMessage(`已创建 ${result.queued} 个知识索引任务，Qoder Work 或其他 Agent 可通过接口领取。`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建知识索引任务失败。");
    } finally {
      setCreatingWikiJobs(false);
    }
  }

  function toggleQueueSelection(item: ParseQueueItem, checked: boolean) {
    if (!item.job_id || item.document_status !== "queued") return;
    setSelectedJobIds((current) => {
      if (checked) return [...new Set([...current, item.job_id as string])];
      return current.filter((id) => id !== item.job_id);
    });
  }

  async function cancelSelectedJobs() {
    if (!canCancelSelected) return;
    if (!window.confirm(`确认把 ${selectedJobs.length} 个文件从解析队列中移除，并退回未解析状态？`)) return;
    setMessage("正在删除队列任务...");
    try {
      for (const item of selectedJobs) {
        if (item.job_id) await cancelParseJob(item.job_id);
      }
      setMessage(`已从队列移除 ${selectedJobs.length} 个文件，状态已退回未解析。`);
      setSelectedJobIds([]);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除队列任务失败。");
    }
  }

  async function openAuditLogs() {
    setShowAudit(true);
    setAuditLoading(true);
    try {
      const data = await fetchAuditLogs();
      setLogs(data.logs);
    } catch {
      setLogs([]);
    } finally {
      setAuditLoading(false);
    }
  }

  async function clearAuditLogsOlderThan7Days() {
    if (!window.confirm("确认清除超过 7 天的最近操作记录？")) return;
    setClearingAudit(true);
    try {
      const result = await clearOldAuditLogs(7);
      const data = await fetchAuditLogs();
      setLogs(data.logs);
      setMessage(`已清除 ${result.deleted} 条超过 7 天的操作记录。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清除操作记录失败。");
    } finally {
      setClearingAudit(false);
    }
  }

  return (
    <section className="workspace">
      <div className="sectionHeader">
        <div>
          <h2>后台管理</h2>
          <p>查看服务状态、解析队列和 Qoder Work 任务入口。</p>
        </div>
        <button className="secondaryButton" onClick={openAuditLogs}>最近操作</button>
      </div>
      <div className="adminGrid">
        <div className="adminTile">
          <Activity size={22} />
          <span>API 状态</span>
          <strong>{health}</strong>
        </div>
        <div className="adminTile">
          <Network size={22} />
          <span>OpenAPI</span>
          <strong>/openapi.json</strong>
        </div>
        <div className="adminTile">
          <KeyRound size={22} />
          <span>Agent Token</span>
          <strong>{agentTokenSaved ? "已保存" : "未保存"}</strong>
        </div>
        <div className="adminTile">
          <Database size={22} />
          <span>未解析文件</span>
          <strong>{unprocessed}</strong>
        </div>
      </div>
      <div className="agentTokenPanel">
        <div>
          <h3>Agent/API Token</h3>
          <p>用于读取解析队列、知识索引队列和 Agent 任务接口。只保存在当前浏览器，不会上传到服务器。</p>
        </div>
        <div className="agentTokenControls">
          <input
            type="password"
            value={agentTokenInput}
            onChange={(event) => setAgentTokenInput(event.target.value)}
            placeholder="填写 .env 里的 KB_AGENT_READ_TOKEN"
          />
          <button className="secondaryButton" onClick={saveAgentToken}>{agentTokenInput.trim() ? "保存" : "清除"}</button>
        </div>
      </div>
      <div className="adminGrid queueMetricGrid">
        <div className="adminTile">
          <Database size={22} />
          <span>队列中</span>
          <strong>{queued}</strong>
        </div>
        <div className="adminTile">
          <Activity size={22} />
          <span>解析中</span>
          <strong>{processing}</strong>
        </div>
        <div className="adminTile">
          <Activity size={22} />
          <span>解析失败</span>
          <strong>{failed}</strong>
        </div>
        <div className="adminTile">
          <Network size={22} />
          <span>任务领取 API</span>
          <strong>/api/v1/parse-jobs/next</strong>
        </div>
      </div>
      <div className="adminGrid compactAdminGrid">
        <div className="adminTile">
          <BookOpen size={22} />
          <span>Wiki 总览页</span>
          <strong>{wikiIndex?.overview_pages.length ?? 0}</strong>
        </div>
        <div className="adminTile">
          <BookOpen size={22} />
          <span>待更新知识</span>
          <strong>{wikiIndex?.stale_documents.length ?? 0}</strong>
        </div>
        <div className="adminTile">
          <BookOpen size={22} />
          <span>知识索引队列</span>
          <strong>{wikiQueued}</strong>
        </div>
        <div className="adminTile">
          <BookOpen size={22} />
          <span>建立索引中</span>
          <strong>{wikiProcessing}</strong>
        </div>
      </div>
      <div className="processPanel">
        <div>
          <h3>创建解析任务</h3>
          <p>把所有“未解析”文件加入队列，不在网站进程里解析。Qoder Work 只领取“队列中”的文件，完成后文件会从下方队列移到知识管理。</p>
        </div>
        <button className="primaryButton" onClick={runProcessing}>创建未解析文件任务</button>
      </div>
      <div className="processPanel">
        <div>
          <h3>建立知识索引</h3>
          <p>把已解析 Markdown 提炼成单文件摘要、关键词和分类总览页。Agent 应优先读取 Wiki 索引和上下文，再按需回源读取原文。</p>
          {wikiIndex?.latest_job && <p>最近建立索引：{new Date(wikiIndex.latest_job.updated_at).toLocaleString("zh-CN")}，状态 {wikiIndex.latest_job.status}。</p>}
        </div>
        <div className="queueActions">
          <button className="secondaryButton" onClick={createSmartWikiJobs} disabled={creatingWikiJobs}>
            {creatingWikiJobs ? "创建中..." : "创建知识索引任务"}
          </button>
          <button className="primaryButton" onClick={runWikiCompile} disabled={compilingWiki}>
            {compilingWiki ? "建立中..." : "本地快速建立索引"}
          </button>
        </div>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="queuePanel">
        <div className="queuePanelHeader">
          <div>
            <h3>解析队列</h3>
            <p>只展示已经加入队列、正在解析或解析失败的文件；未解析文件需点击上方按钮后才会进入这里。</p>
          </div>
          <div className="queueActions">
            <button className="secondaryButton dangerText" onClick={cancelSelectedJobs} disabled={!canCancelSelected}>
              删除选中队列任务
            </button>
            <button className="secondaryButton" onClick={load}>刷新队列</button>
          </div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>选择</th>
                <th>文件</th>
                <th>类型</th>
                <th>状态</th>
                <th>任务</th>
                <th>Qoder Worker</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {queueItems.map((item) => (
                <tr key={item.document_id}>
                  <td>
                    <input
                      className="queueCheckbox"
                      type="checkbox"
                      checked={!!item.job_id && selectedJobIds.includes(item.job_id)}
                      disabled={!item.job_id || item.document_status !== "queued"}
                      onChange={(event) => toggleQueueSelection(item, event.target.checked)}
                    />
                  </td>
                  <td>
                    <div className="docTitle">{item.title}</div>
                    <div className="docMeta">{item.original_filename}</div>
                    {item.error_message && <div className="queueError">{item.error_message}</div>}
                  </td>
                  <td>{item.purpose}</td>
                  <td>
                    <StatusBadge status={item.document_status} />
                  </td>
                  <td>{item.job_id ? shortId(item.job_id) : "-"}</td>
                  <td>{item.worker || "-"}</td>
                  <td>{new Date(item.job_updated_at || item.document_updated_at).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
              {!queueItems.length && (
                <tr>
                  <td colSpan={7}>当前没有待解析、队列中、解析中或失败的文件。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {queueTotal > queueItems.length && <div className="queueFootnote">当前只显示前 {queueItems.length} 条，共 {queueTotal} 条。</div>}
      </div>
      <div className="queuePanel">
        <div className="queuePanelHeader">
          <div>
            <h3>知识索引队列</h3>
            <p>展示等待 Qoder Work 或其他 Agent 领取的 Wiki 索引任务；完成后知识管理列表会显示已索引。</p>
          </div>
          <div className="queueActions">
            <button className="secondaryButton" onClick={load}>刷新队列</button>
          </div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>文件</th>
                <th>类型</th>
                <th>状态</th>
                <th>任务</th>
                <th>Worker</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {wikiQueueItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="docTitle">{item.document.title}</div>
                    <div className="docMeta">{item.document.original_filename}</div>
                    {item.error_message && <div className="queueError">{item.error_message}</div>}
                  </td>
                  <td>{item.document.purpose || item.purpose || "-"}</td>
                  <td>{wikiJobStatusLabel(item.status)}</td>
                  <td>{shortId(item.id)}</td>
                  <td>{item.worker || "-"}</td>
                  <td>{new Date(item.updated_at).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
              {!wikiQueueItems.length && (
                <tr>
                  <td colSpan={6}>当前没有待建立索引、建立索引中或失败的任务。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {wikiQueueTotal > wikiQueueItems.length && <div className="queueFootnote">当前只显示前 {wikiQueueItems.length} 条，共 {wikiQueueTotal} 条。</div>}
      </div>
      {showAudit && (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="最近操作日志">
          <div className="auditModal">
            <div className="modalHeader">
              <div>
                <h3>最近操作</h3>
                <p>只记录上传、删除、创建解析任务、解析完成和解析失败等关键事件。</p>
              </div>
              <div className="modalActions">
                <button className="secondaryButton dangerText" onClick={clearAuditLogsOlderThan7Days} disabled={clearingAudit || auditLoading}>
                  {clearingAudit ? "清除中..." : "清除超7天记录"}
                </button>
                <button className="iconButton" onClick={() => setShowAudit(false)} title="关闭">
                  <X size={17} />
                </button>
              </div>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>动作</th>
                    <th>资料 ID</th>
                    <th>操作者</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.created_at).toLocaleString("zh-CN")}</td>
                      <td>{auditActionLabel(log.action)}</td>
                      <td>{log.document_id || "-"}</td>
                      <td>{log.actor || log.ip || "-"}</td>
                    </tr>
                  ))}
                  {!logs.length && (
                    <tr>
                      <td colSpan={4}>{auditLoading ? "正在加载..." : "暂无关键操作记录。"}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 10)}...` : value;
}

function wikiJobStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: "队列中",
    processing: "建立索引中",
    failed: "索引失败",
    succeeded: "已完成"
  };
  return labels[status] ?? status;
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    upload: "上传文件",
    overwrite_upload: "覆盖上传",
    markdown_import: "导入 Markdown",
    overwrite_markdown_import: "覆盖导入 Markdown",
    compile_wiki: "建立知识索引",
    create_wiki_compile_jobs: "创建知识索引任务",
    claim_wiki_compile_job: "领取知识索引任务",
    complete_wiki_compile_job: "知识索引完成",
    fail_wiki_compile_job: "知识索引失败",
    delete: "删除文件",
    create_folder: "新建文件夹",
    delete_folder: "删除文件夹",
    move_document: "移动文件",
    create_parse_job: "创建单文件解析任务",
    create_parse_jobs_batch: "批量创建解析任务",
    claim_parse_job: "领取解析任务",
    cancel_parse_job: "取消解析任务",
    complete_parse_job: "解析完成",
    fail_parse_job: "解析失败"
  };
  return labels[action] ?? action;
}
