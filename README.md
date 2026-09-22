# Albion PvP Tracker

A modern, local-first desktop tracker for Albion Online PvP events. It stores data in SQLite, values victim equipment with historical median prices, and exposes a small OBS browser-source overlay.

## Included in this MVP

- Europe, Americas, and Asia character search
- automatic polling of global events plus recent player kills/deaths
- KILL / ASSIST / DEATH classification
- Median of daily historical `avg_price` values, without volume weighting, over the last seven completed UTC days; Excellent/Brecilien preferred with market and Normal-quality fallbacks
- fights are saved immediately; valuation runs separately and retries failures without blocking imports
- legacy median/max-sell valuations are automatically replaced; pending values are excluded from silver totals until recalculated
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

## Language / Sprache

English is the default. Select **English** or **Deutsch** in the header or on the character-selection screen. The choice is saved immediately and survives restarts. Interface text, dates, numbers and the standard OBS overlay follow the selected language. Custom HTML/CSS and player/item identifiers are preserved.

Englisch ist die Standardsprache. Wähle **English** oder **Deutsch** im Kopfbereich oder bei der Charakterauswahl. Die Auswahl wird sofort gespeichert und bleibt nach einem Neustart erhalten. Oberfläche, Datums- und Zahlenformate sowie das Standard-OBS-Overlay folgen der Sprache. Eigenes HTML/CSS und Spieler-/Item-IDs bleiben erhalten.

## OBS setup

### Profit tracking period

On the dashboard, **Ab jetzt tracken** starts a new profit session at the current time. Dashboard totals and the OBS overlay count only fights whose event time is on or after that start. Late imports of older fights do not enter the session. **Neue Sitzung ab jetzt** resets the session start, without deleting any fights.

**Ganzer Tag** returns to the current local calendar day, beginning at midnight. Sessions continue across midnight until you change the mode or start a new session. The selection is saved per character and survives app restarts. Fight history and Statistics retain their independent Today / 7 days / 30 days / All time filters.

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
| `{{profit}}` | Tracked net profit (day or session), formatted and signed, e.g. `+20.6m` |
| `{{loss}}` | Tracked loss (day or session), formatted, e.g. `8.4m` |
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

Market reports can also be missing. The tracker uses the median of daily historical sell-order average prices for the last seven completed UTC days, without weighting by item volume, with a persistent SQLite cache without automatic expiration. It prefers Excellent quality (4) in Brecilien, then Excellent across regular cities. If neither has usable history, it tries Normal quality (1) in Brecilien, then across regular cities. This also covers quality-less items such as potions and food. The Black Market, current partial day and maximum sell quotes are excluded. Indexed lookups and concurrent request sharing reuse one reference price per server and exact item ID (including tier/enchantment), regardless of worn quality and across app restarts. The versioned cache excludes previously cached averages. Completed fight valuations (including older pricing methods and zero values) are retained across restarts; only pending fights are calculated in the background. Manual loss overrides are preserved. An item is still valued at zero when no usable history exists; the selected source and quality or missing data are logged in DEV diagnostics. HTTP failures leave the fight queued for retry. Historical medians remain estimates, not actual loot proceeds; this is not a verified copy of KillBoard#1's valuation formula.

## DEV diagnostics

Run `npm run dev` and expand **Developer diagnostics** at the bottom of the app. This panel and its IPC handlers are unavailable in packaged releases.

- Inspect the active profile, saved session start, collector status and pending-price count.
- See whether a stored event falls before the session start and whether it is an assist (excluded from net profit).
- Inspect the latest 500 in-memory log entries, including event pagination, endpoint failures, price calculations and retries. Filter warnings/errors or copy a JSON snapshot before closing the app.
- Enter an event ID and use **Check and import event** to retrieve a missing event for the active participant. Existing events are not duplicated; importing never changes the session start.

The global feed is paged with overlap, up to the API's recent window. Old assists can still be unavailable after a long offline period. Timestamp filtering uses the fight's UTC event time rather than the later import time. A new session intentionally excludes earlier events; select **Whole day** to include the earlier fights from today.

## Privacy

Profiles, events, prices, and settings remain on the local computer. The app contacts only Albion's Game Info endpoints and the Albion Online Data Project price endpoints.

## Disclaimer

This project is not affiliated with Sandbox Interactive GmbH. Albion Online is a trademark of Sandbox Interactive GmbH. Market data is provided by the community-run Albion Online Data Project.

## License

MIT

## Display scaling and persistent caches

Under **Settings → Appearance → UI scale**, select 100%, 125%, 150%, 175% or 200% and save. Text, icons and controls scale together; the setting survives restarts. The OBS overlay keeps its own size.

Item images for weapon icons, equipment and inventory are stored permanently in the app user-data folder under `item-images`. Previously downloaded images also work offline after restart. Failed downloads can be retried. Prices and completed fight valuations remain in `tracker.db` and are reused without automatic expiry or startup recalculation; newly encountered items still require a market request.
