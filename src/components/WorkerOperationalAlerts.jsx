import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../data/api.js'
import { IcoBell, IcoCheck, IcoFlask, IcoShield } from './Icons.jsx'

const TYPES = new Set(['order', 'sample', 'deadline', 'incubation'])

function relative(value) {
  const time = new Date(value).getTime()
  const diff = time - Date.now()
  const absolute = Math.abs(diff)
  if (absolute < 60000) return 'ahora'
  if (absolute < 3600000) return `${Math.round(absolute / 60000)} min`
  if (absolute < 86400000) return `${Math.round(absolute / 3600000)} h`
  return `${Math.round(absolute / 86400000)} días`
}

export default function WorkerOperationalAlerts({ mode = 'gate', onNavigate }) {
  const [items, setItems] = useState([])
  const [soundReady, setSoundReady] = useState(false)
  const audioRef = useRef(null)
  const seenRef = useRef(new Set())
  const latestRef = useRef([])

  const play = useCallback((critical = false) => {
    const context = audioRef.current
    if (!context || context.state !== 'running') return
    const notes = critical ? [880, 660, 880] : [660, 820]
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = context.currentTime + index * (critical ? 0.22 : 0.16)
      oscillator.frequency.value = frequency
      oscillator.type = critical ? 'square' : 'sine'
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(critical ? 0.12 : 0.07, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.18)
    })
  }, [])

  const enableSound = useCallback(async () => {
    try {
      if (!audioRef.current) audioRef.current = new (window.AudioContext || window.webkitAudioContext)()
      await audioRef.current.resume()
      setSoundReady(true)
      if (latestRef.current.length) play(latestRef.current.some((item) => item.critical))
    } catch {
      setSoundReady(false)
    }
  }, [play])

  const load = useCallback(async () => {
    try {
      const result = await api.notifications()
      const next = (result.notifications || []).filter((item) => TYPES.has(item.type) && (!item.read_at || item.operational))
      const newItems = next.filter((item) => !seenRef.current.has(item.id))
      next.forEach((item) => seenRef.current.add(item.id))
      latestRef.current = next
      setItems(next)
      if (newItems.length && audioRef.current?.state === 'running') play(newItems.some((item) => item.critical))
    } catch {
      // The terminal remains usable if a polling request is interrupted.
    }
  }, [play])

  useEffect(() => {
    load()
    const timer = setInterval(load, 15000)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    const unlock = () => enableSound()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [enableSound])

  const critical = useMemo(() => items.filter((item) => item.critical), [items])
  useEffect(() => {
    if (!soundReady || !critical.length) return undefined
    const timer = setInterval(() => play(true), 45000)
    return () => clearInterval(timer)
  }, [critical.length, play, soundReady])

  const attend = async (item) => {
    if (item.operational && item.alert_key) await api.acknowledgeOperationalAlert(item.alert_key).catch(() => {})
    else await api.readNotification(item.id).catch(() => {})
    setItems((current) => current.filter((entry) => entry.id !== item.id))
  }

  if (!items.length && mode === 'floating') return null

  return (
    <section className={`worker-operational-alerts ${mode} ${critical.length ? 'critical' : ''}`} aria-live="assertive">
      <header>
        <span className="worker-alert-bell"><IcoBell />{items.length > 0 && <b>{items.length}</b>}</span>
        <div>
          <small>Centro operativo · antes del PIN</small>
          <h2>{critical.length ? 'Atención inmediata requerida' : items.length ? 'Novedades para el equipo' : 'Equipo al día'}</h2>
        </div>
        <button type="button" className={`worker-sound-toggle ${soundReady ? 'ready' : ''}`} onClick={enableSound}>
          {soundReady ? '● Sonido activo' : 'Activar sonido'}
        </button>
      </header>
      {items.length ? (
        <div className="worker-operational-list">
          {items.slice(0, mode === 'gate' ? 4 : 2).map((item) => (
            <article className={item.critical ? 'critical' : ''} key={item.id}>
              <span>{item.type === 'sample' ? <IcoFlask /> : item.critical ? <IcoShield /> : <IcoBell />}</span>
              <div><strong>{item.title}</strong><p>{item.body}</p><small>{item.critical ? 'La alarma sonará cada 45 segundos hasta ser atendida.' : `Aviso · ${relative(item.created_at)}`}</small></div>
              <div className="worker-alert-actions">
                {mode === 'floating' && item.action_url && <button type="button" onClick={() => onNavigate?.(item.action_url)}>Abrir</button>}
                <button type="button" className={item.critical ? 'attend' : ''} onClick={() => attend(item)}><IcoCheck /> {item.critical ? 'Marcar atendida' : 'Visto'}</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="worker-operational-empty"><IcoCheck /><span>No hay nuevas órdenes, muestras ni incubaciones vencidas.</span></div>
      )}
    </section>
  )
}
