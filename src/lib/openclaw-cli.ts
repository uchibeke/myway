/**
 * OpenClaw CLI wrapper — centralized execFile interface.
 *
 * All OpenClaw CLI interactions go through here:
 *   - No shell injection (execFile, not exec)
 *   - Consistent timeout (default 30s)
 *   - Consistent error handling
 *   - JSON-parsed output
 *
 * SERVER ONLY — never import from client components.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)
const OC = process.env.OPENCLAW_BIN ?? '/usr/bin/openclaw'
const DEFAULT_TIMEOUT = 30_000

/**
 * Execute an OpenClaw CLI command and return parsed JSON output.
 * Throws on non-zero exit or parse failure.
 */
export async function execOpenClaw(
  args: string[],
  timeout = DEFAULT_TIMEOUT,
): Promise<unknown> {
  const { stdout } = await run(OC, args, { timeout })
  return JSON.parse(stdout)
}
