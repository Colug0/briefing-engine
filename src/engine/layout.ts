import type { BlockResult, RunResult } from './types.js'

/**
 * A briefing as short lines for push messages: one line per block, led by
 * its emoji, with the block's parts (batteries, tanks, days) indented below.
 * Blocks without parts, and failed ones, show their text.
 */
function head(b: BlockResult): string {
  const warn = b.severity === 'alarm' ? '🚨 ' : b.severity === 'warn' ? '⚠️ ' : ''
  return `${b.emoji ? `${b.emoji} ` : ''}${warn}${b.error ? b.text : (b.summary ?? b.text)}`
}

/** Plain text that reads well in any ntfy app. */
export function plainLayout(run: RunResult): string {
  return run.blocks
    .map((b) => [head(b), ...(!b.error && b.items ? b.items.map((i) => `  • ${i}`) : [])].join('\n'))
    .join('\n')
}

const escapeMd = (s: string) => s.replace(/([\\*_`#[\]])/g, '\\$1')

/** Markdown for ntfy's Android and web apps: bold headings, parts as lists. */
export function markdownLayout(run: RunResult): string {
  return run.blocks
    .map((b) => {
      const title = b.items?.length && !b.error ? `**${escapeMd(head(b))}**` : escapeMd(head(b))
      const list = !b.error && b.items ? b.items.map((i) => `- ${escapeMd(i)}`) : []
      return [title, ...list].join('\n')
    })
    .join('\n\n')
}
