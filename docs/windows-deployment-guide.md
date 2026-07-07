# Windows 台式机部署手册

这份手册用于把局域网知识库部署到一台 Windows 台式机上，让同一局域网里的同事通过浏览器访问，并让 Qoder Work/其他 Agent 通过接口读取知识或处理解析任务。

最终效果：

```text
同事电脑浏览器 -> http://台式机局域网IP:18080 -> 知识库网站
其他 Agent -> /api/v1/manifest -> 读取已解析知识
Qoder Work -> /api/v1/parse-jobs/next -> 领取解析任务
```

## 一、部署难不难？

推荐使用 Docker Desktop 部署。这样不需要在 Windows 上分别安装 Python、Node.js、Nginx/Caddy 或文档解析依赖。

第一次部署通常需要 30 到 60 分钟，主要时间花在：

1. 安装 Docker Desktop。
2. 下载镜像和构建容器。
3. 固定台式机 IP。
4. 放行 Windows 防火墙端口。

以后更新网站一般只需要 5 到 10 分钟。

## 二、推荐目录

建议程序和资料分开：

```text
F:\lan-knowledge-base\   程序目录，放网站代码
F:\kb-data\              数据目录，放上传文件、解析结果、数据库、备份
```

数据目录建议：

```text
F:\kb-data\
  uploads\
  processed\
  tmp\
  backups\
  kb.sqlite3
```

不要把正式资料放在桌面、下载目录、微信文件目录里。

## 三、部署前准备

### 1. 确认 Windows 版本

建议 Windows 10 或 Windows 11。

查看方式：

1. 按 `Win + R`。
2. 输入 `winver`。
3. 回车。

### 2. 确认虚拟化已开启

Docker Desktop 需要虚拟化。

查看方式：

1. 按 `Ctrl + Shift + Esc` 打开任务管理器。
2. 点“性能”。
3. 点“CPU”。
4. 右下角看“虚拟化”。

如果显示“已启用”，可以继续。如果显示“已禁用”，需要进 BIOS 开启虚拟化。

### 3. 确认网站端口是否可用

这台机器的 80 和 8080 端口已经被其他程序监听，所以本手册统一使用 `18080` 作为网站对外访问端口。

管理员身份打开 PowerShell：

```powershell
netstat -ano | findstr ":18080"
```

没有输出通常表示 `18080` 端口可用。如果有输出，说明 `18080` 也被占用，可以再换成其他不常用端口，例如 `18081`。

## 四、安装 Docker Desktop

下载地址：

```text
https://www.docker.com/products/docker-desktop/
```

安装建议：

- 勾选 `Use WSL 2 instead of Hyper-V`。
- 安装完成后重启电脑。
- 第一次打开 Docker Desktop 时，如果提示安装 WSL2 或 Linux kernel，按提示完成。

验证：

```powershell
docker version
docker compose version
```

能看到 Client/Server 和 Compose 版本号，说明 Docker 正常。

## 五、复制网站项目

把项目放到：

```text
F:\lan-knowledge-base\
```

目录下面应能看到：

```text
docker-compose.yml
.env.example
Caddyfile
apps\
docs\
scripts\
```

如果使用 Git：

```powershell
cd F:\
git clone 项目仓库地址 lan-knowledge-base
```

如果不熟 Git，也可以用压缩包复制解压。

## 六、创建数据目录

管理员或普通 PowerShell 均可：

```powershell
mkdir F:\kb-data
mkdir F:\kb-data\uploads
mkdir F:\kb-data\processed
mkdir F:\kb-data\tmp
mkdir F:\kb-data\backups
```

目录已存在不影响。

## 七、配置 `.env`

进入项目目录：

```powershell
cd F:\lan-knowledge-base
```

复制配置模板：

```powershell
copy .env.example .env
```

用记事本打开：

```powershell
notepad .env
```

推荐配置：

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

# 如果 Docker Hub / Debian / npm / pip 访问不稳定，可以保留下面这些国内镜像配置。
PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim
NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:24-alpine
NGINX_BASE_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine
APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
APT_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
NPM_REGISTRY=https://registry.npmmirror.com
```

说明：

- `KB_HOST_DATA_DIR=F:\kb-data` 是 Windows 上真实目录。
- `/data/kb` 是 Docker 容器内目录。
- Docker 会把 `F:\kb-data` 映射成容器内的 `/data/kb`。
- `KB_AGENT_READ_TOKEN` 是给 Qoder Work 和其他 Agent 调接口用的令牌，正式环境不要使用 `change-me`。
- `PYTHON_BASE_IMAGE`、`NODE_BASE_IMAGE`、`NGINX_BASE_IMAGE` 用来绕开 Docker Hub 访问不稳定的问题。
- `APT_MIRROR`、`PIP_INDEX_URL`、`NPM_REGISTRY` 分别用于 Debian、Python、Node 依赖下载。

## 八、启动网站

确保当前在项目目录：

```powershell
cd F:\lan-knowledge-base
```

第一次启动：

```powershell
docker compose up -d --build
```

查看状态：

```powershell
docker compose ps
```

正常情况下应看到 `api`、`web`、`proxy` 都是 running/up。

## 九、本机测试

在 Windows 台式机浏览器访问：

```text
http://localhost:18080
```

健康检查：

```text
http://localhost:18080/api/v1/health
```

OpenAPI：

```text
http://localhost:18080/openapi.json
```

如果页面能打开，健康检查返回 OK，OpenAPI 能看到 JSON，说明本机部署成功。

## 十、固定台式机 IP

推荐在路由器里绑定固定 IP。

### 方式 A：路由器绑定固定 IP

1. 登录路由器管理页面。
2. 找到 DHCP、地址分配、静态租约、IP/MAC 绑定等菜单。
3. 找到这台 Windows 台式机。
4. 绑定一个固定 IP，例如 `192.168.1.10`。

### 方式 B：Windows 手动设置 IP

如果必须手动设置：

```text
IP 地址：192.168.1.10
子网掩码：255.255.255.0
网关：192.168.1.1
DNS：192.168.1.1 或 223.5.5.5
```

这些数值必须和实际局域网一致，不确定时请优先找网管或懂网络的人处理。

查看本机 IP：

```powershell
ipconfig
```

找到当前网卡的 `IPv4 地址`，例如：

```text
192.168.1.10
```

局域网访问地址就是：

```text
http://192.168.1.10:18080
```

## 十一、放行 Windows 防火墙

如果本机能打开 `http://localhost:18080`，同事电脑打不开 `http://台式机IP:18080`，常见原因是防火墙。

管理员 PowerShell 执行：

```powershell
New-NetFirewallRule -DisplayName "LAN Knowledge Base HTTP 18080" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 18080
```

如果后续又改成其他端口，把 `18080` 换成实际端口。

也可以在“Windows 安全中心 -> 防火墙和网络保护 -> 允许应用通过防火墙”里允许 Docker Desktop 通过专用网络。

## 十二、同事电脑访问测试

找一台同一局域网电脑，访问：

```text
http://台式机局域网IP:18080
```

例如：

```text
http://192.168.1.10:18080
```

再测试：

```text
http://192.168.1.10:18080/openapi.json
```

如果都能打开，局域网访问和 Agent 接口都可用。

## 十三、日常使用流程

### 1. 上传和整理资料

1. 打开网站。
2. 在左侧选择“原始文件”。
3. 选择文件作用分类，例如“政策法规”。
4. 新建或进入目标文件夹。
5. 上传一个或多个文件。
6. 文件上传后状态为“未解析”。

### 2. 移动文件路径

原始文件列表支持多选移动：

1. 勾选一个或多个文件。
2. 在目标路径输入框填写路径，例如：

```text
/政策法规/2026
```

也可以只填：

```text
2026
```

系统会自动归到当前分类下面。

3. 点击“移动选中文件”。

移动后，知识管理中的路径也会同步变化。

### 3. 创建解析任务

进入“后台管理”，点击：

```text
创建未解析文件任务
```

系统会把未解析文件加入队列，等待 Qoder Work 领取。

### 4. 查看解析结果

Qoder Work 回写成功后：

- 原始文件状态变成“可读取”。
- 知识管理页可以查看 Markdown/Text 正文概览。
- 可以复制知识链接给其他 Agent 使用。

## 十四、其他 Agent 读取知识

网站左下角有“Agent 接入”面板：

- 点击“查看说明”可看到读取知识和解析队列说明。
- 点击“复制读取说明”可复制给其他 Agent。
- 点击“复制解析说明”可复制给 Qoder Work。

其他 Agent 读取已解析知识的核心流程：

```http
GET http://台式机IP:18080/api/v1/manifest
GET http://台式机IP:18080/api/v1/documents/{document_id}/content?format=markdown
```

如果配置了 token，请加请求头：

```http
Authorization: Bearer 你的KB_AGENT_READ_TOKEN
```

`manifest` 只返回已经解析完成的 `ready` 知识，并包含：

- `id`
- `title`
- `purpose`
- `folder_path`
- `content_url`
- `raw_url`

## 十五、Qoder Work 解析接口

Qoder Work 的典型流程：

```text
1. 领取任务
2. 下载或读取原文件
3. 解析生成 Markdown/Text
4. 成功则 complete 回写
5. 失败则 fail 回写
```

查看队列：

```http
GET http://台式机IP:18080/api/v1/parse-jobs/queue?limit=500
```

领取任务：

```http
GET http://台式机IP:18080/api/v1/parse-jobs/next?limit=5&worker=qoder-work
```

返回内容包含：

- `id`：job_id
- `document_id`
- `title`
- `original_filename`
- `file_format`
- `file_ext`
- `purpose`
- `folder_path`
- `raw_url`
- `raw_path`

获取原文件：

```text
优先使用 raw_url 下载
同机或共享目录可使用 raw_path 读取
```

解析成功回写：

```http
POST http://台式机IP:18080/api/v1/parse-jobs/{job_id}/complete
Content-Type: application/json
```

请求体：

```json
{
  "markdown": "# 解析后的 Markdown 正文",
  "text": "可选纯文本正文",
  "metadata": {
    "parser": "qoder-work"
  },
  "worker": "qoder-work"
}
```

解析失败回写：

```http
POST http://台式机IP:18080/api/v1/parse-jobs/{job_id}/fail
Content-Type: application/json
```

请求体：

```json
{
  "error_message": "失败原因",
  "worker": "qoder-work"
}
```

所有 Qoder Work 请求建议带：

```http
Authorization: Bearer 你的KB_AGENT_READ_TOKEN
```

## 十六、常用管理命令

所有命令都在项目目录执行：

```powershell
cd F:\lan-knowledge-base
```

查看服务状态：

```powershell
docker compose ps
```

查看所有日志：

```powershell
docker compose logs -f
```

只看后端日志：

```powershell
docker compose logs -f api
```

重启服务：

```powershell
docker compose restart
```

停止服务：

```powershell
docker compose down
```

重新构建并启动：

```powershell
docker compose up -d --build
```

## 十七、开机自启动

### 1. Docker Desktop 开机启动

1. 打开 Docker Desktop。
2. 进入 Settings。
3. 找到 General。
4. 勾选 `Start Docker Desktop when you sign in`。
5. Apply & Restart。

### 2. 容器自动恢复

`docker-compose.yml` 中服务已配置：

```yaml
restart: unless-stopped
```

Docker Desktop 启动后，容器会自动恢复。

## 十八、备份

至少每天备份：

```text
F:\kb-data\kb.sqlite3
F:\kb-data\uploads\
F:\kb-data\processed\
```

建议备份到移动硬盘、NAS 或共享盘。

手动备份示例：

```powershell
$date = Get-Date -Format "yyyyMMdd-HHmmss"
mkdir "F:\kb-data\backups\$date"
copy "F:\kb-data\kb.sqlite3" "F:\kb-data\backups\$date\kb.sqlite3"
robocopy "F:\kb-data\uploads" "F:\kb-data\backups\$date\uploads" /E
robocopy "F:\kb-data\processed" "F:\kb-data\backups\$date\processed" /E
```

仓库中也提供了：

```text
scripts\backup.ps1
scripts\init-data-dirs.ps1
```

## 十九、更新网站

推荐把 Windows 台式机当成“部署机器”，日常不要直接在这台机器上改代码。标准流程是：

```text
开发电脑修改代码 -> 本地测试 -> 提交并推送到 GitHub -> Windows 台式机拉取最新代码 -> Docker 重新构建并启动
```

这样做的好处是：

- GitHub 保存每一次改动，方便追溯和回滚。
- Windows 台式机只负责运行服务，环境更稳定。
- `F:\kb-data` 中的上传文件、解析结果和 SQLite 数据库不会因为更新代码被覆盖。

### 1. 开发电脑上的操作

在开发电脑上完成修改后，先本地测试。前端改动至少执行：

```powershell
cd 项目目录\apps\web
npm run build
```

如果后端接口有改动，也建议本地启动后访问：

```text
http://localhost:8000/api/v1/health
http://localhost:8000/openapi.json
```

确认没问题后提交并推送到 GitHub：

```powershell
cd 项目目录
git status
git add .
git commit -m "说明这次修改了什么"
git push origin main
```

如果你使用的不是 `main` 分支，把命令里的 `main` 换成实际部署分支。

### 2. Windows 台式机第一次准备 Git

如果 Windows 台式机还没有安装 Git，先安装 Git for Windows：

```text
https://git-scm.com/download/win
```

安装后打开 PowerShell，验证：

```powershell
git --version
```

如果仓库是私有仓库，需要提前配置 GitHub 登录方式。常见方式有两种：

- 使用 GitHub Desktop 登录后 clone 仓库。
- 使用 Git 命令行配置 SSH key 或 Personal Access Token。

第一次部署时推荐直接 clone：

```powershell
cd F:\
git clone GitHub仓库地址 lan-knowledge-base
cd F:\lan-knowledge-base
copy .env.example .env
notepad .env
```

`.env` 只在 Windows 台式机本地维护，不要提交到 GitHub。

### 3. Windows 台式机常规更新步骤

更新前先备份 `F:\kb-data`，至少确认这些内容安全：

```text
F:\kb-data\kb.sqlite3
F:\kb-data\uploads\
F:\kb-data\processed\
```

进入项目目录：

```powershell
cd F:\lan-knowledge-base
```

查看当前有没有未提交的本地改动：

```powershell
git status
```

正常情况下，部署机器上的代码文件不应该有本地改动。如果看到 `.env` 以外的代码文件被修改，先不要继续更新，避免覆盖掉不清楚来源的改动。

拉取 GitHub 最新代码：

```powershell
git pull origin main
```

如果你使用的不是 `main` 分支，把 `main` 换成实际部署分支。

重新构建并启动 Docker 服务：

```powershell
docker compose up -d --build
```

查看服务状态：

```powershell
docker compose ps
```

正常情况下应看到 `api`、`web`、`proxy` 都是 running/up。

### 4. 更新后验证

在 Windows 台式机上访问：

```text
http://localhost:18080
http://localhost:18080/api/v1/health
http://localhost:18080/openapi.json
```

在同事电脑上访问：

```text
http://台式机局域网IP:18080
```

再做一次最小业务验证：

1. 打开原始文件页。
2. 查看文件列表是否正常。
3. 打开知识管理页。
4. 查看已解析知识是否能正常读取。
5. 打开后台管理页。
6. 查看解析队列和 API 状态是否正常。

如果页面打不开或接口报错，先看日志：

```powershell
docker compose logs -f
```

只看后端日志：

```powershell
docker compose logs -f api
```

### 5. 什么时候需要重建镜像？

一般只要代码有变化，都用：

```powershell
docker compose up -d --build
```

如果只是改了 `.env`，通常不需要重新构建镜像，重启即可：

```powershell
docker compose restart
```

如果依赖变化、构建异常或怀疑 Docker 缓存导致旧代码没生效，可以强制无缓存构建：

```powershell
docker compose build --no-cache
docker compose up -d
```

### 6. 更新失败如何回滚

先查看最近提交：

```powershell
git log --oneline -5
```

临时回到上一个可用版本：

```powershell
git checkout 上一个可用的commit_id
docker compose up -d --build
```

验证恢复后，网站可以先继续使用。之后在开发电脑上修复问题并推送新提交，再回到 Windows 台式机执行：

```powershell
git switch main
git pull origin main
docker compose up -d --build
```

如果你使用的不是 `main` 分支，把 `main` 换成实际部署分支。

### 7. 不建议在 Windows 部署机器上做的事

- 不建议直接改 `apps\api`、`apps\web`、`docs` 里的代码和文档。
- 不建议把 `F:\kb-data` 放进 Git 仓库。
- 不建议把 `.env`、token、数据库、上传文件提交到 GitHub。
- 不建议在没有备份 `F:\kb-data` 的情况下更新。

推荐只在 Windows 部署机器上维护：

- `F:\lan-knowledge-base\.env`
- `F:\kb-data\`
- Docker Desktop
- 固定 IP 和防火墙规则

## 二十、常见问题

### 1. docker 命令找不到

处理：

1. 确认 Docker Desktop 已安装并打开。
2. 关闭 PowerShell 重新打开。
3. 执行 `docker version`。

### 2. Docker Desktop 启动失败

常见原因：

- 虚拟化没开。
- WSL2 没装好。
- Windows 版本太旧。

处理：

1. 检查任务管理器 CPU 页面里的虚拟化。
2. 按 Docker Desktop 提示修复 WSL2。
3. 重启电脑。

### 3. 本机能打开，同事电脑打不开

排查顺序：

1. 台式机打开 `http://localhost:18080`。
2. 台式机打开 `http://台式机IP:18080`。
3. 同事电脑 ping 台式机 IP：

```powershell
ping 192.168.1.10
```

4. 放行 Windows 防火墙 18080 端口。
5. 检查路由器是否开启 AP 隔离或访客网络隔离。

### 4. 80 和 8080 端口被占用

本手册已经默认改用 `18080`。

`docker-compose.yml` 当前使用：

```yaml
ports:
  - "18080:80"
```

如果 `18080` 后续也被占用，可以再改为：

```yaml
ports:
  - "18081:80"
```

访问：

```text
http://台式机IP:18081
```

### 5. 上传失败

常见原因：

- 文件超过 `KB_MAX_UPLOAD_MB`。
- 文件格式不允许。
- `F:\kb-data` 没有写入权限。
- 磁盘空间不够。

查看后端日志：

```powershell
docker compose logs -f api
```

### 6. Docker 构建时拉不到基础镜像

如果看到类似：

```text
failed to fetch anonymous token
https://auth.docker.io/token
load metadata for docker.io/library/python:3.12-slim
```

说明 Docker 还没进入项目构建步骤，卡在拉 Docker Hub 基础镜像。

处理：

1. 确认 `.env` 里有下面三行：

```dotenv
PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim
NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:24-alpine
NGINX_BASE_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine
```

2. 重新构建：

```powershell
docker compose build --no-cache
docker compose up -d
```

如果这个镜像源也不可用，可以尝试把 `docker.m.daocloud.io` 换成 `docker.1ms.run`：

```dotenv
PYTHON_BASE_IMAGE=docker.1ms.run/library/python:3.12-slim
NODE_BASE_IMAGE=docker.1ms.run/library/node:24-alpine
NGINX_BASE_IMAGE=docker.1ms.run/library/nginx:1.27-alpine
```

### 7. Docker 构建时 apt-get update 失败

如果看到类似：

```text
Unable to connect to deb.debian.org
Unable to locate package build-essential
```

说明基础镜像已经拉下来了，但容器内访问 Debian 软件源失败。

确认 `.env` 里有：

```dotenv
APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
APT_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
```

如果清华源不可用，可以换中科大：

```dotenv
APT_MIRROR=https://mirrors.ustc.edu.cn/debian
APT_SECURITY_MIRROR=https://mirrors.ustc.edu.cn/debian-security
```

### 8. Agent 401

原因通常是 token 不一致。

检查：

1. `.env` 里的 `KB_AGENT_READ_TOKEN`。
2. Agent 请求头是否是：

```http
Authorization: Bearer 你的KB_AGENT_READ_TOKEN
```

修改 `.env` 后需要重启：

```powershell
docker compose restart api
```

### 9. Qoder Work 领取不到任务

排查：

1. 后台管理页是否已经点击“创建未解析文件任务”。
2. 队列里是否有 `queued` 状态任务。
3. Qoder Work 是否调用：

```http
GET /api/v1/parse-jobs/next?limit=5&worker=qoder-work
```

4. token 是否正确。
5. 查看后端日志：

```powershell
docker compose logs -f api
```

## 二十一、最终验收清单

- [ ] Windows 台式机可以打开 `http://localhost:18080`。
- [ ] Windows 台式机可以打开 `http://台式机IP:18080`。
- [ ] 同事电脑可以打开 `http://台式机IP:18080`。
- [ ] 可以上传 PDF、PPT、Excel、Word。
- [ ] 可以新建文件夹。
- [ ] 可以删除空文件夹。
- [ ] 可以移动单个文件到当前文件夹。
- [ ] 可以多选文件并批量移动到目标路径。
- [ ] 可以按文件作用筛选。
- [ ] 可以按文件格式筛选。
- [ ] 可以按解析状态筛选。
- [ ] 可以下载原文件。
- [ ] 后台可以创建未解析文件任务。
- [ ] Qoder Work 可以领取 `/api/v1/parse-jobs/next`。
- [ ] Qoder Work 可以回写 `/complete`。
- [ ] 知识管理页可以看到解析后的 Markdown 正文。
- [ ] 其他 Agent 可以读取 `/api/v1/manifest`。
- [ ] 可以打开 `http://台式机IP:18080/openapi.json`。
- [ ] 已设置固定 IP。
- [ ] 已放行 Windows 防火墙 18080 端口。
- [ ] 已确认备份目录和备份方式。
