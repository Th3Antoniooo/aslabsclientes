import { useEffect, useState } from 'react'
import { IcoArrow, IcoLogout, IcoShield, IcoUser } from './Icons.jsx'
import { api } from '../data/api.js'
import logo from '../assets/aslabs-logo.png'
import WorkerOperationalAlerts from './WorkerOperationalAlerts.jsx'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']

export default function WorkerPinGate({ account, onUnlock, onExit }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (pin.length !== 4 || loading) return undefined
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const result = await api.unlockWorker(pin)
        await onUnlock(result.user)
      } catch (requestError) {
        setError(requestError.message)
        setPin('')
        setLoading(false)
      }
    }, 140)
    return () => clearTimeout(timer)
  }, [pin, loading, onUnlock])

  const press = (key) => {
    if (loading) return
    setError('')
    if (key === 'clear') setPin('')
    else if (key === 'back') setPin((current) => current.slice(0, -1))
    else setPin((current) => `${current}${key}`.slice(0, 4))
  }

  return (
    <main className="worker-pin-page">
      <section className="worker-pin-brand">
        <img src={logo} alt="AS Labs" />
        <div><span><i /> Terminal activa</span><strong>Operaciones de laboratorio</strong></div>
      </section>

      <div className="worker-pin-workspace">
      <section className="worker-pin-card">
        <div className="worker-pin-intro">
          <div className="worker-pin-icon"><IcoUser /></div>
          <span className="eyebrow">Acceso personal</span>
          <h1>Identifícate para comenzar</h1>
          <p>Introduce tus cuatro dígitos. Cada actividad quedará firmada con tu identidad operativa.</p>
          <div className="worker-pin-privacy">
            <div><IcoShield /></div>
            <span><strong>Sesión privada</strong><small>Solo verás órdenes y códigos asignados a ti.</small></span>
          </div>
          <div className="worker-pin-account"><span>Cuenta compartida</span><strong>{account.email}</strong></div>
        </div>

        <div className="worker-pin-entry">
          <div className="worker-pin-entry-head"><span>PIN de trabajador</span><small>{pin.length}/4</small></div>
          <label className="worker-pin-input-wrap">
            <span className="sr-only">PIN de cuatro dígitos</span>
            <input
              className="worker-pin-native"
              type="password"
              inputMode="none"
              autoComplete="off"
              value={pin}
              readOnly
              tabIndex="-1"
              onPointerDown={(event) => event.preventDefault()}
              onFocus={(event) => event.currentTarget.blur()}
              aria-label="PIN de cuatro dígitos"
            />
            <span className="worker-pin-dots" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => <i className={pin.length > index ? 'filled' : ''} key={index}>{pin.length > index ? '•' : ''}</i>)}
            </span>
          </label>

          <div className="worker-pin-feedback">
            {error && <div className="worker-pin-error" role="alert">{error}</div>}
            {loading && <div className="worker-pin-checking"><span /> Identificando trabajador…</div>}
            {!error && !loading && <span>Toca los números para ingresar</span>}
          </div>

          <div className="worker-pin-keypad">
            {KEYS.map((key) => (
              <button
                type="button"
                className={key === 'clear' || key === 'back' ? 'utility' : ''}
                onClick={() => press(key)}
                disabled={loading}
                aria-label={key === 'clear' ? 'Borrar PIN' : key === 'back' ? 'Borrar último dígito' : `Número ${key}`}
                key={key}
              >
                {key === 'clear' ? 'Limpiar' : key === 'back' ? '⌫' : key}
              </button>
            ))}
          </div>
        </div>
      </section>

      <WorkerOperationalAlerts mode="gate" />
      </div>

      <footer className="worker-pin-footer">
        <span><IcoShield /> La identidad del cliente permanece oculta en esta terminal.</span>
        <button type="button" onClick={onExit}><IcoLogout /> Salir de la terminal <IcoArrow /></button>
      </footer>
    </main>
  )
}
