import Type from 'typebox'
import type { DeliveryType } from '../engine/types.js'

/**
 * Every run is kept in the history; this delivery marks it for the webapp's
 * front page, which shows the runs that carry it.
 */
export const webappDelivery: DeliveryType<Record<string, never>> = {
  id: 'webapp',
  title: 'Webapp',
  description: "Show the briefing on this plugin's webapp.",
  schema: Type.Object({}),
  async deliver() {}
}
