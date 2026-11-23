import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from './Editor'
import { useStore, type View } from './store'
import { Briefings, History, Home } from './views'
import './style.css'

const TABS: Array<{ view: View; label: string }> = [
  { view: { name: 'home' }, label: 'Latest' },
  { view: { name: 'briefings' }, label: 'Briefings' },
  { view: { name: 'history' }, label: 'History' }
]

function StatusLine() {
  const status = useStore((s) => s.status)
  if (!status) return null
  const notes: string[] = []
  if (!status.timezone) notes.push('no ship timezone (environment.time.timezoneOffset), times are UTC')
  if (status.internet === null) notes.push('no internet state (signalk-internet), schedules do not wait for a connection')
  if (!status.weatherApi) notes.push('no weather API')
  return notes.length ? <p className="status">{notes.join(' · ')}</p> : null
}

function App() {
  const { view, go, load, error, clearError } = useStore()
  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <nav>
        <strong>Briefing Engine</strong>
        {TABS.map((t) => (
          <button key={t.label} className={view.name === t.view.name ? 'active' : ''} onClick={() => go(t.view)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        <StatusLine />
        {error && (
          <p className="error" onClick={clearError}>
            {error}
          </p>
        )}
        {view.name === 'home' && <Home />}
        {view.name === 'briefings' && <Briefings />}
        {view.name === 'edit' && <Editor id={view.id} />}
        {view.name === 'history' && <History briefingId={view.briefingId} />}
      </main>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
