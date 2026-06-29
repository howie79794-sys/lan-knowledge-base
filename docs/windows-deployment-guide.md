# Windows 台式机部署手册

这份手册按“纯小白也能照着做”的标准写。目标是在一台 Windows 台式机上部署局域网知识库，让同一局域网里的同事通过浏览器访问。

最终效果：

```text
同事电脑浏览器 -> http://台式机局域网IP -> 知识库网站
Qoder Work 等 Agent -> http://台式机局域网IP/openapi.json -> 读取接口
```

## 一、部署难不难？

不算麻烦。推荐用 Docker Desktop 部署后，你不需要在 Windows 上分别安装 Python、Node.js、Caddy、文档解析工具。后续我把网站搭好后，你只需要做这些事：

1. 安装 Docker Desktop。
2. 把项目文件夹复制到 Windows 台式机。
3. 创建一个数据目录，例如 `D:\kb-data`。
4. 修改 `.env` 配置文件。
5. 在 PowerShell 里执行一条启动命令。
6. 固定台式机 IP，并放行 Windows 防火墙 80 端口。

第一次部署通常需要 30 到 60 分钟，主要时间花在 Docker Desktop 安装和下载镜像。以后更新网站一般只需要 5 到 10 分钟。

## 二、推荐目录

建议把程序和资料分开：

```text
D:\lan-knowledge-base\   程序目录，放我搭好的网站代码
D:\kb-data\              数据目录，放上传文件、解析结果、数据库、备份
```

不要把正式资料放在桌面、下载目录、微信文件目录里。后面备份、迁移、排查都会麻烦。

数据目录建议这样：

```text
D:\kb-data\
  uploads\
  processed\
  tmp\
  backups\
  kb.sqlite3
```

## 三、部署前准备

### 1. 确认 Windows 版本

建议使用 Windows 10 或 Windows 11。

查看方式：

1. 按 `Win + R`。
2. 输入 `winver`。
3. 回车。
4. 看弹窗里的 Windows 版本。

### 2. 确认虚拟化已开启

Docker Desktop 需要电脑支持虚拟化。

查看方式：

1. 按 `Ctrl + Shift + Esc` 打开任务管理器。
2. 点“性能”。
3. 点“CPU”。
4. 右下角看“虚拟化”。

如果显示“已启用”，可以继续。

如果显示“已禁用”，需要进 BIOS 开启虚拟化。不同品牌电脑入口不一样，常见按键是 `F2`、`Delete`、`F12`。这一项如果你不熟，建议让会装系统的人帮忙开一下。

### 3. 确认 80 端口没有被占用

知识库默认使用浏览器地址里的普通 HTTP 端口，也就是 80 端口。

打开 PowerShell：

1. 点开始菜单。
2. 搜索 `PowerShell`。
3. 右键“Windows PowerShell”。
4. 点“以管理员身份运行”。

输入：

```powershell
netstat -ano | findstr ":80"
```

如果没有任何输出，说明 80 端口大概率可用。

如果有输出，先不用慌。可能是 IIS、其他网站服务、某些代理软件占用了端口。后续可以改成 `8080` 端口访问，例如 `http://台式机IP:8080`。

## 四、安装 Docker Desktop

### 1. 下载 Docker Desktop

打开官网下载：

```text
https://www.docker.com/products/docker-desktop/
```

下载 Windows 版本并安装。

### 2. 安装时勾选建议

安装界面如果出现这些选项，建议：

- 勾选 `Use WSL 2 instead of Hyper-V`。
- 勾选 `Add shortcut to desktop` 可选。

安装完成后重启电脑。

### 3. 第一次打开 Docker Desktop

1. 打开 Docker Desktop。
2. 等左下角或顶部状态显示 Docker 正在运行。
3. 如果提示安装 WSL2 或更新 Linux kernel，按提示安装。

验证 Docker 是否正常：

打开 PowerShell，输入：

```powershell
docker version
```

能看到 Client 和 Server 信息，就说明 Docker 正常。

再输入：

```powershell
docker compose version
```

能看到版本号，就说明 Docker Compose 正常。

## 五、复制网站项目到 Windows

后续我搭好网站后，会有一个项目文件夹，名字可以叫：

```text
lan-knowledge-base
```

复制到 Windows 台式机：

```text
D:\lan-knowledge-base\
```

如果用压缩包：

1. 把压缩包复制到 Windows 台式机。
2. 右键解压。
3. 确保最终目录是 `D:\lan-knowledge-base\`。
4. 这个目录下面应该能看到 `docker-compose.yml`、`.env.example`、`apps` 等文件或文件夹。

如果用 Git：

```powershell
cd D:\
git clone 项目仓库地址 lan-knowledge-base
```

纯小白更推荐先用压缩包，简单直接。

## 六、创建数据目录

打开 PowerShell，执行：

```powershell
mkdir D:\kb-data
mkdir D:\kb-data\uploads
mkdir D:\kb-data\processed
mkdir D:\kb-data\tmp
mkdir D:\kb-data\backups
```

如果提示目录已存在，不影响。

## 七、配置 `.env`

进入项目目录：

```powershell
cd D:\lan-knowledge-base
```

复制配置模板：

```powershell
copy .env.example .env
```

用记事本打开：

```powershell
notepad .env
```

建议第一版配置：

```dotenv
KB_HOST_DATA_DIR=D:\kb-data
KB_DATA_DIR=/data/kb
KB_UPLOAD_DIR=/data/kb/uploads
KB_PROCESSED_DIR=/data/kb/processed
KB_TMP_DIR=/data/kb/tmp
KB_BACKUP_DIR=/data/kb/backups
KB_SQLITE_PATH=/data/kb/kb.sqlite3
KB_MAX_UPLOAD_MB=300
KB_AGENT_READ_TOKEN=请换成一串较长的随机字符
```

这里有一个容易弄混的地方：

- `KB_HOST_DATA_DIR=D:\kb-data` 是 Windows 台式机上的真实目录。
- `/data/kb` 是 Docker 容器里的目录。
- Docker 会把 `D:\kb-data` 映射成容器里的 `/data/kb`。
- 程序运行在容器里，所以程序配置统一写 `/data/kb`。

`KB_AGENT_READ_TOKEN` 是给 Qoder Work 等 Agent 调接口用的只读令牌。建议随便生成一串不容易猜的字符，例如：

```text
kb_2026_xxxxxxx_把这里换成长一点
```

保存并关闭记事本。

## 八、启动网站

确保 PowerShell 当前在项目目录：

```powershell
cd D:\lan-knowledge-base
```

第一次启动：

```powershell
docker compose up -d --build
```

解释一下这条命令：

- `docker compose`：使用 Docker Compose 管理多个服务。
- `up`：启动服务。
- `-d`：后台运行。
- `--build`：根据当前代码重新构建网站。

第一次会下载镜像和构建服务，可能比较慢。看到命令结束且没有红色错误，就继续下一步。

查看服务是否启动：

```powershell
docker compose ps
```

正常情况下，api、web、proxy 三个服务应该都是 running 或 up。

## 九、在台式机本机测试

打开 Windows 台式机浏览器，访问：

```text
http://localhost
```

再访问健康检查：

```text
http://localhost/api/v1/health
```

如果能打开页面，并且健康检查返回 OK，就说明本机部署成功。

## 十、固定 Windows 台式机 IP

局域网知识库最好固定 IP，否则重启路由器或电脑后地址可能变化。

推荐两种方式，优先用方式 A。

### 方式 A：在路由器里绑定固定 IP

这是最推荐的方式。

1. 登录公司或办公室路由器管理页面。
2. 找到 DHCP、地址分配、静态租约、IP/MAC 绑定之类的菜单。
3. 找到这台 Windows 台式机。
4. 绑定一个固定 IP，例如：

```text
192.168.1.10
```

不同路由器界面不一样，如果看不懂，让网管或懂网络的人帮你设置一次。

### 方式 B：在 Windows 里手动设置固定 IP

1. 打开“设置”。
2. 进入“网络和 Internet”。
3. 找到当前网络连接，通常是以太网或 Wi-Fi。
4. 找到 IP 设置。
5. 改成手动。
6. 填写 IP、网关、DNS。

示例：

```text
IP 地址：192.168.1.10
子网掩码：255.255.255.0
网关：192.168.1.1
DNS：192.168.1.1 或 223.5.5.5
```

注意：这些数值要和你实际局域网一致，不要照抄。如果不确定，优先用路由器绑定。

## 十一、查看台式机局域网 IP

打开 PowerShell：

```powershell
ipconfig
```

找到当前正在使用的网卡，看 `IPv4 地址`。

例如看到：

```text
IPv4 地址 . . . . . . . . . . . . : 192.168.1.10
```

那么知识库地址就是：

```text
http://192.168.1.10
```

## 十二、放行 Windows 防火墙

如果本机能访问 `http://localhost`，但其他同事电脑打不开 `http://台式机IP`，大概率是防火墙挡住了。

### 简单做法：允许 Docker Desktop 通过防火墙

1. 打开“Windows 安全中心”。
2. 进入“防火墙和网络保护”。
3. 点“允许应用通过防火墙”。
4. 找到 Docker Desktop 相关项。
5. 勾选“专用网络”。

### 稳妥做法：放行 80 端口

用管理员身份打开 PowerShell，执行：

```powershell
New-NetFirewallRule -DisplayName "LAN Knowledge Base HTTP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80
```

如果你把网站改成 8080 端口，就把 `80` 换成 `8080`。

## 十三、在同事电脑上测试

找一台同一局域网里的电脑，打开浏览器访问：

```text
http://台式机局域网IP
```

例如：

```text
http://192.168.1.10
```

如果能打开页面，说明局域网访问成功。

再测试：

```text
http://192.168.1.10/openapi.json
```

如果能看到一大段 JSON，说明 Agent 后续也能读取接口说明。

## 十四、解析文件和给 Qoder Work 配置接口

日常使用时，大家只需要上传原始文件，并把文件放进对应文件夹。上传后文件会显示为“未解析”。

当你想让 Agent 读取最新资料时，进入“后台管理”，点击：

```text
解析未解析文件
```

系统会批量处理所有未解析文件，并把解析后的 Markdown/Text 内容写入 `processed` 目录。Agent 读取的是这些解析产物。

Agent 读取入口：

```text
http://台式机局域网IP/openapi.json
```

常用接口：

```text
http://台式机局域网IP/api/v1/manifest
http://台式机局域网IP/api/v1/documents
```

如果接口要求 token，在 Qoder Work 里配置请求头：

```http
Authorization: Bearer 你的KB_AGENT_READ_TOKEN
```

这个 token 来自 `.env` 里的 `KB_AGENT_READ_TOKEN`。

## 十五、常用管理命令

所有命令都在项目目录执行：

```powershell
cd D:\lan-knowledge-base
```

查看服务状态：

```powershell
docker compose ps
```

查看日志：

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

## 十六、开机自启动

建议设置两层：

### 1. Docker Desktop 开机启动

1. 打开 Docker Desktop。
2. 进入 Settings。
3. 找到 General。
4. 勾选 `Start Docker Desktop when you sign in`。
5. Apply & Restart。

### 2. 知识库服务自动恢复

`docker-compose.yml` 里的服务要配置：

```yaml
restart: unless-stopped
```

这样 Docker Desktop 启动后，知识库容器会自动恢复。

## 十七、备份

至少每天备份这些东西：

```text
D:\kb-data\kb.sqlite3
D:\kb-data\uploads\
D:\kb-data\processed\
```

建议备份到：

```text
E:\kb-backup\
```

或者 NAS / 共享盘。

### 手动备份命令

用 PowerShell 执行：

```powershell
$date = Get-Date -Format "yyyyMMdd-HHmmss"
mkdir "D:\kb-data\backups\$date"
copy "D:\kb-data\kb.sqlite3" "D:\kb-data\backups\$date\kb.sqlite3"
robocopy "D:\kb-data\uploads" "D:\kb-data\backups\$date\uploads" /E
robocopy "D:\kb-data\processed" "D:\kb-data\backups\$date\processed" /E
```

后续可以把这些命令做成 `scripts\backup.ps1`，再用 Windows 任务计划程序每天自动执行。

## 十八、更新网站

以后我更新好代码后，你在 Windows 上按这个流程更新：

1. 先备份 `D:\kb-data`。
2. 停止网站：

```powershell
cd D:\lan-knowledge-base
docker compose down
```

3. 替换项目代码。注意不要删除 `D:\kb-data`。
4. 重新启动：

```powershell
docker compose up -d --build
```

5. 测试：

```text
http://localhost
http://localhost/api/v1/health
```

## 十九、常见问题

### 1. `docker` 命令找不到

原因：Docker Desktop 没装好，或者安装后没有重启 PowerShell。

处理：

1. 确认 Docker Desktop 已打开。
2. 关闭 PowerShell 重新打开。
3. 再执行 `docker version`。

### 2. Docker Desktop 一直启动失败

常见原因：

- 虚拟化没开。
- WSL2 没装好。
- Windows 版本太旧。

处理：

1. 检查任务管理器里的虚拟化。
2. 按 Docker Desktop 提示修复 WSL2。
3. 重启电脑。

### 3. 本机能打开，同事电脑打不开

常见原因：

- 同事不在同一个局域网。
- IP 地址写错。
- Windows 防火墙挡住 80 端口。
- 路由器禁止设备互访。

处理顺序：

1. 在台式机打开 `http://localhost`。
2. 在台式机打开 `http://台式机IP`。
3. 在同事电脑 ping 台式机 IP：

```powershell
ping 192.168.1.10
```

4. 放行 Windows 防火墙 80 端口。
5. 检查路由器是否开启了 AP 隔离或访客网络隔离。

### 4. 80 端口被占用

可以先改用 8080 端口。

在 `docker-compose.yml` 里把：

```yaml
ports:
  - "80:80"
```

改成：

```yaml
ports:
  - "8080:80"
```

启动后访问：

```text
http://台式机IP:8080
```

### 5. 上传文件失败

可能原因：

- 文件超过 `KB_MAX_UPLOAD_MB`。
- 文件格式不允许。
- `D:\kb-data` 没有写入权限。
- 磁盘空间不够。

处理：

1. 检查 `.env` 里的 `KB_MAX_UPLOAD_MB`。
2. 检查文件后缀。
3. 检查 D 盘剩余空间。
4. 查看后端日志：

```powershell
docker compose logs -f api
```

## 二十、最终验收清单

部署完成后，逐项打勾：

- [ ] Windows 台式机可以打开 `http://localhost`。
- [ ] Windows 台式机可以打开 `http://台式机IP`。
- [ ] 同事电脑可以打开 `http://台式机IP`。
- [ ] 可以上传 PDF、PPT、Excel。
- [ ] 可以按文件作用筛选。
- [ ] 可以按文件格式筛选。
- [ ] 可以下载原文件。
- [ ] 可以打开 `http://台式机IP/openapi.json`。
- [ ] Qoder Work 可以读取 OpenAPI。
- [ ] 已设置固定 IP。
- [ ] 已放行 Windows 防火墙 80 端口。
- [ ] 已确认备份目录和备份方式。
