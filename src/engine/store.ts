import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Briefing, RunResult, StateStore } from './types.js'

interface Files {
  briefings: Briefing[]
  runs: RunResult[]
  state: Record<string, unknown>
}

const EMPTY: Files = { briefings: [], runs: [], state: {} }

/**
 * Briefings, run history and trigger state as JSON files in the plugin's data
 * directory, which survives plugin updates. Everything is held in memory and
 * written through; writes of one file never overlap.
 */
export class Store implements StateStore {
  private data: Files = structuredClone(EMPTY)
  private writes = new Map<keyof Files, Promise<void>>()

  constructor(
    private readonly dir: string,
    private readonly maxRuns: number,
    private readonly onError: (msg: string) => void = () => {}
  ) {}

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    for (const key of Object.keys(EMPTY) as Array<keyof Files>) {
      try {
        const text = await readFile(this.file(key), 'utf8')
        ;(this.data as unknown as Record<string, unknown>)[key] = JSON.parse(text)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.onError(`Could not read ${key}.json: ${String(error)}`)
      }
    }
  }

  /** Resolves once every pending write has finished. */
  async flush(): Promise<void> {
    await Promise.all(this.writes.values())
  }

  listBriefings(): Briefing[] {
    return structuredClone(this.data.briefings)
  }

  getBriefing(id: string): Briefing | undefined {
    const b = this.data.briefings.find((x) => x.id === id)
    return b && structuredClone(b)
  }

  /** Insert or replace; a briefing without an id gets a new one. */
  saveBriefing(input: Omit<Briefing, 'id'> & { id?: string }): Briefing {
    const briefing: Briefing = { ...structuredClone(input), id: input.id ?? randomUUID() }
    const i = this.data.briefings.findIndex((x) => x.id === briefing.id)
    if (i >= 0) this.data.briefings[i] = briefing
    else this.data.briefings.push(briefing)
    this.persist('briefings')
    return structuredClone(briefing)
  }

  deleteBriefing(id: string): boolean {
    const before = this.data.briefings.length
    this.data.briefings = this.data.briefings.filter((x) => x.id !== id)
    if (this.data.briefings.length === before) return false
    for (const key of Object.keys(this.data.state)) if (key.startsWith(`${id}/`)) delete this.data.state[key]
    this.persist('briefings')
    this.persist('state')
    return true
  }

  /** A disabled copy under a new id and name, so it never fires before it has been edited. */
  cloneBriefing(id: string): Briefing | undefined {
    const source = this.getBriefing(id)
    if (!source) return undefined
    const { id: _drop, ...rest } = source
    return this.saveBriefing({ ...rest, name: `${source.name} (copy)`, enabled: false })
  }

  addRun(run: RunResult): void {
    this.data.runs.unshift(structuredClone(run))
    this.data.runs.length = Math.min(this.data.runs.length, this.maxRuns)
    this.persist('runs')
  }

  listRuns(briefingId?: string): RunResult[] {
    const runs = briefingId ? this.data.runs.filter((r) => r.briefingId === briefingId) : this.data.runs
    return structuredClone(runs)
  }

  get(key: string): unknown {
    return this.data.state[key]
  }

  set(key: string, value: unknown): void {
    this.data.state[key] = value
    this.persist('state')
  }

  private file(key: keyof Files): string {
    return join(this.dir, `${key}.json`)
  }

  private persist(key: keyof Files): void {
    const previous = this.writes.get(key) ?? Promise.resolve()
    const next = previous.then(async () => {
      const target = this.file(key)
      const tmp = `${target}.tmp`
      try {
        await writeFile(tmp, JSON.stringify(this.data[key], null, 2))
        await rename(tmp, target)
      } catch (error) {
        this.onError(`Could not write ${key}.json: ${String(error)}`)
      }
    })
    this.writes.set(key, next)
  }
}
