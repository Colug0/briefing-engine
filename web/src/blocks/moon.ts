/** Whether the moon is waxing: from its phase when known, else from its name, else unknown. */
export function waxingOf(phase: number | undefined, name: string | undefined): boolean | undefined {
  if (typeof phase === 'number') return phase < 0.5
  const n = name?.toLowerCase() ?? ''
  if (n.includes('waxing') || n.includes('first')) return true
  if (n.includes('waning') || n.includes('last') || n.includes('third')) return false
  // New and full moon look the same from either side.
  if (n.includes('new') || n.includes('full')) return true
  return undefined
}
