import type { AppApi } from '../../shared/types'

declare global {
  interface Window {
    tracker: AppApi & { onUpdated(callback: () => void): () => void }
  }
}

export {}
