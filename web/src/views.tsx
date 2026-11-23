import { useEffect } from 'react'
import { api } from './api'
import { RunCard } from './RunCard'
import { useStore } from './store'

/** Front page: the latest briefings that are delivered to the webapp. */
export function Home() {
  const { runs, loadRuns, briefings, go } = useStore()
  useEffect(() => {
    void loadRuns()
  }, [loadRuns])
  const shown = runs.filter((r) => r.deliveries.some((d) => d.type === 'webapp'))
  const [latest, ...older] = shown
  if (!latest)
    return (
      <section className="empty">
        <p>No briefing yet.</p>
        {briefings.length === 0 ? (
          <button onClick={() => go({ name: 'edit' })}>Create your first briefing</button>
        ) : (
          <p className="muted">Briefings with the “Webapp” delivery appear here once they have run. Use “Run now” in Briefings to test one.</p>
        )}
      </section>
    )
  return (
    <section>
      <RunCard run={latest} large />
      {older.slice(0, 5).map((r) => (
        <RunCard key={r.id} run={r} />
      ))}
    </section>
  )
}

export function Briefings() {
  const { briefings, types, busy, act, go } = useStore()
  const title = (kind: 'triggers' | 'contents' | 'deliveries', id: string) =>
    types?.[kind].find((t) => t.id === id)?.title ?? id

  return (
    <section>
      <div className="toolbar">
        <button onClick={() => go({ name: 'edit' })}>New briefing</button>
      </div>
      {briefings.length === 0 && <p className="muted">No briefings yet.</p>}
      {briefings.map((b) => (
        <article key={b.id} className={b.enabled ? 'card' : 'card disabled'}>
          <header>
            <h3>{b.name}</h3>
            <label className="switch">
              <input
                type="checkbox"
                checked={b.enabled}
                disabled={busy[`toggle-${b.id}`]}
                onChange={() => void act(`toggle-${b.id}`, () => api.update({ ...b, enabled: !b.enabled }))}
              />
              {b.enabled ? 'Enabled' : 'Disabled'}
            </label>
          </header>
          <p className="muted">
            {b.triggers.map((t) => title('triggers', t.type)).join(', ') || 'No trigger (run manually)'} →{' '}
            {b.contents.map((c) => title('contents', c.type)).join(', ') || 'no content'} →{' '}
            {b.deliveries.map((d) => title('deliveries', d.type)).join(', ') || 'no delivery'}
          </p>
          <div className="actions">
            <button
              disabled={busy[`run-${b.id}`]}
              onClick={() => void act(`run-${b.id}`, () => api.run(b.id)).then((ok) => ok && go({ name: 'history', briefingId: b.id }))}
            >
              {busy[`run-${b.id}`] ? 'Running…' : 'Run now'}
            </button>
            <button onClick={() => go({ name: 'edit', id: b.id })}>Edit</button>
            <button onClick={() => void act(`clone-${b.id}`, () => api.clone(b.id))}>Clone</button>
            <button onClick={() => go({ name: 'history', briefingId: b.id })}>History</button>
            <button
              className="danger"
              onClick={() => {
                if (confirm(`Delete briefing “${b.name}”?`)) void act(`delete-${b.id}`, () => api.remove(b.id))
              }}
            >
              Delete
            </button>
          </div>
        </article>
      ))}
    </section>
  )
}

export function History({ briefingId }: { briefingId?: string }) {
  const { runs, loadRuns, briefings, go } = useStore()
  useEffect(() => {
    void loadRuns(briefingId)
  }, [briefingId, loadRuns])
  const name = briefingId ? briefings.find((b) => b.id === briefingId)?.name : undefined
  return (
    <section>
      <div className="toolbar">
        <span>{name ? `History of “${name}”` : 'All briefings'}</span>
        {briefingId && <button onClick={() => go({ name: 'history' })}>Show all</button>}
      </div>
      {runs.length === 0 && <p className="muted">Nothing has run yet.</p>}
      {runs.map((r) => (
        <RunCard key={r.id} run={r} />
      ))}
    </section>
  )
}
