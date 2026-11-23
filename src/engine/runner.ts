import { randomUUID } from 'node:crypto'
import type { Registry } from './registry.js'
import type { BlockResult, Briefing, Ctx, DeliveryResult, FireReason, RunResult } from './types.js'

export interface RunOptions {
  /** Longest a single content block may take before it is reported as unavailable. */
  contentTimeoutMs: number
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${Math.round(ms / 1000)} s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Build a briefing: all content blocks in parallel, each with its own timeout,
 * so one slow or broken source shows up as one unavailable section instead
 * of stopping the briefing. Then hand the result to every delivery in turn.
 */
export async function runBriefing(
  ctx: Ctx,
  registry: Registry,
  briefing: Briefing,
  reason: FireReason,
  options: RunOptions,
  record: (run: RunResult) => void
): Promise<RunResult> {
  const blocks: BlockResult[] = await Promise.all(
    briefing.contents.map(async (part): Promise<BlockResult> => {
      const type = registry.contents.get(part.type)
      if (!type) return { type: part.type, title: part.type, text: 'Unknown content type.', error: 'unknown type' }
      try {
        const block = await withTimeout(type.fetch(ctx, part.config), options.contentTimeoutMs)
        return { type: part.type, ...block }
      } catch (error) {
        ctx.log.debug(`${briefing.name}: ${type.title} failed: ${message(error)}`)
        return { type: part.type, title: type.title, text: `${type.title}: not available (${message(error)}).`, error: message(error) }
      }
    })
  )

  const run: RunResult = {
    id: randomUUID(),
    briefingId: briefing.id,
    briefingName: briefing.name,
    at: ctx.now().toISOString(),
    reason,
    blocks,
    deliveries: []
  }

  for (const part of briefing.deliveries) {
    const type = registry.deliveries.get(part.type)
    const result: DeliveryResult = { type: part.type, ok: false }
    if (!type) result.error = 'unknown type'
    else {
      try {
        await type.deliver(ctx, part.config, run)
        result.ok = true
      } catch (error) {
        result.error = message(error)
        ctx.log.error(`${briefing.name}: delivery ${type.title} failed: ${result.error}`)
      }
    }
    run.deliveries.push(result)
  }

  record(run)
  return run
}

/** The whole briefing as plain text, one block per paragraph. */
export function briefingText(run: RunResult): string {
  return [run.briefingName, ...run.blocks.map((b) => b.text)].join('\n\n')
}
