/**
 * GET /api/files/preview?path=...
 *
 * Converts document files (docx, xlsx, xls, csv) to styled HTML for iframe preview.
 * Same security model as /api/files/raw — path must be within allowed root.
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getRoot, isPathAllowed } from '@/lib/fs-config'
import { isTenantUser } from '@/lib/hosted-storage'
import { getTenantId } from '@/lib/tenant'

export async function GET(req: NextRequest) {
  if (isTenantUser({ tenantId: getTenantId(req) })) return new NextResponse('Not available', { status: 404 })

  let root: string
  try { root = getRoot() } catch {
    return new NextResponse('Server misconfiguration', { status: 503 })
  }

  const rawPath = req.nextUrl.searchParams.get('path')
  if (!rawPath) return new NextResponse('path is required', { status: 400 })

  const resolved = path.resolve(rawPath)
  if (!isPathAllowed(resolved)) {
    return new NextResponse('Access denied', { status: 403 })
  }

  try {
    const stat = fs.statSync(resolved)
    if (!stat.isFile()) return new NextResponse('Not a file', { status: 400 })

    const ext = path.extname(resolved).toLowerCase()
    const fileName = path.basename(resolved)
    let html: string

    if (ext === '.docx' || ext === '.doc') {
      html = await convertDocx(resolved, fileName)
    } else if (ext === '.xlsx' || ext === '.xls') {
      html = await convertSpreadsheet(resolved, fileName)
    } else if (ext === '.csv') {
      html = await convertCsv(resolved, fileName)
    } else {
      return new NextResponse('Unsupported format', { status: 400 })
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:",
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') return new NextResponse('Not found', { status: 404 })
    if (err.code === 'EACCES') return new NextResponse('Permission denied', { status: 403 })
    console.error('[GET /api/files/preview]', err)
    return new NextResponse('File conversion error', { status: 500 })
  }
}

// ── Converters ──────────────────────────────────────────────────────────────

async function convertDocx(filePath: string, fileName: string): Promise<string> {
  const mammoth = await import('mammoth')
  const buffer = fs.readFileSync(filePath)
  const result = await mammoth.convertToHtml({ buffer })
  // Wrap tables in scrollable container for responsiveness
  const body = result.value.replace(
    /<table([\s>])/g,
    '<div class="table-wrap"><table$1'
  ).replace(/<\/table>/g, '</table></div>')
  return wrapHtml(fileName, body, 'document')
}

async function convertSpreadsheet(filePath: string, fileName: string): Promise<string> {
  const XLSX = await import('xlsx')
  const buffer = fs.readFileSync(filePath)
  const workbook = XLSX.read(buffer, { type: 'buffer' })

  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const tableHtml = XLSX.utils.sheet_to_html(sheet, { id: `sheet-${name}`, editable: false })
    return { name, html: tableHtml }
  })

  const tabsHtml = sheets.length > 1
    ? `<div class="sheet-tabs">${sheets.map((s, i) =>
        `<button class="sheet-tab${i === 0 ? ' active' : ''}" onclick="showSheet(${i})">${escHtml(s.name)}</button>`
      ).join('')}</div>`
    : ''

  const sheetsHtml = sheets.map((s, i) =>
    `<div class="sheet-content${i === 0 ? ' active' : ''}" data-sheet="${i}">${s.html}</div>`
  ).join('')

  const script = sheets.length > 1
    ? `<script>
function showSheet(idx) {
  document.querySelectorAll('.sheet-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sheet-tab').forEach(el => el.classList.remove('active'));
  document.querySelector('[data-sheet="'+idx+'"]').classList.add('active');
  document.querySelectorAll('.sheet-tab')[idx].classList.add('active');
}
</script>`
    : ''

  return wrapHtml(fileName, tabsHtml + sheetsHtml + script, 'spreadsheet')
}

async function convertCsv(filePath: string, fileName: string): Promise<string> {
  const XLSX = await import('xlsx')
  const buffer = fs.readFileSync(filePath)
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const tableHtml = XLSX.utils.sheet_to_html(sheet, { id: 'csv-table', editable: false })
  return wrapHtml(fileName, tableHtml, 'spreadsheet')
}

// ── Shared wrapper ──────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Extract headings from mammoth HTML for building an outline. */
function extractHeadings(html: string): { level: number; text: string; id: string }[] {
  const headings: { level: number; text: string; id: string }[] = []
  const re = /<h([1-4])[^>]*>(.*?)<\/h\1>/gi
  let match: RegExpExecArray | null
  let idx = 0
  while ((match = re.exec(html)) !== null) {
    const level = parseInt(match[1], 10)
    const text = match[2].replace(/<[^>]+>/g, '').trim()
    if (text) {
      headings.push({ level, text, id: `heading-${idx++}` })
    }
  }
  return headings
}

/** Inject id attributes onto headings so outline links work. */
function injectHeadingIds(html: string, headings: { level: number; id: string }[]): string {
  let idx = 0
  return html.replace(/<h([1-4])([^>]*)>/gi, (full, lvl, attrs) => {
    if (idx < headings.length && parseInt(lvl, 10) === headings[idx].level) {
      return `<h${lvl}${attrs} id="${headings[idx++].id}">`
    }
    return full
  })
}

function wrapHtml(fileName: string, body: string, type: 'document' | 'spreadsheet'): string {
  // For documents, extract headings and inject IDs for outline navigation
  let outlineHtml = ''
  let outlineScript = ''
  if (type === 'document') {
    const headings = extractHeadings(body)
    if (headings.length > 0) {
      body = injectHeadingIds(body, headings)
      const indentMap: Record<number, string> = { 1: '0', 2: '12px', 3: '24px', 4: '36px' }
      const weightMap: Record<number, string> = { 1: '700', 2: '600', 3: '400', 4: '400' }
      const colorMap: Record<number, string> = { 1: '#f1f5f9', 2: '#e2e8f0', 3: '#94a3b8', 4: '#64748b' }

      const items = headings.map(h =>
        `<button class="outline-item" data-target="${h.id}" style="padding-left:${indentMap[h.level] ?? '36px'};font-weight:${weightMap[h.level] ?? '400'};color:${colorMap[h.level] ?? '#64748b'};">${escHtml(h.text)}</button>`
      ).join('\n')

      outlineHtml = `
<div class="outline-bar" id="outlineBar">
  <div style="position:relative;">
    <div class="outline-panel" id="outlinePanel">
      <div class="outline-header">
        <span class="outline-title">OUTLINE</span>
        <button class="outline-close" id="outlineClose">&times;</button>
      </div>
      <div class="outline-list">${items}</div>
    </div>
    <button class="outline-toggle" id="outlineToggle">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      <span class="outline-count">${headings.length}</span>
    </button>
  </div>
</div>`

      outlineScript = `<script>
(function(){
  var panel = document.getElementById('outlinePanel');
  var toggle = document.getElementById('outlineToggle');
  var close = document.getElementById('outlineClose');
  var bar = document.getElementById('outlineBar');
  toggle.onclick = function(){ panel.classList.toggle('open'); };
  close.onclick = function(){ panel.classList.remove('open'); };
  document.addEventListener('click', function(e){
    if (!bar.contains(e.target)) panel.classList.remove('open');
  });
  document.querySelectorAll('.outline-item').forEach(function(btn){
    btn.onclick = function(){
      var el = document.getElementById(btn.dataset.target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      panel.classList.remove('open');
    };
  });
  // Active heading tracking
  var observer = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) {
        document.querySelectorAll('.outline-item').forEach(function(b){ b.classList.remove('active'); });
        var btn = document.querySelector('[data-target="'+e.target.id+'"]');
        if (btn) btn.classList.add('active');
      }
    });
  }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });
  document.querySelectorAll('h1[id],h2[id],h3[id],h4[id]').forEach(function(h){ observer.observe(h); });
})();
</script>`
    }
  }

  const docStyles = type === 'document' ? `
    .content { max-width: 720px; margin: 0 auto; padding: 40px 32px; }
    .content h1 { font-size: 1.75em; font-weight: 700; margin: 1.2em 0 0.4em; color: #e2e8f0; }
    .content h2 { font-size: 1.4em; font-weight: 600; margin: 1.1em 0 0.3em; color: #e2e8f0; }
    .content h3 { font-size: 1.15em; font-weight: 600; margin: 1em 0 0.3em; color: #e2e8f0; }
    .content h4 { font-size: 1.05em; font-weight: 600; margin: 0.9em 0 0.2em; color: #e2e8f0; }
    .content p { margin: 0.6em 0; line-height: 1.7; }
    .content ul, .content ol { padding-left: 1.5em; margin: 0.5em 0; }
    .content li { margin: 0.3em 0; line-height: 1.6; }
    .content strong { color: #f1f5f9; }
    .content a { color: #60a5fa; text-decoration: underline; }
    .content img { max-width: 100%; border-radius: 8px; margin: 1em 0; }
    /* Responsive tables inside documents */
    .content table { border-collapse: collapse; margin: 1em 0; min-width: 100%; }
    .content th, .content td { border: 1px solid #334155; padding: 8px 12px; text-align: left; }
    .content th { background: rgba(255,255,255,0.05); font-weight: 600; color: #e2e8f0; }
    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 8px; border: 1px solid #334155; margin: 1em 0; }
    .table-wrap table { margin: 0; border: none; }
    .table-wrap th:first-child, .table-wrap td:first-child { border-left: none; }
    .table-wrap th:last-child, .table-wrap td:last-child { border-right: none; }
    .table-wrap tr:first-child th, .table-wrap tr:first-child td { border-top: none; }
    .table-wrap tr:last-child th, .table-wrap tr:last-child td { border-bottom: none; }
    /* Outline FAB — sticky bar at bottom of document */
    .outline-bar { position: sticky; bottom: 0; z-index: 50; display: flex; justify-content: flex-end; padding: 12px 16px; pointer-events: none; }
    .outline-bar > * { pointer-events: auto; }
    .outline-toggle { display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: #1e293b; border: 1px solid #334155; border-radius: 9999px; color: #e2e8f0; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.15s; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    .outline-toggle:hover { background: #334155; color: #fff; }
    .outline-toggle:active { transform: scale(0.95); }
    .outline-count { font-variant-numeric: tabular-nums; }
    .outline-panel { display: none; position: absolute; bottom: 100%; right: 0; margin-bottom: 8px; width: 260px; max-height: 60vh; background: #0f1219; border: 1px solid #334155; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6); overflow: hidden; flex-direction: column; }
    .outline-panel.open { display: flex; }
    .outline-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #1e293b; }
    .outline-title { font-size: 11px; font-weight: 600; color: #94a3b8; letter-spacing: 0.08em; }
    .outline-close { background: none; border: none; color: #64748b; cursor: pointer; font-size: 18px; padding: 0 4px; line-height: 1; }
    .outline-close:hover { color: #cbd5e1; }
    .outline-list { overflow-y: auto; padding: 8px; flex: 1; }
    .outline-item { display: block; width: 100%; text-align: left; background: none; border: none; color: inherit; font-size: 12px; padding: 6px 8px; border-radius: 8px; cursor: pointer; transition: background 0.1s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .outline-item:hover { background: rgba(255,255,255,0.06); }
    .outline-item.active { background: rgba(255,255,255,0.08); border-left: 2px solid #60a5fa; color: #f1f5f9 !important; }
    @media (max-width: 600px) {
      .content { padding: 24px 16px; }
      .outline-bar { padding: 8px 12px; }
      .outline-panel { width: 220px; }
    }
  ` : `
    .content { padding: 16px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { border-collapse: collapse; min-width: 100%; font-size: 13px; }
    th, td { border: 1px solid #334155; padding: 6px 10px; text-align: left; white-space: nowrap; }
    th { background: rgba(255,255,255,0.06); font-weight: 600; color: #e2e8f0; position: sticky; top: 0; z-index: 1; }
    tr:hover td { background: rgba(255,255,255,0.03); }
    .sheet-tabs { display: flex; gap: 2px; padding: 8px 16px; border-bottom: 1px solid #334155; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .sheet-tab { padding: 6px 14px; border-radius: 6px 6px 0 0; background: rgba(255,255,255,0.04); border: 1px solid transparent; color: #94a3b8; font-size: 12px; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
    .sheet-tab.active { background: rgba(255,255,255,0.08); border-color: #334155; color: #e2e8f0; }
    .sheet-content { display: none; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .sheet-content.active { display: block; }
    @media (max-width: 600px) {
      .content { padding: 8px; }
      th, td { padding: 4px 6px; font-size: 12px; }
    }
  `

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(fileName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    background: #0f1219;
    color: #cbd5e1;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  ${docStyles}
</style>
</head>
<body>
<div class="content">${body}</div>
${outlineHtml}
${outlineScript}
</body>
</html>`
}
