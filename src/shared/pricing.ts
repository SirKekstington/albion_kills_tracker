export const PRICING_METHOD = 'HISTORY_MEDIAN_7D_EXCELLENT_FALLBACK_V4'
export const PRICE_QUALITY = 4
export const PENDING_PRICING_METHOD = 'PENDING'

export function parseUtcTimestamp(value: string): number {
  return Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`)
}
