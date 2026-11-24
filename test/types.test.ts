import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batteryContent } from '../src/contents/battery.js'
import { moonContent } from '../src/contents/moon.js'
import { pathContent } from '../src/contents/path.js'
import { positionContent } from '../src/contents/position.js'
import { sunContent } from '../src/contents/sun.js'
import { tankContent } from '../src/contents/tanks.js'
import { tideContent } from '../src/contents/tides.js'
import { conditionOf, summarize, weatherContent } from '../src/contents/weather.js'
import { tankKind } from '../src/contents/tanks.js'
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
    'environment.tide.timeLow': '2026-11-23T08:00:00Z',
    'environment.tide.heightLow': 0.3,
    'environment.water.temperature': 300.15
  }

  it('writes readable text in ship time and display units', async () => {
    const ctx = fakeCtx(tree)
    const text = async (p: Promise<{ text: string }>) => (await p).text
    expect(await text(positionContent.fetch(ctx, {}))).toBe("Position: 33°51.4'S 151°12.9'E.")
    expect(await text(batteryContent.fetch(ctx, { batteries: [], lowPercent: 30, highPercent: 70 }))).toBe(
      'Batteries. House: 87%, 12.9 V, -4.2 A, 31.5 h left. Starter: 12.7 V.'
    )
    expect(await text(tankContent.fetch(ctx, { tanks: [] }))).toBe('Tanks. Fresh water: 75% (150 L). Diesel: 50%.')
    expect(await text(sunContent.fetch(ctx, { twilight: true }))).toBe('Sunrise 05:33, sunset 18:05 (dawn 05:10, dusk 18:28).')
    expect(await text(moonContent.fetch(ctx, {}))).toBe('Moon: waxing gibbous, 91% lit, rises 15:38, sets 02:56.')
    expect(await text(tideContent.fetch(ctx, {}))).toBe(
      'Tide at Fort Denison: rising, now 0.8 m. High water 14:12 (1.6 m), low water 20:00 (0.3 m).'
    )
    expect(await text(pathContent.fetch(ctx, { path: 'environment.water.temperature', label: 'Water' }))).toBe('Water: 27.0 °C.')
    expect(await text(pathContent.fetch(ctx, { path: 'not.there' }))).toBe('not.there: no data.')
  })

  it('reads timestamps that a plugin put into the tree as Date objects', async () => {
    // signalk-derived-data publishes sun and moon times as Dates; only REST turns them into strings.
    const ctx = fakeCtx({
      'environment.sunlight.times.sunrise': new Date('2026-11-23T17:33:31Z'),
      'environment.sunlight.times.sunset': new Date('2026-11-24T06:06:50Z'),
      'environment.moon.phaseName': 'Full Moon',
      'environment.moon.times.rise': new Date('2026-11-24T05:39:07Z'),
      'environment.moon.times.set': null
    })
    expect((await sunContent.fetch(ctx, { twilight: true })).text).toBe('Sunrise 05:33, sunset 18:06.')
    expect((await moonContent.fetch(ctx, {})).text).toBe('Moon: full moon, rises 17:39.')
  })

  it('keeps ids that are not plain words', async () => {
    const ctx = fakeCtx({
      'electrical.batteries.LiFePo4-L-F7.voltage': 13.1,
      'electrical.batteries.2997309160.voltage': 4.34,
      'electrical.batteries.houseBank.voltage': 12.9
    })
    expect((await batteryContent.fetch(ctx, { batteries: [], lowPercent: 30, highPercent: 70 })).text).toBe(
      'Batteries. LiFePo4-L-F7: 13.1 V. 2997309160: 4.3 V. House bank: 12.9 V.'
    )
  })

  it('reads tide extremes the server hands over as Date objects, and ids with their path', async () => {
    const tides = { extremes: [{ time: new Date('2026-11-23T04:25:59Z'), level: 2.18, high: true }, { time: new Date('2026-11-23T10:52:58Z'), level: 0.19, high: false }, { time: new Date('2026-11-23T17:00:00Z'), level: 2.1, high: true }] }
    const ctx = fakeCtx({ ...tree, 'environment.tide.heightNow': 1.4 }, { now: '2026-11-23T00:00:00Z', resources: { tides } })
    const block = await tideContent.fetch(ctx, {})
    expect(block.data).toMatchObject({ nowLevel: 1.4, points: [{ timeText: '16:25' }, { timeText: '22:52' }, { timeText: '05:00' }] })
    const tanks = await tankContent.fetch(ctx, { tanks: ['tanks.fuel.main', ' freshWater.0 '] })
    expect(tanks.text).toBe('Tanks. Diesel: 50%. Fresh water: 75% (150 L).')
    const batteries = await batteryContent.fetch(ctx, { batteries: ['electrical.batteries.house'], lowPercent: 30, highPercent: 70 })
    expect(batteries.text).toContain('House: 87%')
  })

  it('draws the tide day from the tides resource', async () => {
    const tides = {
      extremes: [
        { time: '2026-11-22T22:09:44Z', level: 0.31, high: false, low: true },
        { time: '2026-11-23T04:25:59Z', level: 2.18, high: true, low: false },
        { time: '2026-11-23T10:52:58Z', level: 0.19, high: false, low: true },
        { time: '2026-11-25T04:00:00Z', level: 2.2, high: true, low: false }
      ]
    }
    const ctx = fakeCtx({ 'environment.tide.stationName': 'Funafuti' }, { now: '2026-11-23T00:00:00Z', resources: { tides } })
    const block = await tideContent.fetch(ctx, {})
    expect(block.text).toBe('Tide at Funafuti. High water 16:25 (2.2 m), low water 22:52 (0.2 m).')
    expect(block.data).toMatchObject({
      station: 'Funafuti',
      points: [
        { high: false, timeText: '10:09', level: 0.31 },
        { high: true, timeText: '16:25' },
        { high: false, timeText: '22:52' }
      ]
    })
  })

  it('gives the webapp what it draws', async () => {
    const ctx = fakeCtx(tree)
    expect((await batteryContent.fetch(ctx, { batteries: ['house'], lowPercent: 25, highPercent: 80 })).data).toEqual({
      items: [{ id: 'house', name: 'House', soc: 0.874, socText: '87%', voltageText: '12.9 V', current: -4.2, currentText: '-4.2 A', remainingText: '31.5 h left' }],
      low: 0.25,
      high: 0.8
    })
    expect((await tankContent.fetch(ctx, { tanks: [] })).data).toMatchObject({
      items: [
        { id: 'freshWater.0', kind: 'water', level: 0.75 },
        { id: 'fuel.main', name: 'Diesel', kind: 'fuel', level: 0.5 }
      ]
    })
    expect((await moonContent.fetch(ctx, {})).data).toMatchObject({ phaseName: 'Waxing Gibbous', fraction: 0.91, southern: true })
    expect(['fuel', 'freshWater', 'wasteWater', 'blackWater', 'liveWell', 'gas'].map(tankKind)).toEqual(['fuel', 'water', 'waste', 'waste', 'other', 'fuel'])
  })

  it('fails with a reason when the source is missing', async () => {
    const ctx = fakeCtx({})
    await expect(sunContent.fetch(ctx, { twilight: true })).rejects.toThrow('signalk-derived-data')
    await expect(tideContent.fetch(ctx, {})).rejects.toThrow('signalk-tides')
    await expect(batteryContent.fetch(ctx, { batteries: [], lowPercent: 30, highPercent: 70 })).rejects.toThrow('no batteries')
    await expect(weatherContent.fetch(ctx, { days: 2, waves: true, warnings: true, description: false })).rejects.toThrow('no weather provider')
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
    const days = summarize([], items, 720, 2, new Date('2026-11-22T19:30:00Z'))
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
    const block = await weatherContent.fetch(ctx, { days: 1, waves: true, warnings: true, description: false })
    expect(getForecasts.mock.calls.map((c) => c[1]).sort()).toEqual(['daily', 'point'])
    expect(block.text).toBe('Weather. Today: 23.9 to 28.9 °C, wind 15.0 kn from SE, gusts 21.0 kn, rain 3 mm. Warning: Strong wind warning.')
  })

  it('merges daily forecasts with hourly waves, as Open-Meteo sends them', async () => {
    // Shapes as a real Open-Meteo provider answers: daily entries at UTC midnight, chance of rain in percent.
    const daily = [
      { date: '2026-11-24T00:00:00.000Z', type: 'daily', description: 'Rain showers: Slight', outside: { minTemperature: 300.75, maxTemperature: 302.75, precipitationProbability: 27 }, wind: { speedTrue: 6.32, directionTrue: 2.84, gust: 8.2 } },
      { date: '2026-11-25T00:00:00.000Z', type: 'daily', description: 'Thunderstorm: Slight or moderate', outside: { minTemperature: 300, maxTemperature: 302 }, wind: { speedTrue: 9, directionTrue: 2.6, gust: 16 } }
    ]
    const points = [
      { date: '2026-11-23T22:00:00.000Z', type: 'point', water: { waveSignificantHeight: 1.44 } },
      { date: '2026-11-24T03:00:00.000Z', type: 'point', water: { waveSignificantHeight: 1.62 } }
    ]
    const getForecasts = vi.fn(async (_p: unknown, type: string) => (type === 'daily' ? daily : points))
    const ctx = fakeCtx(
      { 'navigation.position': { latitude: -8.6, longitude: 179.1 } },
      { now: '2026-11-23T20:00:00Z', weather: { getForecasts } }
    )
    const block = await weatherContent.fetch(ctx, { days: 2, waves: true, warnings: false, description: true })
    expect(block.text).toBe(
      'Weather. Today: Rain showers: Slight, 27.6 to 29.6 °C, wind 12.3 kn from SSE, gusts 15.9 kn, rain 27%, waves 1.6 m. ' +
        'Tomorrow: Thunderstorm: Slight or moderate, 26.9 to 28.9 °C, wind 17.5 kn from SSE, gusts 31.1 kn.'
    )
    expect(block.data).toMatchObject({
      days: [
        { name: 'Today', condition: 'showers', windy: false },
        { name: 'Tomorrow', condition: 'thunder', windy: true }
      ],
      warnings: []
    })
  })

  it('does not let slow hourly points cost the daily forecast', async () => {
    vi.useFakeTimers()
    try {
      const getForecasts = vi.fn((_p: unknown, type: string) =>
        type === 'daily'
          ? Promise.resolve([{ date: '2026-11-24T00:00:00.000Z', type: 'daily', description: 'Clear sky', outside: { maxTemperature: 300 } }])
          : new Promise<WeatherData[]>(() => {})
      )
      const ctx = fakeCtx({ 'navigation.position': { latitude: -8.6, longitude: 179.1 } }, { now: '2026-11-23T20:00:00Z', weather: { getForecasts } })
      const pending = weatherContent.fetch(ctx, { days: 1, waves: true, warnings: false, description: false })
      await vi.advanceTimersByTimeAsync(5_000)
      const block = await pending
      expect(block.text).toBe('Weather. Today: 26.9 °C.')
      expect(block.data).toMatchObject({ days: [{ condition: 'clear' }] })
      expect((block.data as { days: Array<{ description?: string }> }).days[0]?.description).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for hourly points in full when the daily forecast has nothing for today', async () => {
    vi.useFakeTimers()
    try {
      const getForecasts = vi.fn((_p: unknown, type: string) =>
        type === 'daily'
          ? Promise.resolve([{ date: '2026-11-22T00:00:00.000Z', type: 'daily', description: 'Clear sky' }])
          : new Promise<WeatherData[]>((resolve) =>
              setTimeout(() => resolve([{ date: '2026-11-23T22:00:00.000Z', type: 'point', outside: { temperature: 300 } }]), 8_000)
            )
      )
      const ctx = fakeCtx({ 'navigation.position': { latitude: -8.6, longitude: 179.1 } }, { now: '2026-11-23T20:00:00Z', weather: { getForecasts } })
      const pending = weatherContent.fetch(ctx, { days: 1, waves: true, warnings: false, description: false })
      await vi.advanceTimersByTimeAsync(8_000)
      expect((await pending).text).toBe('Weather. Today: 26.9 °C.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a daily entry on its own date west of Greenwich', () => {
    // The provider may leave out `type`; which list an entry came in decides.
    expect(summarize([{ date: '2026-11-24T00:00:00.000Z' }], [], -600, 1, new Date('2026-11-24T18:00:00Z')).map((d) => d.date)).toEqual(['2026-11-24'])
    const daily = [{ date: '2026-11-24T00:00:00.000Z', type: 'daily', description: 'Clear sky' }]
    // 08:00 on 24 Nov at UTC-10 is 18:00 UTC.
    expect(summarize(daily, [], -600, 1, new Date('2026-11-24T18:00:00Z')).map((d) => d.date)).toEqual(['2026-11-24'])
  })

  it('picks a symbol from the text, else from the numbers', () => {
    expect(conditionOf({ date: '', description: 'Drizzle: Light' })).toBe('drizzle')
    expect(conditionOf({ date: '', description: 'Overcast' })).toBe('cloudy')
    expect(conditionOf({ date: '', description: 'Mainly clear' })).toBe('clear')
    expect(conditionOf({ date: '', description: 'Fog' })).toBe('fog')
    expect(conditionOf({ date: '', cloudCover: 0.86 })).toBe('cloudy')
    expect(conditionOf({ date: '', rainChance: 0.6 })).toBe('rain')
    expect(conditionOf({ date: '' })).toBe('clear')
  })

  it("leaves out the provider's description unless asked", async () => {
    const getForecasts = vi.fn(async () => [{ ...point('2026-11-22T20:00:00Z', 297, 5, 2.36), description: 'Model run 12Z' }])
    const ctx = fakeCtx(
      { 'navigation.position': { latitude: -33.86, longitude: 151.22 } },
      { now: '2026-11-22T19:30:00Z', weather: { getForecasts } }
    )
    const off = await weatherContent.fetch(ctx, { days: 1, waves: false, warnings: false, description: false })
    expect(off.text).not.toContain('Model run')
    const on = await weatherContent.fetch(ctx, { days: 1, waves: false, warnings: false, description: true })
    expect(on.text).toContain('Today: Model run 12Z, ')
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
