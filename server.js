// IG link console: paste an Instagram link -> read the post -> save it into Apple Notes.
// Run: node server.js   (then open http://127.0.0.1:3210)   Self-check: node server.js test
const http = require('node:http');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert');

const PORT = 3210;
const CDP = 'http://127.0.0.1:9333'; // debugging port of the dedicated sign-in Chrome
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function shortcodeOf(link) {
  const m = /^https?:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]+)/.exec(String(link).trim());
  return m && m[1];
}

// The post time is encoded in the shortcode itself, so no extra request is needed.
function idOf(shortcode) {
  let id = 0n;
  for (const ch of shortcode.slice(0, 11)) id = id * 64n + BigInt(ALPHABET.indexOf(ch));
  return id;
}
const dateOf = (shortcode) => new Date(Number((idOf(shortcode) >> 23n) + 1314220021721n));

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pick = (html, re) => { const m = re.exec(html); return m ? decode(m[1]).trim() : ''; };
const count = (s) => (/\d[\d,.]*/.exec(s) || [''])[0]; // "View all 3,764 comments" -> "3,764"

function parseEmbed(html) {
  const caption = pick(html, /<div class="Caption">([\s\S]*?)<\/?div/)
    .replace(/^<a class="CaptionUsername"[\s\S]*?<\/a>/, '')
    .replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').trim();
  return {
    username: pick(html, /class="(?:CaptionUsername|UsernameText)"[^>]*>([^<]+)</),
    caption,
    likes: count(pick(html, /class="SocialProof">\s*<a[^>]*>([^<]+)</)),
    comments: count(pick(html, /class="CaptionCommentsExpand"[^>]*>([^<]+)</)),
    media: [pick(html, /class="EmbeddedMediaImage"[^>]*?src="([^"]+)"/)].filter(Boolean).map((image) => ({ image })),
    location: '', commentList: [],
  };
}

// A separate Chrome with its own profile: the user signs in there by hand, the console never sees the password.
function openSignInBrowser() {
  if (!fs.existsSync(CHROME)) throw new Error('Google Chrome is not installed in /Applications.');
  spawn(CHROME, ['--remote-debugging-port=9333', `--user-data-dir=${path.join(__dirname, '.ig-profile')}`,
    '--no-first-run', '--no-default-browser-check', 'https://www.instagram.com/'], { detached: true, stdio: 'ignore' }).unref();
}

// Runs a script inside the signed-in instagram.com tab, so requests carry the user's own session.
async function evalInInstagramTab(expression) {
  const tabs = await fetch(`${CDP}/json`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json())
    .catch(() => { throw new Error('sign-in browser is not open'); });
  const tab = tabs.find((t) => t.type === 'page' && t.url.startsWith('https://www.instagram.com/'));
  if (!tab) throw new Error('no instagram.com tab in the sign-in browser');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('sign-in browser timed out')), 20000);
      ws.onerror = () => reject(new Error('cannot talk to the sign-in browser'));
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== 1) return;
        const r = m.result && !m.result.exceptionDetails && m.result.result;
        r ? resolve(r.value) : reject(new Error('Instagram request failed in the sign-in browser'));
      };
    });
  } finally { clearTimeout(timer); ws.close(); }
}

function parseApi({ info, com }) {
  const m = info && info.items && info.items[0];
  if (!m) throw new Error('not signed in, or this account cannot see the post');
  const n = (v) => (typeof v === 'number' ? v.toLocaleString('en') : '');
  const first = (list) => (list && list[0] ? list[0].url : undefined);
  const slide = (s) => ({ image: first(s.image_versions2 && s.image_versions2.candidates), video: first(s.video_versions) });
  return {
    username: m.user ? m.user.username : '', caption: m.caption ? m.caption.text : '',
    likes: n(m.like_count), comments: n(m.comment_count), location: m.location ? m.location.name : '',
    media: (m.carousel_media || [m]).map(slide),
    commentList: ((com && com.comments) || []).map((c) => `@${c.user ? c.user.username : '?'}: ${c.text}`),
  };
}

async function readSignedIn(code) {
  const id = idOf(code);
  return parseApi(JSON.parse(await evalInInstagramTab(`(async () => {
    const get = (p) => fetch(p, { headers: { 'x-ig-app-id': '936619743392459' } }).then((r) => r.json()).catch(() => null);
    return JSON.stringify({ info: await get('/api/v1/media/${id}/info/') });
  })()`)));
}

async function readPublic(code) {
  // Instagram's public embed page: public posts only, first image, no comment text.
  const res = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' }, // browser UAs get an empty JS shell
  });
  const post = parseEmbed(await res.text());
  if (!post.username && !post.caption && !post.media.length) {
    throw new Error('Instagram returned no post content (private, deleted, or blocked).');
  }
  return post;
}

async function readPost(link) {
  const code = shortcodeOf(link);
  if (!code) throw new Error('That does not look like an Instagram post or reel link.');
  let post, mode = 'signed-in';
  try { post = await readSignedIn(code); } catch (why) {
    mode = `public — ${why.message}`;
    try { post = await readPublic(code); } catch (err) { throw new Error(`${err.message} Signed-in mode: ${why.message}.`); }
  }
  return { ...post, mode, code, url: `https://www.instagram.com/p/${code}/`, posted: dateOf(code).toISOString() };
}

// Fetches a media file, but only from Instagram's own hosts: the address comes from a remote response.
async function download(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname)) return null;
    const r = await fetch(u, { signal: AbortSignal.timeout(120000) });
    return r.ok ? { type: r.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await r.arrayBuffer()) } : null;
  } catch { return null; }
}

const READER = path.join(__dirname, 'reader'); // on-device text and speech reader, built from reader.swift
const read = (args, input) => new Promise((resolve) => {
  const child = execFile(READER, args, { timeout: 300000 }, (err, out) => resolve(err ? '' : out.trim()));
  child.stdin.on('error', () => {}); // reader missing or exited early
  child.stdin.end(input || '');
});
const hasChinese = (s) => /[\u3400-\u9fff]/.test(s);
const SPEECH_LOCALES = ['en-US', 'zh-TW', 'zh-HK'];

// Downloads every image and video of the post, then reads the text in images and the speech in videos.
// Each slide leaves one file (the video, or the picture when there is no video) to attach once the note exists.
// Pictures written into the note text show in Notes as blank file boxes, so they are attached like videos.
function fetchMedia(post, lang) {
  // shortcut: "auto" guesses the spoken language from the caption; pick it in the page when that is wrong.
  const locale = SPEECH_LOCALES.includes(lang) ? lang : (hasChinese(post.caption) ? 'zh-TW' : 'en-US');
  const canRead = fs.existsSync(READER);
  const dir = path.join(__dirname, 'videos');
  fs.mkdirSync(dir, { recursive: true });
  const save = (i, ext, data) => { const file = path.join(dir, `${post.code}-${i + 1}.${ext}`); fs.writeFileSync(file, data); return file; };
  return Promise.all(post.media.map(async (m, i) => {
    const f = {};
    const img = m.image && await download(m.image);
    if (img) {
      const picture = save(i, 'jpg', img.data);
      if (canRead) f.text = await read(['ocr', picture]);
      if (m.video) fs.unlinkSync(picture); else Object.assign(f, { file: picture, kind: 'picture', size: img.data.length });
    }
    const vid = m.video && await download(m.video);
    if (vid) {
      Object.assign(f, { file: save(i, 'mp4', vid.data), kind: 'video', size: vid.data.length });
      if (canRead) f.speech = await read(['speech', f.file, locale]);
    }
    if (!f.file) f.failed = true;
    return f;
  }));
}

function parseSummary(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  return { title: lines[0].replace(/^[-#*\s]+|[*\s]+$/g, '').slice(0, 90), points: lines.slice(1).map((l) => l.replace(/^[-•*]\s*/, '')) };
}

// Apple's on-device model writes the note title and key points. Returns null when it is unavailable.
async function summarize(post, files) {
  // shortcut: the on-device model has a small input limit, so long captions and transcripts are cut.
  const text = [`Caption: ${post.caption.slice(0, 1200)}`,
    ...files.map((f) => (f.speech ? `Speech: ${f.speech.slice(0, 1200)}` : '')),
    ...files.map((f) => (f.text ? `Text in image: ${f.text.slice(0, 300)}` : ''))].filter(Boolean).join('\n');
  return parseSummary(await read(['summarize', hasChinese(text) ? 'zh' : 'en'], text));
}

async function attachMedia(files, noteId) {
  const report = [];
  for (const [i, f] of files.entries()) {
    if (f.failed) { report.push(`item ${i + 1} could not be downloaded`); continue; }
    try {
      // Notes inserts a scripted attachment twice, so the extra copy is removed.
      await osa(['on run argv', 'tell application "Notes"', 'set n to note id (item 1 of argv)', 'set startCount to count of attachments of n',
        'make new attachment at n with data (POSIX file (item 2 of argv))',
        'if (count of attachments of n) > startCount + 1 then delete last attachment of n', 'end tell', 'end run'], [noteId, f.file]);
      fs.unlinkSync(f.file);
      report.push(`${f.kind} ${i + 1} attached (${(f.size / 1e6).toFixed(1)} MB)`);
    } catch (err) { report.push(`${f.kind} ${i + 1} kept at ${f.file} — ${err.message}`); }
  }
  return report;
}

// The note is deliberately short: summary title, key points, a link back, and the media.
// Pictures and videos are attached after the note exists.
function noteHtml(p) {
  const title = p.summary ? p.summary.title : `@${p.username || 'instagram'} — ${(p.caption.split('\n')[0] || 'Instagram post').slice(0, 60)}`;
  return `<div><h1>${escapeHtml(title)}</h1></div>`
    // Without a summary (Apple Intelligence off) the caption stands in, so the note is never empty.
    + (p.summary ? p.summary.points.map((x) => `<div>• ${escapeHtml(x)}</div>`).join('') : `<div>${escapeHtml(p.caption).replace(/\n/g, '<br>')}</div>`)
    + `<div><br></div><div><a href="${p.url}">${p.url}</a></div><div><br></div>`;
}

const osa = (lines, args) => new Promise((resolve, reject) => execFile('osascript', [...lines.flatMap((l) => ['-e', l]), ...args],
  (err, out, stderr) => (err ? reject(new Error('Apple Notes refused: ' + (stderr || err.message).trim())) : resolve(out))));

async function listFolders() {
  const out = await osa(['tell application "Notes"', 'set out to ""', 'repeat with f in folders',
    'set out to out & (id of f) & tab & (name of f) & tab & (name of container of f) & linefeed',
    'end repeat', 'return out', 'end tell'], []);
  return out.split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t'))
    .filter(([, name]) => name !== 'Recently Deleted').map(([id, name, parent]) => ({ id, name: `${name} (${parent})` }));
}

// The note travels in a temp file (images are too big for an argument) and is never spliced into
// the script, so captions cannot inject AppleScript.
async function saveToNotes(html, folderId) {
  const file = path.join(os.tmpdir(), `ig-note-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(file, html);
  try {
    return (await osa(['on run argv', 'set html to read POSIX file (item 1 of argv) as «class utf8»', 'tell application "Notes"',
      'if (item 2 of argv) is "" then', 'set n to make new note with properties {body:html}', 'else',
      'set n to make new note at folder id (item 2 of argv) with properties {body:html}', 'end if', 'return id of n', 'end tell', 'end run'], [file, String(folderId || '')])).trim();
  } finally { fs.unlinkSync(file); }
}

const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IG Link Console</title>
<style>
  body{font:16px/1.5 -apple-system,"PingFang TC",sans-serif;max-width:680px;margin:48px auto;padding:0 16px;color:#1d1d1f;background:#f5f5f7}
  form{display:flex;gap:8px} input{flex:1;padding:10px 12px;font:inherit;border:1px solid #c7c7cc;border-radius:8px}
  button{padding:10px 16px;font:inherit;border:0;border-radius:8px;background:#0071e3;color:#fff;cursor:pointer} button:disabled{opacity:.5}
  #status{margin:16px 0;min-height:1.5em} .err{color:#c00}
  #out{background:#fff;border-radius:12px;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere} #out:empty{display:none}
</style>
<h1>IG Link Console</h1>
<form id="f"><label for="u" hidden>Instagram link</label>
<input id="u" type="url" required placeholder="https://www.instagram.com/p/…" autofocus><button>Save to Notes</button></form>
<p><label for="folder">Save in folder: </label><select id="folder" style="font:inherit;padding:6px"><option value="">Default folder</option></select></p>
<p><label for="lang">Speech language in videos: </label><select id="lang" style="font:inherit;padding:6px">
<option value="">Auto (guess from caption)</option><option value="en-US">English</option><option value="zh-TW">國語 Mandarin</option><option value="zh-HK">粵語 Cantonese</option></select></p>
<p><button id="login" type="button" style="background:#e5e5ea;color:#1d1d1f">Open sign-in browser</button>
<small> Optional: sign in there once to read private posts, all images and comments. Keep that window open.</small></p>
<p id="status" role="status"></p><div id="out"></div>
<script>
const folder = document.getElementById('folder');
fetch('/folders').then((r) => r.json()).then((list) => {
  for (const x of list) folder.add(new Option(x.name, x.id));
  folder.value = localStorage.igFolder || ''; if (folder.selectedIndex < 0) folder.value = '';
}).catch(() => {});
folder.onchange = () => { localStorage.igFolder = folder.value; };
const lang = document.getElementById('lang'); lang.value = localStorage.igLang || '';
lang.onchange = () => { localStorage.igLang = lang.value; };
const f = document.getElementById('f'), s = document.getElementById('status'), o = document.getElementById('out');
f.onsubmit = async (e) => {
  e.preventDefault();
  const b = f.querySelector('button'); b.disabled = true; s.className = ''; s.textContent = 'Reading post… (videos can take a minute)'; o.textContent = '';
  try {
    const r = await fetch('/extract', { method: 'POST', body: JSON.stringify({ url: document.getElementById('u').value, folder: folder.value, lang: lang.value }) });
    const d = await r.json();
    if (d.post) o.textContent = [...(d.post.summary ? [d.post.summary.title, ...d.post.summary.points.map((x) => '• ' + x)] : ['@' + d.post.username, '', d.post.caption])].filter((x, i, all) => x || all[i - 1]).join('\\n');
    s.className = d.error ? 'err' : ''; s.textContent = d.error || 'Saved to Apple Notes (' + d.post.mode + '). ' + (d.videos || []).join('; ');
  } catch (err) { s.className = 'err'; s.textContent = 'Console server not reachable.'; }
  b.disabled = false;
};
document.getElementById('login').onclick = async () => {
  const d = await (await fetch('/login', { method: 'POST' })).json();
  s.className = d.error ? 'err' : ''; s.textContent = d.error || 'Sign-in browser opened. Sign in to Instagram there, then paste a link here.';
};
</script></html>`;

function serve() {
  http.createServer(async (req, res) => {
    const json = (out) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(out)); };
    // Only this page may trigger actions; other websites open in a browser cannot.
    if (req.method === 'POST' && !/^http:\/\/(127\.0\.0\.1|localhost):3210$/.test(req.headers.origin || '')) { res.writeHead(403); return res.end(); }
    if (req.method === 'POST' && req.url === '/login') {
      try { openSignInBrowser(); return json({}); } catch (err) { return json({ error: err.message }); }
    }
    if (req.method === 'POST' && req.url === '/extract') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) break; }
      const out = {};
      try {
        const { url, folder, lang } = JSON.parse(body);
        out.post = await readPost(url);
        const files = await fetchMedia(out.post, lang);
        out.post.summary = await summarize(out.post, files);
        const noteId = await saveToNotes(noteHtml(out.post), folder);
        out.videos = await attachMedia(files, noteId);
      } catch (err) { out.error = err.message; }
      return json(out);
    }
    if (req.url === '/folders') return json(await listFolders().catch(() => []));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  }).listen(PORT, '127.0.0.1', () => console.log(`IG console: http://127.0.0.1:${PORT}`));
}

function selfCheck() {
  assert.equal(shortcodeOf('https://www.instagram.com/p/BsOGulcndj-/?igsh=x'), 'BsOGulcndj-');
  assert.equal(shortcodeOf('https://instagram.com/someone/reel/Cabc_123/'), 'Cabc_123');
  assert.equal(shortcodeOf('https://evil.example/p/BsOGulcndj-/'), null);
  assert.equal(dateOf('BsOGulcndj-').toISOString().slice(0, 10), '2019-01-04');
  const p = parseEmbed('<div class="SocialProof"><a href="#">12 likes</a></div><div class="Caption"><a class="CaptionUsername" href="#">小明</a><br /><br />你好 &amp; hello<br /><a href="#">#標籤</a><div class="CaptionComments">');
  assert.deepEqual([p.username, p.caption, p.likes], ['小明', '你好 & hello\n#標籤', '12']);
  assert.ok(noteHtml({ ...p, url: 'u', posted: '2019-01-04T17:05:45.000Z' }).includes('你好 &amp; hello<br>#標籤'));
  assert.equal(String(idOf('BsOGulcndj-')), '1949525278281554174');
  const a = parseApi({ info: { items: [{ user: { username: 'u' }, caption: { text: '中文' }, like_count: 1234, comment_count: 2,
    carousel_media: [{ image_versions2: { candidates: [{ url: 'i1' }] } }, { video_versions: [{ url: 'v2' }], image_versions2: { candidates: [{ url: 'i2' }] } }] }] },
    com: { comments: [{ user: { username: 'c' }, text: '好' }] } });
  assert.deepEqual([a.caption, a.likes, a.media, a.commentList], ['中文', '1,234', [{ image: 'i1', video: undefined }, { image: 'i2', video: 'v2' }], ['@c: 好']]);
  assert.ok(!noteHtml({ ...a, url: 'u', posted: '2019-01-04T17:05:45.000Z' }).includes('<img'));
  assert.deepEqual(parseSummary('標題  \n- 重點一\n\n- point two'), { title: '標題', points: ['重點一', 'point two'] });
  assert.equal(parseSummary(''), null);
  assert.equal(parseSummary('**Bold Title**\n- a').title, 'Bold Title');
  assert.ok(noteHtml({ ...a, summary: { title: 'T', points: ['P'] }, url: 'u', posted: '2019-01-04T17:05:45.000Z' }).includes('<h1>T</h1></div><div>• P</div>'));
  console.log('self-check ok');
}

process.argv[2] === 'test' ? selfCheck() : serve();
