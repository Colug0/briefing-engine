import { create } from 'zustand'
import { api, type Briefing, type Run, type Status, type Types } from './api'

export type View = { name: 'home' } | { name: 'briefings' } | { name: 'edit'; id?: string } | { name: 'history'; briefingId?: string }

interface State {
  view: View
  types?: Types
  status?: Status
  briefings: Briefing[]
  runs: Run[]
  error?: string
  busy: Record<string, boolean>
  go(view: View): void
  load(): Promise<void>
  loadRuns(briefingId?: string): Promise<void>
  /** Run an action, show its error, and reload. */
  act(key: string, fn: () => Promise<unknown>): Promise<boolean>
  clearError(): void
}

/** View state lives here, not in components, so it survives navigating between views. */
export const useStore = create<State>((set, get) => ({
  view: { name: 'home' },
  briefings: [],
  runs: [],
  busy: {},
  go: (view) => set({ view, error: undefined }),
  async load() {
    try {
      const [types, status, briefings] = await Promise.all([api.types(), api.status(), api.briefings()])
      set({ types, status, briefings })
    } catch (error) {
      set({ error: String((error as Error).message ?? error) })
    }
  },
  async loadRuns(briefingId) {
    try {
      set({ runs: await api.runs(briefingId) })
    } catch (error) {
      set({ error: String((error as Error).message ?? error) })
    }
  },
  async act(key, fn) {
    set((s) => ({ busy: { ...s.busy, [key]: true }, error: undefined }))
    try {
      await fn()
      await get().load()
      return true
    } catch (error) {
      set({ error: String((error as Error).message ?? error) })
      return false
    } finally {
      set((s) => ({ busy: { ...s.busy, [key]: false } }))
    }
  },
  clearError: () => set({ error: undefined })
}))
