# htmlFileAgent

> Open local files from the browser — zero dependencies, single file, no installation (double-click to deploy).

## Introduction

htmlFileAgent is a lightweight local file opener that allows web pages (HTML/JS running in a browser) to call local programs to open files of any type. It is designed for enterprise intranet systems, offline document management systems, and other scenarios where you need to open local files from the browser.

### Key Features

- 🚀 **Zero Dependencies** — Built with Node.js/Bun, compiled into a single EXE, no runtime environment required
- 🔒 **Secure & Controllable** — Whitelist/blacklist mechanism, executable files blocked by default to prevent malicious invocation
- 📁 **Full Character Support** — Perfectly handles Tibetan, Emoji, special symbols, super-long paths, and other complex filenames (no more `rundll32` garbled text)
- 🛡️ **Crash-Proof Armor** — Global exception catching (`uncaughtException`), even if underlying calls are blocked or error out, the service stays alive
- 🌐 **HTTP + HTTPS** — Local service with built-in CORS support, callable directly from the browser
- ⚡ **One-Click Deploy** — Double-click the EXE to auto-deploy, import certificates, and configure startup
- 🗑️ **One-Click Uninstall** — Run with `--uninstall` to completely remove the service and certificates

## Architecture

```text
Browser (HTML/JS)
    ↓ HTTP/HTTPS (localhost)
htmlFileAgent.exe (Node.js)
    ↓ Primary engine: explorer.exe (native wide characters, perfect for Tibetan/special symbols)
    ↓ Fallback engine: rundll32 url.dll,FileProtocolHandler (compatibility fallback)
System default handler (Word, Excel, PDF reader, Photoshop...)
```

## Quick Start

### 1. Build

Prerequisites: Install [Bun](https://bun.sh) (recommended, zero config) or Node.js ≥ 18.

```bash
# Bun (recommended)
bun build --compile src/htmlFileAgent.js --outfile dist/htmlFileAgent.exe

# Node.js + pkg (alternative)
npm install -g pkg
pkg src/htmlFileAgent.js --targets node18-win-x64 --output dist/htmlFileAgent.exe
```

### 2. Deploy

Send `htmlFileAgent.exe` to the client and double-click to run. It will automatically:
- Copy itself to `C:\htmlFileAgent\`
- Generate a configuration file `config.json`
- Generate a self-signed HTTPS certificate
- Create a scheduled task (auto-start on boot)
- Start the local service

### 3. Verify

Open `http://127.0.0.1:19000/ping` in a browser. A JSON response containing `"ok": true` means deployment succeeded.

### 4. Try It

Open `demo/htmlFileAgent-demo.html` to experience the full probe, absolute path open, and relative path open features.

## API

### `GET /ping`

Probe service status.

```json
{
  "ok": true,
  "service": "html-file-agent",
  "version": "1.3.0.0",
  "ports": { "http": 19000, "https": 19443 },
  "sources": ["default"],
  "mode": "whitelist",
  "allowAllExtensions": true
}
```

### `GET /open?source=default&path=subdir\file.docx`

Open a file. Two calling methods are supported:
- **source + relative path** (recommended): tries each configured root in order
- **Absolute path**: `?path=D:\Docs\a.xlsx` or `?path=\\Server\Share\b.pdf` (requires `roots: ["*"]` or path in whitelist)

Successful response example (includes the engine actually used):
```json
{
  "ok": true,
  "path": "\\\\Server\\Share\\subdir\\file.xlsx",
  "local": "\\\\Server\\Share\\subdir\\file.xlsx",
  "method": "explorer"
}
```

### `GET /exists?source=default&path=subdir\file.docx`

Check whether a file exists without triggering the open action.

### `GET /reveal?source=default&path=subdir\file.docx`

Open the containing directory in Windows Explorer and select the file.

### `GET /open-folder?source=default&path=subdir\file.docx`

Open the containing directory in Windows Explorer (without selecting the file).

### `GET /cache/clear`

Clear downloaded cache files from HTTP-type sources.

## Configuration

Edit `C:\htmlFileAgent\config.json`:

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

### Configuration Reference

| Field | Description |
|-------|-------------|
| `ports` | HTTP/HTTPS listening ports |
| `mode` | Security mode: `whitelist` (recommended) or `blacklist` |
| `sources` | File source configuration, supports multiple sources |
| `sources.*.type` | `local` (local/LAN files) or `http` (WebDAV/remote download) |
| `sources.*.roots` | Allowed root paths, `*` means all drives, wildcards supported |
| `sources.*.tryAll` | When true, tries each root in order and opens the first existing file |
| `allowedExtensions` | Whitelist of allowed extensions, empty array = no restriction |
| `blockExecutables` | Whether to reject executable files (default true, prevents remote code execution) |
| `allowedHosts` | Host whitelist for HTTP sources, prevents SSRF attacks |

### Environment Variables

The config supports `${VAR}` syntax to dynamically reference environment variables, making it easy to share one config across multiple devices:

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

## Frontend Integration

```javascript
// Probe local service
const ping = await fetch('http://127.0.0.1:19000/ping').then(r => r.json());
if (!ping.ok) {
  alert('Local service not started. Please double-click htmlFileAgent.exe first.');
}

// Open a file (recommended: specify source and relative path)
const result = await fetch(
  'http://127.0.0.1:19000/open?source=default&path=' +
  encodeURIComponent('docs\\report.pdf')
).then(r => r.json());

if (result.ok) {
  console.log('File sent to system handler:', result.path);
} else {
  console.error('Failed to open:', result.error);
}
```

## Uninstall

Run in a command prompt with administrator privileges:
```bash
htmlFileAgent.exe --uninstall
```

Or remove manually:
1. Delete the scheduled task `htmlFileAgent` (taskschd.msc)
2. Kill the process and delete the directory `C:\htmlFileAgent\`
3. Remove the trusted root certificate `CN=htmlFileAgent Local` (certlm.msc → Trusted Root Certification Authorities)

## Project Structure

```
htmlFileAgent/
├── src/
│   └── htmlFileAgent.js        # Backend source code (Node.js/Bun)
├── demo/
│   └── htmlFileAgent-demo.html # Frontend demo page
├── README.md
├── LICENSE
└── .gitignore
```

## FAQ

**Q: Browser shows "htmlFileAgent not detected"?**
- A: Confirm the service is running (`http://127.0.0.1:19000/ping` is accessible), and fully close and reopen the browser.

**Q: HTTPS certificate warning?**
- A: Self-signed certificates trigger browser warnings — this is normal. For production, use a proper certificate.

**Q: How do I restrict which directories can be opened?**
- A: Modify `sources.default.roots` in `config.json`, e.g. `["D:\\Docs", "\\\\fileserver\\share"]`.

**Q: How do I restrict which file types can be opened?**
- A: Modify `allowedExtensions` in `config.json`, e.g. `[".pdf", ".docx", ".xlsx"]`.

**Q: Clicking a file does nothing, browser reports TypeError: Failed to fetch?**
- A: This means the local service process has crashed. v1.2.0+ includes global `uncaughtException` handling and should not crash under normal conditions. Check if antivirus software blocked `htmlFileAgent.exe` (add it to the whitelist).

**Q: HTTPS page blocked from calling HTTP endpoints?**
- A: 127.0.0.1 is a local secure context and browsers allow it by default. If blocked, a system proxy (e.g. Clash/V2Ray) is likely configured — add 127.0.0.1 to the proxy bypass list.

## Changelog

**v1.4.0 (Latest)**
- Fixed: Wildcard root matching — `roots: ["path\\*"]` now also matches the root directory itself, not only its subdirectories.
- Improved: `SERVICE_VER` unified with exe file version for consistent version identification.

**v1.3.2**
- Improved: `/reveal` command parameter handling (merged `/select,` and path into a single argument for UNC/Chinese path compatibility).
  
**v1.3.0**
- New: `/open-folder` endpoint (open containing folder without selecting the file).
- Improved: `/reveal` command parameter handling (merged `/select,` and path into a single argument for UNC/Chinese path compatibility).

**v1.2.0**
- New: Primary engine switched to `explorer.exe`, perfectly supporting Cyrillic, Tibetan, special symbols, and super-long paths.
- New: Global crash-proof mechanism (`uncaughtException` catch) to eliminate `TypeError: Failed to fetch` caused by underlying call failures.
- Improved: Async response concurrency lock to prevent duplicate-response crashes in Node.
- Improved: Added `rundll32` fallback for high availability in extreme environments.

**v1.1.0**
- New: Multi-source configuration with `roots` mechanism, supporting automatic addressing across multiple servers.
- New: Dynamic hot-reloading of `config.json` — no restart needed to change configuration.
- New: Independent `/exists` and `/reveal` endpoints.
- Improved: Removed default extension restrictions; executables blacklisted by default for better security.

**v1.0.0**
- Initial release: LAN file opener based on `rundll32`.

## License

[MIT](LICENSE) © 2026 [FatFatYoung](https://github.com/FatFatYoung)

## Author

**FatFatYoung** — [github.com/FatFatYoung](https://github.com/FatFatYoung)
