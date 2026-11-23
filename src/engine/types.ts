import type { TSchema } from 'typebox'

/** One rendered section of a briefing, produced by a content type. */
export interface Block {
  title: string
  /** Plain text for screens and push messages. */
  text: string
  /** Text written to be spoken; falls back to `text`. */
  speech?: string
  /** Optional richer form for deliveries that render Markdown. */
  markdown?: string
  /** Structured values, shown or used by deliveries that can. */
  data?: unknown
}

/** A value converted to the unit the server's unit preferences choose. */
export interface DisplayValue {
  value: number
  symbol: string
  /** Number and symbol ready to print, e.g. "12.6 V". */
  text: string
}

/** What the engine hands to every trigger, content and delivery. */
export interface Ctx {
  /** The current value of a path below vessels.self, or undefined. */
  getSelf(path: string): unknown
  /** Path keys directly below a vessels.self branch, e.g. battery ids below electrical.batteries. */
  childKeys(path: string): string[]
  /** Convert an SI value of `path` to its display unit, or undefined when that is not possible. */
  display(path: string, value: number): DisplayValue | undefined
  /** Local time of the vessel, formatted for text, e.g. "06:12". */
  time(iso: string | Date): string
  /** Local date of the vessel, e.g. "Mon 23 Nov". */
  date(iso: string | Date): string
  /** Offset of the vessel's local time from UTC in minutes. */
  utcOffsetMinutes(): number
  now(): Date
  /** In-process server APIs; undefined when the server or a provider does not offer them. */
  weather(): WeatherApiLike | undefined
  history(): Promise<HistoryApiLike | undefined>
  /** Send a value for a path below vessels.self into the data model as this plugin. */
  publish(path: string, value: unknown): void
  /** Listen to a path below vessels.self; returns an unsubscribe function. */
  onSelfValue(path: string, cb: (value: unknown) => void): () => void
  /** Persistent state for a trigger, kept across restarts. */
  state: StateStore
  log: { debug(msg: string): void; error(msg: string): void }
}

export interface StateStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export interface Position {
  latitude: number
  longitude: number
}

export interface WeatherApiLike {
  getForecasts(position: Position, type: 'daily' | 'point', options?: { maxCount?: number }): Promise<WeatherData[]>
  getWarnings?(position: Position): Promise<Array<{ startTime?: string; endTime?: string; details?: string; source?: string; type?: string }>>
}

export interface WeatherData {
  date: string
  description?: string
  outside?: {
    minTemperature?: number
    maxTemperature?: number
    temperature?: number
    pressure?: number
    precipitationVolume?: number
    cloudCover?: number
    relativeHumidity?: number
  }
  wind?: { speedTrue?: number; directionTrue?: number; gust?: number }
  water?: { waveSignificantHeight?: number; swellHeight?: number; temperature?: number }
}

export interface HistoryApiLike {
  getValues(query: unknown): Promise<{ data: Array<[string, ...unknown[]]> }>
}

/** A reason a briefing ran, shown in the history. */
export type FireReason = string

export interface TriggerType<C = Record<string, unknown>> {
  id: string
  title: string
  description: string
  schema: TSchema
  /** Start watching; call `fire` when the briefing should run. Returns a stop function. */
  start(ctx: Ctx, config: C, fire: (reason: FireReason) => void, key: string): () => void
}

export interface ContentType<C = Record<string, unknown>> {
  id: string
  title: string
  description: string
  schema: TSchema
  fetch(ctx: Ctx, config: C): Promise<Block>
}

export interface DeliveryType<C = Record<string, unknown>> {
  id: string
  title: string
  description: string
  schema: TSchema
  deliver(ctx: Ctx, config: C, run: RunResult): Promise<void>
}

/** A configured trigger, content or delivery inside a briefing. */
export interface Part {
  type: string
  config: Record<string, unknown>
}

export interface Briefing {
  id: string
  name: string
  enabled: boolean
  triggers: Part[]
  contents: Part[]
  deliveries: Part[]
}

export interface BlockResult extends Block {
  type: string
  error?: string
}

export interface DeliveryResult {
  type: string
  ok: boolean
  error?: string
}

export interface RunResult {
  id: string
  briefingId: string
  briefingName: string
  at: string
  reason: FireReason
  blocks: BlockResult[]
  deliveries: DeliveryResult[]
}
