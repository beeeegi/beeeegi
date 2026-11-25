import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const token = process.env.LANGS_TOKEN;
const out = process.argv[2] || 'profile/langs.svg';
const hidden = new Set(['HTML', 'CSS', 'SCSS', 'Less']);
const count = 8;

const LANGS = {
  '.rs': 'Rust', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.lua': 'Lua', '.luau': 'Luau', '.py': 'Python', '.cs': 'C#', '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++',
  '.hpp': 'C++', '.hh': 'C++', '.c': 'C', '.h': 'C', '.kt': 'Kotlin', '.kts': 'Kotlin', '.java': 'Java',
  '.go': 'Go', '.sh': 'Shell', '.bash': 'Shell', '.ps1': 'PowerShell', '.psm1': 'PowerShell', '.php': 'PHP',
  '.rb': 'Ruby', '.swift': 'Swift', '.dart': 'Dart', '.vue': 'Vue', '.svelte': 'Svelte', '.gd': 'GDScript',
  '.wgsl': 'WGSL', '.glsl': 'GLSL', '.frag': 'GLSL', '.vert': 'GLSL', '.hlsl': 'HLSL', '.sql': 'SQL',
  '.zig': 'Zig', '.bat': 'Batchfile', '.cmd': 'Batchfile', '.r': 'R', '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'SCSS', '.less': 'Less', '.asm': 'Assembly', '.ex': 'Elixir', '.exs': 'Elixir',
  '.hs': 'Haskell', '.scala': 'Scala', '.m': 'Objective-C', '.sp': 'SourcePawn', '.inc': 'SourcePawn',
  '.ahk': 'AutoHotkey', '.nim': 'Nim', '.jl': 'Julia', '.vb': 'Visual Basic', '.fs': 'F#',
};
const COLORS = {
  Rust: '#dea584', TypeScript: '#3178c6', JavaScript: '#f1e05a', Lua: '#4f5bd5', Luau: '#00a2ff', Python: '#3572a5',
  'C#': '#178600', 'C++': '#f34b7d', C: '#8a8a8a', Kotlin: '#a97bff', Java: '#b07219', Go: '#00add8', Shell: '#89e051',
  PowerShell: '#2f6fb3', PHP: '#4f5d95', Ruby: '#701516', Swift: '#f05138', Dart: '#00b4ab', Vue: '#41b883',
  Svelte: '#ff3e00', GDScript: '#355570', WGSL: '#1a5e9a', GLSL: '#5686a5', HLSL: '#aace60', SQL: '#e38c00',
  Zig: '#ec915c', Batchfile: '#c1f12e', R: '#198ce7', HTML: '#e34c26', CSS: '#663399', SCSS: '#c6538c',
  Assembly: '#6e4c13', Elixir: '#6e4a7e', Haskell: '#5e5086', Scala: '#c22d40', 'Objective-C': '#438eff',
  SourcePawn: '#f69e1d', AutoHotkey: '#6594b9', Nim: '#ffc200', Julia: '#a270ba', 'Visual Basic': '#945db7', 'F#': '#b845fc',
};
const LINE = { Python: ['#'], Shell: ['#'], PowerShell: ['#'], Ruby: ['#'], R: ['#'], Elixir: ['#'], GDScript: ['#'],
  Lua: ['--'], Luau: ['--'], Haskell: ['--'], SQL: ['--'], Assembly: [';'], AutoHotkey: [';'], Batchfile: ['REM ', '::', 'rem '],
  'Visual Basic': ["'"], HTML: [], CSS: [] };
const BLOCK = { Lua: [/--\[=*\[/, /\]=*\]/], Luau: [/--\[=*\[/, /\]=*\]/], HTML: [/<!--/, /-->/], Python: [/^("""|''')/, /("""|''')/] };
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', 'vendor', 'out', '.next', 'coverage',
  '__pycache__', 'Packages', 'DevPackages', 'ServerPackages', '.venv', 'venv', 'bin', 'obj', '.svelte-kit', '.nuxt', 'third_party']);

function lines(text, lang) {
  const line = LINE[lang] ?? ['//'];
  const block = BLOCK[lang] ?? [/\/\*/, /\*\//];
  let n = 0;
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (inBlock) {
      if (block[1].test(l)) inBlock = false;
      continue;
    }
    if (line.some(p => l.startsWith(p)) && !(BLOCK[lang] && block[0].test(l))) continue;
    if (block[0].test(l) && l.search(block[0]) === 0) {
      const rest = l.replace(block[0], '');
      if (!block[1].test(rest)) inBlock = true;
      continue;
    }
    n++;
  }
  return n;
}

function walk(dir, totals) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, totals);
      continue;
    }
    if (!e.isFile() || /\.min\.|\.bundle\.|\.d\.ts$|-lock\.|\.lock$/.test(e.name)) continue;
    const lang = LANGS[extname(e.name).toLowerCase()];
    if (!lang) continue;
    const size = statSync(p).size;
    if (size > 1_500_000) continue;
    const text = readFileSync(p, 'utf8');
    if (text.length > 4000 && text.split('\n').length < 5) continue;
    totals[lang] = (totals[lang] || 0) + lines(text, lang);
  }
}

async function api(path) {
  const all = [];
  for (let page = 1; ; page++) {
    const r = await fetch(`https://api.github.com${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const items = await r.json();
    all.push(...items);
    if (items.length < 100) return all;
  }
}

const repos = (await api('/user/repos?affiliation=owner')).filter(r => !r.fork);
const totals = {};
let used = 0;
for (const r of repos) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-'));
  try {
    for (let tries = 0; ; tries++) {
      try {
        execFileSync('git', ['clone', '--depth', '1', '--quiet', `https://x-access-token:${token}@github.com/${r.full_name}.git`, dir], { stdio: 'ignore' });
        break;
      } catch (e) {
        if (tries === 2) throw e;
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir);
      }
    }
    walk(dir, totals);
    used++;
  } catch {
    console.error('skipped ' + r.name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const short = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : String(n));
const all = Object.entries(totals).filter(([l, n]) => !hidden.has(l) && n > 0).sort((a, b) => b[1] - a[1]);
const total = all.reduce((a, [, n]) => a + n, 0);
const rest = all.slice(count).reduce((a, [, n]) => a + n, 0);
const rows = rest > 0 ? [...all.slice(0, count), ['Other', rest]] : all.slice(0, count);
const color = l => (l === 'Other' ? 'var(--faint)' : COLORS[l] || `hsl(${[...l].reduce((a, c) => a + c.charCodeAt(0) * 37, 0) % 360} 55% 55%)`);
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif`;
const THEME = `:root{--bg:#ffffff;--line:#d0d7de;--fg:#1f2328;--mute:#59636e;--faint:#818b98;--track:#eff2f5}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--line:#30363d;--fg:#e6edf3;--mute:#9198a1;--faint:#656c76;--track:#21262d}}
text{font-family:${FONT};fill:var(--fg)}`;
const W = 495, pad = 24, head = 64, rowH = 27, nameW = 96, valW = 54;
const H = head + rows.length * rowH + 14;
const max = Math.max(...rows.map(([, n]) => n));
const track = W - pad * 2 - nameW - valW;
const body = rows.map(([l, n], i) => {
  const y = head + i * rowH;
  const w = Math.max(3, (n / max) * track);
  return `<text x="${pad}" y="${y + 9}" font-size="13" dominant-baseline="middle">${esc(l)}</text>
<rect x="${pad + nameW}" y="${y + 4}" width="${track}" height="10" rx="5" fill="var(--track)"/>
<rect x="${pad + nameW}" y="${y + 4}" width="${w.toFixed(1)}" height="10" rx="5" fill="${color(l)}"/>
<text x="${W - pad}" y="${y + 9}" font-size="12.5" text-anchor="end" dominant-baseline="middle" style="fill:var(--mute)">${short(n)}</text>`;
}).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Languages by lines of code"><style>${THEME}</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" style="fill:var(--bg);stroke:var(--line)"/>
<text x="${pad}" y="36" font-size="16" font-weight="600">Languages</text>
<text x="${W - pad}" y="36" font-size="12.5" text-anchor="end" style="fill:var(--mute)">${short(total)} lines · ${used} repos</text>
${body}</svg>`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`${used} repos, ${total} lines, ${all.length} languages -> ${out}`);
console.log(rows.map(([l, n]) => `${l} ${n}`).join('\n'));
