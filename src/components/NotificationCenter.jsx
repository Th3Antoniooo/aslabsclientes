import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../data/api.js'
import { IcoBell, IcoCheck, IcoDna, IcoLocation, IcoOrders } from './Icons.jsx'

const icons = {
  dna: IcoDna,
  tracking: IcoLocation,
  result: IcoOrders,
  account: IcoCheck,
  order: IcoOrders,
  sample: IcoOrders,
  deadline: IcoBell,
  incubation: IcoBell,
}

function when(value) {
  const date = new Date(value)
  const diff = Math.max(0, Date.now() - date.getTime())
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Hace ${hours} h`
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })
}

export default function NotificationCenter({ onNavigate }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const panelRef = useRef(null)
  const unread = useMemo(() => items.filter((item) => !item.read_at).length, [items])

  const load = async () => {
    try {
      const result = await api.notifications()
      setItems(result.notifications)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 45000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const close = (event) => {
      if (open && panelRef.current && !panelRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const openItem = async (item) => {
    if (!item.read_at && !item.operational) {
      setItems((current) => current.map((entry) => (
        entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry
      )))
      api.readNotification(item.id).catch(() => {})
    }
    if (item.action_url) {
      onNavigate(item.action_url)
      setOpen(false)
    }
  }

  const markAll = async () => {
    setItems((current) => current.map((item) => item.operational ? item : ({ ...item, read_at: item.read_at || new Date().toISOString() })))
    await api.readAllNotifications().catch(() => {})
  }

  return (
    <div className="notification-root" ref={panelRef}>
      <button
        className={`icon-button ${open ? 'active' : ''}`}
        aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ''}`}
        onClick={() => setOpen((value) => !value)}
      >
        <IcoBell />
        {unread > 0 && <span className="notification-count">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <aside className="notification-panel">
          <header>
            <div>
              <span>Centro de avisos</span>
              <h3>Notificaciones</h3>
            </div>
            {unread > 0 && <button onClick={markAll}>Marcar todo como leído</button>}
          </header>
          <div className="notification-list">
            {loading && <div className="notification-empty">Cargando avisos…</div>}
            {!loading && items.length === 0 && (
              <div className="notification-empty">
                <span><IcoBell /></span>
                <strong>Todo está al día</strong>
                <p>No tienes notificaciones pendientes.</p>
              </div>
            )}
            {items.map((item) => {
              const Icon = icons[item.type] || IcoBell
              return (
                <button
                  key={item.id}
                  className={`notification-item ${!item.read_at ? 'unread' : ''} ${item.priority === 'high' ? 'priority' : ''}`}
                  onClick={() => openItem(item)}
                >
                  <span className={`notification-icon ${item.type}`}><Icon /></span>
                  <span className="notification-copy">
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    <small>{when(item.created_at)}</small>
                  </span>
                  {!item.read_at && <i className="unread-dot" />}
                </button>
              )
            })}
          </div>
          <footer><span><i /> Sincronizado en tiempo real</span></footer>
        </aside>
      )}
    </div>
  )
}
