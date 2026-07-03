# 局域网知识库

这是一个面向局域网内部资料管理和 Agent 读取的知识库项目。

第一阶段目标是先做成一个稳定的“局域网资料入口”：

- Windows 台式机单机部署。
- 局域网固定 IP 访问。
- 支持 PDF、PPT、Excel、Word 等办公资料上传、文件夹浏览和下载。
- 网页主体验是文件管理器，大家只需要把原始文件上传到对应文件夹。
- 上传后不自动解析，由管理员定期创建解析任务。
- Qoder Work 主动领取解析任务，生成 Markdown/Text 后回写网站。
- 解析后的 Markdown/Text 独立存储在 processed 目录，供 Qoder Work 等 Agent 读取。
- 为 Qoder Work 等 Agent 提供 OpenAPI、manifest、Markdown 正文和原文下载接口。

## 当前内容

目前仓库包含可运行 MVP 代码、项目规划和部署方案：

- [局域网知识库本地 MVP 方案](docs/local-mvp-plan.md)
- [Windows 台式机部署手册](docs/windows-deployment-guide.md)

## 本地开发预览

后端：

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
KB_DATA_DIR=../../data KB_UPLOAD_DIR=../../data/uploads KB_PROCESSED_DIR=../../data/processed KB_SQLITE_PATH=../../data/kb.sqlite3 uvicorn app.main:app --reload --port 8000
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

## Qoder Work 解析任务流

网站本身只负责存储原始文件、记录状态、创建任务和接收结果。Qoder Work 负责真正解析文件。

典型流程：

```text
1. 管理员在后台点击“创建未解析文件任务”
2. Qoder Work 请求 GET /api/v1/parse-jobs/next?limit=5
3. Qoder Work 读取返回的 raw_url 或 raw_path
4. Qoder Work 生成 Markdown/Text
5. Qoder Work 调用 POST /api/v1/parse-jobs/{job_id}/complete 回写结果
```

Qoder Work 领取和回写任务时使用：

```text
Authorization: Bearer <KB_AGENT_READ_TOKEN>
```

## 推荐部署路线

第一阶段推荐：

```text
Windows 台式机 + Docker Desktop + Docker Compose + Caddy
```

后续代码完成后，Windows 台式机上的典型目录如下：

```text
D:\lan-knowledge-base\   项目代码
D:\kb-data\              上传资料、解析结果、SQLite 数据库和备份
```

启动命令：

```powershell
cd D:\lan-knowledge-base
copy .env.example .env
docker compose up -d --build
```

局域网访问地址：

```text
http://台式机局域网IP
```

## 版本管理约定

- `main`：稳定可部署版本。
- `.env`、数据库、上传资料、解析产物和备份不会提交到 GitHub。
- 真实业务资料应保存在 Windows 台式机的数据目录，例如 `D:\kb-data\`。
