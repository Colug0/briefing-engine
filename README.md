# Briefing Engine

Build your own briefings for your boat in Signal K: choose **when** a briefing
runs, **what** it says and **where** it goes.

- **Triggers:** a schedule (daily or on chosen weekdays at ship time), which can
  wait for an internet connection, unlimited or metered; or any Signal K path,
  e.g. a switch or a button. Every briefing can also be run by hand.
- **Content:** position, batteries, tanks, sun, moon, tides, weather forecast,
  official marine weather bulletins (GMDSS, e.g. Fiji Met, MetService NZ, BoM),
  tropical cyclones near the boat (GDACS), and the value of any Signal K path.
  Each block is optional and configurable.
- **Deliveries:** the plugin's own webapp, a Signal K notification
  "Briefing … ready", and ntfy push to a server on board (sent at once) and/or
  a server on the internet (sent once there is a connection).

A block can flag a warning or an alarm; deliveries then raise the ntfy
priority and the notification state, unless that is turned off.

Briefings are created, cloned, enabled and disabled in the webapp
(**Webapps → Briefing Engine**). There each briefing shows with small
graphics: battery and tank gauges (fuel, water and waste in their own
colours), the sun's arc, the moon's phase as seen from your hemisphere, a
tide curve for the day and a weather symbol with wind arrow per day.

Example:

```text
Position: 33°51.4'S 151°12.9'E.
Batteries. House: 87%, 12.91 V, -4.20 A, 31.5 h left.
Sunrise 05:33, sunset 18:05.
Moon: waxing gibbous, 91% lit, rises 15:38, sets 02:56.
Tide at Fort Denison: rising, now 0.8 m. Low water 08:00 (0.3 m), high water 14:12 (1.6 m).
Weather. Today: 23.9 to 28.8 °C, wind 15.0 kn from SE, gusts 21.0 kn, rain 2 mm, waves 1.1 m.
```

## Works with

| Plugin | Used for |
|---|---|
| [@meri-imperiumi/signalk-internet](https://www.npmjs.com/package/@meri-imperiumi/signalk-internet) | `network.internet.state` for schedules that wait for a connection |
| [signalk-derived-data](https://www.npmjs.com/package/signalk-derived-data) | sun and moon (`environment.sunlight.*`, `environment.moon.*`) |
| [signalk-tides](https://www.npmjs.com/package/signalk-tides) | tides (`environment.tide.*`, and its `tides` resource for the tide curve) |
| a weather provider plugin, e.g. [@signalk/open-meteo-provider](https://www.npmjs.com/package/@signalk/open-meteo-provider) | the weather forecast, through the Signal K weather API; the default provider answers. Open-Meteo's weather texts give each day its symbol |

Without one of them, the matching block says it is not available and the rest
of the briefing still runs.

Marine bulletins come from NOAA's TGFTP mirror of the GTS and tropical cyclones
from [GDACS](https://www.gdacs.org); both are fetched when there is internet
and shown from the last answer, with its age, when there is not. A warning in a
bulletin or an orange GDACS alert marks the briefing as a warning. A storm
closer than 300 nm, a red GDACS alert, or storm or hurricane force in a warning
or a nearby tropical system marks it as an alarm.

## Ship time and units

Times are ship time from `environment.time.timezoneOffset`. When several
plugins publish that path with different values, set **Timezone source** in
the plugin configuration to the one to trust (its `$source`).
Without the path, times are UTC.

Numbers use the server's unit preferences where the server converts units for
plugins (tested with Signal K 2.37); otherwise they come in knots, °C, %, hPa
and litres.

## Configuration

| Setting | Default | |
|---|---|---|
| Timezone source | – | `$source` to prefer for the ship's timezone offset |
| Content timeout | 20 s | a block that takes longer is reported as not available |
| Briefings kept in the history | 100 | |
| Offline data shown for | 24 h | without internet, blocks that fetch from the internet through the plugin's cache show their last data with the time it was fetched, until it is this old |

Briefings, their history and the schedules' state are stored in the plugin's
data directory (`plugin-config-data/briefing-engine/briefings/`). Remembered
internet data lives in `cache/` next to it, tagged with `CACHEDIR.TAG` so
backups skip it.

The ntfy delivery follows the ntfy transport of
[signalk-alert-center](https://github.com/arodus/signalk-alert-center) (MIT).

## Adding a type

Each trigger, content and delivery type is one file in `src/triggers`,
`src/contents` or `src/deliveries`, registered in `src/types.ts`. A type has
an `id`, a `title`, a `description`, a [TypeBox](https://github.com/sinclairzx81/typebox)
`schema` for its settings, from which the webapp builds its form, and one
function:

```ts
export const myContent: ContentType<{ path: string }> = {
  id: 'my-content',
  title: 'My content',
  description: 'What it says.',
  schema: Type.Object({ path: Type.String({ title: 'Path' }) }),
  async fetch(ctx, config) {
    return { title: 'My content', text: `It is ${ctx.getSelf(config.path)}.` }
  }
}
```

A content type can also return `data`; when the webapp has a view for the
type (`web/src/blocks`), it draws that instead of the text. The data shapes
are in `src/contents/data.ts`.

`ctx` gives access to Signal K values, display units, ship time, the weather
and history APIs and persistent state. A content block that throws is shown as
"not available" with the reason.

## Development

```sh
npm install
npm test           # unit tests
npm run typecheck
npm run build      # plugin to dist/, webapp to public/
```

## License

MIT
