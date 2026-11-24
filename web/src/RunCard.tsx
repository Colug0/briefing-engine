import type { Run } from './api'
import { Blocks } from './blocks'

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function RunCard({ run, large = false }: { run: Run; large?: boolean }) {
  const failed = run.deliveries.filter((d) => !d.ok)
  const notes = run.deliveries.filter((d) => d.ok && d.note)
  const classes = ['card', 'run', large ? 'large' : '', run.severity ? `sev-${run.severity}` : ''].filter(Boolean).join(' ')
  return (
    <article className={classes}>
      <header>
        <h3>
          {run.briefingName}
          {run.severity && <span className={`badge sev-${run.severity}`}>{run.severity === 'alarm' ? 'Alarm' : 'Warning'}</span>}
        </h3>
        <span className="muted">
          {when(run.at)} · {run.reason}
        </span>
      </header>
      <Blocks blocks={run.blocks} />
      {notes.length > 0 && <p className="muted">{notes.map((d) => `${d.type}: ${d.note}`).join(' · ')}</p>}
      {failed.length > 0 && (
        <p className="warn">
          Not delivered: {failed.map((d) => `${d.type} (${d.error ?? 'failed'})`).join(', ')}
        </p>
      )}
    </article>
  )
}
