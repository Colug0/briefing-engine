import { describe, expect, it } from 'vitest'
import type { RJSFSchema } from '@rjsf/utils'
import { summarize, withChoices } from '../web/src/parts.js'

describe('summary line of a part in the editor', () => {
  const schema: RJSFSchema = {
    type: 'object',
    properties: {
      time: { type: 'string', title: 'Time', default: '07:00' },
      days: { type: 'array', title: 'Days', items: { type: 'string', enum: ['mon', 'tue'] }, default: ['mon', 'tue'] },
      radiusNm: { type: 'number', title: 'Radius (nm)', default: 600 },
      low: { type: 'number', title: 'Low below (%)', default: 30 },
      markdown: { type: 'boolean', title: 'Markdown', default: false },
      local: {
        type: 'object',
        title: 'Local server',
        properties: { enabled: { type: 'boolean' }, server: { type: 'string' }, topic: { type: 'string' }, token: { type: 'string' } }
      }
    }
  }

  it('shows settings, falling back to defaults', () => {
    expect(summarize(schema, {})).toBe('07:00 · days: all · radius 600 nm · low below 30%')
  })

  it('names switches that are on and leaves out secrets', () => {
    expect(summarize(schema, { days: ['mon'], markdown: true, local: { enabled: true, server: 'http://ntfy', topic: 'boat', token: 'tk_secret' } })).toBe(
      '07:00 · mon · radius 600 nm · low below 30% · markdown · http://ntfy boat'
    )
  })

  it('leaves out groups that are off', () => {
    expect(summarize(schema, { local: { enabled: false, server: 'x', topic: 'y' } })).not.toContain('x y')
  })
})

describe('choices from the server in the editor', () => {
  const schema: RJSFSchema = {
    type: 'object',
    properties: {
      batteries: { type: 'array', items: { type: 'string' }, default: [] },
      battery: { type: 'string', default: 'house' }
    }
  }
  const choices = {
    batteries: [
      { value: 'house', label: 'House' },
      { value: '1', label: 'Starter' }
    ],
    battery: [{ value: '1', label: 'Starter' }]
  }

  it('offers the batteries as checkboxes and keeps saved ones the server does not report', () => {
    const { schema: s, ui } = withChoices(schema, {}, choices, { batteries: ['old'] })
    const props = s.properties as Record<string, RJSFSchema>
    expect((props.batteries!.items as RJSFSchema).enum).toEqual(['house', '1', 'old'])
    expect(ui.batteries).toEqual({ 'ui:widget': 'checkboxes', items: { 'ui:enumNames': ['House (house)', 'Starter (1)', 'old (no data now)'] } })
    expect(props.battery!.enum).toEqual(['1', 'house'])
    expect(ui.battery).toEqual({ 'ui:enumNames': ['Starter (1)', 'house (no data now)'] })
  })

  it('leaves a field as it is when there is nothing to choose', () => {
    expect(withChoices(schema, {}, { batteries: [] }, {}).schema).toEqual(schema)
  })
})
