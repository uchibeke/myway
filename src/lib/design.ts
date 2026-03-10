/**
 * Shared design tokens for Myway app pages.
 *
 * getAppGradient — maps an app's Tailwind bg-* color class to a dark atmospheric
 * radial gradient used as the ambient background inside the phone-card shell.
 *
 * Uses var(--brand-bg) so gradients respect white-label branding.
 */

const GRADIENT_MAP: Record<string, string> = {
  'bg-red-500':    'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(239,68,68,0.18) 0%, transparent 65%), var(--brand-bg)',
  'bg-yellow-500': 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(234,179,8,0.15) 0%, transparent 65%), var(--brand-bg)',
  'bg-blue-500':   'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(59,130,246,0.15) 0%, transparent 65%), var(--brand-bg)',
  'bg-orange-500': 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(249,115,22,0.15) 0%, transparent 65%), var(--brand-bg)',
  'bg-purple-500': 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(168,85,247,0.15) 0%, transparent 65%), var(--brand-bg)',
  'bg-green-500':  'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(34,197,94,0.12) 0%, transparent 65%), var(--brand-bg)',
  'bg-indigo-600': 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(79,70,229,0.18) 0%, transparent 65%), var(--brand-bg)',
  'bg-zinc-600':   'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(113,113,122,0.12) 0%, transparent 65%), var(--brand-bg)',
  'bg-amber-500':  'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(245,158,11,0.15) 0%, transparent 65%), var(--brand-bg)',
  // Missing mappings for existing apps
  'bg-amber-700':  'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(180,83,9,0.18) 0%, transparent 65%), var(--brand-bg)',
  'bg-slate-600':  'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(71,85,105,0.15) 0%, transparent 65%), var(--brand-bg)',
  'bg-pink-500':   'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(236,72,153,0.18) 0%, transparent 65%), var(--brand-bg)',
  'bg-emerald-600':'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(5,150,105,0.15) 0%, transparent 65%), var(--brand-bg)',
  'bg-violet-600': 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,58,237,0.18) 0%, transparent 65%), var(--brand-bg)',
  // Somni — deep indigo night sky
  'bg-indigo-900': 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(49,46,129,0.25) 0%, transparent 65%), var(--brand-bg)',
}

const DEFAULT_GRADIENT =
  'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.12) 0%, transparent 65%), var(--brand-bg)'

export function getAppGradient(colorClass: string): string {
  return GRADIENT_MAP[colorClass] ?? DEFAULT_GRADIENT
}
