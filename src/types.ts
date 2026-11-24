/**
 * Every trigger, content and delivery type the plugin offers. To add a type,
 * write one file next to the others and add it to the matching list here;
 * the webapp builds its form from the type's schema.
 */
import { batteryContent } from './contents/battery.js'
import { bulletinContent } from './contents/bulletin.js'
import { moonContent } from './contents/moon.js'
import { overnightContent } from './contents/overnight.js'
import { pathContent } from './contents/path.js'
import { positionContent } from './contents/position.js'
import { stormContent } from './contents/storms.js'
import { sunContent } from './contents/sun.js'
import { tankContent } from './contents/tanks.js'
import { tideContent } from './contents/tides.js'
import { weatherContent } from './contents/weather.js'
import { notificationDelivery } from './deliveries/notification.js'
import { ntfyDelivery } from './deliveries/ntfy.js'
import { webappDelivery } from './deliveries/webapp.js'
import { Registry } from './engine/registry.js'
import { pathTrigger } from './triggers/path.js'
import { scheduleTrigger } from './triggers/schedule.js'

export function createRegistry(): Registry {
  return new Registry({
    triggers: [scheduleTrigger, pathTrigger],
    contents: [positionContent, batteryContent, overnightContent, tankContent, sunContent, moonContent, tideContent, weatherContent, bulletinContent, stormContent, pathContent],
    deliveries: [webappDelivery, notificationDelivery, ntfyDelivery]
  })
}
