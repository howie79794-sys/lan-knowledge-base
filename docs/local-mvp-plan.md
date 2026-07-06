# 局域网知识库架构与接口说明

本文档描述当前局域网知识库网站的架构、功能边界、数据流和 Agent/Qoder Work 接口。它已经从最初 MVP 规划更新为当前实现状态。

## 一、当前目标

系统定位是局域网内部的“资料上传 + 文件夹整理 + 解析任务队列 + Markdown 知识读取”平台。

核心目标：

- 给团队成员一个统一的资料上传和文件夹整理入口。
- 原始文件与解析后的知识分离保存。
- 管理员决定何时创建解析任务，避免上传时自动消耗解析资源。
- Qoder Work 从接口领取解析任务，解析原文件，回写 Markdown/Text。
- 其他 Agent 通过 manifest 和 content 接口读取已解析完成的知识。

## 二、当前已实现功能

### 前端体验

- 轻量工作区风格界面。
- 左侧树形导航：
  - 原始文件
  - 知识管理
  - 后台管理
- 按文件作用分类浏览：
  - 招投标需求清单
  - 规划材料
  - 政策法规
  - 产品社区文档
  - 业务知识
  - 客户或特性案例
  - 业务材料
  - 竞品材料
  - 其他
- 原始文件页：
  - 搜索标题、文件名或正文
  - 按格式筛选
  - 按状态筛选
  - 文件夹面包屑浏览
  - 新建文件夹
  - 删除空文件夹
  - 上传单个或多个文件
  - 表格分页
  - 单选文件查看详情
  - 多选文件并批量移动到目标路径
  - 下载原始文件
  - 复制解析正文链接
  - 创建解析任务
  - 删除文件记录
- 知识管理页：
  - 按分类和路径浏览已解析知识
  - 搜索知识标题、来源文件或正文
  - 查看知识详情
  - 查看 Markdown/Text 正文概览
  - 复制知识正文链接
- 后台管理页：
  - API 状态
  - OpenAPI 入口
  - Agent Token 配置提示
  - 未解析、队列中、解析中、失败数量
  - 创建未解析文件任务
  - 查看解析队列
  - 删除选中队列任务
  - 查看最近操作日志
- 左下角 Agent 接入面板：
  - 展示读取知识入口
  - 展示解析任务入口
  - 查看 Agent 接入说明弹窗
  - 一键复制“其他 Agent 读取知识说明”
  - 一键复制“Qoder Work 解析接口说明”

### 后端能力

- FastAPI 应用启动时自动创建数据目录并初始化 SQLite。
- 支持 CORS 配置。
- 支持上传文件落盘、元数据入库、文件夹路径记录。
- 支持文件夹创建、列出、删除空文件夹。
- 支持文件软删除。
- 支持文件移动路径，移动后知识管理里的路径同步变化。
- 支持解析任务创建、批量创建、领取、完成、失败、取消。
- 支持解析结果写入 `processed` 目录。
- 支持 Agent manifest。
- 支持 OpenAPI。
- 支持关键操作审计日志。

## 三、技术栈

| 层 | 技术 | 当前用途 |
|-|-|-|
| 前端 | React + Vite + TypeScript | 管理页面、知识页面、后台页面 |
| 图标 | lucide-react | 导航、状态、操作按钮 |
| 后端 | FastAPI + Python | 文件、文件夹、任务队列、Agent API |
| 数据库 | SQLite | 文档元数据、文件夹、解析任务、审计日志 |
| 文件存储 | 本地目录 | 原文件、解析结果、临时文件、备份 |
| 反向代理 | Caddy | Docker 部署时监听 80 端口并转发 API/前端 |
| 容器 | Docker Compose | api、web、proxy 三服务部署 |

## 四、仓库结构

```text
lan-knowledge-base/
  README.md
  .env.example
  docker-compose.yml
  Caddyfile
  docs/
    local-mvp-plan.md
    windows-deployment-guide.md
  scripts/
    backup.ps1
    init-data-dirs.ps1
    convert_pptx_to_md.py
  apps/
    api/
      Dockerfile
      requirements.txt
      app/
        main.py
        core/
          config.py
          paths.py
        db/
          session.py
        modules/
          documents/
          parse_jobs/
          agent/
          audit/
          artifacts/
        workers/
          conversion_worker.py
    web/
      Dockerfile
      nginx.conf
      package.json
      src/
        app.tsx
        styles.css
        api/client.ts
        pages/
        components/
```

## 五、数据目录

推荐正式部署时把数据放到非系统盘，例如 Windows：

```text
F:\kb-data\
  uploads\
  processed\
  tmp\
  backups\
  kb.sqlite3
```

Docker 容器内部统一使用：

```text
/data/kb/
  uploads/
  processed/
  tmp/
  backups/
  kb.sqlite3
```

`.env` 示例：

```dotenv
KB_HOST_DATA_DIR=F:\kb-data
KB_DATA_DIR=/data/kb
KB_UPLOAD_DIR=/data/kb/uploads
KB_PROCESSED_DIR=/data/kb/processed
KB_TMP_DIR=/data/kb/tmp
KB_BACKUP_DIR=/data/kb/backups
KB_SQLITE_PATH=/data/kb/kb.sqlite3
KB_MAX_UPLOAD_MB=300
KB_AGENT_READ_TOKEN=请换成一串较长的随机字符
KB_ALLOW_ORIGINS=http://localhost:18080,http://127.0.0.1:18080,http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173
```

注意：

- `KB_HOST_DATA_DIR` 是 Windows 主机真实目录。
- `/data/kb` 是 Docker 容器内目录。
- Docker Compose 会把 `KB_HOST_DATA_DIR` 映射到容器的 `/data/kb`。

## 六、核心数据模型

### documents

一条记录对应一个上传文件。

| 字段 | 说明 |
|-|-|
| id | 文件唯一 ID |
| title | 展示标题，默认取文件名 |
| original_filename | 上传时原始文件名 |
| file_ext | 文件扩展名 |
| file_format | 归一化格式，如 pdf、ppt、excel、word、markdown |
| mime_type | MIME 类型 |
| size_bytes | 文件大小 |
| checksum_sha256 | 完整性校验 |
| storage_path | 原文件相对路径 |
| folder_path | 业务文件夹路径 |
| status | uploaded、queued、processing、ready、failed、deleted |
| content_excerpt | 解析后正文摘要 |
| search_text | 搜索文本 |
| error_message | 失败原因 |
| created_at / updated_at | 创建和更新时间 |

### document_metadata

保存业务分类和补充元数据。

| 字段 | 说明 |
|-|-|
| document_id | 关联 documents |
| purpose | 文件作用分类 |
| source | 资料来源 |
| project | 项目/客户 |
| confidentiality | public、internal、sensitive |
| uploader_name | 上传人 |

### document_folders

保存用户创建或系统推导出的文件夹路径。

| 字段 | 说明 |
|-|-|
| id | 文件夹唯一 ID |
| purpose | 所属知识分类 |
| path | 完整路径，例如 `/政策法规/2026` |
| created_at | 创建时间 |

### parse_jobs

保存解析任务。

| 字段 | 说明 |
|-|-|
| id | job ID |
| document_id | 待解析文件 |
| status | queued、processing、succeeded、failed |
| worker | 领取任务的 worker 名称 |
| attempts | 领取/处理次数 |
| requested_by | 创建来源，如 web |
| error_message | 失败原因 |
| started_at / finished_at / updated_at | 任务时间 |

### processed_artifacts

记录解析产物。

| 字段 | 说明 |
|-|-|
| id | 产物记录 ID |
| document_id | 关联文件 |
| artifact_type | markdown、text、json |
| path | 产物相对路径 |
| parser | 解析器名称 |
| parse_status | ready、failed |
| created_at | 创建时间 |

## 七、状态流转

```text
上传原文件
  -> documents.status = uploaded

后台创建解析任务
  -> parse_jobs.status = queued
  -> documents.status = queued

Qoder Work 领取任务
  -> parse_jobs.status = processing
  -> documents.status = processing

Qoder Work 回写成功
  -> content.md / content.txt / metadata.json 写入 processed/{document_id}/
  -> parse_jobs.status = succeeded
  -> documents.status = ready

Qoder Work 回写失败
  -> parse_jobs.status = failed
  -> documents.status = failed
```

## 八、页面 API

### 系统

```http
GET /api/v1/health
GET /openapi.json
```

### 分类

```http
GET /api/v1/categories
```

### 文件

```http
POST   /api/v1/documents
GET    /api/v1/documents?purpose=&format=&q=&status=&folder=&limit=&offset=
GET    /api/v1/documents/{document_id}
GET    /api/v1/documents/{document_id}/raw
GET    /api/v1/documents/{document_id}/content?format=markdown
PATCH  /api/v1/documents/{document_id}/folder
POST   /api/v1/documents/{document_id}/reprocess
DELETE /api/v1/documents/{document_id}
```

### 文件夹

```http
GET    /api/v1/folders?path=/政策法规&purpose=政策法规
POST   /api/v1/folders
DELETE /api/v1/folders?purpose=政策法规&path=/政策法规/2026
```

创建文件夹请求体：

```json
{
  "purpose": "政策法规",
  "parent_path": "/政策法规",
  "name": "2026"
}
```

移动文件请求体：

```json
{
  "folder_path": "/政策法规/2026"
}
```

前端批量移动会对选中文件逐个调用 `PATCH /api/v1/documents/{document_id}/folder`。

### 知识管理

```http
GET /api/v1/knowledge?q=&folder=&purpose=
```

只返回可用于知识页展示的文档摘要，正文仍通过 `/documents/{id}/content` 读取。

### 审计

```http
GET /api/v1/audit-logs
```

记录上传、删除、创建解析任务、解析完成、解析失败、移动文件、创建/删除文件夹等关键事件。

## 九、Agent 读取知识接口

其他 Agent 接入时，推荐只依赖两个步骤：

1. 读取 manifest。
2. 按 manifest 中的 `content_url` 读取 Markdown 正文。

```http
GET /api/v1/manifest
GET /api/v1/documents/{document_id}/content?format=markdown
```

如配置了 `KB_AGENT_READ_TOKEN`，请求头带：

```http
Authorization: Bearer <KB_AGENT_READ_TOKEN>
```

`/api/v1/manifest` 返回字段：

```json
{
  "total": 1,
  "documents": [
    {
      "id": "doc_xxx",
      "title": "某项目招投标需求清单",
      "purpose": "招投标需求清单",
      "folder_path": "/招投标需求清单/2026",
      "file_format": "excel",
      "size_bytes": 1048576,
      "status": "ready",
      "updated_at": "2026-07-04T10:00:00+08:00",
      "content_url": "http://服务器/api/v1/documents/doc_xxx/content?format=markdown",
      "raw_url": "http://服务器/api/v1/documents/doc_xxx/raw"
    }
  ]
}
```

约定：

- manifest 只返回 `ready` 状态的知识。
- Agent 不应猜测 document_id，应先从 manifest 发现。
- Agent 引用知识时建议保留 title、purpose、folder_path，便于追溯。

## 十、Qoder Work 解析接口

### 查看解析队列

```http
GET /api/v1/parse-jobs/queue?limit=500
```

用途：后台页面展示和调试，不会改变任务状态。

返回重点字段：

- `document_id`
- `title`
- `original_filename`
- `file_format`
- `folder_path`
- `purpose`
- `document_status`
- `job_id`
- `job_status`
- `worker`
- `attempts`
- `error_message`

### 领取待解析任务

```http
GET /api/v1/parse-jobs/next?limit=5&worker=qoder-work
```

领取后：

- `parse_jobs.status` 变为 `processing`
- `documents.status` 变为 `processing`
- 返回任务中的 `raw_url` 和 `raw_path`

返回重点字段：

```json
{
  "jobs": [
    {
      "id": "job_xxx",
      "document_id": "doc_xxx",
      "title": "文件标题",
      "original_filename": "原始文件名.pptx",
      "file_format": "ppt",
      "file_ext": "pptx",
      "folder_path": "/招投标需求清单/2026",
      "purpose": "招投标需求清单",
      "size_bytes": 123456,
      "raw_url": "http://服务器/api/v1/documents/doc_xxx/raw",
      "raw_path": "/data/kb/uploads/..."
    }
  ]
}
```

### 解析成功回写

```http
POST /api/v1/parse-jobs/{job_id}/complete
Content-Type: application/json
```

请求体：

```json
{
  "markdown": "# 解析后的 Markdown 正文",
  "text": "可选纯文本正文；不传时默认使用 markdown",
  "metadata": {
    "parser": "qoder-work",
    "notes": "可选解析元信息"
  },
  "worker": "qoder-work"
}
```

成功后：

- 写入 `processed/{document_id}/content.md`
- 写入 `processed/{document_id}/content.txt`
- 写入 `processed/{document_id}/metadata.json`
- 文件状态变为 `ready`
- 知识管理页可读取正文

### 解析失败回写

```http
POST /api/v1/parse-jobs/{job_id}/fail
Content-Type: application/json
```

请求体：

```json
{
  "error_message": "失败原因",
  "worker": "qoder-work"
}
```

失败后：

- 文件状态变为 `failed`
- 后台解析队列显示错误信息

## 十一、部署架构

Docker Compose 当前包含三个服务：

```text
proxy(Caddy, :80)
  -> /api/* 与 /openapi.json 转发到 api:8000
  -> 其他路径转发到 web:80

api(FastAPI)
  -> 读写 /data/kb
  -> SQLite: /data/kb/kb.sqlite3

web(Nginx 静态站点)
  -> React/Vite build 产物
```

`docker-compose.yml`：

```yaml
services:
  api:
    build:
      context: ./apps/api
    env_file: .env
    volumes:
      - ${KB_HOST_DATA_DIR:-./data}:/data/kb
    expose:
      - "8000"
    restart: unless-stopped

  web:
    build:
      context: ./apps/web
    expose:
      - "80"
    restart: unless-stopped

  proxy:
    image: caddy:2.8
    ports:
      - "18080:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    depends_on:
      - api
      - web
    restart: unless-stopped
```

## 十二、当前运维关注点

- `KB_AGENT_READ_TOKEN` 正式环境必须改成强随机值。
- `F:\kb-data` 必须定期备份，至少包含：
  - `kb.sqlite3`
  - `uploads\`
  - `processed\`
- Windows 防火墙需要放行 18080 端口。
- 局域网 IP 建议在路由器里绑定固定地址。
- 当前 Windows 部署默认使用 `18080:80`，访问 `http://台式机IP:18080`；如果 18080 也被占用，可以改为其他宿主机端口。
- 解析任务由 Qoder Work 处理，网站自身不负责调用大模型或消耗 Token。
