import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '../shared/types'

const api: AppApi & { onUpdated(callback: () => void): () => void } = {
  ...(process.argv.includes('--tracker-dev-debug') ? {
    getDebugSnapshot: () => ipcRenderer.invoke('debug:snapshot'),
    debugImportEvent: (eventId: string) => ipcRenderer.invoke('debug:import', eventId)
  } : {}),
  setLanguage: (language) => ipcRenderer.invoke('language:set', language),
  searchPlayers: (server, query) => ipcRenderer.invoke('players:search', server, query),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  getProfile: () => ipcRenderer.invoke('profile:get'),
  getDashboard: (range) => ipcRenderer.invoke('dashboard:get', range),
  setProfitTracking: (mode) => ipcRenderer.invoke('tracking:set', mode),
  getFightDetails: (eventId) => ipcRenderer.invoke('fights:details', eventId),
  setFightValuation: (eventId, mode) => ipcRenderer.invoke('fights:valuation', eventId, mode),
  getItemImage: (itemId, quality) => ipcRenderer.invoke('items:image', itemId, quality),
  refreshNow: () => ipcRenderer.invoke('collector:refresh'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getOverlayUrl: () => ipcRenderer.invoke('overlay:url'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  onUpdated: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('tracker:updated', listener)
    return () => ipcRenderer.removeListener('tracker:updated', listener)
  }
}

contextBridge.exposeInMainWorld('tracker', api)
