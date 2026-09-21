# Albion PvP Tracker

A modern, local-first desktop tracker for Albion Online PvP events. It stores data in SQLite, values victim equipment with median market prices, and exposes a small OBS browser-source overlay.

## Included in this MVP

- Europe, Americas, and Asia character search
- automatic polling of global events plus recent player kills/deaths
- KILL / ASSIST / DEATH classification
- median of city `sell_price_min` values from the Albion Online Data Project
- values are frozen when an event is first stored
- Today / 7 days / 30 days / all-time statistics
- `Profit = direct Kill Value - Loss`; Assist Value is shown separately in brackets
- local SQLite storage in Electron's application-data directory
- OBS overlay at `http://127.0.0.1:3847/overlay`
- JSON endpoint at `http://127.0.0.1:3847/api/today`
- configurable refresh interval, overlay port, and Windows autostart

## Run in development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

## Tests and production build

```bash
npm run typecheck
npm test
npm run build
```

Create a Windows NSIS installer:

```bash
npm run dist
```

The installer is written to `release/`.

## OBS setup

1. Keep the tracker running.
2. In OBS, add a **Browser** source.
3. Set the URL to `http://127.0.0.1:3847/overlay`.
4. A size around `400 × 120` works well.
5. In the tracker, open **Settings → OBS browser source** and enable **No background (transparent)** to remove the panel background, border and blur. Click **Save settings**.

The server binds only to `127.0.0.1`, so it is not exposed to the LAN or internet.

### Custom HTML and CSS

Enable **Use custom HTML + CSS** in the same settings panel. You can enter an HTML fragment or a complete HTML document, plus CSS in its own field. The preview uses sample numbers and a checkerboard to show transparency.

Place these placeholders in HTML text (not inside attributes, scripts or CSS):

| Placeholder | Value |
| --- | --- |
| `{{profit}}` | Today's net profit, formatted and signed, e.g. `+20.6m` |
| `{{loss}}` | Today's loss, formatted, e.g. `8.4m` |
| `{{profit_raw}}` | Unabbreviated profit, e.g. `20600000` |
| `{{loss_raw}}` | Unabbreviated loss, e.g. `8400000` |

Example HTML:

```html
<div class="stats">
  <span class="profit">{{profit}}</span>
  <span class="loss">{{loss}}</span>
</div>
```

Example CSS:

```css
.stats { display: flex; gap: 24px; padding: 12px; font: bold 32px "Segoe UI", sans-serif; }
.profit { color: #70e1a1; }
.loss { color: #ff7d88; }
```

The tracker fills in the values and updates every three seconds; custom JavaScript is not required or executed. Placeholders can be repeated. **Save settings** applies the design to the running OBS source automatically. When changing the port, also update the OBS source URL. HTML and CSS remain saved when custom mode is switched off.

**No background** also removes backgrounds, panel shadows, borders and backdrop blur from custom designs. Switch it off if your custom CSS should control those. Adjust the OBS source dimensions to fit your design. For an independently hosted overlay, the existing `/api/today` JSON endpoint provides the numeric `profit` and `lossValue` fields.

## Known API limitation

Albion's Game Info API is public but not a formally supported product API. The global event endpoint only exposes a recent window. Direct kills and deaths can be backfilled from player endpoints, but assists can be missed while the app is not running. A future hosted collector would be needed for complete 24/7 assist history.

Market reports can also be missing or stale. The tracker prefers sell-order reports from the last 24 hours and falls back to available non-zero reports. An item is valued at zero when no usable report exists.

## Privacy

Profiles, events, prices, and settings remain on the local computer. The app contacts only Albion's Game Info endpoints and the Albion Online Data Project price endpoints.

## Disclaimer

This project is not affiliated with Sandbox Interactive GmbH. Albion Online is a trademark of Sandbox Interactive GmbH. Market data is provided by the community-run Albion Online Data Project.

## License

MIT
