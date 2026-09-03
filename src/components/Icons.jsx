// Iconos SVG minimalistas (stroke) — sin dependencias externas
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const IcoDashboard = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
)
export const IcoOrders = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" />
    <rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 12l2 2 4-4" />
  </svg>
)
export const IcoBox = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="m3 7 9 5 9-5M12 12v10" /><path d="m5 4 7-3 7 3 2 3v10l-9 5-9-5V7l2-3Z" />
  </svg>
)
export const IcoMap = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z" /><path d="M9 3v16M15 5v16" />
  </svg>
)
export const IcoChart = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M3 3v18h18" /><path d="M7 15l3-4 3 3 5-7" />
  </svg>
)
export const IcoUser = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </svg>
)
export const IcoUsers = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
export const IcoPlus = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
)
export const IcoChat = (p) => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M21 12a8 8 0 0 1-11.3 7.3L3 21l1.7-6.7A8 8 0 1 1 21 12Z" />
  </svg>
)
export const IcoSend = (p) => (
  <svg width="17" height="17" viewBox="0 0 24 24" {...base} {...p}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" /></svg>
)
export const IcoDrop = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}><path d="M12 2s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12Z" /></svg>
)
export const IcoArrow = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
export const IcoBell = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
)
export const IcoCamera = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)
export const IcoCalendar = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
  </svg>
)
export const IcoFile = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M6 2h8l4 4v16H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M14 2v5h5M8 13h8M8 17h6" />
  </svg>
)
export const IcoFolder = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-3H5a2 2 0 0 0-2 2v2.5Z" />
  </svg>
)
export const IcoSearch = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
  </svg>
)
export const IcoFlask = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
    <path d="M7.5 15h9" />
  </svg>
)
export const IcoLeaf = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 16-9 0 8-4 12-9 12Z" /><path d="M4 20c2-4 5-7 9-8" />
  </svg>
)
export const IcoCheck = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}><path d="M5 12l5 5 9-11" /></svg>
)
export const IcoLocation = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
)
export const IcoDna = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M7 3c8 4 2 14 10 18M17 3C9 7 15 17 7 21M8 7h8M7 12h10M8 17h8" />
  </svg>
)
export const IcoShield = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.8 3 8.2 7.5 9.5 4.5-1.3 7.5-4.7 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)
export const IcoLogout = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 8l4 4-4 4M18 12H8" />
  </svg>
)
export const IcoMenu = (p) => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)
