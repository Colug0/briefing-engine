import Form from '@rjsf/core'
import type { RJSFSchema, UiSchema } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import { useEffect } from 'react'
import { create } from 'zustand'
import { api, type Briefing, type Part, type TypeInfo } from './api'
import { useStore } from './store'

type Kind = 'triggers' | 'contents' | 'deliveries'
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

/** The draft being edited, kept outside the component so leaving the view does not lose it. */
const useDraft = create<{ draft?: Draft; forId?: string; set(d: Draft | undefined, forId?: string): void }>((set) => ({
  set: (draft, forId) => set({ draft, forId })
}))

const SECTIONS: Array<{ kind: Kind; title: string; one: string; hint: string }> = [
  { kind: 'triggers', title: 'Triggers', one: 'trigger', hint: 'When the briefing runs. Without a trigger it only runs with “Run now”.' },
  { kind: 'contents', title: 'Content', one: 'content', hint: 'What the briefing says, in this order.' },
  { kind: 'deliveries', title: 'Deliveries', one: 'delivery', hint: 'Where the briefing goes.' }
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

function PartEditor({
  info,
  part,
  onChange,
  onRemove,
  onMove
}: {
  info?: TypeInfo
  part: Part
  onChange(config: Record<string, unknown>): void
  onRemove(): void
  onMove(delta: -1 | 1): void
}) {
  const schema = info?.schema as RJSFSchema | undefined
  const hasFields = Boolean(schema && Object.keys((schema.properties as object) ?? {}).length)
  return (
    <div className="part">
      <div className="part-head">
        <strong>{info?.title ?? `${part.type} (unknown)`}</strong>
        <span className="part-buttons">
          <button title="Move up" onClick={() => onMove(-1)}>
            ↑
          </button>
          <button title="Move down" onClick={() => onMove(1)}>
            ↓
          </button>
          <button title="Remove" className="danger" onClick={onRemove}>
            ✕
          </button>
        </span>
      </div>
      {info && <p className="muted">{info.description}</p>}
      {schema && hasFields && (
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
      )}
    </div>
  )
}

export function Editor({ id }: { id?: string }) {
  const { briefings, types, act, go } = useStore()
  const { draft, forId, set } = useDraft()

  useEffect(() => {
    if (draft && forId === id) return
    const existing = id ? briefings.find((b) => b.id === id) : undefined
    set(existing ? structuredClone(existing) : structuredClone(NEW), id)
  }, [id, briefings, draft, forId, set])

  if (!draft || !types) return <p className="muted">Loading…</p>

  const update = (patch: Partial<Draft>) => set({ ...draft, ...patch }, id)
  const updateParts = (kind: Kind, parts: Part[]) => update({ [kind]: parts } as Partial<Draft>)

  const save = async () => {
    const ok = await act('save', () => (draft.id ? api.update(draft as Briefing) : api.create(draft)))
    if (ok) {
      set(undefined)
      go({ name: 'briefings' })
    }
  }

  return (
    <section className="editor">
      <label className="field">
        Name
        <input value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="Morning briefing" />
      </label>
      <label className="switch">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        Enabled
      </label>

      {SECTIONS.map(({ kind, title, one, hint }) => (
        <fieldset key={kind}>
          <legend>{title}</legend>
          <p className="muted">{hint}</p>
          {draft[kind].map((part, i) => (
            <PartEditor
              key={`${kind}-${i}-${part.type}`}
              info={types[kind].find((t) => t.id === part.type)}
              part={part}
              onChange={(config) => updateParts(kind, draft[kind].map((p, j) => (j === i ? { ...p, config } : p)))}
              onRemove={() => updateParts(kind, draft[kind].filter((_, j) => j !== i))}
              onMove={(delta) => {
                const next = [...draft[kind]]
                const j = i + delta
                if (j < 0 || j >= next.length) return
                ;[next[i], next[j]] = [next[j]!, next[i]!]
                updateParts(kind, next)
              }}
            />
          ))}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) updateParts(kind, [...draft[kind], { type: e.target.value, config: {} }])
            }}
          >
            <option value="">+ Add {one}…</option>
            {types[kind].map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </fieldset>
      ))}

      <div className="actions">
        <button className="primary" onClick={() => void save()} disabled={!draft.name.trim()}>
          Save
        </button>
        <button
          onClick={() => {
            set(undefined)
            go({ name: 'briefings' })
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  )
}
