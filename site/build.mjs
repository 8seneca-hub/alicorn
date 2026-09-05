import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync } from 'fs';
import { join } from 'path';
const layout = readFileSync('layout.html', 'utf8');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('assets', 'dist/assets', { recursive: true });
const pages = readdirSync('pages').filter(f => f.endsWith('.html'));
for (const f of pages) {
  const raw = readFileSync(join('pages', f), 'utf8');
  const meta = {};
  const body = raw.replace(/^<!--([\s\S]*?)-->\s*/, (_, m) => {
    m.trim().split('\n').forEach(l => {
      const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    return '';
  });
  const html = layout
    .replace('{{TITLE}}', meta.title || 'Alicorn')
    .replace(/\{\{TITLE\}\}/g, meta.title || 'Alicorn')
    .replace(/\{\{DESC\}\}/g, meta.desc || '')
    .replace('{{HEAD}}', meta.head || '')
    .replace('{{BODY}}', body.trim());
  writeFileSync(join('dist', f), html);
}
console.log('built', pages.length, 'pages →', pages.map(p => '/' + p.replace('.html','')).join(' '));
