#!/usr/bin/env node
/**
 * send-email.mjs — Briefing sender for Telegram-triggered emails
 *
 * Usage:
 *   node scripts/send-email.mjs --to <email> --subject <subject> \
 *     --type <morning|evening|update> --greeting <text> --date <text> \
 *     --sections '[{"title":"MIT","items":["Do the thing"],"callout":{"text":"Note","style":"warm"}}]' \
 *     [--signoff <text>]
 *
 * All emails go through buildBriefingHtml() — the canonical Myway template.
 * Plain-text fallback is auto-generated from sections.
 */

import os from 'os';
import Database from 'better-sqlite3';
import { createDecipheriv, scryptSync, createHash, randomUUID } from 'crypto';
import { google } from 'googleapis';

// ── Config ────────────────────────────────────────────────────────────────────
const MYWAY_SECRET = process.env.MYWAY_SECRET;
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT      = `http://localhost:${process.env.PORT || 48291}/api/connections/auth/callback`;
const DB_PATH       = process.env.MYWAY_DB_PATH || `${process.env.HOME || os.homedir()}/.myway/data/myway.db`;
const TIMEZONE      = process.env.MYWAY_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

if (!MYWAY_SECRET || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Missing required env vars: MYWAY_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
  console.error('   Set them in .env.local or export before running this script.');
  process.exit(1);
}

// ── Args ──────────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const get      = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const to       = get('--to')       || process.env.BRIEFING_TO;
if (!to) {
  console.error('❌ Missing --to flag or BRIEFING_TO env var.');
  process.exit(1);
}
const subject  = get('--subject');
const type     = get('--type')     || 'update';       // morning | evening | weekly | update
const greeting = get('--greeting');
const date     = get('--date')     || new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TIMEZONE });
const signoff  = get('--signoff')  || null;
const sectionsRaw = get('--sections');
const sections = sectionsRaw ? JSON.parse(sectionsRaw) : [];
const dryRun = args.includes('--dry-run');

// Guard: require subject, greeting, and at least one section to prevent empty/test emails
if (!subject || !greeting || sections.length === 0) {
  console.error('❌ Missing required args. Usage: --subject "..." --greeting "..." --sections \'[...]\'');
  console.error('   subject:', subject || '(missing)');
  console.error('   greeting:', greeting || '(missing)');
  console.error('   sections:', sections.length ? `${sections.length} section(s)` : '(empty)');
  process.exit(1);
}

// Guard: validate sections schema — each section MUST have title (string) + items (array of strings)
// Wrong format: {"type":"text","content":"..."} — this silently crashes at render time
// Right format: {"title":"Section Name","items":["Line 1","Line 2"],"callout":{"text":"...","style":"warm"}}
const sectionErrors = [];
for (let i = 0; i < sections.length; i++) {
  const s = sections[i];
  if (typeof s.title !== 'string' || !s.title.trim()) {
    sectionErrors.push(`sections[${i}] missing "title" (string). Got: ${JSON.stringify(s)}`);
  }
  if (!Array.isArray(s.items) || s.items.length === 0) {
    sectionErrors.push(`sections[${i}] missing "items" (non-empty array). Got: ${JSON.stringify(s)}`);
  } else {
    for (let j = 0; j < s.items.length; j++) {
      if (typeof s.items[j] !== 'string') {
        sectionErrors.push(`sections[${i}].items[${j}] must be a string. Got: ${typeof s.items[j]}`);
      }
    }
  }
  if (s.callout !== undefined) {
    if (typeof s.callout?.text !== 'string') {
      sectionErrors.push(`sections[${i}].callout.text must be a string`);
    }
    if (!['warm', 'neutral'].includes(s.callout?.style)) {
      sectionErrors.push(`sections[${i}].callout.style must be "warm" or "neutral". Got: ${s.callout?.style}`);
    }
  }
}
if (sectionErrors.length > 0) {
  console.error('❌ Invalid sections format. Each section must be: {"title":"Name","items":["line1","line2"]}');
  console.error('   Errors:');
  sectionErrors.forEach(e => console.error('   •', e));
  console.error('\n   Example:');
  console.error('   --sections \'[{"title":"MIT","items":["Do the thing","Then this"],"callout":{"text":"Note","style":"warm"}}]\'');
  process.exit(1);
}

// ── Crypto ────────────────────────────────────────────────────────────────────
function decryptToken(enc) {
  if (!enc) throw new Error('Empty token');
  if (enc.startsWith('b64:')) return Buffer.from(enc.slice(4), 'base64').toString('utf8');
  // Must match src/lib/connections/crypto.ts deriveKey()
  const salt = createHash('sha256').update(`myway:${MYWAY_SECRET}`).digest().subarray(0, 16);
  const key = scryptSync(MYWAY_SECRET, salt, 32);
  const buf  = Buffer.from(enc, 'base64');
  const iv   = buf.subarray(0, 12);
  const tag  = buf.subarray(buf.length - 16);
  const body = buf.subarray(12, buf.length - 16);
  const dec  = createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(body), dec.final()]).toString('utf8');
}

// ── Template (mirrors email-template.ts exactly) ──────────────────────────────
function mdToHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:13px;font-family:\'SF Mono\',Monaco,Consolas,monospace;">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#1f2937;text-decoration:underline;">$1</a>')
    .replace(/\n/g, '<br>');
}
function esc(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const HEADER_LABELS = { morning: 'Morning Brief', evening: 'Evening Recap', weekly: 'Weekly Review', update: 'Quick Update' };

function buildBriefingHtml(data) {
  const headerLabel = HEADER_LABELS[data.type] || 'Brief';

  const sectionBlocks = data.sections.map((section) => {
    const items = section.items.map((item) => `
      <tr><td style="padding:6px 0;font-size:15px;line-height:1.6;color:#1f2937;">${mdToHtml(item)}</td></tr>`
    ).join('');

    const calloutHtml = section.callout ? `
      <tr><td style="padding:12px 0 4px 0;">
        <div style="padding:14px 16px;background:${section.callout.style === 'warm' ? '#fffbeb' : '#f8fafc'};border:1px solid ${section.callout.style === 'warm' ? '#fde68a' : '#e5e7eb'};border-radius:6px;">
          <p style="margin:0;font-size:14px;line-height:1.5;color:${section.callout.style === 'warm' ? '#92400e' : '#374151'};">${mdToHtml(section.callout.text)}</p>
        </div>
      </td></tr>` : '';

    return `
      <tr><td style="padding:24px 0 6px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;">${esc(section.title)}</td></tr>
      <tr><td style="border-top:1px solid #f3f4f6;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${items}${calloutHtml}</table>
      </td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>Myway ${headerLabel}</title>
  <style>
    body,table,td,p,a,li{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
    body{margin:0!important;padding:0!important;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;color:#1f2937;}
    a{color:#1f2937;}
    @media only screen and (max-width:600px){.email-body{padding-left:20px!important;padding-right:20px!important;}}
  </style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr><td align="center">
      <div style="max-width:560px;margin:0 auto;">

        <!-- Header -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td class="email-body" style="padding:40px 32px 0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:0 0 24px 0;border-bottom:1px solid #e5e7eb;">
                <p style="margin:0 0 2px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#9ca3af;">MYWAY &middot; ${esc(headerLabel.toUpperCase())}</p>
                <p style="margin:0;font-size:13px;color:#9ca3af;">${esc(data.date)}</p>
              </td></tr>
            </table>
          </td></tr>
        </table>

        <!-- Content -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td class="email-body" style="padding:24px 32px 0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:0 0 4px 0;">
                <p style="margin:0;font-size:17px;font-weight:600;color:#111827;line-height:1.4;">${esc(data.greeting)}</p>
              </td></tr>
              ${sectionBlocks}
            </table>
          </td></tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td class="email-body" style="padding:32px 32px 40px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${data.signoff ? `<tr><td style="padding:0 0 20px 0;"><p style="margin:0;font-size:15px;color:#374151;">${esc(data.signoff)}</p></td></tr>` : ''}
              <tr><td style="padding:20px 0 0 0;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;color:#9ca3af;">Sent by Myway &middot; Your ambient intelligence layer</p>
              </td></tr>
            </table>
          </td></tr>
        </table>

      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildPlainText(data) {
  const label = HEADER_LABELS[data.type] || 'Brief';
  const lines = [`${label} — ${data.date}`, '', data.greeting, ''];
  for (const s of data.sections) {
    lines.push(s.title.toUpperCase());
    lines.push('─'.repeat(s.title.length));
    for (const item of s.items) lines.push(`• ${item.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}`);
    if (s.callout) lines.push(`  → ${s.callout.text}`);
    lines.push('');
  }
  if (data.signoff) lines.push(data.signoff);
  lines.push('', '— Sent by Myway');
  return lines.join('\n');
}

function encodeSubject(s) {
  return `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=`;
}

function buildMime(from, to, subject, plainText, html) {
  const b = `myway_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const htmlB64 = Buffer.from(html, 'utf-8').toString('base64').match(/.{1,76}/g).join('\r\n');
  // RFC 2822 Date header in America/Toronto so email clients show ET time
  const now = new Date();
  const etParts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, weekday: 'short', day: '2-digit',
    month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hour12: false, timeZoneName: 'shortOffset'
  }).formatToParts(now);
  const p = Object.fromEntries(etParts.map(x => [x.type, x.value]));
  const rawOffset = (p.timeZoneName || 'GMT-5').replace('GMT', ''); // e.g. "-5" or "-4:30"
  const sign = rawOffset[0] === '-' ? '-' : '+';
  const [oh, om = '0'] = rawOffset.slice(1).split(':');
  const offsetFmt = `${sign}${oh.padStart(2,'0')}${om.padStart(2,'0')}`;
  const etDate = `${p.weekday}, ${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute}:${p.second} ${offsetFmt}`;
  return [
    `MIME-Version: 1.0`,
    `Date: ${etDate}`,
    `From: ${from}`, `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `Content-Type: multipart/alternative; boundary="${b}"`, '',
    `--${b}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`, '',
    plainText, '',
    `--${b}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`, '',
    htmlB64, '',
    `--${b}--`
  ].join('\r\n');
}

// ── Dry Run ───────────────────────────────────────────────────────────────────
if (dryRun) {
  const data = { type, greeting, date, sections, signoff };
  const html  = buildBriefingHtml(data);   // throws here if template is broken
  const plain = buildPlainText(data);
  console.log('✅ DRY RUN — schema valid, template renders OK');
  console.log(`   to: ${to} | subject: ${subject} | type: ${type}`);
  console.log(`   sections: ${sections.length} section(s): ${sections.map(s => s.title).join(', ')}`);
  console.log(`   html length: ${html.length} chars | plain length: ${plain.length} chars`);
  process.exit(0);
}

// ── OAuth ─────────────────────────────────────────────────────────────────────
const db  = new Database(DB_PATH);
const row = db.prepare('SELECT access_token, refresh_token FROM connection_tokens WHERE connection_id = ?').get('google-workspace');
if (!row) { console.error('❌ No google-workspace connection. Reconnect at http://localhost:48291 → Connections.'); process.exit(1); }

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
oauth2.setCredentials({ access_token: decryptToken(row.access_token), refresh_token: decryptToken(row.refresh_token) });
oauth2.on('tokens', (t) => { if (t.access_token) console.log('🔄 Token refreshed.'); });

// ── Send ──────────────────────────────────────────────────────────────────────
try {
  const gmail   = google.gmail({ version: 'v1', auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const fromEmail = profile.data.emailAddress;
  const from    = `Myway <${fromEmail}>`;

  const data = { type, greeting, date, sections, signoff };
  const html  = buildBriefingHtml(data);
  const plain = buildPlainText(data);
  const mime  = buildMime(from, to, subject, plain, html);

  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(mime).toString('base64url') } });
  console.log(`✅ ${from} → ${to} | ${subject} | Gmail ID: ${res.data.id}`);

  // ── Save to briefings table ────────────────────────────────────────────────
  try {
    // Ensure briefings table exists (migration may not have run yet)
    db.exec(`CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, subject TEXT NOT NULL,
      greeting TEXT, date_label TEXT, sections TEXT NOT NULL DEFAULT '[]',
      signoff TEXT, sent_to TEXT NOT NULL, external_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}', is_deleted INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    db.prepare(`
      INSERT INTO briefings (id, type, subject, greeting, date_label, sections, signoff, sent_to, external_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), type, subject, greeting, date,
      JSON.stringify(sections), signoff, to, res.data.id ?? null
    );
    console.log(`📋 Briefing saved to DB (type: ${type})`);
  } catch (dbErr) {
    // Non-critical — email was already sent successfully
    console.warn('⚠️ Failed to save briefing to DB:', dbErr.message);
  }
} catch (err) {
  if (err.message?.includes('invalid_grant')) {
    console.error('❌ Token expired. Reconnect at http://localhost:48291 → Connections.');
  } else {
    console.error('❌', err.message);
  }
  process.exit(1);
}
