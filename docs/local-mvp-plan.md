# 局域网知识库本地 MVP 方案

基于飞书设计文档 revision 7 和当前确认信息，第一阶段目标是先做成一个稳定的“局域网资料入口”，并让 Qoder Work 这类 Agent 能通过 HTTP/OpenAPI 读取资料目录、清洗正文和原文件。

## 一、MVP 边界

### 必须包含

- 局域网固定 IP 访问，例如 `http://192.168.1.10`。
- 文件上传、文件夹层级浏览、列表、详情、下载。
- 两类核心分类：
  - 文件作用：招投标需求清单、规划材料、政策法规、产品社区文档、业务知识、客户或特性案例、业务材料、其他。
  - 文件格式：由系统根据扩展名自动识别。
- PDF、Word、PPT、Excel 不在上传时自动解析；管理员手动创建解析任务，由 Qoder Work 主动领取任务并回写解析结果。
- 为 Agent 提供只读 API：manifest、列表筛选、正文读取、原文下载、OpenAPI；Agent 默认读取 processed 目录中的解析产物。
- 操作日志：上传、下载、删除、重建索引。
- 每日备份数据库和文件目录。

### 第一阶段暂缓

- 复杂账号体系、部门权限、审批流。
- Office 在线编辑、版本回滚。
- 大规模向量库、知识图谱、复杂 RAG 编排。
- 多服务器部署和高可用。

## 二、推荐技术栈

第一版建议使用轻量单机栈：

| 层 | 技术 | 说明 |
|-|-|-|
| 前端 | React + Vite + TypeScript | 简单、开发快，后续也容易扩展管理后台。 |
| 后端 | FastAPI + Python | 文件处理、OpenAPI、后台任务都比较顺手。 |
| 数据库 | SQLite | 3 到 5GB 文件规模下，元数据量小，SQLite 足够起步。 |
| ORM/迁移 | SQLModel 或 SQLAlchemy + Alembic | 建议用 Alembic 保留后续迁移能力。 |
| 文件存储 | 本地目录 | 原文件和衍生文件分开存放。 |
| 文档解析 | Qoder Work 任务工人 + 可选本地解析工具 | 网站负责任务队列和结果回写；Qoder Work 负责实际解析，避免上传时消耗台式机性能和 Token。 |
| 反向代理 | Caddy 或 Nginx | 监听 80 端口，转发前端与 API。 |
| 进程管理 | Docker Compose 优先；非 Docker 可用 systemd/launchd | 便于在台式机上稳定启动和重启。 |

MVP 先不引入 PostgreSQL、Redis、Meilisearch。等 2 到 4 周使用反馈稳定后，再评估是否增加全文检索和异步队列。

## 三、代码结构

建议采用单仓库结构：

```text
lan-knowledge-base/
  README.md
  .env.example
  docker-compose.yml
  Caddyfile
  scripts/
    init_data_dirs.sh
    backup.sh
    restore.sh
    reprocess_all.sh
  apps/
    api/
      pyproject.toml
      alembic.ini
      app/
        main.py
        core/
          config.py
          security.py
          paths.py
          logging.py
        db/
          session.py
          models.py
          migrations/
        modules/
          documents/
            router.py
            schemas.py
            service.py
            repository.py
          artifacts/
            service.py
            parsers.py
            cleaners.py
          parse_jobs/
            router.py
            schemas.py
            service.py
          agent/
            router.py
            schemas.py
          audit/
            service.py
        workers/
          conversion_worker.py
        tests/
    web/
      package.json
      vite.config.ts
      src/
        main.tsx
        app.tsx
        api/
          client.ts
        pages/
          DocumentListPage.tsx
          UploadPage.tsx
          DocumentDetailPage.tsx
          AdminPage.tsx
        components/
          DocumentFilters.tsx
          DocumentTable.tsx
          UploadDropzone.tsx
  data/
    uploads/
    processed/
    tmp/
    backups/
    kb.sqlite3
```

## 解析任务流

原始文件和解析知识分离：

```text
上传原始文件 -> documents.status = uploaded
后台创建解析任务 -> parse_jobs.status = queued, documents.status = queued
Qoder Work 领取任务 -> parse_jobs.status = processing, documents.status = processing
Qoder Work 回写结果 -> content.md/content.txt 写入 processed, documents.status = ready
Qoder Work 回写失败 -> documents.status = failed
```

Qoder Work 使用的核心 API：

```text
GET  /api/v1/parse-jobs/next?limit=5
POST /api/v1/parse-jobs/{job_id}/complete
POST /api/v1/parse-jobs/{job_id}/fail
```

这些接口通过 `KB_AGENT_READ_TOKEN` 保护。网站后台只创建任务，不直接消耗 Token 做解析。

实际开发时，`data/` 不进 Git，只保留 `.gitkeep` 或在初始化脚本中创建。

## 四、数据目录规划

建议把数据放在非系统盘。目录结构：

```text
/data/kb/
  uploads/
    2026/06/{document_id}/original_filename.ext
  processed/
    2026/06/{document_id}/content.md
    2026/06/{document_id}/content.txt
    2026/06/{document_id}/metadata.json
  tmp/
  backups/
    db/
    files/
  kb.sqlite3
```

如果当前台式机是 macOS，可以先映射到类似：

```text
/Users/zhuangjiaxuan/Data/kb/
```

如果是 Windows，建议类似：

```text
D:\kb-data\
```

如果使用 Docker 部署，`.env` 里要同时区分“Windows 主机目录”和“容器内部目录”。Windows 主机目录用于 Docker 挂载，容器内部目录用于程序读写：

```dotenv
KB_HOST_DATA_DIR=D:\kb-data
KB_DATA_DIR=/data/kb
KB_UPLOAD_DIR=/data/kb/uploads
KB_PROCESSED_DIR=/data/kb/processed
KB_SQLITE_PATH=/data/kb/kb.sqlite3
KB_MAX_UPLOAD_MB=300
KB_AGENT_READ_TOKEN=change-me
```

## 五、核心数据模型

### documents

一条记录对应一个上传文件。

| 字段 | 类型 | 说明 |
|-|-|-|
| id | uuid/string | 文件唯一 ID。 |
| title | string | 展示标题，默认取文件名，可修改。 |
| original_filename | string | 上传时的原始文件名。 |
| file_ext | string | 文件扩展名，如 pdf、pptx、xlsx。 |
| file_format | string | 归一化格式，如 pdf、ppt、excel、word。 |
| mime_type | string | MIME 类型。 |
| size_bytes | int | 文件大小。 |
| checksum_sha256 | string | 去重和完整性校验。 |
| storage_path | string | 原文件相对路径。 |
| status | enum | uploaded、processing、ready、failed、deleted。 |
| created_at / updated_at | datetime | 创建和更新时间。 |

### document_metadata

保存业务分类。

| 字段 | 类型 | 说明 |
|-|-|-|
| document_id | fk | 关联 documents。 |
| purpose | enum | 文件作用分类。 |
| source | string | 资料来源，可选。 |
| project | string | 项目/客户，可选。 |
| confidentiality | enum | public、internal、sensitive，第一阶段仅标记不拦截。 |
| uploader_name | string | 上传人姓名，可选但建议记录。 |

### processed_artifacts

保存清洗产物。

| 字段 | 类型 | 说明 |
|-|-|-|
| document_id | fk | 关联 documents。 |
| artifact_type | enum | markdown、text、json。 |
| path | string | 衍生文件相对路径。 |
| parser | string | 使用的解析器。 |
| parse_status | enum | ready、failed。 |
| error_message | text | 解析失败原因。 |
| created_at | datetime | 创建时间。 |

### conversion_jobs

用于后台转换任务。

| 字段 | 类型 | 说明 |
|-|-|-|
| id | uuid/string | 任务 ID。 |
| document_id | fk | 目标文件。 |
| status | enum | queued、running、succeeded、failed。 |
| attempts | int | 重试次数。 |
| error_message | text | 失败原因。 |
| started_at / finished_at | datetime | 执行时间。 |

## 六、API 设计

### 页面 API

```http
POST   /api/v1/documents
GET    /api/v1/documents
GET    /api/v1/documents/{id}
GET    /api/v1/documents/{id}/raw
GET    /api/v1/documents/{id}/content?format=markdown
PATCH  /api/v1/documents/{id}/metadata
DELETE /api/v1/documents/{id}
POST   /api/v1/documents/{id}/reprocess
GET    /api/v1/categories
GET    /api/v1/audit-logs
```

### Agent 只读 API

Agent 端统一带 token：

```http
Authorization: Bearer ${KB_AGENT_READ_TOKEN}
```

推荐路径：

```http
GET /api/v1/manifest
GET /api/v1/documents?purpose=政策法规&format=pdf&q=招标
GET /api/v1/documents/{id}/content?format=markdown
GET /api/v1/documents/{id}/raw
GET /openapi.json
```

`/api/v1/manifest` 返回示例：

```json
{
  "generated_at": "2026-06-29T10:00:00+08:00",
  "total": 1,
  "documents": [
    {
      "id": "doc_01J...",
      "title": "某项目招投标需求清单",
      "purpose": "招投标需求清单",
      "file_format": "excel",
      "size_bytes": 1048576,
      "updated_at": "2026-06-29T09:58:00+08:00",
      "content_url": "/api/v1/documents/doc_01J.../content?format=markdown",
      "raw_url": "/api/v1/documents/doc_01J.../raw"
    }
  ]
}
```

## 七、前端页面

### 文件管理页

- 顶部：当前文件夹路径、关键词搜索、文件格式筛选、解析状态筛选。
- 主体：文件夹卡片和文件表格，支持一层层进入子文件夹。
- 操作：查看详情、下载原文；已解析文件可复制 Agent 正文链接。

### 上传页

- 拖拽上传。
- 选择或填写目标文件夹路径。
- 选择文件作用。
- 填写标题、来源、项目、上传人、敏感等级。
- 上传后显示为“未解析”，等待管理员统一解析。

### 文件详情页

- 原始文件信息。
- 业务分类信息。
- 清洗后的 Markdown/Text 预览。
- Agent 读取链接。
- 下载原文件。

### 后台管理页

- 分类字典。
- 解析失败队列。
- 手动触发“解析未解析文件”。
- 最近操作日志。
- 备份状态。

## 八、文档解析策略

上传成功后只写入 `documents` 和原文件目录，状态为 `uploaded`（未解析），不自动生成转换任务。

MVP 可以先用内置后台线程或定时轮询 worker，不必上 Redis：

1. 上传原文件到 `uploads/`。
2. 计算 sha256，落库，记录用户选择的文件夹路径。
3. 管理员在后台点击“解析未解析文件”。
4. 系统为所有 `uploaded` 状态文件创建 `conversion_jobs`。
5. worker 读取 queued job，按文件格式调用解析器：
   - PDF：PyMuPDF 或 pdfplumber。
   - Word：python-docx 或 MarkItDown。
   - PPT：python-pptx 或 MarkItDown。
   - Excel：openpyxl，把工作表转为 Markdown 表格摘要。
6. 生成 `content.md`、`content.txt`、`metadata.json`。
7. 将解析产物写入独立的 `processed/` 目录，并更新 `documents.status = ready`。
8. 解析失败则保留原文件，状态为 `failed`，页面允许手动重试。

## 九、部署方式

### 推荐：Docker Compose

第一阶段只需要三个服务：

```yaml
services:
  api:
    build: ./apps/api
    env_file: .env
    volumes:
      - ${KB_HOST_DATA_DIR:-./data}:/data/kb
    expose:
      - "8000"
    restart: unless-stopped

  web:
    build: ./apps/web
    expose:
      - "80"
    restart: unless-stopped

  proxy:
    image: caddy:2
    ports:
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    depends_on:
      - api
      - web
    restart: unless-stopped
```

Caddyfile：

```caddyfile
:80

handle_path /api/* {
  reverse_proxy api:8000
}

handle /openapi.json {
  reverse_proxy api:8000
}

handle {
  reverse_proxy web:80
}
```

### Windows 台式机部署建议

你确认服务器是一台 Windows 台式机后，第一阶段推荐部署方式是：

```text
Windows 台式机
  Docker Desktop
    api 容器：FastAPI 后端
    web 容器：前端静态网站
    proxy 容器：Caddy 监听 80 端口
  D:\kb-data\
    uploads：原始文件
    processed：解析后的 Markdown/Text
    backups：备份
    kb.sqlite3：元数据数据库
```

这样做的好处是：部署时不用在 Windows 上手动安装 Python、Node.js、Caddy、各种解析依赖；只要安装 Docker Desktop，把项目文件复制过去，改 `.env`，执行一条启动命令即可。

面向纯小白的完整部署手册单独放在：

```text
docs/windows-deployment-guide.md
```

后续开发完成后，把整个项目文件夹复制到 Windows 台式机，例如：

```text
D:\lan-knowledge-base\
```

把资料数据放到：

```text
D:\kb-data\
```

然后在 PowerShell 里进入项目目录执行：

```powershell
docker compose up -d --build
```

浏览器访问：

```text
http://localhost
http://台式机局域网IP
```

局域网其他同事访问：

```text
http://台式机局域网IP
```

注意：Windows 主机路径和 Docker 容器内部路径要分开配置。Windows 上真实目录是 `D:\kb-data`，容器里的程序统一访问 `/data/kb`。

```dotenv
KB_HOST_DATA_DIR=D:\kb-data
KB_DATA_DIR=/data/kb
KB_UPLOAD_DIR=/data/kb/uploads
KB_PROCESSED_DIR=/data/kb/processed
KB_SQLITE_PATH=/data/kb/kb.sqlite3
```

### 非 Docker 备选

- 后端：`uvicorn app.main:app --host 127.0.0.1 --port 8000`，用 systemd/launchd/NSSM 做开机启动。
- 前端：Vite build 后由 Caddy/Nginx 托管静态文件。
- 反向代理：Caddy/Nginx 监听 `0.0.0.0:80`。

如果这台台式机是 Windows，优先使用 Docker Desktop。非 Docker 方式需要分别安装 Python、Node.js、Caddy/Nginx、文档解析依赖和进程守护工具，对小白不友好，只作为排障或特殊环境备选。

## 十、实施步骤

### 第 0 步：确认本机环境

- 操作系统：macOS / Windows / Linux。
- 固定 IP：例如 `192.168.1.10`。
- 数据目录：建议非系统盘。
- 单文件上传上限：建议先设为 300MB。
- 备份位置：NAS、移动硬盘或另一台共享机器。

### 第 1 步：搭建代码骨架

- 创建 `apps/api` 和 `apps/web`。
- 初始化 FastAPI、React/Vite。
- 加 `.env.example`、`docker-compose.yml`、`Caddyfile`。
- 写健康检查接口 `GET /api/v1/health`。

验收标准：局域网内访问 `http://固定IP` 能打开页面，`/api/v1/health` 返回 OK。

### 第 2 步：实现上传和元数据

- 建 SQLite 数据模型和迁移。
- 实现上传接口、文件落盘、sha256、大小限制、后缀限制。
- 实现文件列表、详情、下载。
- 前端完成上传页和资料总览页。

验收标准：能上传 PDF/PPT/Excel，列表能看到，详情能下载原文件。

### 第 3 步：实现分类和筛选

- 内置首批文件作用分类字典。
- 自动识别文件格式。
- 列表支持 purpose、format、q 筛选。
- 记录上传人和敏感等级字段。

验收标准：能按“政策法规 + PDF”等组合筛选。

### 第 4 步：接入文本抽取

- 建 `conversion_jobs`。
- 实现 worker。
- 先覆盖 PDF、Word、PPT、Excel。
- 失败文件显示失败原因并支持重试。

验收标准：上传办公文件后能生成 Markdown/Text，并能在详情页预览。

### 第 5 步：开放 Agent API

- 实现 `/api/v1/manifest`。
- 实现 `/api/v1/documents/{id}/content?format=markdown`。
- Agent API 增加只读 token。
- 确认 `/openapi.json` 可被 Qoder Work 读取。

验收标准：Qoder Work 能通过 OpenAPI 发现接口，并读取 manifest 与 Markdown 正文。

### 第 6 步：部署到局域网

- 在 Windows 台式机安装 Docker Desktop。
- 创建 `D:\lan-knowledge-base\` 放项目代码，创建 `D:\kb-data\` 放资料数据。
- 配置 `.env` 数据目录、上传限制和 Agent token。
- 执行 `docker compose up -d --build`。
- 固定台式机 IP。
- 放行 Windows 防火墙 80 端口。
- 设置 Docker Desktop 开机自启动。
- 在同一局域网其他电脑访问 `http://台式机局域网IP` 测试。

验收标准：其他同事电脑能上传、筛选、下载；Agent 能读取。

### 第 7 步：备份与运维

- 每天备份 `kb.sqlite3`。
- 每天增量备份 `uploads/` 和 `processed/`。
- 保留最近 7 到 14 天备份。
- 增加 `scripts/backup.sh` 和恢复说明。

验收标准：能从备份恢复到另一目录并启动服务。

## 十一、建议的开发顺序

优先顺序如下：

1. API 健康检查 + Docker/Caddy 跑通。
2. SQLite 模型 + 上传落盘。
3. 列表、筛选、详情、下载。
4. 文档解析 worker。
5. Agent manifest/content API。
6. 备份脚本和部署文档。
7. 前端体验打磨。

这样第一周就能看到可用系统，后续再逐步把解析质量、搜索和权限补上。

## 十二、下一轮可直接开工的任务

如果进入开发，建议下一轮从以下任务开始：

1. 创建 FastAPI + React/Vite 单仓库骨架。
2. 写 `docker-compose.yml`、`Caddyfile`、`.env.example`。
3. 实现 `GET /api/v1/health` 和首页空状态。
4. 实现 SQLite 数据模型和上传接口。
