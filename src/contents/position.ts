import Type from 'typebox'
import type { ContentType } from '../engine/types.js'
import { isNum } from './helpers.js'

function dm(value: number, pos: string, neg: string): string {
  const abs = Math.abs(value)
  const deg = Math.floor(abs)
  const min = (abs - deg) * 60
  return `${deg}°${min.toFixed(1).padStart(4, '0')}'${value >= 0 ? pos : neg}`
}

export const positionContent: ContentType<Record<string, never>> = {
  id: 'position',
  emoji: '📍',
  title: 'Position',
  description: "The vessel's position.",
  schema: Type.Object({}),
  async fetch(ctx) {
    const p = ctx.getSelf('navigation.position') as { latitude?: unknown; longitude?: unknown } | undefined
    if (!p || !isNum(p.latitude) || !isNum(p.longitude)) throw new Error('no position')
    const text = `${dm(p.latitude, 'N', 'S')} ${dm(p.longitude, 'E', 'W')}`
    return {
      title: 'Position',
      text: `Position: ${text}.`,
      summary: text,
      speech: `Position: ${Math.abs(p.latitude).toFixed(2)} degrees ${p.latitude >= 0 ? 'north' : 'south'}, ${Math.abs(p.longitude).toFixed(2)} degrees ${p.longitude >= 0 ? 'east' : 'west'}.`,
      data: { latitude: p.latitude, longitude: p.longitude, text }
    }
  }
}
