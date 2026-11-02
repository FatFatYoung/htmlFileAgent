// htmlFileAgent.js — 通用本地文件打开器
// 双击无参数 => 部署；--serve => 服务；--uninstall => 卸载
// 支持任意扩展名（默认不限制），按系统默认关联打开

const fs     = require('fs');
const path   = require('path');
const net    = require('net');
const http   = require('http');
const https  = require('https');
const urlLib = require('url');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { pipeline } = require('stream');
const { promisify } = require('util');

const pipeAsync = promisify(pipeline);

const HOST        = '127.0.0.1';
const INSTALL_DIR = 'C:\\htmlFileAgent';
const EXE_PATH    = path.join(INSTALL_DIR, 'htmlFileAgent.exe');
const CONFIG_PATH = path.join(INSTALL_DIR, 'config.json');
const PFX_PATH    = path.join(INSTALL_DIR, 'agent.pfx');
const CER_PATH    = path.join(INSTALL_DIR, 'agent.cer');
const VBS_PATH    = path.join(INSTALL_DIR, 'start.vbs');
const TASK_NAME   = 'htmlFileAgent';
const PFX_PASS    = 'htmlfileagent';
const SERVICE_VER = '3.0';

// ============ 默认配置 ============
const DEFAULT_CONFIG = {
  ports: { http: 19000, https: 19443 },
  mode: 'whitelist',
  sources: {
    default: { type: 'local', tryAll: true, roots: ['*'] }
  },
  allowedExtensions: [],
  blockExecutables: true,
  blockedExtensions: [
    '.exe', '.bat', '.cmd', '.com', '.scr', '.ps1', '.vbs', '.vbe',
    '.js', '.jse', '.wsf', '.wsh', '.msi', '.cpl', '.hta', '.pif',
    '.reg', '.inf', '.lnk', '.url', '.dll'
  ],
  cacheDir: 'C:\\htmlFileAgent\\cache',
  cacheMaxAgeHours: 24,
  downloadTimeoutMs: 120000,
  allowedHosts: []
};

// ============ 入口 ============
const argv = process.argv.slice(2);
if (argv.includes('--serve'))          runServer();
else if (argv.includes('--uninstall')) doUninstall();
else                                   doAuto().catch(e => {
  showMsg('部署失败', String(e && e.message || e), 'Error');
  process.exit(1);
});

// ============ 配置热加载 ============
let _cfgCache = null, _cfgMtime = 0;
function loadConfig() {
  try {
    const st = fs.statSync(CONFIG_PATH);
    if (_cfgCache && st.mtimeMs === _cfgMtime) return _cfgCache;
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    _cfgCache = normalizeConfig(cfg);
    _cfgMtime = st.mtimeMs;
    return _cfgCache;
  } catch (e) {
    if (!_cfgCache) _cfgCache = normalizeConfig(DEFAULT_CONFIG);
    return _cfgCache;
  }
}

function normalizeConfig(cfg) {
  const c = JSON.parse(JSON.stringify(cfg));
  c.ports = c.ports || DEFAULT_CONFIG.ports;
  c.sources = c.sources || DEFAULT_CONFIG.sources;
  c.mode = c.mode || 'whitelist';
  c.allowedExtensions = Array.isArray(c.allowedExtensions) ? c.allowedExtensions : [];
  c.blockExecutables = c.blockExecutables !== false;
  c.blockedExtensions = Array.isArray(c.blockedExtensions)
    ? c.blockedExtensions : DEFAULT_CONFIG.blockedExtensions;
  c.cacheDir = c.cacheDir || DEFAULT_CONFIG.cacheDir;
  c.cacheMaxAgeHours = c.cacheMaxAgeHours != null ? c.cacheMaxAgeHours : 24;
  c.downloadTimeoutMs = c.downloadTimeoutMs || 120000;
  c.allowedHosts = c.allowedHosts || [];

  const expand = (s) => typeof s === 'string'
    ? s.replace(/\$\{([^}]+)\}/g, (_, k) => process.env[k] || '')
    : s;

  Object.keys(c.sources).forEach(k => {
    const src = c.sources[k];
    if (src.type === 'local' && !src.roots && src.root) {
      src.roots = [src.root]; delete src.root;
    }
    if (src.type === 'local' && (!src.roots || !src.roots.length)) {
      src.roots = ['*'];
    }
    if (src.roots) src.roots = src.roots.map(expand);
    if (src.base) src.base = expand(src.base);
    if (src.tryAll == null) src.tryAll = true;
  });
  c.cacheDir = expand(c.cacheDir);
  return c;
}

// ============ 部署 ============
async function doAuto() {
  const cfg = loadConfig();
  if (fs.existsSync(EXE_PATH) && taskExists(TASK_NAME) && await portOpen(cfg.ports.http)) {
    showMsg('htmlFileAgent 已在运行',
      'http://127.0.0.1:' + cfg.ports.http + '/ping',
      'Information');
    return;
  }
  if (!isAdmin()) { elevateSelf([]); return; }
  await install();
  showMsg('htmlFileAgent 部署成功',
    '· HTTP： http://127.0.0.1:' + cfg.ports.http + '/ping\n' +
    '· HTTPS：https://127.0.0.1:' + cfg.ports.https + '/ping\n' +
    '· 配置：' + CONFIG_PATH + '\n\n' +
    '默认允许所有扩展名（除可执行文件），如需限制请编辑 config.json 的 allowedExtensions。\n\n' +
    '请完全关闭浏览器后再打开。\n' +
    '卸载：htmlFileAgent.exe --uninstall',
    'Information');
}

async function install() {
  if (!fs.existsSync(INSTALL_DIR)) fs.mkdirSync(INSTALL_DIR, { recursive: true });
  if (process.execPath.toLowerCase() !== EXE_PATH.toLowerCase()) {
    fs.copyFileSync(process.execPath, EXE_PATH);
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  }
  if (!fs.existsSync(VBS_PATH)) {
    fs.writeFileSync(VBS_PATH,
      'CreateObject("WScript.Shell").Run """' + EXE_PATH + '"" --serve", 0, False\r\n',
      'ascii');
  }
  if (!fs.existsSync(PFX_PATH)) makeCert();

  spawnSync('schtasks', ['/create', '/tn', TASK_NAME,
    '/tr', 'wscript.exe "' + VBS_PATH + '"',
    '/sc', 'onlogon', '/rl', 'highest', '/f'],
    { stdio: 'ignore', windowsHide: true });

  spawn('wscript.exe', [VBS_PATH],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref();

  const cfg = loadConfig();
  for (let i = 0; i < 50; i++) {
    if (await portOpen(cfg.ports.http)) return;
    await sleep(300);
  }
  throw new Error('服务启动超时');
}

// ============ 卸载 ============
function doUninstall() {
  if (!isAdmin()) { elevateSelf(['--uninstall']); return; }
  spawnSync('schtasks', ['/end', '/tn', TASK_NAME], { stdio: 'ignore', windowsHide: true });
  spawnSync('schtasks', ['/delete', '/tn', TASK_NAME, '/f'], { stdio: 'ignore', windowsHide: true });
  const cfg = loadConfig();
  try {
    runPS("Get-NetTCPConnection -LocalPort " + cfg.ports.http + "," + cfg.ports.https +
      " -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | " +
      "ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }");
  } catch (e) {}
  try {
    runPS("Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object {$_.Subject -like '*htmlFileAgent*'} | " +
      "Remove-Item -Force -ErrorAction SilentlyContinue");
  } catch (e) {}
  [VBS_PATH, PFX_PATH, CER_PATH].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
  });
  showMsg('卸载完成', 'htmlFileAgent.exe 本体仍在 ' + INSTALL_DIR, 'Information');
}

// ============ 服务 ============
function runServer() {
  const cfg = loadConfig();
  http.createServer(handleRequest)
    .on('error', e => log('HTTP ' + cfg.ports.http + ' error: ' + (e.code || e.message)))
    .listen(cfg.ports.http, HOST, () => log('HTTP  http://' + HOST + ':' + cfg.ports.http));

  if (fs.existsSync(PFX_PATH)) {
    try {
      const pfx = fs.readFileSync(PFX_PATH);
      https.createServer({ pfx, passphrase: PFX_PASS }, handleRequest)
        .on('error', e => log('HTTPS ' + cfg.ports.https + ' error: ' + (e.code || e.message)))
        .listen(cfg.ports.https, HOST, () => log('HTTPS https://' + HOST + ':' + cfg.ports.https));
    } catch (e) {
      log('HTTPS disabled: ' + e.message);
    }
  }
  setTimeout(() => cleanupCache(false).catch(() => {}), 5000);
}

function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Access-Control-Request-Private-Network');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  let parsed;
  try { parsed = urlLib.parse(req.url, true); }
  catch (e) { return sendJson(res, 400, { ok: false, error: 'bad url' }); }

  const p = parsed.pathname, q = parsed.query || {};
  const cfg = loadConfig();

  if (p === '/ping') {
    return sendJson(res, 200, {
      ok: true, service: 'html-file-agent', version: SERVICE_VER, pid: process.pid,
      ports: cfg.ports,
      sources: Object.keys(cfg.sources),
      mode: cfg.mode,
      allowAllExtensions: cfg.allowedExtensions.length === 0,
      allowedExtensions: cfg.allowedExtensions
    });
  }

  if (p === '/open' || p === '/exists' || p === '/reveal') {
    return handleFileOp(p, q, res, cfg).catch(err => {
      sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
    });
  }

  if (p === '/cache/clear') {
    cleanupCache(true).then(() => sendJson(res, 200, { ok: true }))
      .catch(e => sendJson(res, 500, { ok: false, error: String(e) }));
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
}

// ============ 文件操作 ============
async function handleFileOp(op, q, res, cfg) {
  let target;
  try { target = await resolveTarget(q, cfg); }
  catch (e) { return sendJson(res, 403, { ok: false, error: e.message }); }
  if (!target) return sendJson(res, 403, { ok: false, error: 'path not allowed' });

  const extCheck = checkExtension(target.displayPath || target.localPath || '', cfg);
  if (!extCheck.ok) {
    return sendJson(res, 403, { ok: false, error: extCheck.reason });
  }

  let localPath;
  try { localPath = await obtainLocal(target, cfg); }
  catch (e) { return sendJson(res, 404, { ok: false, error: e.message }); }

  if (op === '/exists') return sendJson(res, 200, { ok: true, exists: true, path: target.displayPath });

  if (op === '/open') {
    try {
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', localPath],
        { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
      return sendJson(res, 200, { ok: true, path: target.displayPath, local: localPath });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: 'open failed: ' + e.message });
    }
  }

  if (op === '/reveal') {
    try {
      spawn('explorer.exe', ['/select,', localPath],
        { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: 'reveal failed: ' + e.message });
    }
  }
}

function checkExtension(filePath, cfg) {
  const ext = path.win32.extname(filePath).toLowerCase();

  if (cfg.blockExecutables && ext && cfg.blockedExtensions.indexOf(ext) >= 0) {
    return { ok: false, reason: 'executable blocked: ' + ext };
  }

  if (cfg.allowedExtensions.length > 0) {
    if (!ext) return { ok: false, reason: 'file has no extension' };
    if (cfg.allowedExtensions.indexOf(ext) < 0) {
      return { ok: false, reason: 'extension not in whitelist: ' + ext };
    }
  }

  return { ok: true };
}

// ============ Resolver ============
function wildcardToRegex(pattern) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + esc.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

function matchAnyRoot(absPath, roots) {
  const norm = path.win32.normalize(absPath);
  for (const r of roots) {
    if (!r) continue;
    if (r.indexOf('*') < 0 && r.indexOf('?') < 0) {
      const rl = r.toLowerCase(), nl = norm.toLowerCase();
      const prefix = rl.endsWith('\\') ? rl : rl + '\\';
      if (nl === rl || nl.startsWith(prefix)) return true;
      continue;
    }
    if (r === '*') return true;
    const pat = r.endsWith('*') ? r : r + '*';
    if (wildcardToRegex(pat).test(norm)) return true;
  }
  return false;
}

async function resolveTarget(q, cfg) {
  if (q.source) {
    const src = cfg.sources[q.source];
    if (!src) throw new Error('unknown source: ' + q.source);
    const rel = String(q.path || '').replace(/^[\\\/]+/, '');
    if (!rel) throw new Error('path required');
    if (/[\x00-\x1f]/.test(rel)) throw new Error('invalid characters');

    if (src.type === 'local') {
      const candidates = [];
      for (const root of src.roots) {
        if (root === '*' || root === '**') {
          let abs;
          try { abs = path.win32.normalize(rel); } catch (e) { continue; }
          if (!abs.startsWith('\\\\') && !/^[A-Za-z]:\\/.test(abs)) continue;
          candidates.push(abs);
        } else {
          const base = root.replace(/[*?]/g, '');
          const abs = path.win32.join(base, rel);
          if (!matchAnyRoot(abs, [root])) continue;
          candidates.push(abs);
        }
      }
      if (!candidates.length) throw new Error('path escapes all roots');
      const chosen = src.tryAll === false
        ? candidates[0]
        : candidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || candidates[0];
      return { type: 'local', displayPath: chosen, localPath: chosen, source: q.source };
    }
    if (src.type === 'http') {
      const base = src.base.endsWith('/') ? src.base : src.base + '/';
      const safeRel = rel.split(/[\\\/]/).map(encodeURIComponent).join('/');
      const url = base + safeRel;
      checkHost(url, cfg);
      return { type: 'http', displayPath: url, url, source: q.source, auth: src.auth };
    }
    throw new Error('unsupported source type');
  }

  const abs = String(q.path || '');
  if (!abs) throw new Error('path required');
  if (/[\x00-\x1f]/.test(abs)) throw new Error('invalid characters');
  let norm;
  try { norm = path.win32.normalize(abs); } catch (e) { throw new Error('invalid path'); }
  if (!norm.startsWith('\\\\') && !/^[A-Za-z]:\\/.test(norm)) {
    throw new Error('must be absolute path');
  }

  for (const name of Object.keys(cfg.sources)) {
    const src = cfg.sources[name];
    if (src.type !== 'local') continue;
    if (matchAnyRoot(norm, src.roots)) {
      return { type: 'local', displayPath: norm, localPath: norm, source: name };
    }
  }
  throw new Error('path not in any configured source');
}

function checkHost(urlStr, cfg) {
  if (!cfg.allowedHosts || !cfg.allowedHosts.length) return;
  const u = new URL(urlStr);
  if (cfg.allowedHosts.indexOf(u.hostname.toLowerCase()) < 0) {
    throw new Error('host not allowed: ' + u.hostname);
  }
}

// ============ Fetcher ============
async function obtainLocal(target, cfg) {
  if (target.type === 'local') {
    if (!fs.existsSync(target.localPath)) {
      throw new Error('file not found or no access: ' + target.displayPath);
    }
    return target.localPath;
  }
  if (target.type === 'http') return await downloadToCache(target, cfg);
  throw new Error('unsupported target type');
}

async function downloadToCache(target, cfg) {
  const cacheDir = cfg.cacheDir;
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const urlPath = new URL(target.url).pathname;
  const ext = path.win32.extname(urlPath) || '.dat';
  const hash = crypto.createHash('sha1')
    .update(target.url + (target.auth ? target.auth.user : ''))
    .digest('hex').slice(0, 16);
  const fpath = path.join(cacheDir, hash + ext);

  if (fs.existsSync(fpath)) {
    const st = fs.statSync(fpath);
    if ((Date.now() - st.mtimeMs) / 3600000 < cfg.cacheMaxAgeHours) {
      try { fs.utimesSync(fpath, new Date(), new Date()); } catch (e) {}
      return fpath;
    }
  }

  const tmp = fpath + '.part.' + process.pid;
  try {
    await httpDownload(target.url, tmp, {
      timeoutMs: cfg.downloadTimeoutMs,
      auth: target.auth
    });
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
    fs.renameSync(tmp, fpath);
    return fpath;
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    throw new Error('download failed: ' + e.message);
  }
}

function httpDownload(urlStr, destPath, opts) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = {};
    if (opts.auth && opts.auth.user) {
      headers['Authorization'] = 'Basic ' +
        Buffer.from(opts.auth.user + ':' + (opts.auth.pass || '')).toString('base64');
    }
    const req = lib.get(u, { headers, timeout: opts.timeoutMs }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, u).toString();
        res.resume();
        return httpDownload(next, destPath, opts).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      pipeAsync(res, fs.createWriteStream(destPath)).then(resolve, reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function cleanupCache(force) {
  const cfg = loadConfig();
  if (!fs.existsSync(cfg.cacheDir)) return;
  const maxMs = (cfg.cacheMaxAgeHours || 24) * 3600000;
  const now = Date.now();
  try {
    for (const f of fs.readdirSync(cfg.cacheDir)) {
      const full = path.join(cfg.cacheDir, f);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && (force || now - st.mtimeMs > maxMs)) fs.unlinkSync(full);
      } catch (e) {}
    }
  } catch (e) {}
}

// ============ 工具 ============
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
function isAdmin() {
  return spawnSync('net', ['session'], { stdio: 'ignore', windowsHide: true }).status === 0;
}
function elevateSelf(args) {
  const exe = process.execPath.replace(/'/g, "''");
  let ps = "Start-Process -FilePath '" + exe + "'";
  if (args && args.length) {
    ps += ' -ArgumentList ' + args.map(a => "'" + a.replace(/'/g, "''") + "'").join(',');
  }
  ps += ' -Verb RunAs';
  try {
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
      { stdio: 'ignore', windowsHide: true });
  } catch (e) {}
  process.exit(0);
}
function makeCert() {
  const ps = `
$ErrorActionPreference = 'Stop'
try {
  $c = New-SelfSignedCertificate -Subject 'CN=htmlFileAgent Local' -DnsName 'localhost','127.0.0.1' ` +
    `-CertStoreLocation Cert:\\LocalMachine\\My -NotAfter (Get-Date).AddYears(10) ` +
    `-KeyExportPolicy Exportable -KeyLength 2048
  $p = ConvertTo-SecureString -String '${PFX_PASS}' -Force -AsPlainText
  Export-PfxCertificate -Cert $c -FilePath '${PFX_PATH}' -Password $p | Out-Null
  $c | Export-Certificate -FilePath '${CER_PATH}' -Type CERT | Out-Null
  Import-Certificate -FilePath '${CER_PATH}' -CertStoreLocation Cert:\\LocalMachine\\Root | Out-Null
  Write-Output 'OK'
} catch { Write-Output ('ERR:' + $_.Exception.Message) }
`;
  const r = runPS(ps);
  if (!/OK/.test(r.stdout || '')) log('cert warning: ' + (r.stdout || r.stderr || ''));
}
function runPS(script) {
  return spawnSync('powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
     Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true });
}
function showMsg(title, msg, icon) {
  const ps = `
Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
  '${msg.replace(/'/g, "''")}',
  '${title.replace(/'/g, "''")}',
  'OK',
  '${icon || 'Information'}'
) | Out-Null
`;
  try { runPS(ps); } catch (e) {}
}
function taskExists(name) {
  return spawnSync('schtasks', ['/query', '/tn', name],
    { stdio: 'ignore', windowsHide: true }).status === 0;
}
function portOpen(port) {
  return new Promise(resolve => {
    const s = net.connect({ host: HOST, port });
    let done = false;
    const fin = ok => { if (!done) { done = true; s.destroy(); resolve(ok); } };
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
    s.setTimeout(800, () => fin(false));
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(s) { try { console.log('[html-file-agent] ' + s); } catch (e) {} }
