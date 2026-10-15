// NETS 마케팅 대시보드 로컬 서버 (외부 패키지 없음, Node 18+)
// 실행: node server.js  →  http://localhost:5173
// - dashboard/ 폴더의 화면을 보여 주고
// - data/*.json 을 읽고 씁니다. 저장할 때마다 data/.backup/ 에 직전 파일을 남깁니다.
// - 읽을 때 파일 버전(X-Version)을 주고, 저장할 때 그 버전(X-Base-Version)과 다르면 409로 거절합니다.
//   (대시보드가 켜진 동안 Claude Code가 파일을 고쳐도 대시보드가 덮어쓰지 않게)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 5173;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const BACKUP = path.join(DATA, '.backup');
const DATASETS = new Set(['config', 'posts', 'tasks', 'metrics', 'budget', 'meetings']);
const KEEP_BACKUPS = 30;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function send(res, code, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function version(file) {
  try { return String(Math.floor(fs.statSync(file).mtimeMs)); } catch { return ''; }
}

function backup(name) {
  const file = path.join(DATA, name + '.json');
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(BACKUP, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(BACKUP, `${name}-${stamp}.json`));
  const old = fs.readdirSync(BACKUP).filter(f => f.startsWith(name + '-')).sort();
  old.slice(0, Math.max(0, old.length - KEEP_BACKUPS)).forEach(f => fs.unlinkSync(path.join(BACKUP, f)));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const m = url.pathname.match(/^\/api\/data\/([a-z]+)$/);

  if (m) {
    const name = m[1];
    if (!DATASETS.has(name)) return send(res, 404, { error: `알 수 없는 데이터: ${name}` });
    const file = path.join(DATA, name + '.json');
    if (req.method === 'GET') {
      try { return send(res, 200, fs.readFileSync(file, 'utf8'), undefined, { 'X-Version': version(file) }); }
      catch { return send(res, 404, { error: `${name}.json 파일이 없습니다.` }); }
    }
    if (req.method === 'PUT') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { return send(res, 400, { error: 'JSON 형식이 아닙니다.' }); }
        const base = req.headers['x-base-version'];
        if (base != null && base !== version(file)) {
          return send(res, 409, { error: `${name}.json이 대시보드 밖에서 바뀌었습니다.` });
        }
        try {
          backup(name);
          fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
          return send(res, 200, { ok: true, savedAt: new Date().toISOString(), version: version(file) });
        } catch (e) { return send(res, 500, { error: '파일을 쓰지 못했습니다: ' + e.message }); }
      });
      return;
    }
    return send(res, 405, { error: 'GET 또는 PUT만 지원합니다.' });
  }

  // 정적 파일: / → /dashboard/, 그 외는 프로젝트 루트 기준 (data/.backup 제외)
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '' || rel === '/dashboard') { res.writeHead(302, { Location: '/dashboard/' }); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const target = path.normalize(path.join(ROOT, rel));
  if (!target.startsWith(ROOT) || target.includes(`${path.sep}.`)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(target, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, buf, TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`NETS 마케팅 대시보드: http://localhost:${PORT}`);
  console.log('종료하려면 이 창에서 Ctrl+C');
});
