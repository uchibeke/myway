/**
 * Admin Tab Registry
 *
 * Adding a new tab requires:
 *  1. Add entry to ADMIN_TABS below
 *  2. Create the section component
 *  3. Add to TAB_COMPONENTS map in the admin page
 *
 * Use `order` gaps (10, 20, 30...) for easy future insertions.
 *
 * System health is NOT here — it lives in Settings (accessible to all users).
 * Admin focuses on multi-tenant concerns: user management and usage billing.
 */

import type { AppTabDef } from '@/lib/apps'

export const ADMIN_TABS: AppTabDef[] = [
  { id: 'users',  label: 'Users',  icon: 'users',      order: 10 },
  { id: 'costs',  label: 'Costs',  icon: 'dollar-sign', order: 15 },
  { id: 'usage',  label: 'Usage',  icon: 'bar-chart',   order: 20 },
]

export const getSortedAdminTabs = (): AppTabDef[] =>
  [...ADMIN_TABS].sort((a, b) => a.order - b.order)
