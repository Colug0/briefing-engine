import Type, { type Static } from 'typebox'
import type { ContentType } from '../engine/types.js'
import { isNum } from './helpers.js'

const PathSchema = Type.Object({
  path: Type.String({ title: 'Signal K path', description: 'Below vessels.self, e.g. environment.water.temperature', minLength: 1 }),
  label: Type.Optional(Type.String({ title: 'Label', description: 'Shown before the value; the path when empty' }))
})

export const pathContent: ContentType<Static<typeof PathSchema>> = {
  id: 'path',
  title: 'Signal K value',
  description: 'The current value of any Signal K path, in your display units.',
  schema: PathSchema,
  async fetch(ctx, config) {
    const title = config.label?.trim() || config.path
    const value = ctx.getSelf(config.path)
    let text: string
    if (isNum(value)) text = ctx.display(config.path, value)?.text ?? String(value)
    else if (value === undefined || value === null) text = 'no data'
    else if (typeof value === 'object') text = JSON.stringify(value)
    else text = String(value)
    return { title, text: `${title}: ${text}.`, data: { path: config.path, value } }
  }
}
