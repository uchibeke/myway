import { NextRequest, NextResponse } from 'next/server'
import { extractContent } from '@/lib/extract'

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '::1',
  '169.254.169.254',  // Cloud metadata (AWS, GCP, Azure)
  'metadata.google.internal',
]

function isBlockedHost(hostname: string): boolean {
  // Strip brackets from IPv6
  const h = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  if (BLOCKED_HOSTS.includes(h)) return true
  if (BLOCKED_HOSTS.includes(hostname)) return true
  // IPv4 private ranges
  if (h.startsWith('192.168.')) return true
  if (h.startsWith('10.')) return true
  if (h.startsWith('172.') && /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  // Link-local (IPv4 + IPv6)
  if (h.startsWith('169.254.')) return true
  if (h.toLowerCase().startsWith('fe80:')) return true
  // IPv6 loopback and private
  if (h === '::' || h.startsWith('fc') || h.startsWith('fd')) return true
  return false
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')

  if (!url) {
    return NextResponse.json(
      { error: 'Missing required parameter: url' },
      { status: 400 },
    )
  }

  // Validate URL format
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL format' },
      { status: 400 },
    )
  }

  if (!parsed.protocol.startsWith('http')) {
    return NextResponse.json(
      { error: 'Only HTTP(S) URLs are supported' },
      { status: 400 },
    )
  }

  // SSRF protection
  if (isBlockedHost(parsed.hostname)) {
    return NextResponse.json(
      { error: 'URL points to a blocked host' },
      { status: 403 },
    )
  }

  try {
    const result = await extractContent(url)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      {
        url,
        platform: 'generic',
        title: null,
        description: null,
        content: null,
        author: null,
        thumbnail: null,
        error: 'Extraction failed',
      },
      { status: 500 },
    )
  }
}
