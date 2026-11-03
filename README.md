# htmlFileAgent

> 浏览器调用本地 Agent 打开文件 — 零依赖、单文件、免安装（双击部署）。

## 简介

htmlFileAgent 是一个轻量级的本地文件打开器，允许网页（运行在浏览器中的 HTML/JS）调用本地程序打开任意类型的文件。适用于企业内网系统、离线文档管理系统等需要从浏览器打开本地文件的场景。

### 核心特性

- 🚀 **零依赖** — 基于 Node.js/Bun 编写，打包为单个 EXE 文件，无需安装运行环境
- 🔒 **安全可控** — 白名单/黑名单机制，默认拒绝可执行文件，防止恶意调用
- 📁 **全字符兼容** — 完美支持藏文、Emoji、特殊符号、超长路径等复杂文件名（不再是 `rundll32` 的乱码受害者）
- 🛡️ **防崩溃装甲** — 全局异常捕获（`uncaughtException`），即使底层调用被拦截或报错，服务也不会宕机
- 🌐 **HTTP + HTTPS** — 本地服务，自带跨域（CORS）支持，浏览器直接调用
- ⚡ **一键部署** — 双击 EXE 自动完成部署、证书导入、开机自启配置
- 🗑️ **一键卸载** — 运行 `--uninstall` 参数完全清除服务与证书

## 架构

```text
浏览器 (HTML/JS)
    ↓ HTTP/HTTPS (localhost)
htmlFileAgent.exe (Node.js)
    ↓ 主引擎: explorer.exe (系统原生宽字符，完美兼容藏文/特殊符号)
    ↓ 备引擎: rundll32 url.dll,FileProtocolHandler (兼容降级)
系统默认关联程序 (Word、Excel、PDF阅读器、PS...)
```

## 快速开始

### 1. 构建

前置条件：安装 [Bun](https://bun.sh)（推荐，零配置）或 Node.js ≥ 18。

```bash
# Bun（推荐）
bun build --compile src/htmlFileAgent.js --outfile dist/htmlFileAgent.exe

# Node.js + pkg（替代方案）
npm install -g pkg
pkg src/htmlFileAgent.js --targets node18-win-x64 --output dist/htmlFileAgent.exe
```

### 2. 部署

将`htmlFileAgent.exe`发给客户端，双击运行，自动完成：
- 复制到 `C:\htmlFileAgent\`
- 生成配置文件 `config.json`
- 生成自签名 HTTPS 证书
- 创建计划任务（开机自启）
- 启动本地服务

### 3. 验证

浏览器访问 `http://127.0.0.1:19000/ping`，返回包含 "ok": true 的 JSON 即部署成功。

### 4. 体验

打开 `demo/htmlFileAgent-demo.html`，体验完整的探测、绝对路径打开、相对路径打开功能。

## API

### `GET /ping`

探测服务状态。

```json
{
  "ok": true,
  "service": "html-file-agent",
  "version": "1.2.0",
  "ports": { "http": 19000, "https": 19443 },
  "sources": ["default"],
  "mode": "whitelist",
  "allowAllExtensions": true
}
```

### `GET /open?source=default&path=subdir\file.docx`

打开文件。支持两种调用方式：
- **source + 相对路径**（推荐）：按配置的 roots 逐个尝试
- **绝对路径**：`?path=D:\Docs\a.xlsx` 或 `?path=\\Server\Share\b.pdf`（需 roots: ["*"] 或在白名单内）。
- **返回成功示例（包含实际使用的打开引擎）：
```json
{
  "ok": true,
  "path": "\\\\Server\\Share\\subdir\\file.xlsx",
  "local": "\\\\Server\\Share\\subdir\\file.xlsx",
  "method": "explorer"
}
```

### `GET /exists?source=default&path=subdir\file.docx`

检查文件是否存在，不触发打开动作。

### `GET /reveal?source=default&path=subdir\file.docx`

在 Windows 资源管理器中打开文件所在目录，并选中该文件。

### `GET /cache/clear`

清理 HTTP 类型 Source 下载的缓存文件。

## 配置

编辑 `C:\htmlFileAgent\config.json`：

```json
{
  "ports": { "http": 19000, "https": 19443 },
  "mode": "whitelist",
  "sources": {
    "default": {
      "type": "local",
      "tryAll": true,
      "roots": ["*"]
    }
  },
  "allowedExtensions": [],
  "blockExecutables": true,
  "blockedExtensions": [
    ".exe", ".bat", ".cmd", ".com", ".scr", ".ps1",
    ".vbs", ".js", ".msi", ".dll", ".reg", ".lnk"
  ],
  "cacheDir": "C:\\htmlFileAgent\\cache",
  "cacheMaxAgeHours": 24,
  "downloadTimeoutMs": 120000,
  "allowedHosts": []
}
```

### 配置说明

| 字段 | 说明 |
|------|------|
| `ports` | HTTP/HTTPS 监听端口 |
| `mode` | 安全模式，`whitelist`（推荐）或 `blacklist` |
| `sources` | 文件来源配置，支持多个 source |
| `sources.*.type` | `local`（本地/局域网文件）或 `http`（WebDAV/远程下载） |
| `sources.*.roots` | 允许的根路径，`*` 表示全盘，支持通配符 |
| `sources.*.tryAll` | true 时逐个尝试 roots，找到存在的文件就打开 |
| `allowedExtensions` | 允许的扩展名白名单，空数组 = 不限制 |
| `blockExecutables` | 是否拒绝可执行文件（默认 true，防止远程执行代码） |
| `allowedHosts` | HTTP 来源的主机白名单，防止 SSRF 攻击 |

### 环境变量

配置中支持 `${VAR}` 语法引用环境变量动态引用系统环境变量，方便多台不同设备共用一份配置：

```json
{
  "sources": {
    "docs": {
      "type": "local",
      "roots": ["${USERPROFILE}\\Documents"]
    }
  }
}
```

## 前端对接

```javascript
// 探测本地服务
const ping = await fetch('http://127.0.0.1:19000/ping').then(r => r.json());
if (!ping.ok) {
  alert('本地服务未启动，请先双击运行 htmlFileAgent.exe');
}

// 打开文件（推荐方式：指定 source 和相对路径）
const result = await fetch(
  'http://127.0.0.1:19000/open?source=default&path=' +
  encodeURIComponent('客户底档\\藏文（བོད་ལྗོངས་མཐོ་སྒང་）.psd')
).then(r => r.json());

if (result.ok) {
  console.log('文件已成功发送至系统打开:', result.path);
} else {
  console.error('打开失败:', result.error);
}
```

## 卸载

在具有管理员权限的命令行中运行：
```bash
htmlFileAgent.exe --uninstall
```

或手动删除：
1. 删除计划任务 `htmlFileAgent`（taskschd.msc）
2. 终止进程并删除目录 `C:\htmlFileAgent\`
3. 删除受信任的根证书 `CN=htmlFileAgent Local`（certlm.msc → 受信任的根证书颁发机构）

## 项目结构

```
htmlFileAgent/
├── src/
│   └── htmlFileAgent.js        # 后端源码（Node.js/Bun）
├── demo/
│   └── htmlFileAgent-demo.html # 前端演示页面
├── README.md
├── LICENSE
└── .gitignore
```

## 常见问题

**Q: 浏览器提示"未检测到本地 htmlFileAgent"？**
- A: 确认服务已启动（`http://127.0.0.1:19000/ping` 能访问），且浏览器已完全关闭并重新打开。

**Q: HTTPS 证书警告？**
- A: 自签名证书会触发浏览器警告，属正常现象。生产环境建议使用正式证书。

**Q: 如何限制可打开的目录？**
- A: 修改 `config.json` 中 `sources.default.roots`，如 `["D:\\Docs", "\\\\fileserver\\share"]`。

**Q: 如何限制可打开的文件类型？**
- A: 修改 `config.json` 中 `allowedExtensions`，如 `[".pdf", ".docx", ".xlsx"]`。

**Q: 点击文件没反应，浏览器报 TypeError: Failed to fetch？**
- A: 这说明本地服务进程挂掉了。新版 v1.2.0 已加入全局 uncaughtException 捕获机制，正常不会崩溃。请确认是否被企业杀毒软件当作木马拦截了 htmlFileAgent.exe（请加白名单）。

**Q: HTTPS 页面调用 HTTP 接口被拦截？**
- A: 127.0.0.1 属于本地安全上下文，浏览器默认放行。如果遇到拦截，说明客户端配置了代理（如 Clash/V2Ray），请将 127.0.0.1 加入系统代理的 Bypass 列表中。

## 版本更新
**v1.2.0 (Latest)**
- 新增：主引擎切换为 explorer.exe，完美兼容西里尔文、藏文、特殊符号与超长路径。

- 新增：全局防崩溃机制（uncaughtException 捕获），彻底解决因底层的调用异常导致的 TypeError: Failed to fetch 问题。

- 优化：加入异步响应并发锁，防止因重复返回响应导致 Node 进程崩溃。

- 优化：增加 rundll32 降级方案，确保在极端环境下的高可用性。

**v1.1.0**
- 新增：引入多 sources 配置与 roots 机制，支持多服务器自动寻址。

- 新增：动态热加载 config.json，无需重启即可修改配置。

- 新增：提供独立的 /exists 和 /reveal 接口。

- 优化：默认去除扩展名限制，且将可执行文件加入黑名单，提升安全性。

**v1.0.0**
- 初始发布：基于 rundll32 的局域网文件本地打开器。

## License

[MIT](LICENSE) © 2026 [FatFatYoung](https://github.com/FatFatYoung)

## Author

**FatFatYoung** — [github.com/FatFatYoung](https://github.com/FatFatYoung)
