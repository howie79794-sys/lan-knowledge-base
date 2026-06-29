import { Activity, Database, KeyRound, Network } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditLog } from "../api/client";
import { fetchAuditLogs, fetchDocuments, fetchHealth, processUnprocessed } from "../api/client";

export function AdminPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [health, setHealth] = useState<string>("检测中");
  const [unprocessed, setUnprocessed] = useState(0);
  const [message, setMessage] = useState("");

  async function load() {
    fetchHealth()
      .then((data) => setHealth(data.ok ? "正常" : "异常"))
      .catch(() => setHealth("异常"));
    fetchAuditLogs().then((data) => setLogs(data.logs)).catch(() => setLogs([]));
    fetchDocuments({ status: "uploaded" }).then((data) => setUnprocessed(data.total)).catch(() => setUnprocessed(0));
  }

  useEffect(() => {
    load();
  }, []);

  async function runProcessing() {
    setMessage("正在提交解析任务...");
    try {
      const result = await processUnprocessed();
      setMessage(`已提交 ${result.queued} 个未解析文件。解析产物会写入 processed 目录。`);
      window.setTimeout(load, 1000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交解析任务失败。");
    }
  }

  return (
    <section className="workspace">
      <div className="sectionHeader">
        <div>
          <h2>后台管理</h2>
          <p>查看服务状态、Agent 入口和最近操作记录。</p>
        </div>
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
      <div className="processPanel">
        <div>
          <h3>手动解析</h3>
          <p>只处理还没有解析过的文件。解析后的 Markdown/Text 会独立存放在 processed 目录，供 Agent 后续读取。</p>
        </div>
        <button className="primaryButton" onClick={runProcessing}>解析未解析文件</button>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="auditPanel">
        <h3>最近操作</h3>
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
                <td>{log.action}</td>
                <td>{log.document_id || "-"}</td>
                <td>{log.actor || log.ip || "-"}</td>
              </tr>
            ))}
            {!logs.length && (
              <tr>
                <td colSpan={4}>暂无操作记录。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
