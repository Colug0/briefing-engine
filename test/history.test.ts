import { describe, expect, it, vi } from 'vitest'
import { ampHours, overnightContent, windowStart } from '../src/contents/overnight.js'
import { tankContent, yesterday } from '../src/contents/tanks.js'
import { readFileSync } from 'node:fs'
import { medianSmooth, totalUse } from '../src/engine/history.js'
import type { HistoryApiLike } from '../src/engine/types.js'
import { fakeCtx } from './fake.js'

/** A history provider that answers with fixed rows and records what it was asked. */
function fakeHistory(rows: Array<[string, ...Array<number | null>]>) {
  const asked: Array<Record<string, unknown>> = []
  const api: HistoryApiLike = {
    async getValues(query) {
      asked.push(query as Record<string, unknown>)
      return { data: rows }
    }
  }
  return { api, asked }
}

describe('time windows', () => {
  it('starts the night at the last 20:00 ship time at least an hour ago', () => {
    const cfg = { battery: 'house', window: 'since' as const, since: '20:00', hours: 10 }
    // 07:00 ship time at UTC+12 → since 20:00 yesterday.
    expect(windowStart(cfg, new Date('2026-11-23T19:00:00Z'), 720).toISOString()).toBe('2026-11-23T08:00:00.000Z')
    // 20:30 ship time → only 30 min since today's 20:00, so yesterday's.
    expect(windowStart(cfg, new Date('2026-11-24T08:30:00Z'), 720).toISOString()).toBe('2026-11-23T08:00:00.000Z')
    expect(windowStart({ ...cfg, window: 'last', hours: 6 }, new Date('2026-11-24T08:30:00Z'), 720).toISOString()).toBe(
      '2026-11-24T02:30:00.000Z'
    )
  })

  it('takes yesterday from ship midnight to midnight', () => {
    expect(yesterday(new Date('2026-11-23T19:00:00Z'), 720)).toEqual({
      from: new Date('2026-11-22T12:00:00Z'),
      to: new Date('2026-11-23T12:00:00Z')
    })
    expect(yesterday(new Date('2026-11-24T10:00:00Z'), -600).from.toISOString()).toBe('2026-11-23T10:00:00.000Z')
  })
})

describe('sums from history', () => {
  it('splits amp hours into used and charged', () => {
    expect(ampHours([-10, -10, null, 5], 1800)).toEqual({ used: 10, charged: 2.5 })
  })

  it('counts use as start minus end plus fills, and ignores the sender wobbling', () => {
    // Used 0.02, filled 0.07 at once, used 0.01 more.
    const steps = (...levels: number[]) => levels.flatMap((l) => [l, l, l])
    expect(totalUse(steps(0.1, 0.09, 0.08, 0.15, 0.14), 0.005)).toBeCloseTo(0.03)
    // A fill spread over two buckets counts once.
    expect(totalUse(steps(0.1, 0.08, 0.12, 0.15, 0.14), 0.005)).toBeCloseTo(0.03)
    // Wobble of ±3 L around 110 L is no use at all.
    expect(totalUse([0.111, 0.114, 0.111, 0.114, 0.111], 0.0045)).toBeCloseTo(0)
    expect(totalUse([0.1], 0.01)).toBeUndefined()
    // A real fuel sender's day at about 114 L, with single readings up to 150 L: hardly any use, no fills.
    const day = JSON.parse(readFileSync(new URL('./fixtures/fuel-volume-day.json', import.meta.url), 'utf8')) as Array<number | null>
    // 8 % of its 150 L tank is the fill threshold the tanks block uses.
    expect(totalUse(day, 0.012)! * 1000).toBeLessThan(1)
    expect(medianSmooth([1, 1, 9, 1, 1])).toEqual([1, 1, 1, 1, 1])
    // A fill is followed to its peak: used 0.02, filled 0.06.
    expect(totalUse(steps(0.1, 0.08, 0.12, 0.14), 0.03)).toBeCloseTo(0.02)
  })
})

describe('battery overnight', () => {
  it('reads the night from the History API', async () => {
    const { api, asked } = fakeHistory([
      ['2026-11-23T08:00:00Z', 0.92, -10, 12.9],
      ['2026-11-23T14:00:00Z', 0.8, -6, 12.6],
      ['2026-11-23T18:00:00Z', 0.71, 2, 12.41]
    ])
    const ctx = fakeCtx({}, { now: '2026-11-23T19:00:00Z', history: api })
    const block = await overnightContent.fetch(ctx, { battery: 'electrical.batteries.house', window: 'since', since: '20:00', hours: 10 })
    // Each row stands for one bucket of `resolution` seconds, as providers fill empty buckets with null.
    expect(block.text).toBe('House since 20:00: 92% → 71%, used 4 Ah, lowest 12.4 V.')
    const q = asked[0]!
    expect(String(q.from)).toBe('2026-11-23T08:00:00.000Z')
    expect(String(q.to)).toBe('2026-11-23T19:00:00.000Z')
    expect(q.resolution).toBe(825)
    expect(q.pathSpecs).toEqual([
      { path: 'electrical.batteries.house.capacity.stateOfCharge', aggregate: 'average', parameter: [] },
      { path: 'electrical.batteries.house.current', aggregate: 'average', parameter: [] },
      { path: 'electrical.batteries.house.voltage', aggregate: 'min', parameter: [] }
    ])
    expect(block.data).toMatchObject({ name: 'House', soc: [0.92, 0.8, 0.71] })
  })

  it('says when there is no history provider or no data', async () => {
    await expect(overnightContent.fetch(fakeCtx(), { battery: 'house', window: 'last', since: '20:00', hours: 8 })).rejects.toThrow(
      'no history provider'
    )
    const ctx = fakeCtx({}, { history: fakeHistory([['2026-11-23T08:00:00Z', null, null, null]]).api })
    await expect(overnightContent.fetch(ctx, { battery: 'house', window: 'last', since: '20:00', hours: 8 })).rejects.toThrow('no history for')
  })
})

describe('tanks yesterday', () => {
  it('adds what each tank used over the previous day', async () => {
    const { api, asked } = fakeHistory([
      ['2026-11-22T12:00:00Z', 0.12, 0.8, null, 0.5],
      ['2026-11-22T20:00:00Z', 0.11, 0.73, null, 0.45],
      ['2026-11-23T02:00:00Z', 0.15, 1, null, 0.4],
      ['2026-11-23T08:00:00Z', 0.145, 0.97, null, 0.4]
    ])
    const ctx = fakeCtx(
      { 'tanks.fuel.0.currentLevel': 0.74, 'tanks.fuel.0.currentVolume': 0.11, 'tanks.freshWater.0.currentLevel': 0.4 },
      { now: '2026-11-23T19:00:00Z', history: api }
    )
    const block = await tankContent.fetch(ctx, { tanks: ['fuel.0', 'freshWater.0'], yesterday: true })
    // Fuel: 120 → 110 L, filled to 150 L, then 145 L: used 15 L.
    expect(block.text).toBe('Tanks. Fuel: 74% (110 L), used yesterday 15 L. Fresh water: 40%, used yesterday 10%.')
    expect(String(asked[0]!.from)).toBe('2026-11-22T12:00:00.000Z')
    expect(asked[0]!.resolution).toBe(900)
  })

  it('still lists the tanks when the history is missing', async () => {
    const ctx = fakeCtx({ 'tanks.fuel.0.currentLevel': 0.74 })
    const block = await tankContent.fetch(ctx, { tanks: ['fuel.0'], yesterday: true })
    expect(block.text).toBe(
      "Tanks. Fuel: 74%. Yesterday's use not available (no history provider (e.g. signalk-questdb))."
    )
    expect(block.data).toMatchObject({ note: "Yesterday's use not available (no history provider (e.g. signalk-questdb))." })
  })

  it('does not let a slow history hold up the current readings', async () => {
    vi.useFakeTimers()
    try {
      const ctx = fakeCtx({ 'tanks.fuel.0.currentLevel': 0.74 }, { history: { getValues: () => new Promise(() => {}) } })
      const pending = tankContent.fetch(ctx, { tanks: ['fuel.0'], yesterday: true })
      await vi.advanceTimersByTimeAsync(8_000)
      expect((await pending).text).toBe("Tanks. Fuel: 74%. Yesterday's use not available (the history did not answer in time).")
    } finally {
      vi.useRealTimers()
    }
  })
})
