import type { Registry } from './registry.js'
import { runBriefing } from './runner.js'
import type { Store } from './store.js'
import type { Ctx, FireReason, RunResult } from './types.js'

export interface EngineOptions {
  contentTimeoutMs: number
}

/**
 * Keeps the triggers of every enabled briefing running and runs a briefing
 * when one fires. A briefing that is still being built is not started again.
 */
export class Engine {
  private stops: Array<() => void> = []
  private running = new Set<string>()

  constructor(
    private readonly ctx: Ctx,
    private readonly registry: Registry,
    private readonly store: Store,
    private readonly options: EngineOptions
  ) {}

  /** (Re)start the triggers after briefings changed. */
  sync(): void {
    this.stopTriggers()
    for (const briefing of this.store.listBriefings()) {
      if (!briefing.enabled) continue
      briefing.triggers.forEach((part, i) => {
        const type = this.registry.triggers.get(part.type)
        if (!type) return
        const key = `${briefing.id}/${i}/${part.type}`
        try {
          this.stops.push(type.start(this.ctx, part.config, (reason) => void this.run(briefing.id, reason), key))
        } catch (error) {
          this.ctx.log.error(`${briefing.name}: trigger ${type.title} did not start: ${String(error)}`)
        }
      })
    }
  }

  /** Run a briefing now; undefined when it does not exist or is already running. */
  async run(briefingId: string, reason: FireReason): Promise<RunResult | undefined> {
    const briefing = this.store.getBriefing(briefingId)
    if (!briefing || this.running.has(briefingId)) return undefined
    this.running.add(briefingId)
    try {
      this.ctx.log.debug(`${briefing.name}: running (${reason})`)
      return await runBriefing(this.ctx, this.registry, briefing, reason, this.options, (r) => this.store.addRun(r))
    } finally {
      this.running.delete(briefingId)
    }
  }

  stop(): void {
    this.stopTriggers()
  }

  private stopTriggers(): void {
    for (const stop of this.stops.splice(0)) {
      try {
        stop()
      } catch {
        // a trigger that fails to stop must not keep the others running
      }
    }
  }
}
