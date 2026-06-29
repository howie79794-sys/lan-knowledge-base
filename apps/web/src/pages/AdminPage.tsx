import { Activity, Database, KeyRound, Network } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditLog } from "../api/client";
import { fetchAuditLogs, fetchHealth } from "../api/client";

export function AdminPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [health, setHealth] = useState<string>("检测中");

  useEffect(() => {
    fetchHealth()
      .then((data) => setHealth(data.ok ? "正常" : "异常"))
      .catch(() => setHealth("异常"));
    fetchAuditLogs().then((data) => setLogs(data.logs)).catch(() => setLogs([]));
  }, []);

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
          <span>数据目录</span>
          <strong>/data/kb</strong>
        </div>
      </div>
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
