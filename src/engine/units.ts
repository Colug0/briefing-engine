import type { DisplayValue } from './types.js'

/** Number of decimals a display format such as "0.0" asks for. */
export function decimalsOf(format: string | undefined, fallback = 1): number {
  if (!format) return fallback
  const dot = format.indexOf('.')
  return dot < 0 ? 0 : format.length - dot - 1
}

/** Unit presets may name a unit in words; a briefing reads better with the short symbol. */
const SHORT: Record<string, string> = {
  hour: 'h',
  hours: 'h',
  minute: 'min',
  minutes: 'min',
  second: 's',
  seconds: 's',
  day: 'd',
  days: 'd',
  liter: 'L',
  liters: 'L',
  litre: 'L',
  litres: 'L',
  percent: '%'
}

export function toDisplayValue(value: number, unitSymbol: string, format?: string): DisplayValue {
  const symbol = SHORT[unitSymbol.toLowerCase()] ?? unitSymbol
  const decimals = decimalsOf(format)
  const rounded = Number(value.toFixed(decimals))
  const number = rounded.toFixed(decimals)
  const text = symbol === '' ? number : symbol === '%' || symbol === '°' ? `${number}${symbol}` : `${number} ${symbol}`
  return { value: rounded, symbol, text }
}

/**
 * Display conversion when the server cannot convert a path (older server, or
 * a unit without a preset). Keeps the SI unit except for the few where SI
 * would be unreadable in a briefing.
 */
export function fallbackDisplay(units: string | undefined, value: number): DisplayValue {
  switch (units) {
    case 'ratio':
      return toDisplayValue(value * 100, '%', '0')
    case 'K':
      return toDisplayValue(value - 273.15, '°C', '0.0')
    case 'm/s':
      return toDisplayValue(value * 1.943844, 'kn', '0.0')
    case 'rad':
      return toDisplayValue(((value * 180) / Math.PI + 360) % 360, '°', '0')
    case 'Pa':
      return toDisplayValue(value / 100, 'hPa', '0')
    case 'm3':
      return toDisplayValue(value * 1000, 'L', '0')
    case 's':
      return value >= 7200 ? toDisplayValue(value / 3600, 'h', '0.0') : toDisplayValue(value / 60, 'min', '0')
    default:
      return toDisplayValue(value, units ?? '', '0.0')
  }
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** 16-point compass name for a direction in radians. */
export function compass(rad: number): string {
  const deg = (((rad * 180) / Math.PI) % 360 + 360) % 360
  return COMPASS[Math.round(deg / 22.5) % 16]!
}

const SPOKEN: Array<[RegExp, string]> = [
  [/(\d) ?°C\b/g, '$1 degrees'],
  [/(\d) ?°F\b/g, '$1 degrees Fahrenheit'],
  [/(\d)°/g, '$1 degrees'],
  [/(\d) ?%/g, '$1 percent'],
  [/(\d) kn\b/g, '$1 knots'],
  [/(\d) nm\b/g, '$1 nautical miles'],
  [/(\d) hPa\b/g, '$1 hectopascal'],
  [/(\d) mm\b/g, '$1 millimetres'],
  [/(\d) m\b/g, '$1 metres'],
  [/(\d) ft\b/g, '$1 feet'],
  [/(\d) V\b/g, '$1 volts'],
  [/(\d) A\b/g, '$1 amps'],
  [/(\d) Ah\b/g, '$1 amp hours'],
  [/(\d) W\b/g, '$1 watts'],
  [/(\d) L\b/g, '$1 litres'],
  [/(\d) h\b/g, '$1 hours'],
  [/(\d) min\b/g, '$1 minutes']
]

/** Turn screen text into something a text-to-speech engine reads well. */
export function speechify(text: string): string {
  return SPOKEN.reduce((t, [re, to]) => t.replace(re, to), text)
}
