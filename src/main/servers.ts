import type { AlbionServer, ServerDefinition } from '../shared/types'

export const SERVERS: Record<AlbionServer, ServerDefinition> = {
  EUROPE: {
    key: 'EUROPE',
    label: 'Europe',
    gameInfoBaseUrl: 'https://gameinfo-ams.albiononline.com/api/gameinfo',
    priceBaseUrl: 'https://europe.albion-online-data.com'
  },
  AMERICAS: {
    key: 'AMERICAS',
    label: 'Americas',
    gameInfoBaseUrl: 'https://gameinfo.albiononline.com/api/gameinfo',
    priceBaseUrl: 'https://west.albion-online-data.com'
  },
  ASIA: {
    key: 'ASIA',
    label: 'Asia',
    gameInfoBaseUrl: 'https://gameinfo-sgp.albiononline.com/api/gameinfo',
    priceBaseUrl: 'https://east.albion-online-data.com'
  }
}
