import Type from 'typebox'
import { describe, expect, it } from 'vitest'
import { notificationDelivery } from '../src/deliveries/notification.js'
import { moonEmoji } from '../src/contents/moon.js'
import { flushPending, ntfyDelivery, priorityFor } from '../src/deliveries/ntfy.js'
import { markdownLayout, plainLayout } from '../src/engine/layout.js'
import { INTERNET_PATH } from '../src/engine/internet.js'
import { Registry } from '../src/engine/registry.js'
import { runBriefing, withAge } from '../src/engine/runner.js'
import type { Briefing, ContentType, RunResult } from '../src/engine/types.js'
import { fakeCtx } from './fake.js'

const run = (over: Partial<RunResult> = {}): RunResult => ({
  id: 'r1',
  briefingId: 'b1',
  briefingName: 'Morning',
  at: '2026-11-23T19:00:00Z',
  reason: 'test',
  blocks: [
    { type: 'sun', title: 'Sun', text: 'Sunrise 05:33.' },
    { type: 'storms', title: 'Storms', text: 'Cyclone near.', severity: 'warn' }
  ],
  deliveries: [],
  ...over
})

const target = (server: string, enabled = true) => ({ enabled, server, topic: 'boat', token: undefined as string | undefined })
type NtfyConfig = Parameters<typeof ntfyDelivery.deliver>[1]
const config = (over: Partial<NtfyConfig> = {}): NtfyConfig => ({
  local: target('http://ntfy.local'),
  internet: target('https://ntfy.sh', false),
  priority: 3,
  escalate: true,
  markdown: false,
  ...over
})

const ok = async () => new Response('{}', { status: 200 })

describe('ntfy delivery', () => {
  it('posts the briefing to the server on board, with title and raised priority', async () => {
    const ctx = fakeCtx({ [INTERNET_PATH]: 'offline' }, { http: ok })
    const note = await ntfyDelivery.deliver(ctx, config({ click: 'http://boat.local/briefing-engine/' }), run({ severity: 'warn' }))
    expect(note).toBeUndefined()
    expect(ctx.requests).toHaveLength(1)
    expect(ctx.requests[0]!.url).toBe('http://ntfy.local')
    expect(JSON.parse(String(ctx.requests[0]!.init!.body))).toEqual({
      topic: 'boat',
      title: 'Morning',
      message: 'Sunrise 05:33.\n⚠️ Cyclone near.',
      priority: 4,
      tags: ['warning'],
      click: 'http://boat.local/briefing-engine/'
    })
  })

  it('lets the internet server wait while offline and sends the newest once online', async () => {
    const ctx = fakeCtx({ [INTERNET_PATH]: 'offline' }, { http: ok })
    const cfg = config({ local: target('http://ntfy.local', false), internet: { ...target('https://ntfy.sh'), token: 'tk' } })
    expect(await ntfyDelivery.deliver(ctx, cfg, run())).toBe('internet server: waiting for a connection')
    expect(await ntfyDelivery.deliver(ctx, cfg, run({ id: 'r2', at: '2026-11-23T20:00:00Z', briefingName: 'Evening' }))).toContain('waiting')
    expect(ctx.requests).toHaveLength(0)
    ctx.values.set(INTERNET_PATH, 'metered')
    await flushPending(ctx)
    expect(ctx.requests).toHaveLength(1)
    expect((ctx.requests[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer tk')
    expect(JSON.parse(String(ctx.requests[0]!.init!.body)).title).toBe('Evening')
    expect(ctx.stateData.get('ntfy/pending')).toEqual({})
  })

  it('sends a waiting message once when flushes overlap, and keeps one queued meanwhile', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const ctx = fakeCtx({ [INTERNET_PATH]: 'offline' }, { http: async () => (await gate, new Response('{}')) })
    const cfg = config({ local: target('', false), internet: target('https://ntfy.sh') })
    await ntfyDelivery.deliver(ctx, cfg, run())
    ctx.values.set(INTERNET_PATH, 'online')
    const a = flushPending(ctx)
    const b = flushPending(ctx)
    // A newer run is queued while the older one is on its way.
    ctx.values.set(INTERNET_PATH, 'offline')
    await ntfyDelivery.deliver(ctx, cfg, run({ id: 'r2', at: '2026-11-23T21:00:00Z', briefingName: 'Evening' }))
    release()
    await Promise.all([a, b])
    expect(ctx.requests).toHaveLength(1)
    expect(Object.values(ctx.stateData.get('ntfy/pending') as Record<string, { msg: { title: string } }>).map((p) => p.msg.title)).toEqual(['Evening'])
  })

  it('drops an older waiting run once a newer one went through', async () => {
    let fail = true
    const ctx = fakeCtx({}, { http: async () => (fail ? new Response('busy', { status: 503 }) : new Response('{}')) })
    const cfg = config({ local: target('', false), internet: target('https://ntfy.sh') })
    expect(await ntfyDelivery.deliver(ctx, cfg, run())).toContain('waiting')
    fail = false
    await ntfyDelivery.deliver(ctx, cfg, run({ id: 'r2', at: '2026-11-23T21:00:00Z' }))
    expect(ctx.stateData.get('ntfy/pending')).toEqual({})
  })

  it('keeps a waiting message after a server error and drops it after a refusal or 24 h', async () => {
    let status = 503
    const ctx = fakeCtx(
      { [INTERNET_PATH]: 'offline' },
      { http: async () => new Response('busy', { status }), now: '2026-11-23T20:00:00Z' }
    )
    const cfg = config({ local: target('', false), internet: target('https://ntfy.sh') })
    await ntfyDelivery.deliver(ctx, cfg, run())
    ctx.values.set(INTERNET_PATH, 'online')
    await flushPending(ctx)
    expect(Object.keys(ctx.stateData.get('ntfy/pending') as object)).toHaveLength(1)
    status = 403
    await flushPending(ctx)
    expect(ctx.stateData.get('ntfy/pending')).toEqual({})

    ctx.values.set(INTERNET_PATH, 'offline')
    await ntfyDelivery.deliver(ctx, cfg, run())
    ctx.clock.now = new Date('2026-11-24T21:00:00Z')
    ctx.values.set(INTERNET_PATH, 'online')
    await flushPending(ctx)
    expect(ctx.requests).toHaveLength(2)
    expect(ctx.stateData.get('ntfy/pending')).toEqual({})
  })

  it('fails when the server on board refuses or nothing is set up', async () => {
    const ctx = fakeCtx({}, { http: async () => new Response('forbidden', { status: 403 }) })
    await expect(ntfyDelivery.deliver(ctx, config(), run())).rejects.toThrow('http://ntfy.local: HTTP 403 forbidden')
    await expect(ntfyDelivery.deliver(ctx, config({ local: target('', true) }), run())).rejects.toThrow('no server with topic')
  })

  it('raises the priority only when asked', () => {
    expect(priorityFor(3, 'warn', true)).toBe(4)
    expect(priorityFor(3, 'alarm', true)).toBe(5)
    expect(priorityFor(5, 'warn', true)).toBe(5)
    expect(priorityFor(2, 'alarm', false)).toBe(2)
    expect(priorityFor(2, undefined, true)).toBe(2)
  })
})

describe('layout for push messages', () => {
  const layoutRun = run({
    severity: 'warn',
    blocks: [
      { type: 'battery', title: 'Batteries', text: 'Batteries. House: 87%.', emoji: '🔋', summary: 'Batteries', items: ['House · 87% · 12.9 V', 'Starter · 12.7 V'] },
      { type: 'moon', title: 'Moon', text: 'Moon: full.', emoji: '🌕', summary: 'full moon · 100% lit' },
      { type: 'bulletin', title: 'Bulletin', text: '…', emoji: '📢', severity: 'warn', summary: 'Fiji Met', items: ['⚠️ Strong wind warning'] },
      { type: 'tides', title: 'Tides', text: 'Tides: not available (no data).', emoji: '🌊', error: 'no data', items: ['x'] }
    ]
  })

  it('writes one line per block with its parts below', () => {
    expect(plainLayout(layoutRun)).toBe(
      ['🔋 Batteries', '  • House · 87% · 12.9 V', '  • Starter · 12.7 V', '🌕 full moon · 100% lit', '📢 ⚠️ Fiji Met', '  • ⚠️ Strong wind warning', '🌊 Tides: not available (no data).'].join('\n')
    )
  })

  it('writes Markdown with bold headings and lists when asked', async () => {
    expect(markdownLayout(layoutRun)).toBe(
      ['**🔋 Batteries**\n- House · 87% · 12.9 V\n- Starter · 12.7 V', '🌕 full moon · 100% lit', '**📢 ⚠️ Fiji Met**\n- ⚠️ Strong wind warning', '🌊 Tides: not available \\(no data\\).']
        .join('\n\n')
        .replace('\\(no data\\)', '(no data)')
    )
    const ctx = fakeCtx({}, { http: ok })
    await ntfyDelivery.deliver(ctx, config({ markdown: true }), layoutRun)
    expect(JSON.parse(String(ctx.requests[0]!.init!.body))).toMatchObject({ markdown: true, tags: ['warning'] })
  })

  it('shows the moon as it looks', () => {
    expect([0, 0.25, 0.5, 0.75, 0.97].map((phase) => moonEmoji({ phase, southern: false }))).toEqual(['🌑', '🌓', '🌕', '🌗', '🌑'])
  })
})

describe('severity and offline data', () => {
  it('raises the notification state for a warning', async () => {
    const ctx = fakeCtx()
    await notificationDelivery.deliver(ctx, { state: 'normal', method: ['visual'], escalate: true }, run({ severity: 'alarm' }))
    await notificationDelivery.deliver(ctx, { state: 'normal', method: ['visual'], escalate: false }, run({ severity: 'alarm' }))
    expect(ctx.published.map((p) => (p.value as { state: string }).state)).toEqual(['alarm', 'normal'])
  })

  it('gives a run the most urgent severity and says how old offline data is', async () => {
    let online = true
    const web: ContentType = {
      id: 'web',
      title: 'Web',
      description: '',
      schema: Type.Object({}),
      async fetch(ctx) {
        const r = await ctx.cached('web', async () => {
          if (!online) throw new Error('down')
          return 'fresh'
        })
        return { title: 'Web', text: `Got ${String(r.value)}.`, asOf: r.fromCache ? r.at.toISOString() : undefined, severity: 'warn' }
      }
    }
    const registry = new Registry({ triggers: [], contents: [web], deliveries: [] })
    const briefing: Briefing = { id: 'b', name: 'B', enabled: true, triggers: [], contents: [{ type: 'web', config: {} }], deliveries: [] }
    const ctx = fakeCtx({}, { now: '2026-11-23T18:00:00Z' })
    const first = await runBriefing(ctx, registry, briefing, 't', { contentTimeoutMs: 1000 }, () => {})
    expect(first.severity).toBe('warn')
    expect(first.blocks[0]!.text).toBe('Got fresh.')
    online = false
    ctx.clock.now = new Date('2026-11-23T21:00:00Z')
    const later = await runBriefing(ctx, registry, briefing, 't', { contentTimeoutMs: 1000 }, () => {})
    expect(later.blocks[0]!.text).toBe('Got fresh. (as of 06:00, 3 h ago)')
    ctx.values.set(INTERNET_PATH, 'offline')
    ctx.clock.now = new Date('2026-11-25T21:00:00Z')
    const tooOld = await runBriefing(ctx, registry, briefing, 't', { contentTimeoutMs: 1000 }, () => {})
    expect(tooOld.blocks[0]!.text).toBe('Web: not available (offline and no recent data).')
    expect(withAge(ctx, 'x', ctx.clock.now.toISOString())).toBe('x')
  })
})
