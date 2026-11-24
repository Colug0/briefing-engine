import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bulletinContent, paragraphs, parseBulletin } from '../src/contents/bulletin.js'
import { stormContent, stormSeverity, stormsNear } from '../src/contents/storms.js'
import { findPositions, latLonText, rangeText } from '../src/engine/geo.js'
import { INTERNET_PATH } from '../src/engine/internet.js'
import { fakeCtx } from './fake.js'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8')
// Off Funafuti, where real bulletins were fetched for these fixtures.
const boat = { latitude: -8.6067, longitude: 179.0967 }

describe('geography', () => {
  it('reads positions as bulletins write them', () => {
    expect(findPositions('NEAR 13.0 SOUTH 167.0 WEST AT 231800 UTC')).toEqual([{ latitude: -13, longitude: -167 }])
    expect(findPositions('TROUGH T3 18S 162E 16S 168E 14S 172E')).toHaveLength(3)
    expect(findPositions('Trough 04S155E 09S160E')).toEqual([
      { latitude: -4, longitude: 155 },
      { latitude: -9, longitude: 160 }
    ])
    expect(rangeText(boat, { latitude: -13, longitude: -167 })).toBe('861 nm ESE')
    expect(latLonText({ latitude: -13, longitude: -167 })).toBe('13.0°S 167.0°W')
  })
})

describe('marine bulletin', () => {
  it('reads warnings and nearby systems from Fiji Met', () => {
    const fiji = parseBulletin(fixture('fqps01.nffn'), boat, 600)
    expect(fiji.issued).toBe('NOV 232000 UTC')
    expect(fiji.warnings).toEqual([])
    expect(fiji.severity).toBeUndefined()
    // The tropical depression is shown although it is further than 600 nm;
    // a trough counts by its closest point.
    expect(fiji.systems.map((s) => [s.text.slice(0, 22), s.distanceText, s.tropical])).toEqual([
      ['TROPICAL DEPRESSION TD', '861 nm ESE', true],
      ['TROUGH T3 18S 162E 16S', '528 nm SW', false]
    ])
  })

  it('turns a warning into a warn, and does not take a heading for one', () => {
    const waters = parseBulletin(fixture('fqfj40.nffn'), boat, 600)
    expect(waters.warnings).toEqual(['A STRONG WIND WARNING REMAINS IN FORCE FOR ALL FIJI WATERS EXCEPT MAMANUCA WATERS.'])
    expect(waters.severity).toBe('warn')
    const au = parseBulletin(fixture('fqau20.ammc'), boat, 600)
    expect(au.warnings).toEqual([])
    expect(au.severity).toBeUndefined()
    expect(parseBulletin('PART 1 : STORM WARNING 042 ISSUED BY FIJI', boat, 600).severity).toBe('alarm')
    // Storm force near the boat is an alarm without the word warning; far away it is not.
    expect(parseBulletin('TROPICAL CYCLONE TEST NEAR 10S 179E. HURRICANE FORCE WINDS.', boat, 600).severity).toBe('alarm')
    expect(parseBulletin('TROPICAL CYCLONE TEST NEAR 30S 150W. HURRICANE FORCE WINDS.', boat, 600).severity).toBeUndefined()
    expect(parseBulletin('TROPICAL CYCLONE TEST NEAR 10S 179E. STORM-FORCE WINDS.', boat, 600).severity).toBe('alarm')
    // Without the boat's position nothing is known to be near.
    expect(parseBulletin('TROPICAL CYCLONE TEST. HURRICANE FORCE WINDS.', undefined, 600).severity).toBeUndefined()
    // A long warning is kept whole, and force words at its end still count.
    const long = `GALE WARNING 12. ${'SOUTHEAST WINDS 35 KNOTS. '.repeat(20)}STORM FORCE WINDS EXPECTED LATER.`
    const parsed = parseBulletin(long, boat, 600)
    expect(parsed.warnings[0]).toBe(long)
    expect(parsed.severity).toBe('alarm')
  })

  it('finds the issue time when the heading is repeated', () => {
    // Fiji Met's bulletin of 24 Nov 06:00 repeats its heading before the time.
    expect(parseBulletin(fixture('fqps01.nffn-240600'), boat, 600).issued).toBe('NOV 240800 UTC')
    expect(parseBulletin(fixture('fqps01.nffn'), boat, 600).issued).toBe('NOV 232000 UTC')
    // Only the time stamp, never the text after it; French markers too.
    expect(parseBulletin('Issued at 0600 UTC\n\nGALE WARNING FOR FIJI.', boat, 600).issued).toBe('0600 UTC')
    expect(parseBulletin('Émis le 24 novembre 2026 à 0600 UTC.', boat, 600).issued).toBe('24 novembre 2026 à 0600 UTC')
  })

  it('finds the warning in a bulletin without a single blank line', () => {
    // Fiji Met's Fiji waters bulletin of 24 Nov 18:00 UTC: heading, issue lines and warning run together.
    const waters = parseBulletin(fixture('fqfj40.nffn-241800'), boat, 600)
    expect(waters.warnings).toEqual(['A STRONG WIND WARNING REMAINS IN FORCE FOR ALL FIJI WATERS EXCEPT MAMANUCA WATERS.'])
    expect(waters.severity).toBe('warn')
  })

  it('reads warnings from the warnings part and not from mentions in forecasts', () => {
    // BoM: the warning is listed in Part 1; "outside of warning area" in Part 3 is no warning.
    const au = parseBulletin(fixture('fqau22.ammc'), boat, 600)
    expect(au.warnings).toEqual(['Melbourne Storm Force Wind Warning 11.'])
    expect(au.severity).toBe('alarm')
    // MetService NZ: "WARNINGS IN FORCE: 337"; "gales as in warning 337" in the forecast is a mention.
    const nz = parseBulletin(fixture('fqps45.nzkl'), boat, 600)
    expect(nz.warnings).toEqual(['WARNINGS IN FORCE: 337'])
    expect(nz.severity).toBe('warn')
    expect(parseBulletin('Southerly 20kt, gales as in warning 12.', boat, 600).warnings).toEqual([])
    expect(parseBulletin('Part 1 - WARNINGS\nWARNINGS IN FORCE: NIL\n\nPart 2 - Situation', boat, 600).warnings).toEqual([])
  })

  it('keeps a warning with its body and its references', () => {
    const colon = parseBulletin('GALE WARNING:\nNORTHWEST WINDS 35 KNOTS. STORM FORCE WINDS EXPECTED LATER.', boat, 600)
    expect(colon.warnings).toEqual(['GALE WARNING: NORTHWEST WINDS 35 KNOTS. STORM FORCE WINDS EXPECTED LATER.'])
    expect(colon.severity).toBe('alarm')
    const issued = parseBulletin('GALE WARNING 12 ISSUED AT 0600 UTC\nNORTHWEST WINDS 35 KNOTS. STORM FORCE WINDS EXPECTED LATER.', boat, 600)
    expect(issued.warnings).toHaveLength(1)
    expect(issued.severity).toBe('alarm')
    const ref = parseBulletin('A STRONG WIND WARNING REMAINS IN FORCE FOR ALL FIJI WATERS; SEE WARNING 12 FOR DETAILS.', boat, 600)
    expect(ref.warnings).toHaveLength(1)
    expect(parseBulletin('NO STORM WARNING FOR AREA NEAR 10S 179E.', boat, 600)).toMatchObject({ warnings: [], systems: [] })
    expect(parseBulletin('NO STORM WARNING FOR AREA NEAR 10S 179E.', boat, 600).severity).toBeUndefined()
    // A reference to a storm warning elsewhere does not make this warning an alarm.
    expect(parseBulletin('A STRONG WIND WARNING REMAINS IN FORCE FOR FIJI; SEE STORM WARNING 12 FOR ANOTHER AREA.', boat, 600).severity).toBe('warn')
    // A list of referenced warnings is still only a reference.
    expect(parseBulletin('Southerly 20kt, gales as in warning 12, warning 13 and warning 14.', boat, 600).warnings).toEqual([])
    // A nearby tropical system stays, even when it says no warning is in force.
    const tc = parseBulletin('TROPICAL CYCLONE TEST NEAR 10S 179E. NO GALE WARNING CURRENTLY IN FORCE. STORM FORCE WINDS EXPECTED.', boat, 600)
    expect(tc.systems).toHaveLength(1)
    expect(tc.severity).toBe('alarm')
  })

  it('splits paragraphs on blank lines and indented lines', () => {
    expect(paragraphs('A\nB\n\n C\nD\n')).toEqual(['A B', 'C D'])
  })

  it('fetches the chosen bulletin and falls back to the last one offline', async () => {
    const ctx = fakeCtx(
      { 'navigation.position': boat },
      { now: '2026-11-23T21:00:00Z', http: async () => new Response(fixture('fqfj40.nffn')) }
    )
    const block = await bulletinContent.fetch(ctx, { bulletin: 'fiji-warnings', radiusNm: 600 })
    expect(ctx.requests[0]!.url).toBe('https://tgftp.nws.noaa.gov/data/raw/fq/fqfj40.nffn..txt')
    expect(block.text).toBe(
      'Fiji Met – Fiji waters warnings. Warning: A STRONG WIND WARNING REMAINS IN FORCE FOR ALL FIJI WATERS EXCEPT MAMANUCA WATERS.'
    )
    expect(block.severity).toBe('warn')
    ctx.values.set(INTERNET_PATH, 'offline')
    ctx.clock.now = new Date('2026-11-24T01:00:00Z')
    const offline = await bulletinContent.fetch(ctx, { bulletin: 'fiji-warnings', radiusNm: 600 })
    expect(offline.asOf).toBe('2026-11-23T21:00:00.000Z')
    expect(ctx.requests).toHaveLength(1)
  })
})

const gdacs = {
  features: [
    {
      geometry: { type: 'Point', coordinates: [-168.8, -11.8] },
      properties: {
        eventname: 'XAVIER-26',
        alertlevel: 'Green',
        todate: '2026-11-23T00:00:00',
        severitydata: { severitytext: 'Tropical Depression (maximum wind speed of 241 km/h)' },
        url: { report: 'https://www.gdacs.org/report.aspx?eventid=1' }
      }
    },
    { geometry: { type: 'Point', coordinates: [84.7, 17.2] }, properties: { eventname: 'AKVAN-26', alertlevel: 'Orange', todate: '2026-11-23T06:00:00' } },
    { geometry: { type: 'Point', coordinates: [178, -10] }, properties: { eventname: 'OLD-26', alertlevel: 'Red', todate: '2026-11-18T00:00:00' } }
  ]
}

describe('storms', () => {
  it('keeps recent storms within reach, nearest first', () => {
    const near = stormsNear(gdacs, boat, 1000, new Date('2026-11-23T20:00:00Z'), 48)
    expect(near.map((s) => [s.name, s.distanceNm, s.compass, s.alertLevel])).toEqual([['XAVIER-26', 740, 'ESE', 'green']])
    expect(stormSeverity({ alertLevel: 'orange', distanceNm: 800 })).toBe('warn')
    expect(stormSeverity({ alertLevel: 'green', distanceNm: 250 })).toBe('alarm')
    expect(stormSeverity({ alertLevel: 'green', distanceNm: 700 })).toBeUndefined()
    expect(stormSeverity({ alertLevel: 'green', distanceNm: 300, exactNm: 299.6 })).toBe('alarm')
    expect(stormSeverity({ alertLevel: 'green', distanceNm: 300, exactNm: 300 })).toBeUndefined()
    // Out-of-range coordinates are dropped, and the last change counts, not the end of the event window.
    const odd = {
      features: [
        { geometry: { type: 'Point', coordinates: [0, 360] }, properties: { eventname: 'BAD', alertlevel: 'Red', todate: '2026-11-23T00:00:00' } },
        { geometry: { type: 'Point', coordinates: [-168.8, -11.8] }, properties: { eventname: 'OLDWINDOW', alertlevel: 'Green', todate: '2026-11-19T00:00:00', datemodified: '2026-11-23T10:00:00' } }
      ]
    }
    expect(stormsNear(odd, boat, 5000, new Date('2026-11-23T20:00:00Z'), 48).map((s) => s.name)).toEqual(['OLDWINDOW'])
  })

  it('writes the storm with distance and direction from the boat', async () => {
    const ctx = fakeCtx({ 'navigation.position': boat }, { now: '2026-11-23T20:00:00Z', http: async () => Response.json(gdacs) })
    const block = await stormContent.fetch(ctx, { radiusNm: 1000, hours: 48 })
    expect(block.text).toBe(
      'Tropical cyclones. XAVIER-26: 11.8°S 168.8°W, 740 nm ESE, green alert, Tropical Depression (maximum wind speed of 241 km/h), updated Mon 23 Nov 12:00.'
    )
    expect(block.severity).toBeUndefined()
    const none = await stormContent.fetch(ctx, { radiusNm: 300, hours: 48 })
    expect(none.text).toBe('Tropical cyclones. No tropical cyclones within 300 nm.')
  })
})
