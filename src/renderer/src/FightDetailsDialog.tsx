import { useEffect, useRef, useState } from 'react'
import { Backpack, CircleDollarSign, Footprints, Hand, HardHat, ImageOff, LoaderCircle, Shield, Shirt, Swords, Utensils, Wine, X } from 'lucide-react'
import type { AlbionItem, AlbionPlayer, FightDetails, FightSummary, ValuationMode } from '../../shared/types'

const SLOTS: Record<string, string> = {
  MainHand: 'Main hand', OffHand: 'Off hand', Head: 'Head', Armor: 'Armor',
  Shoes: 'Shoes', Cape: 'Cape', Bag: 'Bag', Mount: 'Mount', Potion: 'Potion', Food: 'Food'
}
const QUALITIES = ['Unknown', 'Normal', 'Good', 'Outstanding', 'Excellent', 'Masterpiece']
const GEAR_LAYOUT = ['Bag', 'Head', 'Cape', 'MainHand', 'Armor', 'OffHand', 'Potion', 'Shoes', 'Food', 'Mount']
const SLOT_ICONS = { Bag: Backpack, Head: HardHat, Cape: Shield, MainHand: Swords, Armor: Shirt, OffHand: Hand, Potion: Wine, Shoes: Footprints, Food: Utensils, Mount: Shield }

export function FightDetailsDialog({ fight, onClose }: { fight: FightSummary; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [details, setDetails] = useState<FightDetails | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [savingValuation, setSavingValuation] = useState(false)
  const [valuationError, setValuationError] = useState('')

  const changeValuation = async (mode: ValuationMode): Promise<void> => {
    setSavingValuation(true)
    setValuationError('')
    try { setDetails(await window.tracker.setFightValuation(fight.eventId, mode)) }
    catch { setValuationError('Could not save valuation. Inventory-only valuation requires saved inventory data. Please try again.') }
    finally { setSavingValuation(false) }
  }

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { dialog.current?.close(); previousFocus?.focus() }
  }, [])

  useEffect(() => {
    let active = true
    setError('')
    setDetails(null)
    void window.tracker.getFightDetails(fight.eventId).then((result) => {
      if (!active) return
      if (result) setDetails(result)
      else setError('This fight is no longer available for the active character.')
    }).catch(() => {
      if (active) setError('Could not load fight details. Please try again.')
    })
    return () => { active = false }
  }, [fight.eventId, attempt])

  return <dialog ref={dialog} className="fight-dialog" aria-labelledby="fight-title" onCancel={onClose} onClick={(event) => {
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }
  }}>
    <header className="fight-detail-header">
      <div><p className="eyebrow">{fight.type} · FIGHT #{fight.eventId}</p><h2 id="fight-title">Fight against {fight.opponentName}</h2><time dateTime={new Date(fight.timestamp).toISOString()}>{new Date(fight.timestamp).toLocaleString()}</time></div>
      <button autoFocus className="icon-button" aria-label="Close fight details" onClick={onClose}><X size={18} /></button>
    </header>
    {error ? <div role="alert" className="detail-state"><p>{error}</p><button className="secondary-button" onClick={() => setAttempt(attempt + 1)}>Try again</button></div>
      : !details ? <div className="detail-state" role="status"><LoaderCircle className="spin" /> Loading fight details…</div>
      : <>
        <section className="fight-comparison">
          <PlayerGear player={details.player} label="Your gear" />
          <div className="fight-versus">
            <p className="fight-outcome">{details.type === 'DEATH' ? 'killed by' : details.type === 'ASSIST' ? 'assisted' : 'killed'}</p>
            <span className="assist-badge">{details.assists.length ? `${details.assists.length} assist${details.assists.length === 1 ? '' : 's'}` : 'Solo'}</span>
            <div className="versus-stat"><Swords size={21} /><span>Total kill fame</span><strong>{details.killFame.toLocaleString()}</strong></div>
            <div className="versus-stat silver"><CircleDollarSign size={21} /><span>{details.valuationMode === 'NONE' ? 'No item loss' : details.type === 'DEATH' ? 'Estimated loss' : 'Estimated victim value'}</span><strong>{details.estimatedValue.toLocaleString()}</strong><small>silver · {details.valuationMode === 'FULL' ? 'gear + inventory' : details.valuationMode === 'INVENTORY' ? 'inventory only' : 'excluded from value totals'}</small></div>
          </div>
          <PlayerGear player={details.opponent} label="Opponent gear" />
        </section>
        <section className="fight-valuation">
          <label htmlFor="fight-valuation-mode">Item loss for this fight</label>
          <select id="fight-valuation-mode" value={details.valuationMode} disabled={savingValuation} onChange={(event) => void changeValuation(event.target.value as ValuationMode)}>
            <option value="FULL">Full loot — gear + inventory</option>
            <option value="INVENTORY" disabled={!details.victim?.Inventory}>Depths — inventory only</option>
            <option value="NONE">No item loss — 0 silver</option>
          </select>
          {savingValuation && <span role="status">Saving valuation…</span>}
          <p className="detail-note">The API does not reliably identify protected gear. This choice is saved for this fight and updates statistics and the overlay. Fight counts and fame remain unchanged. Original gear + inventory estimate: {details.originalValue.toLocaleString()} silver.</p>
          {valuationError && <p role="alert">{valuationError}</p>}
        </section>
        <p className="detail-note">{details.killer?.Name ?? 'Unknown killer'} killed {details.victim?.Name ?? 'Unknown victim'}. {details.valuationMode === 'NONE' ? 'Manually marked as no item loss.' : <>Value includes {details.valuationMode === 'INVENTORY' ? 'only the victim’s inventory; equipped gear is excluded' : 'the victim’s equipment and inventory'}, using median city sell prices. Missing prices count as zero; this is an estimate, not guaranteed loot. {details.valuationMode === 'INVENTORY' ? 'Inventory valued when this correction was saved' : 'Priced'} {new Date(details.pricingTimestamp).toLocaleString()}.</>} {details.type === 'ASSIST' && 'Assist value is not included in your net profit.'}</p>
        <section className="fight-assists"><h3>Assisted by</h3>
          {details.assists.length ? <ul>{details.assists.map((player, index) => <li key={player.Id ?? index}><b>{player.Name ?? 'Unknown player'}{player.Id && player.Id === details.player?.Id ? ' (you)' : ''}</b><span>{player.GuildName || 'No guild'}{player.AverageItemPower != null ? ` · ${Math.round(player.AverageItemPower)} IP` : ''}</span></li>)}</ul> : <p className="detail-note">No assists recorded for this fight.</p>}
        </section>
      </>}
  </dialog>
}

function PlayerGear({ player, label }: { player: AlbionPlayer | null; label: string }) {
  const inventory = (player?.Inventory ?? []).filter((item): item is AlbionItem => Boolean(item?.Type))
  const mainHand = player?.Equipment?.MainHand
  const showTwoHandedOffhand = /^T\d+_2H_/.test(mainHand?.Type ?? '') && !player?.Equipment?.OffHand?.Type
  return <article className="player-gear">
    <p className="eyebrow">{label}</p><h3>{player?.Name ?? 'Character unavailable'}</h3>
    <div className="player-identity"><p className="detail-note">{player?.GuildName || 'No guild'}{player?.AllianceName ? ` · [${player.AllianceName}]` : ''}</p><p className="player-ip">{player?.AverageItemPower != null ? `${Math.round(player.AverageItemPower)} IP` : 'IP unavailable'}</p></div>
    <div className="equipment-board">{GEAR_LAYOUT.map((slot) => {
      const ghost = slot === 'OffHand' && showTwoHandedOffhand
      return <div key={slot} className={`equipment-position slot-${slot.toLowerCase()}`}><ItemTile item={ghost ? mainHand : player?.Equipment?.[slot]} slot={slot} ghost={ghost} /></div>
    })}</div>
    {!player?.Equipment && <p className="detail-note">Equipment was not included in the saved event.</p>}
    <details className="gear-inventory"><summary>Inventory ({inventory.length} stacks)</summary>{player?.Inventory == null ? <p className="detail-note">Inventory was not included in the saved event.</p> : inventory.length ? <div className="inventory-grid">{inventory.map((item, index) => <ItemTile key={index} item={item} />)}</div> : <p className="detail-note">No inventory items recorded.</p>}</details>
  </article>
}

function ItemTile({ item, slot, ghost = false }: { item: AlbionItem | null | undefined; slot?: string; ghost?: boolean }) {
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const itemId = item?.Type
  const quality = item?.Quality ?? 1
  useEffect(() => {
    let active = true
    setSource(''); setFailed(false)
    if (itemId) void window.tracker.getItemImage(itemId, quality).then((url) => {
      if (active) setSource(url)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [itemId, quality, attempt])
  const label = slot ? SLOTS[slot] ?? slot : 'Inventory'
  const description = itemId ? `${label}: ${itemId} · ${QUALITIES[quality] ?? 'Unknown'}${ghost ? ' · Two-handed weapon (occupies both hands)' : ` · ×${Math.max(1, item?.Count ?? 1)}`}` : `${label}: empty / not recorded`
  const Placeholder = SLOT_ICONS[slot as keyof typeof SLOT_ICONS] ?? Backpack
  return <button type="button" className={`item-tile ${itemId ? 'occupied' : 'vacant'}${ghost ? ' two-handed-ghost' : ''}`} title={description + (failed ? ' · Click to retry image' : '')} aria-label={description + (failed ? '. Click to retry image' : '')} onClick={() => { if (failed) setAttempt(attempt + 1) }}>
    {itemId ? source ? <img src={source} alt="" onError={() => { setSource(''); setFailed(true) }} /> : failed ? <><ImageOff size={22} /><span className="item-fallback">{itemId}</span></> : <LoaderCircle className="spin" size={22} /> : <Placeholder className="slot-placeholder" />}
    {itemId && !ghost && (item?.Count ?? 1) > 1 && <span className="item-count">{item?.Count}</span>}
  </button>
}
