/**
 * Tenant discovery — scans the data directory for tenant sub-directories.
 * Shared by admin routes (costs, usage, export).
 */

import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '@/lib/db/config'

/**
 * Discover all tenant IDs by scanning $DATA_DIR/tenants/.
 * Returns only directories matching the safe tenant ID pattern.
 */
export function getDiscoveredTenantIds(): string[] {
  const ids: string[] = []
  const tenantsDir = join(DATA_DIR, 'tenants')
  if (!existsSync(tenantsDir)) return ids

  try {
    for (const entry of readdirSync(tenantsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-zA-Z0-9_-]{1,64}$/.test(entry.name)) {
        ids.push(entry.name)
      }
    }
  } catch { /* directory read failed */ }

  return ids
}
