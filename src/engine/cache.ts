import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Backup tools (kopia, restic, borg) skip a directory whose CACHEDIR.TAG starts with this line. */
const CACHEDIR_TAG = 'Signature: 8a477f597d28d172789f06886806bc55\n# Briefing Engine: internet data kept for offline briefings; it is fetched again when online.\n'

interface Entry {
  at: string
  value: unknown
}

/**
 * The last answer of each internet source, so a briefing made offline can
 * still show it with its age. Lives in its own tagged directory so backups
 * leave it out.
 */
export class Cache {
  private entries: Record<string, Entry> = {}
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly dir: string,
    private readonly onError: (msg: string) => void = () => {}
  ) {}

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(join(this.dir, 'CACHEDIR.TAG'), CACHEDIR_TAG)
    try {
      this.entries = JSON.parse(await readFile(this.file(), 'utf8')) as Record<string, Entry>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.onError(`Could not read the cache: ${String(error)}`)
    }
  }

  get(key: string): { value: unknown; at: Date } | undefined {
    const e = this.entries[key]
    return e ? { value: e.value, at: new Date(e.at) } : undefined
  }

  set(key: string, value: unknown, at: Date): void {
    this.entries[key] = { at: at.toISOString(), value }
    this.writing = this.writing.then(async () => {
      try {
        const tmp = `${this.file()}.tmp`
        await writeFile(tmp, JSON.stringify(this.entries))
        await rename(tmp, this.file())
      } catch (error) {
        this.onError(`Could not write the cache: ${String(error)}`)
      }
    })
  }

  flush(): Promise<void> {
    return this.writing
  }

  private file(): string {
    return join(this.dir, 'cache.json')
  }
}
