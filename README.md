# htmlFileAgent

> 浏览器调用本地 Agent 打开文件 — 零依赖、单文件、免安装（双击部署）。

## 简介

htmlFileAgent 是一个轻量级的本地文件打开器，允许网页（运行在浏览器中的 HTML/JS）调用本地程序打开任意类型的文件。适用于企业内网系统、离线文档管理系统等需要从浏览器打开本地文件的场景。

### 核心特性

- 🚀 **零依赖** — 基于 Node.js/Bun 编写，打包为单个 EXE 文件
- 🔒 **安全可控** — 白名单/黑名单机制，默认拒绝可执行文件
- 📁 **不限扩展名** — 支持打开任意类型的文件，按系统默认关联打开
- 🌐 **HTTP + HTTPS** — 本地服务，支持 CORS，浏览器直接调用
- ⚡ **一键部署** — 双击 EXE 自动部署，无需手动配置
- 🗑️ **一键卸载** — `--uninstall` 参数完全清除

## 架构

```
浏览器 (HTML/JS)
    ↓ HTTP/HTTPS (localhost)
htmlFileAgent.exe
    ↓ rundll32 url.dll,FileProtocolHandler
系统默认关联程序 (Word、Excel、PDF阅读器...)
```

## 快速开始

### 1. 构建

```bash
# 需要 Bun (https://bun.sh)
bun build --compile src/htmlFileAgent.js --outfile htmlFileAgent.exe
```

### 2. 部署

双击 `htmlFileAgent.exe`，自动完成：
- 复制到 `C:\htmlFileAgent\`
- 生成配置文件 `config.json`
- 生成自签名 HTTPS 证书
- 创建计划任务（开机自启）
- 启动本地服务

### 3. 验证

浏览器访问 `http://127.0.0.1:19000/ping`，返回 JSON 即部署成功。

### 4. 体验

打开 `demo/htmlFileAgent-demo.html`，体验完整功能。

## API

### `GET /ping`

探测服务状态。

```json
{
  "ok": true,
  "service": "html-file-agent",
  "version": "3.0",
  "ports": { "http": 19000, "https": 19443 },
  "sources": ["default"],
  "mode": "whitelist",
  "allowAllExtensions": true
}
```

### `GET /open?source=default&path=subdir\file.docx`

打开文件。支持两种调用方式：
- **source + 相对路径**（推荐）：按配置的 roots 逐个尝试
- **绝对路径**：`?path=D:\Docs\a.xlsx` 或 `?path=\\Server\Share\b.pdf`

### `GET /exists?source=default&path=subdir\file.docx`

检查文件是否存在，不打开。

### `GET /reveal?source=default&path=subdir\file.docx`

在资源管理器中定位文件。

### `GET /cache/clear`

清理下载缓存。

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
| `mode` | `whitelist`（推荐）或 `blacklist` |
| `sources` | 文件来源配置，支持多个 source |
| `sources.*.type` | `local`（本地文件）或 `http`（远程下载） |
| `sources.*.roots` | 允许的根路径，`*` 表示全盘，支持通配符 |
| `sources.*.tryAll` | 逐个尝试 roots，找到存在的文件就打开 |
| `allowedExtensions` | 允许的扩展名白名单，空数组 = 不限制 |
| `blockExecutables` | 是否拒绝可执行文件（默认 true） |
| `allowedHosts` | HTTP 来源的主机白名单 |

### 环境变量

配置中支持 `${VAR}` 语法引用环境变量：

```json
{
  "sources": {
    "docs": {
      "type": "local",
      "roots": ["${DOCS_ROOT}"]
    }
  }
}
```

## 前端对接

```javascript
// 探测
const ping = await fetch('http://127.0.0.1:19000/ping').then(r => r.json());

// 打开文件
const result = await fetch(
  'http://127.0.0.1:19000/open?source=default&path=' +
  encodeURIComponent('report\\2024\\annual.pdf')
).then(r => r.json());

if (result.ok) {
  console.log('已打开:', result.path);
} else {
  console.error('失败:', result.error);
}
```

## 卸载

```bash
htmlFileAgent.exe --uninstall
```

或手动删除：
1. 删除计划任务 `htmlFileAgent`（taskschd.msc）
2. 删除目录 `C:\htmlFileAgent\`
3. 删除证书 `CN=htmlFileAgent Local`（certlm.msc → 受信任的根证书颁发机构）

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
A: 确认服务已启动（`http://127.0.0.1:19000/ping` 能访问），且浏览器已完全关闭并重新打开。

**Q: HTTPS 证书警告？**
A: 自签名证书会触发浏览器警告，属正常现象。生产环境建议使用正式证书。

**Q: 如何限制可打开的目录？**
A: 修改 `config.json` 中 `sources.default.roots`，如 `["D:\\Docs", "\\\\fileserver\\share"]`。

**Q: 如何限制可打开的文件类型？**
A: 修改 `config.json` 中 `allowedExtensions`，如 `[".pdf", ".docx", ".xlsx"]`。

## License

[MIT](LICENSE) © 2026 [FatFatYoung](https://github.com/FatFatYoung)

## Author

**FatFatYoung** — [github.com/FatFatYoung](https://github.com/FatFatYoung)

Related projects: [PortPier](https://github.com/FatFatYoung/PortPier) - TCP 端口映射工具
