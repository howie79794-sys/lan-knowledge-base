import { Activity, Database, KeyRound, Network, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditLog, ParseQueueItem } from "../api/client";
import { fetchAuditLogs, fetchHealth, fetchParseQueue, processUnprocessed } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function AdminPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [queueItems, setQueueItems] = useState<ParseQueueItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [health, setHealth] = useState<string>("检测中");
  const [message, setMessage] = useState("");

  const unprocessed = queueItems.filter((item) => item.document_status === "uploaded").length;
  const queued = queueItems.filter((item) => item.document_status === "queued").length;
  const processing = queueItems.filter((item) => item.document_status === "processing").length;
  const failed = queueItems.filter((item) => item.document_status === "failed").length;

  async function load() {
    fetchHealth()
      .then((data) => setHealth(data.ok ? "正常" : "异常"))
      .catch(() => setHealth("异常"));
    fetchParseQueue()
      .then((data) => {
        setQueueItems(data.items);
        setQueueTotal(data.total);
      })
      .catch(() => {
        setQueueItems([]);
        setQueueTotal(0);
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
          <strong>.env 配置</strong>
        </div>
        <div className="adminTile">
          <Database size={22} />
          <span>未解析文件</span>
          <strong>{unprocessed}</strong>
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
      <div className="processPanel">
        <div>
          <h3>创建解析任务</h3>
          <p>把所有“未解析”文件加入队列，不在网站进程里解析。Qoder Work 只领取“队列中”的文件，完成后文件会从下方队列移到知识管理。</p>
        </div>
        <button className="primaryButton" onClick={runProcessing}>创建未解析文件任务</button>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="queuePanel">
        <div className="queuePanelHeader">
          <div>
            <h3>解析队列</h3>
            <p>展示所有尚未解析完成的文件；解析成功后会自动从这里移除。</p>
          </div>
          <button className="secondaryButton" onClick={load}>刷新队列</button>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
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
                    <div className="docTitle">{item.title}</div>
                    <div className="docMeta">{item.original_filename}</div>
                    {item.error_message && <div className="queueError">{item.error_message}</div>}
                  </td>
                  <td>{item.purpose}</td>
                  <td>
                    <StatusBadge status={item.document_status} />
                  </td>
                  <td>{item.job_id ? shortId(item.job_id) : "未入队"}</td>
                  <td>{item.worker || "-"}</td>
                  <td>{new Date(item.job_updated_at || item.document_updated_at).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
              {!queueItems.length && (
                <tr>
                  <td colSpan={6}>当前没有待解析、队列中、解析中或失败的文件。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {queueTotal > queueItems.length && <div className="queueFootnote">当前只显示前 {queueItems.length} 条，共 {queueTotal} 条。</div>}
      </div>
      {showAudit && (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="最近操作日志">
          <div className="auditModal">
            <div className="modalHeader">
              <div>
                <h3>最近操作</h3>
                <p>只记录上传、删除、创建解析任务、解析完成和解析失败等关键事件。</p>
              </div>
              <button className="iconButton" onClick={() => setShowAudit(false)} title="关闭">
                <X size={17} />
              </button>
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

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    upload: "上传文件",
    delete: "删除文件",
    create_parse_job: "创建单文件解析任务",
    create_parse_jobs_batch: "批量创建解析任务",
    complete_parse_job: "解析完成",
    fail_parse_job: "解析失败"
  };
  return labels[action] ?? action;
}
