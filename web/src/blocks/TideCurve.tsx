import type { TideData } from '../../../src/contents/data'

const W = 300
const H = 70
const PAD = 8

/**
 * The tide between its turning points, drawn as half cosine waves, which is
 * how a tide runs between high and low water closely enough for a glance.
 */
export function TideCurve({ data }: { data: TideData }) {
  const pts = data.points.map((p) => ({ ...p, t: Date.parse(p.time) }))
  if (pts.length < 2) return null
  const t0 = pts[0]!.t
  const t1 = pts[pts.length - 1]!.t
  const levels = pts.map((p) => p.level)
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const x = (t: number) => PAD + ((t - t0) / (t1 - t0)) * (W - 2 * PAD)
  const y = (l: number) => H - 14 - ((l - lo) / (hi - lo || 1)) * (H - 30)
  const level = (t: number): number => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / (b.t - a.t)
        return a.level + (b.level - a.level) * (1 - Math.cos(Math.PI * f)) / 2
      }
    }
    return pts[pts.length - 1]!.level
  }
  const steps = 60
  const path = Array.from({ length: steps + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / steps
    return `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(level(t)).toFixed(1)}`
  }).join(' ')
  const now = Date.parse(data.now)
  const showNow = now >= t0 && now <= t1
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tide curve" className="tide">
      <line x1={PAD} y1={H - 12} x2={W - PAD} y2={H - 12} stroke="var(--line)" />
      <path d={path} fill="none" stroke="var(--water)" strokeWidth="2" />
      {showNow && (
        <>
          <line x1={x(now)} y1="2" x2={x(now)} y2={H - 12} stroke="var(--muted)" strokeDasharray="2 3" />
          <circle cx={x(now)} cy={y(level(now))} r="3.5" fill="var(--water)" />
        </>
      )}
      {pts.map((p) => (
        <circle key={p.time} cx={x(p.t)} cy={y(p.level)} r="2.5" fill="var(--water-dark)" />
      ))}
    </svg>
  )
}
