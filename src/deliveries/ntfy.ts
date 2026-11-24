import Type, { type Static } from 'typebox'
import { INTERNET_PATH, mayUseInternet } from '../engine/internet.js'
import { briefingText } from '../engine/runner.js'
import type { Severity } from '../engine/severity.js'
import type { Ctx, DeliveryType, RunResult } from '../engine/types.js'

/*
 * Publishing follows the ntfy transport of signalk-alert-center
 * (github.com/arodus/signalk-alert-center, MIT): which HTTP answers are worth
 * a retry, and reading only a short prefix of an error answer.
 */

const Target = (title: string, description: string) =>
  Type.Object(
    {
      enabled: Type.Boolean({ title: 'Send here', default: false }),
      server: Type.String({ title: 'Server', description: 'e.g. http://ntfy.local or https://ntfy.sh', default: '' }),
      topic: Type.String({ title: 'Topic', default: '' }),
      token: Type.Optional(Type.String({ title: 'Access token', description: 'Only for servers that need one' }))
    },
    { title, description }
  )

const Schema = Type.Object({
  local: Target('Server on board', 'Sent at once; it does not wait for an internet connection.'),
  internet: Target('Server on the internet', 'Sent when signalk-internet reports a connection; until then the newest briefing waits (at most 24 h).'),
  priority: Type.Integer({ title: 'Priority', description: '1 (min) to 5 (max); ntfy’s default is 3.', default: 3, minimum: 1, maximum: 5 }),
  escalate: Type.Boolean({ title: 'Raise the priority for warnings', description: 'Warnings in the briefing raise it to at least 4, alarms to 5.', default: true }),
  click: Type.Optional(Type.String({ title: 'Link when tapped', description: 'e.g. the address of this webapp on board' }))
})
type Config = Static<typeof Schema>
type TargetConfig = Config['local']

export interface NtfyMessage {
  server: string
  topic: string
  token?: string
  title: string
  message: string
  priority: number
  click?: string
}

interface Pending {
  at: string
  msg: NtfyMessage
}

const PENDING_KEY = 'ntfy/pending'
const MAX_WAIT_MS = 24 * 3_600_000
const RETRY_MS = 5 * 60_000
/** ntfy turns longer messages into attachments. */
const MAX_MESSAGE = 4000

export function priorityFor(base: number, severity: Severity | undefined, escalate: boolean): number {
  if (!escalate || !severity) return base
  return Math.max(base, severity === 'alarm' ? 5 : 4)
}

export class NtfyError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

async function readPrefix(response: Response, max = 8_192): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, max)
  } catch {
    return ''
  }
}

/** Publish with ntfy's JSON API, which keeps any characters in the title. */
export async function publish(ctx: Ctx, msg: NtfyMessage): Promise<void> {
  let response: Response
  try {
    response = await ctx.http(msg.server.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(msg.token ? { Authorization: `Bearer ${msg.token}` } : {}) },
      body: JSON.stringify({
        topic: msg.topic,
        title: msg.title,
        message: msg.message,
        priority: msg.priority,
        ...(msg.click ? { click: msg.click } : {})
      })
    })
  } catch (error) {
    throw new NtfyError(`${msg.server}: ${error instanceof Error ? error.message : String(error)}`, true)
  }
  if (response.ok) return
  const retryable = [408, 425, 429].includes(response.status) || response.status >= 500
  throw new NtfyError(`${msg.server}: HTTP ${response.status} ${(await readPrefix(response)).trim().slice(0, 200)}`, retryable)
}

function usable(t: TargetConfig): boolean {
  return t.enabled && t.server.trim() !== '' && t.topic.trim() !== ''
}

function messageFor(t: TargetConfig, config: Config, run: RunResult): NtfyMessage {
  const body = briefingText(run).split('\n\n').slice(1).join('\n\n')
  return {
    server: t.server.trim(),
    topic: t.topic.trim(),
    token: t.token?.trim() || undefined,
    title: run.briefingName,
    message: body.length > MAX_MESSAGE ? `${body.slice(0, MAX_MESSAGE - 1)}…` : body,
    priority: priorityFor(config.priority, run.severity, config.escalate),
    click: config.click?.trim() || undefined
  }
}

function pending(ctx: Ctx): Record<string, Pending> {
  const v = ctx.state.get(PENDING_KEY)
  return v && typeof v === 'object' ? { ...(v as Record<string, Pending>) } : {}
}

/** Send what waited for the internet; keep what may succeed later. */
export async function flushPending(ctx: Ctx): Promise<void> {
  if (!mayUseInternet(ctx.internet())) return
  const queue = pending(ctx)
  let changed = false
  for (const [key, p] of Object.entries(queue)) {
    if (ctx.now().getTime() - Date.parse(p.at) > MAX_WAIT_MS) {
      delete queue[key]
      changed = true
      ctx.log.debug(`ntfy: dropped "${p.msg.title}", it waited more than 24 h`)
      continue
    }
    try {
      await publish(ctx, p.msg)
      delete queue[key]
      changed = true
    } catch (error) {
      if (!(error instanceof NtfyError && error.retryable)) {
        delete queue[key]
        changed = true
      }
      ctx.log.error(`ntfy: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (changed) ctx.state.set(PENDING_KEY, queue)
}

export const ntfyDelivery: DeliveryType<Config> = {
  id: 'ntfy',
  title: 'ntfy push',
  description: 'Push the briefing to ntfy: a server on board right away, a server on the internet once there is a connection.',
  schema: Schema,
  async deliver(ctx, config, run) {
    const errors: string[] = []
    const notes: string[] = []
    if (usable(config.local)) {
      try {
        await publish(ctx, messageFor(config.local, config, run))
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (usable(config.internet)) {
      const msg = messageFor(config.internet, config, run)
      const wait = (): void => {
        const queue = pending(ctx)
        // Only the newest briefing of each kind is worth sending late.
        queue[`${run.briefingId}|${msg.server}|${msg.topic}`] = { at: run.at, msg }
        ctx.state.set(PENDING_KEY, queue)
        notes.push('internet server: waiting for a connection')
      }
      if (!mayUseInternet(ctx.internet())) wait()
      else {
        try {
          await publish(ctx, msg)
        } catch (error) {
          if (error instanceof NtfyError && error.retryable) wait()
          else errors.push(error instanceof Error ? error.message : String(error))
        }
      }
    }
    if (!usable(config.local) && !usable(config.internet)) errors.push('no server with topic is enabled')
    if (errors.length) throw new Error(errors.join('; '))
    return notes.join('; ') || undefined
  },
  start(ctx) {
    const run = (): void => void flushPending(ctx).catch((e: unknown) => ctx.log.error(`ntfy: ${String(e)}`))
    const unsubscribe = ctx.onSelfValue(INTERNET_PATH, run)
    const timer = setInterval(run, RETRY_MS)
    const first = setTimeout(run, 0)
    return () => {
      unsubscribe()
      clearInterval(timer)
      clearTimeout(first)
    }
  }
}
