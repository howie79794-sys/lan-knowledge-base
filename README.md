# 局域网知识库

面向局域网内部资料管理、知识解析和 Agent 读取的轻量知识库系统。

当前版本已经从“资料入口 MVP”演进为一个可用的单机知识库：

- Windows 台式机或本地开发机部署，局域网固定 IP 访问。
- React + Vite 前端，FastAPI 后端，SQLite 元数据，本地目录存储原文件和解析产物。
- 支持 PDF、PPT、Excel、Word、CSV、Markdown、Text 等办公资料上传。
- 支持按知识分类建立文件夹、进入子文件夹、新建/删除空文件夹。
- 支持原始文件列表、搜索、格式筛选、状态筛选、分页、详情、下载。
- 支持单个或多个原始文件快速移动到目标文件夹路径。
- 上传后不自动解析，由管理员创建解析任务。
- Qoder Work 通过接口领取解析队列，读取原文件，生成 Markdown/Text 后回写。
- 解析后的知识进入“知识管理”视图，支持搜索、路径浏览、正文预览和复制知识链接。
- 左下角提供 Agent 接入说明，可一键复制“读取知识说明”和“解析队列说明”。
- 后台管理支持服务状态、解析队列、批量创建未解析任务、删除队列任务、最近操作日志。

## 文档

- [局域网知识库架构与接口说明](docs/local-mvp-plan.md)
- [Windows 台式机部署手册](docs/windows-deployment-guide.md)

## 本地开发

后端：

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
KB_DATA_DIR=../../data \
KB_UPLOAD_DIR=../../data/uploads \
KB_PROCESSED_DIR=../../data/processed \
KB_SQLITE_PATH=../../data/kb.sqlite3 \
uvicorn app.main:app --reload --port 8000
```

前端：

```bash
cd apps/web
npm install
npm run dev
```

浏览器访问：

```text
http://localhost:5173
```

## Docker 部署

推荐部署形态：

```text
Windows 台式机 + Docker Desktop + Docker Compose + Caddy
```

典型目录：

```text
F:\lan-knowledge-base\   项目代码
F:\kb-data\              上传文件、解析产物、SQLite 数据库、备份
```

启动：

```powershell
cd F:\lan-knowledge-base
copy .env.example .env
docker compose up -d --build
```

局域网访问：

```text
http://台式机局域网IP:18080
```

## Qoder Work 解析流程

网站只负责存储原始文件、维护文件夹路径、创建任务、提供原文件、接收解析结果。Qoder Work 负责实际解析。

```text
1. 用户上传原始文件，状态为 uploaded
2. 管理员在后台创建解析任务，状态变为 queued
3. Qoder Work 调用 /api/v1/parse-jobs/next 领取任务，状态变为 processing
4. Qoder Work 通过 raw_url 或 raw_path 获取原文件
5. Qoder Work 解析生成 Markdown/Text
6. Qoder Work 调用 /api/v1/parse-jobs/{job_id}/complete 回写结果
7. 网站更新文件状态为 ready，知识管理页可读取正文
```

核心接口：

```http
GET  /api/v1/parse-jobs/queue?limit=500
GET  /api/v1/parse-jobs/next?limit=5&worker=qoder-work
POST /api/v1/parse-jobs/{job_id}/complete
POST /api/v1/parse-jobs/{job_id}/fail
```

如配置了 `KB_AGENT_READ_TOKEN`，Qoder Work 请求头需要带：

```http
Authorization: Bearer <KB_AGENT_READ_TOKEN>
```

## Agent 读取知识

其他 Agent 推荐先读 manifest，再按 `content_url` 读取 Markdown 正文。

```http
GET /api/v1/manifest
GET /api/v1/documents/{document_id}/content?format=markdown
GET /api/v1/documents/{document_id}/raw
GET /openapi.json
```

`/api/v1/manifest` 只返回 `ready` 状态的已解析知识，并包含标题、分类、路径、正文 URL 和原文件 URL。

## 数据目录

`.env` 默认使用：

```dotenv
KB_HOST_DATA_DIR=./data
KB_DATA_DIR=/data/kb
KB_UPLOAD_DIR=/data/kb/uploads
KB_PROCESSED_DIR=/data/kb/processed
KB_TMP_DIR=/data/kb/tmp
KB_BACKUP_DIR=/data/kb/backups
KB_SQLITE_PATH=/data/kb/kb.sqlite3
KB_MAX_UPLOAD_MB=300
KB_AGENT_READ_TOKEN=change-me
```

正式部署时建议把 `KB_HOST_DATA_DIR` 改为 Windows 主机上的数据盘目录，例如：

```dotenv
KB_HOST_DATA_DIR=F:\kb-data
```

## 版本管理约定

- `main`：稳定可部署版本。
- `.env`、SQLite 数据库、上传资料、解析产物和备份不提交到 GitHub。
- 真实业务资料保存在 Windows 台式机的数据目录，例如 `F:\kb-data\`。
