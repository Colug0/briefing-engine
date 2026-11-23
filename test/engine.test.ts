import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Type from 'typebox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shipOffset } from '../src/engine/context.js'
import { Engine } from '../src/engine/engine.js'
import { Registry } from '../src/engine/registry.js'
import { runBriefing } from '../src/engine/runner.js'
import { Store } from '../src/engine/store.js'
import { formatDate, formatTime, localParts, offsetMinutes, parseClock } from '../src/engine/time.js'
import type { Briefing, ContentType, TriggerType } from '../src/engine/types.js'
import { compass, fallbackDisplay, speechify, toDisplayValue } from '../src/engine/units.js'
import { createRegistry } from '../src/types.js'
import { fakeCtx } from './fake.js'

describe('ship time', () => {
  it('reads (-)hhmm offsets', () => {
    expect(offsetMinutes(1200)).toBe(720)
    expect(offsetMinutes(-330)).toBe(-210)
    expect(offsetMinutes(545)).toBe(345)
    expect(offsetMinutes(0)).toBe(0)
    expect(offsetMinutes(1260)).toBeUndefined()
    expect(offsetMinutes('1200')).toBeUndefined()
    expect(offsetMinutes(12.5)).toBeUndefined()
  })

  it('formats local time and date across midnight', () => {
    const d = new Date('2026-11-22T17:33:00Z')
    expect(formatTime(d, 720)).toBe('05:33')
    expect(formatDate(d, 720)).toBe('Mon 23 Nov')
    expect(localParts(d, 720).isoDate).toBe('2026-11-23')
    expect(localParts(d, 0).isoDate).toBe('2026-11-22')
  })

  it('parses clock times', () => {
    expect(parseClock('07:00')).toBe(420)
    expect(parseClock('7:05')).toBe(425)
    expect(parseClock('24:00')).toBeUndefined()
    expect(parseClock('noon')).toBeUndefined()
  })

  it('prefers a configured timezone source over the current value', () => {
    // As seen on a real server: two plugins disagree, the wrong one is current.
    const leaf = {
      value: 0,
      $source: 'plugin-b',
      values: { 'plugin-a.timezone': { value: 1200 }, 'plugin-b': { value: 0 } }
    }
    expect(shipOffset(leaf)).toEqual({ minutes: 0, source: 'plugin-b' })
    expect(shipOffset(leaf, 'plugin-a')).toEqual({ minutes: 720, source: 'plugin-a.timezone' })
    expect(shipOffset(leaf, 'not-there')).toEqual({ minutes: 0, source: 'plugin-b' })
    expect(shipOffset(undefined)).toBeUndefined()
  })
})

describe('units', () => {
  it('formats display values', () => {
    expect(toDisplayValue(12.567, 'V', '0.00').text).toBe('12.57 V')
    expect(toDisplayValue(87.4, '%', '0').text).toBe('87%')
    expect(fallbackDisplay('ratio', 0.874).text).toBe('87%')
    expect(fallbackDisplay('K', 300.15).text).toBe('27.0 °C')
    expect(fallbackDisplay('s', 113460).text).toBe('31.5 h')
    expect(compass(Math.PI * 0.75)).toBe('SE')
  })

  it('makes text speakable', () => {
    expect(speechify('Wind 15.0 kn, 27.0 °C, 87%')).toBe('Wind 15.0 knots, 27.0 degrees, 87 percent')
  })
})

describe('store', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'briefing-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('saves, clones disabled, deletes and keeps state per briefing', async () => {
    const store = new Store(dir, 2)
    await store.load()
    const b = store.saveBriefing({ name: 'Morning', enabled: true, triggers: [], contents: [], deliveries: [] })
    const copy = store.cloneBriefing(b.id)!
    expect(copy).toMatchObject({ name: 'Morning (copy)', enabled: false })
    expect(copy.id).not.toBe(b.id)
    store.set(`${b.id}/0/schedule`, '2026-11-23')
    expect(store.deleteBriefing(b.id)).toBe(true)
    expect(store.get(`${b.id}/0/schedule`)).toBeUndefined()
    await store.flush()

    const again = new Store(dir, 2)
    await again.load()
    expect(again.listBriefings().map((x) => x.name)).toEqual(['Morning (copy)'])
  })

  it('keeps only the newest runs', async () => {
    const store = new Store(dir, 2)
    await store.load()
    for (const id of ['a', 'b', 'c']) {
      store.addRun({ id, briefingId: 'x', briefingName: 'x', at: '', reason: '', blocks: [], deliveries: [] })
    }
    expect(store.listRuns().map((r) => r.id)).toEqual(['c', 'b'])
    await store.flush()
    expect(JSON.parse(await readFile(join(dir, 'runs.json'), 'utf8'))).toHaveLength(2)
  })
})

const slow: ContentType = {
  id: 'slow',
  title: 'Slow',
  description: '',
  schema: Type.Object({}),
  fetch: () => new Promise(() => {})
}
const broken: ContentType = {
  id: 'broken',
  title: 'Broken',
  description: '',
  schema: Type.Object({}),
  fetch: async () => {
    throw new Error('sensor offline')
  }
}
const ok: ContentType = {
  id: 'ok',
  title: 'Ok',
  description: '',
  schema: Type.Object({}),
  fetch: async () => ({ title: 'Ok', text: 'All good.' })
}

describe('runner', () => {
  it('reports slow and failing blocks without stopping the briefing', async () => {
    const registry = new Registry({ triggers: [], contents: [slow, broken, ok], deliveries: [] })
    const ctx = fakeCtx()
    const briefing: Briefing = {
      id: 'b1',
      name: 'Test',
      enabled: true,
      triggers: [],
      contents: [{ type: 'slow', config: {} }, { type: 'broken', config: {} }, { type: 'ok', config: {} }, { type: 'gone', config: {} }],
      deliveries: [{ type: 'missing', config: {} }]
    }
    const runs: unknown[] = []
    const run = await runBriefing(ctx, registry, briefing, 'test', { contentTimeoutMs: 50 }, (r) => runs.push(r))
    expect(run.blocks.map((b) => b.text)).toEqual([
      'Slow: not available (no answer within 0 s).',
      'Broken: not available (sensor offline).',
      'All good.',
      'Unknown content type.'
    ])
    expect(run.blocks.map((b) => Boolean(b.error))).toEqual([true, true, false, true])
    expect(run.deliveries).toEqual([{ type: 'missing', ok: false, error: 'unknown type' }])
    expect(runs).toHaveLength(1)
  })
})

describe('runner defaults', () => {
  it('fills settings a briefing saved by an older version lacks', async () => {
    const seen: unknown[] = []
    const withDefaults: ContentType = {
      id: 'd',
      title: 'D',
      description: '',
      schema: Type.Object({ added: Type.Integer({ default: 70 }) }),
      fetch: async (_ctx, config) => {
        seen.push(config)
        return { title: 'D', text: 'ok' }
      }
    }
    const registry = new Registry({ triggers: [], contents: [withDefaults], deliveries: [] })
    const briefing: Briefing = { id: 'b', name: 'B', enabled: true, triggers: [], contents: [{ type: 'd', config: {} }], deliveries: [] }
    await runBriefing(fakeCtx(), registry, briefing, 'test', { contentTimeoutMs: 1000 }, () => {})
    expect(seen).toEqual([{ added: 70 }])
  })
})

describe('registry', () => {
  it('fills defaults and reports problems', () => {
    const registry = createRegistry()
    const good = registry.validate({
      name: ' Morning ',
      triggers: [{ type: 'schedule', config: { time: '06:30' } }],
      contents: [{ type: 'sun' }],
      deliveries: [{ type: 'notification', config: {} }]
    })
    expect('briefing' in good && good.briefing).toMatchObject({
      name: 'Morning',
      enabled: true,
      triggers: [{ type: 'schedule', config: { time: '06:30', days: [], internet: 'any' } }],
      contents: [{ type: 'sun', config: { twilight: true } }],
      deliveries: [{ type: 'notification', config: { state: 'normal', method: ['visual'] } }]
    })

    const bad = registry.validate({ name: '', triggers: [{ type: 'schedule', config: { time: 'later' } }], contents: [{ type: 'nope' }] })
    expect('errors' in bad && bad.errors).toEqual([
      'name is required',
      expect.stringContaining('triggers[0] schedule/time'),
      'contents[0]: unknown type nope'
    ])
  })

  it('describes every type with a schema', () => {
    const d = createRegistry().describe()
    expect(d.triggers.map((t) => t.id)).toEqual(['schedule', 'path'])
    expect(d.contents.map((t) => t.id)).toEqual(['position', 'battery', 'tanks', 'sun', 'moon', 'tides', 'weather', 'path'])
    expect(d.deliveries.map((t) => t.id)).toEqual(['webapp', 'notification'])
    for (const t of [...d.triggers, ...d.contents, ...d.deliveries]) expect(t.schema).toMatchObject({ type: 'object' })
  })
})

describe('engine', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'briefing-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('starts triggers of enabled briefings only and runs on fire', async () => {
    let fire: ((reason: string) => void) | undefined
    const started: string[] = []
    const manual: TriggerType = {
      id: 'manual',
      title: 'Manual',
      description: '',
      schema: Type.Object({}),
      start(_ctx, _cfg, f, key) {
        started.push(key)
        fire = f
        return () => started.push(`stop ${key}`)
      }
    }
    const registry = new Registry({ triggers: [manual], contents: [ok], deliveries: [] })
    const store = new Store(dir, 10)
    await store.load()
    const on = store.saveBriefing({ name: 'On', enabled: true, triggers: [{ type: 'manual', config: {} }], contents: [{ type: 'ok', config: {} }], deliveries: [] })
    store.saveBriefing({ name: 'Off', enabled: false, triggers: [{ type: 'manual', config: {} }], contents: [], deliveries: [] })
    const engine = new Engine(fakeCtx(), registry, store, { contentTimeoutMs: 1000 })
    engine.sync()
    expect(started).toEqual([`${on.id}/0/manual`])

    fire!('pressed')
    await new Promise((r) => setTimeout(r, 10))
    expect(store.listRuns()).toMatchObject([{ briefingName: 'On', reason: 'pressed', blocks: [{ text: 'All good.' }] }])

    engine.stop()
    expect(started.at(-1)).toBe(`stop ${on.id}/0/manual`)
    await store.flush()
  })
})
