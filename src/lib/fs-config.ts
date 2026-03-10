import path from 'path'
import fs from 'fs'

/**
 * Returns the configured root directory from the environment.
 * Throws if MYWAY_ROOT is not set — the app should not start without it.
 * Only call this from server-side code (API routes, server components).
 */
export function getRoot(): string {
  const root = process.env.MYWAY_ROOT
  if (!root || root.trim() === '') {
    throw new Error('MYWAY_ROOT environment variable is not set. Set it in .env.local.')
  }
  return path.resolve(root.trim())
}

/**
 * A virtual symlink — a file or directory from outside MYWAY_ROOT made
 * visible in the home listing under a chosen display name.
 *
 * Configure via MYWAY_LINKS in .env.local (JSON array):
 *   MYWAY_LINKS=[{"name":"notes.md","target":"/home/user/notes.md"}]
 */
export type MywayLink = {
  /** Display name shown in the file browser (e.g. "PRD.md" or "project"). */
  name: string
  /** Absolute path to the real file or directory. */
  target: string
}

/**
 * Parses MYWAY_LINKS from the environment.
 * Returns [] if unset or malformed — never throws.
 */
export function getLinks(): MywayLink[] {
  const raw = process.env.MYWAY_LINKS
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (l): l is MywayLink =>
        l && typeof l.name === 'string' && typeof l.target === 'string'
    )
  } catch {
    return []
  }
}

/**
 * If resolvedPath is within a configured link target, returns the matching
 * link and the relative subpath within that target. Otherwise returns null.
 *
 * Used to compute virtual display paths (e.g. "notes.md" instead of
 * the full absolute path) and parent pointers.
 */
export function findLinkForPath(
  resolvedPath: string
): { link: MywayLink; relative: string } | null {
  for (const link of getLinks()) {
    const t = path.resolve(link.target)
    if (resolvedPath === t) return { link, relative: '' }
    if (resolvedPath.startsWith(t + path.sep)) {
      return { link, relative: resolvedPath.slice(t.length) }
    }
  }
  return null
}

// ─── Path allowance checks ────────────────────────────────────────────────────

/**
 * Returns true if the normalized (but NOT symlink-resolved) path is within
 * MYWAY_ROOT or any configured link target. Handles `../..` traversal.
 */
function _isNormalizedAllowed(normalized: string, root: string): boolean {
  if (normalized === root || normalized.startsWith(root + path.sep)) return true
  return getLinks().some(({ target }) => {
    const t = path.resolve(target)
    return normalized === t || normalized.startsWith(t + path.sep)
  })
}

/**
 * Walks up the path until it finds an existing ancestor, then returns its
 * real path (resolving OS symlinks). Used to check write targets that don't
 * exist yet. Returns null if resolution fails entirely.
 */
function _realpathOfExistingAncestor(p: string): string | null {
  try {
    return fs.realpathSync(p)
  } catch (e: any) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      const parent = path.dirname(p)
      if (parent === p) return null // filesystem root — give up
      return _realpathOfExistingAncestor(parent)
    }
    return null // EACCES or other — fail safe
  }
}

/**
 * Returns true only if the path is within MYWAY_ROOT or a configured link
 * target — after BOTH normalizing `../..` segments AND resolving OS symlinks.
 *
 * Two checks are required because:
 *   1. `path.resolve` handles `../..` traversal but does NOT follow OS symlinks.
 *   2. `fs.realpathSync` resolves OS symlinks but requires the path to exist.
 *      For new-file writes, we resolve the nearest existing ancestor instead.
 *
 * This prevents:
 *   - Classic path traversal: ../../etc/passwd
 *   - Symlink escapes: a symlink inside the vault pointing to /etc/passwd
 */
export function isPathAllowed(targetPath: string): boolean {
  const root = getRoot()
  const normalized = path.resolve(targetPath)

  // Check 1: normalized path — blocks ../.. traversal
  if (!_isNormalizedAllowed(normalized, root)) return false

  // Check 2: real path — blocks OS symlink escapes
  const real = _realpathOfExistingAncestor(normalized)
  if (real === null) return false
  return _isNormalizedAllowed(real, root)
}
