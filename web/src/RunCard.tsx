import type { Run } from './api'
import { Blocks } from './blocks'

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function RunCard({ run, large = false }: { run: Run; large?: boolean }) {
  const failed = run.deliveries.filter((d) => !d.ok)
  return (
    <article className={large ? 'card run large' : 'card run'}>
      <header>
        <h3>{run.briefingName}</h3>
        <span className="muted">
          {when(run.at)} · {run.reason}
        </span>
      </header>
      <Blocks blocks={run.blocks} />
      {failed.length > 0 && (
        <p className="warn">
          Not delivered: {failed.map((d) => `${d.type} (${d.error ?? 'failed'})`).join(', ')}
        </p>
      )}
    </article>
  )
}
