import { t } from './i18n'
import { useEffect, useState } from 'react'
import { Swords } from 'lucide-react'
import type { AlbionItem } from '../../shared/types'

export function FightWeapon({ item, label }: { item: AlbionItem | null; label: string }) {
  const [source, setSource] = useState('')
  const itemId = item?.Type
  const quality = item?.Quality ?? 1
  useEffect(() => {
    let active = true
    setSource('')
    if (itemId) void window.tracker.getItemImage(itemId, quality).then((url) => {
      if (active) setSource(url)
    }).catch(() => { /* The full fight still opens when an icon is unavailable. */ })
    return () => { active = false }
  }, [itemId, quality])
  const description = `${label}: ${itemId ? `${itemId} · ${t('Quality')} ${quality}` : t("not recorded")}`
  return <span className="fight-weapon" title={description} role="img" aria-label={description}>
    {source ? <img src={source} alt="" onError={() => setSource('')} /> : <Swords size={17} aria-hidden="true" />}
  </span>
}
