/**
 * Settings Tab Registry
 *
 * Adding a new tab requires:
 *  1. Add entry to SETTINGS_TABS below
 *  2. Create the section component
 *  3. Add to TAB_COMPONENTS map in the settings page
 *
 * Use `order` gaps (10, 20, 30…) for easy future insertions.
 */

export type SettingsTabDef = {
  id: string
  label: string
  /** Lucide icon name — resolved to a component at the render site */
  icon: string
  /** Sort order (10, 20, 30… — gaps for future insertions) */
  order: number
}

export const SETTINGS_TABS: SettingsTabDef[] = [
  { id: 'connections', label: 'Connections', icon: 'plug',     order: 10 },
  { id: 'profile',     label: 'Profile',     icon: 'user',     order: 20 },
  { id: 'automation',  label: 'Automations', icon: 'clock',    order: 25 },
  { id: 'about',       label: 'About',       icon: 'info',     order: 30 },
]

export const getSortedTabs = (): SettingsTabDef[] =>
  [...SETTINGS_TABS].sort((a, b) => a.order - b.order)
