import Form from '@rjsf/core'
import type { RJSFSchema, UiSchema } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconChevronDown, IconCopy, IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect } from 'react'
import { create } from 'zustand'
import { api, type Briefing, type Part, type TypeInfo } from './api'
import { iconFor, summarize, type Kind } from './parts'
import { useStore } from './store'

type Draft = Omit<Briefing, 'id'> & { id?: string }

const NEW: Draft = {
  name: '',
  enabled: true,
  triggers: [{ type: 'schedule', config: {} }],
  contents: [],
  deliveries: [
    { type: 'webapp', config: {} },
    { type: 'notification', config: {} }
  ]
}

interface DraftState {
  draft?: Draft
  forId?: string
  /** Open parts, as "kind:index". */
  open: string[]
  /** Which kind shows its list of types to add. */
  adding?: Kind
  set(d: Draft | undefined, forId?: string): void
  setOpen(open: string[]): void
  setAdding(kind: Kind | undefined): void
}

/** The draft being edited, kept outside the component so leaving the view does not lose it. */
const useDraft = create<DraftState>((set) => ({
  open: [],
  set: (draft, forId) => set({ draft, forId }),
  setOpen: (open) => set({ open }),
  setAdding: (adding) => set({ adding })
}))

const SECTIONS: Array<{ kind: Kind; title: string; one: string; hint: string }> = [
  { kind: 'triggers', title: 'When it runs', one: 'trigger', hint: 'Without a trigger the briefing only runs with “Test run” or “Run now”.' },
  { kind: 'contents', title: 'What it says', one: 'content', hint: 'In this order.' },
  { kind: 'deliveries', title: 'Where it goes', one: 'delivery', hint: '' }
]

/** Lists of fixed choices (weekdays, methods) as checkboxes instead of a multi-select box. */
function uiSchemaFor(schema: RJSFSchema): UiSchema {
  const ui: UiSchema = {}
  for (const [key, prop] of Object.entries((schema.properties ?? {}) as Record<string, RJSFSchema>)) {
    const items = prop.items as RJSFSchema | undefined
    if (prop.type === 'array' && items && Array.isArray(items.enum)) ui[key] = { 'ui:widget': 'checkboxes', 'ui:options': { inline: true } }
  }
  return ui
}

function PartCard({
  kind,
  info,
  part,
  open,
  first,
  last,
  onToggle,
  onChange,
  onRemove,
  onMove,
  onCopy
}: {
  kind: Kind
  info?: TypeInfo
  part: Part
  open: boolean
  first: boolean
  last: boolean
  onToggle(): void
  onChange(config: Record<string, unknown>): void
  onRemove(): void
  onMove(delta: -1 | 1): void
  onCopy(): void
}) {
  const schema = info?.schema as RJSFSchema | undefined
  const hasFields = Boolean(schema && Object.keys((schema.properties as object) ?? {}).length)
  const Icon = iconFor(kind, part.type)
  const title = info?.title ?? `${part.type} (unknown)`
  const summary = summarize(schema, part.config) || info?.description
  return (
    <div className={open ? 'part open' : 'part'}>
      <div className="part-head">
        <button className="part-toggle" aria-expanded={open} onClick={onToggle}>
          <Icon className="part-icon" size={20} aria-hidden />
          <span className="part-title">{title}</span>
          <span className="part-summary">{open ? '' : summary}</span>
          <IconChevronDown className="chevron" size={18} aria-hidden />
        </button>
        <span className="part-buttons">
          <button className="icon" title="Move up" aria-label={`Move ${title} up`} disabled={first} onClick={() => onMove(-1)}>
            <IconArrowUp size={16} />
          </button>
          <button className="icon" title="Move down" aria-label={`Move ${title} down`} disabled={last} onClick={() => onMove(1)}>
            <IconArrowDown size={16} />
          </button>
          <button className="icon" title="Duplicate" aria-label={`Duplicate ${title}`} onClick={onCopy}>
            <IconCopy size={16} />
          </button>
          <button className="icon danger" title="Remove" aria-label={`Remove ${title}`} onClick={onRemove}>
            <IconTrash size={16} />
          </button>
        </span>
      </div>
      {open && (
        <div className="part-body">
          {info && <p className="muted">{info.description}</p>}
          {schema && hasFields ? (
            <Form
              schema={{ ...schema, title: undefined, description: undefined }}
              uiSchema={uiSchemaFor(schema)}
              formData={part.config}
              validator={validator}
              liveValidate
              showErrorList={false}
              onChange={(e) => onChange((e.formData ?? {}) as Record<string, unknown>)}
            >
              <></>
            </Form>
          ) : (
            <p className="muted">No settings.</p>
          )}
        </div>
      )}
    </div>
  )
}

export function Editor({ id }: { id?: string }) {
  const { briefings, types, act, go, error, busy } = useStore()
  const { draft, forId, set, open, setOpen, adding, setAdding } = useDraft()

  useEffect(() => {
    if (draft && forId === id) return
    const existing = id ? briefings.find((b) => b.id === id) : undefined
    set(existing ? structuredClone(existing) : structuredClone(NEW), id)
    // A new briefing starts with its trigger open, an existing one closed.
    setOpen(existing ? [] : NEW.triggers.map((_, i) => `triggers:${i}`))
    setAdding(undefined)
  }, [id, briefings, draft, forId, set, setOpen, setAdding])

  if (!draft || !types) return <p className="muted">Loading…</p>

  const update = (patch: Partial<Draft>) => set({ ...draft, ...patch }, id)
  const updateParts = (kind: Kind, parts: Part[]) => update({ [kind]: parts } as Partial<Draft>)
  const key = (kind: Kind, i: number) => `${kind}:${i}`
  /** Indexes shift when parts move or go; keep the same parts open. */
  const remap = (kind: Kind, map: (i: number) => number | undefined) =>
    open.flatMap((k) => {
      const [k0, n] = k.split(':')
      if (k0 !== kind) return [k]
      const j = map(Number(n))
      return j === undefined ? [] : [key(kind, j)]
    })
  const allKeys = SECTIONS.flatMap(({ kind }) => draft[kind].map((_, i) => key(kind, i)))
  const allOpen = allKeys.length > 0 && allKeys.every((k) => open.includes(k))

  const leave = () => {
    set(undefined)
    go({ name: 'briefings' })
  }
  const persist = async (): Promise<Briefing | undefined> => {
    let saved: Briefing | undefined
    const ok = await act('save', async () => {
      saved = draft.id ? await api.update(draft as Briefing) : await api.create(draft)
    })
    return ok ? saved : undefined
  }
  const save = async () => {
    if (await persist()) leave()
  }
  /** A test run is of what is on screen, so it saves first. */
  const testRun = async () => {
    const saved = await persist()
    if (!saved) return
    set({ ...draft, id: saved.id }, id)
    if (await act('test', () => api.run(saved!.id))) {
      set(undefined)
      go({ name: 'history', briefingId: saved.id })
    }
  }

  return (
    <section className="editor">
      <div className="editor-bar">
        <button className="icon" title="Back without saving" aria-label="Back without saving" onClick={leave}>
          <IconArrowLeft size={18} />
        </button>
        <input
          className="editor-name"
          aria-label="Name"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Morning briefing"
        />
        <label className="switch">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          {draft.enabled ? 'Enabled' : 'Disabled'}
        </label>
        <button onClick={() => void testRun()} disabled={!draft.name.trim() || busy.save || busy.test}>
          <IconPlayerPlay size={16} aria-hidden /> {busy.test ? 'Running…' : 'Test run'}
        </button>
        <button className="primary" onClick={() => void save()} disabled={!draft.name.trim() || busy.save}>
          Save
        </button>
      </div>
      {/* The page-wide message is at the top, out of sight after scrolling down. */}
      {error && <p className="error">{error}</p>}

      {SECTIONS.map(({ kind, title, one, hint }, n) => (
        <div key={kind} className="step">
          <h2 className="step-head">
            <span className="step-num">{n + 1}</span>
            {title}
            {n === 1 && allKeys.length > 0 && (
              <button className="link" onClick={() => setOpen(allOpen ? [] : allKeys)}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </h2>
          {hint && <p className="muted step-hint">{hint}</p>}
          {draft[kind].map((part, i) => (
            <PartCard
              key={`${kind}-${i}-${part.type}`}
              kind={kind}
              info={types[kind].find((t) => t.id === part.type)}
              part={part}
              open={open.includes(key(kind, i))}
              first={i === 0}
              last={i === draft[kind].length - 1}
              onToggle={() => setOpen(open.includes(key(kind, i)) ? open.filter((k) => k !== key(kind, i)) : [...open, key(kind, i)])}
              onChange={(config) => updateParts(kind, draft[kind].map((p, j) => (j === i ? { ...p, config } : p)))}
              onRemove={() => {
                updateParts(kind, draft[kind].filter((_, j) => j !== i))
                setOpen(remap(kind, (j) => (j === i ? undefined : j > i ? j - 1 : j)))
              }}
              onMove={(delta) => {
                const j = i + delta
                if (j < 0 || j >= draft[kind].length) return
                const next = [...draft[kind]]
                ;[next[i], next[j]] = [next[j]!, next[i]!]
                updateParts(kind, next)
                setOpen(remap(kind, (k) => (k === i ? j : k === j ? i : k)))
              }}
              onCopy={() => {
                const next = [...draft[kind]]
                next.splice(i + 1, 0, structuredClone(part))
                updateParts(kind, next)
                setOpen([...remap(kind, (k) => (k > i ? k + 1 : k)), key(kind, i + 1)])
              }}
            />
          ))}
          <button className="add" aria-expanded={adding === kind} onClick={() => setAdding(adding === kind ? undefined : kind)}>
            <IconPlus size={16} aria-hidden /> Add {one}
          </button>
          {adding === kind && (
            <div className="pick">
              {types[kind].map((t) => {
                const Icon = iconFor(kind, t.id)
                return (
                  <button
                    key={t.id}
                    title={t.description}
                    onClick={() => {
                      updateParts(kind, [...draft[kind], { type: t.id, config: {} }])
                      setOpen([...open, key(kind, draft[kind].length)])
                      setAdding(undefined)
                    }}
                  >
                    <Icon size={18} aria-hidden /> {t.title}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
