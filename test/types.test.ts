import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batteryContent } from '../src/contents/battery.js'
import { moonContent } from '../src/contents/moon.js'
import { pathContent } from '../src/contents/path.js'
import { positionContent } from '../src/contents/position.js'
import { sunContent } from '../src/contents/sun.js'
import { tankContent } from '../src/contents/tanks.js'
import { tideContent } from '../src/contents/tides.js'
import { summarize, weatherContent } from '../src/contents/weather.js'
import { notificationDelivery, notificationPath } from '../src/deliveries/notification.js'
import type { RunResult, WeatherData } from '../src/engine/types.js'
import { createEdge, pathTrigger } from '../src/triggers/path.js'
import { connectionOk, due, INTERNET_PATH, scheduleTrigger } from '../src/triggers/schedule.js'
import type { Weekday } from '../src/engine/time.js'
import { fakeCtx } from './fake.js'

const daily = { time: '07:00', days: [] as Weekday[], internet: 'any' as const }

describe('schedule trigger', () => {
  // 2026-11-23 07:30 ship time at UTC+12 is 2026-11-22 19:30 UTC, a Monday locally.
  const at0730 = new Date('2026-11-22T19:30:00Z')

  it('is due once per ship date after the set time', () => {
    expect(due(daily, new Date('2026-11-22T18:59:00Z'), 720, undefined, 'unknown')).toBeUndefined()
    expect(due(daily, at0730, 720, undefined, 'unknown')).toBe('2026-11-23')
    expect(due(daily, at0730, 720, '2026-11-23', 'unknown')).toBeUndefined()
    expect(due(daily, at0730, 720, '2026-11-22', 'unknown')).toBe('2026-11-23')
  })

  it('honours weekdays in ship time', () => {
    expect(due({ ...daily, days: ['mon'] }, at0730, 720, undefined, 'online')).toBe('2026-11-23')
    expect(due({ ...daily, days: ['sun'] }, at0730, 720, undefined, 'online')).toBeUndefined()
    // In UTC it is still Sunday evening.
    expect(due({ ...daily, days: ['sun'], time: '19:00' }, at0730, 0, undefined, 'online')).toBe('2026-11-22')
  })

  it('waits for the wanted connection, never for an unknown one', () => {
    expect(connectionOk('online', 'metered')).toBe(false)
    expect(connectionOk('online', 'online')).toBe(true)
    expect(connectionOk('onlineOrMetered', 'metered')).toBe(true)
    expect(connectionOk('onlineOrMetered', 'offline')).toBe(false)
    expect(connectionOk('online', 'unknown')).toBe(true)
    expect(connectionOk('any', 'offline')).toBe(true)
  })

  describe('running', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('does not fire right away when a new schedule is already past its time', () => {
      const ctx = fakeCtx({}, { now: '2026-11-22T19:30:00Z' })
      const fired: string[] = []
      scheduleTrigger.start(ctx, daily, (r) => fired.push(r), 'k')
      vi.advanceTimersByTime(60_000)
      expect(fired).toEqual([])
      expect(ctx.stateData.get('k')).toBe('2026-11-23')
    })

    it('fires when the connection comes up and remembers the date', () => {
      const ctx = fakeCtx({ [INTERNET_PATH]: 'offline' }, { now: '2026-11-22T19:30:00Z' })
      ctx.stateData.set('k', '2026-11-22')
      const fired: string[] = []
      const stop = scheduleTrigger.start(ctx, { ...daily, internet: 'online' }, (r) => fired.push(r), 'k')
      vi.advanceTimersByTime(60_000)
      expect(fired).toEqual([])
      ctx.emit(INTERNET_PATH, 'online')
      expect(fired).toEqual(['schedule 07:00, internet online'])
      expect(ctx.stateData.get('k')).toBe('2026-11-23')
      vi.advanceTimersByTime(60_000)
      expect(fired).toHaveLength(1)
      stop()
      expect(ctx.listeners.get(INTERNET_PATH)).toEqual([])
    })
  })
})

describe('path trigger', () => {
  it('fires on the rising edge only, with a cooldown', () => {
    let t = 0
    const edge = createEdge({ path: 'x', when: 'true', cooldownSeconds: 60 }, () => t)
    expect(edge(true)).toBe(false) // baseline
    expect(edge(false)).toBe(false)
    expect(edge(true)).toBe(true)
    expect(edge(true)).toBe(false)
    expect(edge(false)).toBe(false)
    t = 30_000
    expect(edge(1)).toBe(false) // cooldown
    t = 120_000
    expect(edge(0)).toBe(false)
    expect(edge('on')).toBe(true)
  })

  it('compares with a value or fires on every change', () => {
    const eq = createEdge({ path: 'x', when: 'equals', value: 'Briefing', cooldownSeconds: 0 }, () => 0)
    eq('other')
    expect(eq('briefing')).toBe(true)
    const any = createEdge({ path: 'x', when: 'changes', cooldownSeconds: 0 }, () => 0)
    any(1)
    expect(any(1)).toBe(false)
    expect(any(2)).toBe(true)
  })

  it('takes the current value as baseline when it starts', () => {
    const ctx = fakeCtx({ 'electrical.switches.brief.state': true })
    const fired: string[] = []
    pathTrigger.start(ctx, { path: 'electrical.switches.brief.state', when: 'true', cooldownSeconds: 0 }, (r) => fired.push(r), 'k')
    ctx.emit('electrical.switches.brief.state', true)
    expect(fired).toEqual([])
    ctx.emit('electrical.switches.brief.state', false)
    ctx.emit('electrical.switches.brief.state', true)
    expect(fired).toEqual(['electrical.switches.brief.state = true'])
  })
})

describe('contents', () => {
  const tree = {
    'navigation.position': { latitude: -33.8568, longitude: 151.2153 },
    'electrical.batteries.house.capacity.stateOfCharge': 0.874,
    'electrical.batteries.house.voltage': 12.91,
    'electrical.batteries.house.current': -4.2,
    'electrical.batteries.house.capacity.timeRemaining': 113460,
    'electrical.batteries.starter.voltage': 12.7,
    'tanks.freshWater.0.currentLevel': 0.75,
    'tanks.freshWater.0.currentVolume': 0.15,
    'tanks.fuel.main.currentLevel': 0.5,
    'tanks.fuel.main.name': 'Diesel',
    'environment.sunlight.times.sunrise': '2026-11-22T17:33:02Z',
    'environment.sunlight.times.sunset': '2026-11-23T06:05:28Z',
    'environment.sunlight.times.dawn': '2026-11-22T17:10:00Z',
    'environment.sunlight.times.dusk': '2026-11-23T06:28:00Z',
    'environment.moon.phaseName': 'Waxing Gibbous',
    'environment.moon.fraction': 0.91,
    'environment.moon.times.rise': '2026-11-23T03:38:17Z',
    'environment.moon.times.set': '2026-11-22T14:56:09Z',
    'environment.moon.times.alwaysUp': false,
    'environment.tide.stationName': 'Fort Denison',
    'environment.tide.state': 'rising',
    'environment.tide.heightNow': 0.8,
    'environment.tide.timeHigh': '2026-11-23T02:12:00Z',
    'environment.tide.heightHigh': 1.6,
    'environment.tide.timeLow': '2026-11-22T20:00:00Z',
    'environment.tide.heightLow': 0.3,
    'environment.water.temperature': 300.15
  }

  it('writes readable text in ship time and display units', async () => {
    const ctx = fakeCtx(tree)
    const text = async (p: Promise<{ text: string }>) => (await p).text
    expect(await text(positionContent.fetch(ctx, {}))).toBe("Position: 33°51.4'S 151°12.9'E.")
    expect(await text(batteryContent.fetch(ctx, { batteries: [] }))).toBe(
      'Batteries. House: 87%, 12.9 V, -4.2 A, 31.5 h left. Starter: 12.7 V.'
    )
    expect(await text(tankContent.fetch(ctx, { tanks: [] }))).toBe('Tanks. Fresh water: 75% (150 L). Diesel: 50%.')
    expect(await text(sunContent.fetch(ctx, { twilight: true }))).toBe('Sunrise 05:33, sunset 18:05 (dawn 05:10, dusk 18:28).')
    expect(await text(moonContent.fetch(ctx, {}))).toBe('Moon: waxing gibbous, 91% lit, rises 15:38, sets 02:56.')
    expect(await text(tideContent.fetch(ctx, {}))).toBe(
      'Tide at Fort Denison: rising, now 0.8 m. Low water 08:00 (0.3 m), high water 14:12 (1.6 m).'
    )
    expect(await text(pathContent.fetch(ctx, { path: 'environment.water.temperature', label: 'Water' }))).toBe('Water: 27.0 °C.')
    expect(await text(pathContent.fetch(ctx, { path: 'not.there' }))).toBe('not.there: no data.')
  })

  it('fails with a reason when the source is missing', async () => {
    const ctx = fakeCtx({})
    await expect(sunContent.fetch(ctx, { twilight: true })).rejects.toThrow('signalk-derived-data')
    await expect(tideContent.fetch(ctx, {})).rejects.toThrow('signalk-tides')
    await expect(batteryContent.fetch(ctx, { batteries: [] })).rejects.toThrow('no batteries')
    await expect(weatherContent.fetch(ctx, { days: 2, waves: true, warnings: true })).rejects.toThrow('no weather provider')
  })
})

describe('weather', () => {
  const point = (iso: string, t: number, wind: number, dir: number, rain = 0): WeatherData => ({
    date: iso,
    outside: { temperature: t, precipitationVolume: rain },
    wind: { speedTrue: wind, directionTrue: dir, gust: wind * 1.4 }
  })

  it('summarises hourly points per ship day', () => {
    const items = [
      point('2026-11-22T19:00:00Z', 297, 5, 2.3), // Mon 07:00 ship time
      point('2026-11-23T01:00:00Z', 302, 8, 2.4, 0.002),
      point('2026-11-23T13:00:00Z', 296, 6, 1.6) // Tue 01:00
    ]
    const days = summarize(items, 720, 2, new Date('2026-11-22T19:30:00Z'))
    expect(days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24'])
    expect(days[0]).toMatchObject({ minTemperature: 297, maxTemperature: 302, windSpeed: 8, windDirection: 2.4, precipitation: 0.002 })
  })

  it('uses daily forecasts and falls back to points', async () => {
    const getForecasts = vi.fn(async (_p: unknown, type: string) =>
      type === 'daily'
        ? []
        : [point('2026-11-22T20:00:00Z', 297, 5, 2.36), point('2026-11-23T02:00:00Z', 302, 7.7, 2.36, 0.003)]
    )
    const ctx = fakeCtx(
      { 'navigation.position': { latitude: -33.86, longitude: 151.22 } },
      { now: '2026-11-22T19:30:00Z', weather: { getForecasts, getWarnings: async () => [{ details: 'Strong wind warning' }] } }
    )
    const block = await weatherContent.fetch(ctx, { days: 1, waves: true, warnings: true })
    expect(getForecasts.mock.calls.map((c) => c[1])).toEqual(['daily', 'point'])
    expect(block.text).toBe('Weather. Today: 23.9 to 28.9 °C, wind 15.0 kn from SE, gusts 21.0 kn, rain 3 mm. Warning: Strong wind warning.')
  })
})

describe('notification delivery', () => {
  it('raises a notification with the configured state', async () => {
    const ctx = fakeCtx()
    const run = { id: 'r1', briefingId: 'a1b2-c3', briefingName: 'Morning' } as RunResult
    await notificationDelivery.deliver(ctx, { state: 'alert', method: ['visual', 'sound'] }, run)
    expect(notificationPath('a1b2-c3')).toBe('notifications.briefing.a1b2c3')
    expect(ctx.published).toEqual([
      {
        path: 'notifications.briefing.a1b2c3',
        value: { state: 'alert', method: ['visual', 'sound'], message: 'Briefing "Morning" ready', id: 'r1' }
      }
    ])
  })
})
