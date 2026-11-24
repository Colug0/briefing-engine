/**
 * The `data` each content type returns, shared with the webapp, which draws
 * its graphics from it. Numbers for graphics are in SI units or ratios; every
 * value meant to be read comes as a ready text in the server's display units.
 */

export interface PositionData {
  latitude: number
  longitude: number
  text: string
}

export interface PathData {
  path: string
  label: string
  value: unknown
  text: string
}

export interface BatteryItem {
  id: string
  name: string
  /** State of charge as a ratio (0–1). */
  soc?: number
  socText?: string
  voltageText?: string
  /** Current in A; positive charges. */
  current?: number
  currentText?: string
  remainingText?: string
}

export interface BatteryData {
  items: BatteryItem[]
  /** Below this ratio a battery is low, at or above `high` it is good. */
  low: number
  high: number
}

export type TankKind = 'fuel' | 'water' | 'waste' | 'other'

export interface TankItem {
  id: string
  name: string
  kind: TankKind
  /** Level as a ratio (0–1). */
  level?: number
  levelText?: string
  volumeText?: string
  /** What the tank went down by over the previous day. */
  usedYesterdayText?: string
}

export interface TankData {
  items: TankItem[]
}

export interface SunData {
  now: string
  sunrise?: string
  sunset?: string
  dawn?: string
  dusk?: string
  sunriseText?: string
  sunsetText?: string
  dawnText?: string
  duskText?: string
}

export interface MoonData {
  phaseName?: string
  /** Position in the lunar cycle: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase?: number
  /** Illuminated part of the disc (0–1). */
  fraction?: number
  riseText?: string
  setText?: string
  always?: 'up' | 'down'
  /** South of the equator the waxing moon is lit on the left. */
  southern: boolean
}

export interface TidePoint {
  time: string
  /** Height in metres above the station's datum. */
  level: number
  high: boolean
  timeText: string
  levelText: string
}

export interface TideData {
  now: string
  station?: string
  state?: string
  nowText?: string
  /** Height now in metres, to start the curve when no extreme lies before now. */
  nowLevel?: number
  /** Extremes around now, oldest first, for the curve. */
  points: TidePoint[]
}

export type WeatherCondition = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'showers' | 'thunder' | 'snow'

export interface WeatherDay {
  date: string
  name: string
  condition: WeatherCondition
  description?: string
  temperatureText?: string
  windText?: string
  /** Direction the wind comes from, in radians. */
  windDirection?: number
  compass?: string
  gustText?: string
  /** Strong wind, worth its own symbol. */
  windy: boolean
  rainText?: string
  waveText?: string
}

export interface WeatherBlockData {
  days: WeatherDay[]
  warnings: string[]
}

export interface BulletinSystem {
  text: string
  distanceText?: string
  tropical: boolean
}

export interface BulletinData {
  title: string
  issued?: string
  url: string
  warnings: string[]
  systems: BulletinSystem[]
}

export interface StormItem {
  name: string
  alertLevel: 'green' | 'orange' | 'red' | 'unknown'
  description?: string
  positionText: string
  distanceNm: number
  /** Bearing from the vessel to the storm, in radians. */
  bearing: number
  compass: string
  updatedText?: string
  url?: string
}

export interface StormData {
  radiusNm: number
  storms: StormItem[]
}

export interface OvernightData {
  name: string
  fromText: string
  toText: string
  startSocText?: string
  endSocText?: string
  usedAhText?: string
  chargedAhText?: string
  minVoltageText?: string
  /** State of charge over the window (0–1, null where unknown), for a small curve. */
  soc: Array<number | null>
}
