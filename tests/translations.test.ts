import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { german, translate } from '../src/shared/translations'
import { DEFAULT_OVERLAY_APPEARANCE, overlayValues, renderOverlay } from '../src/shared/overlay'
import { EMPTY_STATS } from '../src/shared/types'

describe('English and German', () => {
  it('translates interpolated messages and preserves user names and overlay placeholders', () => {
    expect(translate('en', 'Fight against {name}', { name: 'MrKekstein' })).toBe('Fight against MrKekstein')
    expect(translate('de', 'Fight against {name}', { name: 'MrKekstein' })).toBe('Kampf gegen MrKekstein')
    expect(translate('de', '{count} deaths', { count: 2 })).toBe('2 Tode')
    expect(translate('de', '{{profit}} / {{loss}}')).toBe('{{profit}} / {{loss}}')
    for (const [source, target] of Object.entries(german)) {
      expect(target.match(/\{\w+\}/g)?.sort() ?? []).toEqual(source.match(/\{\w+\}/g)?.sort() ?? [])
    }
  })

  it('provides German translations for every literal translation key in the UI', () => {
    for (const file of ['App', 'FightDetailsDialog', 'FightWeapon', 'OverlayEditor', 'i18n', 'DebugPanel', 'UpdateSettings']) {
      const text = readFileSync(`src/renderer/src/${file}.tsx`, 'utf8')
      const source = ts.createSourceFile(file + '.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          expect(german, `${file}: ${node.arguments[0].text}`).toHaveProperty(node.arguments[0].text)
        }
        if (ts.isJsxText(node) && /[a-zA-Z]/.test(node.text)) {
          expect(['ALBION', 'PvP Tracker', 'HTML', 'CSS', 'English', 'Deutsch', '· DEV']).toContain(node.text.trim())
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  })

  it('localizes default OBS text and numbers without rewriting custom designs', () => {
    const stats = { ...EMPTY_STATS, profit: 1500000, lossValue: 100000 }
    const values = overlayValues(stats, 'de')
    expect(values.profit).toBe('+1,5m')
    expect(values.profit_raw).toBe('1500000')
    const defaults = renderOverlay({ ...DEFAULT_OVERLAY_APPEARANCE, language: 'de' }, values)
    expect(defaults).toContain('Gewinn:')
    expect(defaults).toContain('Verlust:')
    expect(defaults).toContain('lang="de"')
    const custom = renderOverlay({ ...DEFAULT_OVERLAY_APPEARANCE, language: 'de', overlayCustomEnabled: true,
      overlayHtml: '<p>My Profit: {{profit}}</p>' }, values)
    expect(custom).toContain('My Profit:')
    expect(custom).not.toContain('Gewinn:')
  })
})
