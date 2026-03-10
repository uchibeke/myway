// ─── URL Content Extraction Service ──────────────────────────────────────────
// Reusable library for extracting content from URLs (YouTube, generic pages).
// No external dependencies — uses native fetch() + regex parsing.

export type ExtractedContent = {
  url: string
  platform: 'youtube' | 'tiktok' | 'instagram' | 'twitter' | 'generic'
  title: string | null
  description: string | null
  content: string | null   // transcript for videos, article body for pages
  author: string | null
  thumbnail: string | null
  error: string | null
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ─── Platform detection ──────────────────────────────────────────────────────

function detectPlatform(url: string): ExtractedContent['platform'] {
  const host = new URL(url).hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com')
    return 'youtube'
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok'
  if (host === 'instagram.com' || host.endsWith('.instagram.com'))
    return 'instagram'
  if (host === 'twitter.com' || host === 'x.com') return 'twitter'
  return 'generic'
}

// ─── HTML entity decoder ─────────────────────────────────────────────────────

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/\\n/g, '\n')
}

// ─── OG tag parser ───────────────────────────────────────────────────────────

function parseOGTags(html: string): {
  title: string | null
  description: string | null
  image: string | null
  author: string | null
} {
  const og = (prop: string): string | null => {
    const m = html.match(
      new RegExp(
        `<meta[^>]+(?:property|name)=["']og:${prop}["'][^>]+content=["']([^"']*?)["']`,
        'i',
      ),
    )
    if (m) return decodeHTMLEntities(m[1])
    // Try reversed attribute order
    const m2 = html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']*?)["'][^>]+(?:property|name)=["']og:${prop}["']`,
        'i',
      ),
    )
    return m2 ? decodeHTMLEntities(m2[1]) : null
  }

  const metaDesc = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*?)["']/i,
  )
  const metaDescRev = html.match(
    /<meta[^>]+content=["']([^"']*?)["'][^>]+name=["']description["']/i,
  )

  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)

  return {
    title: og('title') || (titleTag ? decodeHTMLEntities(titleTag[1].trim()) : null),
    description:
      og('description') ||
      (metaDesc
        ? decodeHTMLEntities(metaDesc[1])
        : metaDescRev
          ? decodeHTMLEntities(metaDescRev[1])
          : null),
    image: og('image'),
    author: og('article:author') || og('site_name'),
  }
}

// ─── YouTube extractor ───────────────────────────────────────────────────────

function getYouTubeVideoId(url: string): string | null {
  const u = new URL(url)
  if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
  return u.searchParams.get('v')
}

// Extract a JSON object from HTML using string-aware brace counting.
// Naive brace counting breaks on braces inside string literals.
function extractJsonObject(html: string, startIdx: number): string | null {
  const braceStart = html.indexOf('{', startIdx)
  if (braceStart === -1) return null

  let depth = 0
  let inString = false
  let end = braceStart
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  return depth === 0 ? html.slice(braceStart, end + 1) : null
}

async function extractYouTube(
  url: string,
  videoId: string,
): Promise<ExtractedContent> {
  const result: ExtractedContent = {
    url,
    platform: 'youtube',
    title: null,
    description: null,
    content: null,
    author: null,
    thumbnail: null,
    error: null,
  }

  // 1. oEmbed API — always works, no bot detection
  try {
    const oembedResp = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    )
    if (oembedResp.ok) {
      const oembed = await oembedResp.json()
      result.title = oembed.title || null
      result.author = oembed.author_name || null
      result.thumbnail = oembed.thumbnail_url || null
    }
  } catch {
    // oEmbed failed, continue — we'll try other sources
  }

  // 2. Fetch watch page for ytInitialData (description) and ytInitialPlayerResponse (captions)
  let html: string | null = null
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlfZnJvbnRlbmRfdWlzZXJ2ZXJfMjAyMzA4MjkuMDdfcDAQAhgBGgJlbg',
      },
      redirect: 'follow',
    })
    html = await resp.text()
  } catch {
    // Page fetch failed — we still have oEmbed data
  }

  if (html) {
    // 2a. Extract description from ytInitialData
    // This works even when ytInitialPlayerResponse is bot-blocked
    const dataMarkerIdx = html.indexOf('var ytInitialData')
    if (dataMarkerIdx !== -1) {
      const dataJson = extractJsonObject(html, dataMarkerIdx)
      if (dataJson) {
        try {
          const initialData = JSON.parse(dataJson)
          const secondaryInfo = initialData
            ?.contents?.twoColumnWatchNextResults?.results?.results?.contents
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?.find((c: any) => c.videoSecondaryInfoRenderer)
            ?.videoSecondaryInfoRenderer
          const attrDesc = secondaryInfo?.attributedDescription?.content
          if (attrDesc) {
            result.description = attrDesc
          }
        } catch {
          // ytInitialData parse failed
        }
      }
    }

    // 2b. Try ytInitialPlayerResponse for captions (may be blocked by bot detection)
    const playerMarkerIdx = html.indexOf('var ytInitialPlayerResponse')
    if (playerMarkerIdx !== -1) {
      const playerJson = extractJsonObject(html, playerMarkerIdx)
      if (playerJson) {
        try {
          const player = JSON.parse(playerJson)
          const details = player.videoDetails
          if (details) {
            // Use player response data if we don't have it from oEmbed
            result.title = result.title || details.title || null
            result.description = result.description || details.shortDescription || null
            result.author = result.author || details.author || null
            if (!result.thumbnail) {
              result.thumbnail =
                details.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || null
            }
          }

          // Extract captions
          const captionTracks =
            player.captions?.playerCaptionsTracklistRenderer?.captionTracks
          if (captionTracks && captionTracks.length > 0) {
            const enTrack =
              captionTracks.find(
                (t: { languageCode: string }) =>
                  t.languageCode === 'en' || t.languageCode?.startsWith('en'),
              ) || captionTracks[0]

            if (enTrack?.baseUrl) {
              try {
                const captionResp = await fetch(enTrack.baseUrl, {
                  headers: { 'User-Agent': BROWSER_UA },
                })
                const captionXml = await captionResp.text()
                const textMatches = captionXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)
                const lines: string[] = []
                for (const m of textMatches) {
                  const line = decodeHTMLEntities(m[1]).trim()
                  if (line) lines.push(line)
                }
                if (lines.length > 0) {
                  result.content = lines.join(' ')
                }
              } catch {
                // Captions failed — partial success
              }
            }
          }
        } catch {
          // Player response parse failed
        }
      }
    }
  }

  // Fallback thumbnail from video ID
  if (!result.thumbnail) {
    result.thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  }

  if (!result.title && !result.description && !result.content) {
    result.error = 'Could not extract any content from this YouTube video'
  }

  return result
}

// ─── Generic extractor ───────────────────────────────────────────────────────

async function extractGeneric(url: string): Promise<ExtractedContent> {
  const result: ExtractedContent = {
    url,
    platform: 'generic',
    title: null,
    description: null,
    content: null,
    author: null,
    thumbnail: null,
    error: null,
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })

    const contentType = resp.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      result.error = `Unsupported content type: ${contentType}`
      return result
    }

    // Cap at 500KB to avoid memory issues
    const reader = resp.body?.getReader()
    if (!reader) {
      result.error = 'No response body'
      return result
    }

    const chunks: Uint8Array[] = []
    let totalSize = 0
    const MAX_SIZE = 500 * 1024

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalSize += value.length
      if (totalSize >= MAX_SIZE) break
    }
    reader.cancel()

    const html = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length)
        merged.set(acc)
        merged.set(chunk, acc.length)
        return merged
      }, new Uint8Array()),
    )

    // OG tags + meta
    const og = parseOGTags(html)
    result.title = og.title
    result.description = og.description
    result.thumbnail = og.image
    result.author = og.author

    // Extract body text: strip scripts/styles, then tags, take first 2000 chars
    let body = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    body = decodeHTMLEntities(body)

    if (body.length > 2000) {
      body = body.slice(0, 2000) + '...'
    }

    if (body.length > 50) {
      result.content = body
    }
  } catch (e) {
    result.error = `Failed to fetch page: ${e instanceof Error ? e.message : String(e)}`
  }

  if (!result.title && !result.description && !result.content) {
    result.error = result.error || 'Could not extract any content from this URL'
  }

  return result
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function extractContent(url: string): Promise<ExtractedContent> {
  const platform = detectPlatform(url)

  switch (platform) {
    case 'youtube': {
      const videoId = getYouTubeVideoId(url)
      if (!videoId) {
        return {
          url,
          platform,
          title: null,
          description: null,
          content: null,
          author: null,
          thumbnail: null,
          error: 'Could not extract video ID from YouTube URL',
        }
      }
      return extractYouTube(url, videoId)
    }

    default:
      return extractGeneric(url)
  }
}
