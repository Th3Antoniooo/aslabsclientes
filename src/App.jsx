import { Component, lazy, Suspense, useCallback, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import Topbar from './components/Topbar.jsx'
import { IcoChat, IcoCheck } from './components/Icons.jsx'
import Login from './pages/Login.jsx'
import WorkerPinGate from './components/WorkerPinGate.jsx'
import { api } from './data/api.js'

const loadDashboard = () => import('./pages/Dashboard.jsx')
const Dashboard = lazy(loadDashboard)
const Ordenes = lazy(() => import('./pages/Ordenes.jsx'))
const NuevaOrden = lazy(() => import('./pages/NuevaOrden.jsx'))
const Zonas = lazy(() => import('./pages/Zonas.jsx'))
const Resultados = lazy(() => import('./pages/Resultados.jsx'))
const Cuenta = lazy(() => import('./pages/Cuenta.jsx'))
const Tracking = lazy(() => import('./pages/Tracking.jsx'))
const DnaTracking = lazy(() => import('./pages/DnaTracking.jsx'))
const UserManagement = lazy(() => import('./pages/UserManagement.jsx'))
const Analysts = lazy(() => import('./pages/Analysts.jsx'))
const OperationsHub = lazy(() => import('./pages/OperationsHub.jsx'))
const WorkerDashboard = lazy(() => import('./pages/WorkerDashboard.jsx'))
const Biotechnology = lazy(() => import('./pages/Biotechnology.jsx'))
const Procurement = lazy(() => import('./pages/Procurement.jsx'))
const EmailDeliveries = lazy(() => import('./pages/EmailDeliveries.jsx'))
const Assistance = lazy(() => import('./pages/Assistance.jsx'))

const RELEASE_NOTICE_KEY = 'aslabs-release-v2.9.1-seen'

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('No fue posible mostrar el portal.', error)
    const message = String(error?.message || error || '').toLowerCase()
    const recoverable = message.includes('chunk') || message.includes('dynamically imported') || message.includes('loading css') || message.includes('fetch')
    if (recoverable && !sessionStorage.getItem('aslabs-view-recovery')) {
      sessionStorage.setItem('aslabs-view-recovery', '1')
      window.setTimeout(() => window.location.reload(), 250)
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="app-recovery" role="alert">
        <span />
        <strong>No pudimos abrir esta vista</strong>
        <p>Tu sesión sigue protegida. Vuelve a intentarlo para recuperar el portal.</p>
        <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
          Volver a abrir
        </button>
      </div>
    )
  }
}

const VIEW_MODULE = {
  dashboard: 'dashboard',
  ordenes: 'orders',
  nueva: 'orders',
  tracking: 'tracking',
  operaciones: 'lab_operations',
  biotecnologia: 'biotechnology',
  dna: 'dna',
  zonas: 'zones',
  resultados: 'results',
  accesos: 'users',
  analistas: 'analysts',
  proveedores: 'procurement',
  correos: 'notifications',
}

function canOpen(user, nextView) {
  if (user?.activeWorker?.codeCreatorOnly) {
    return ['dashboard', 'biotecnologia', 'operaciones', 'cuenta'].includes(nextView)
  }
  if (nextView === 'dashboard' && user?.activeWorker) return true
  if (nextView === 'asistencia') return ['admin', 'client'].includes(user?.role)
  if (nextView === 'biotecnologia' && user?.role !== 'admin') {
    return Boolean(user?.activeWorker?.biotechnologyAccess || user?.activeWorker?.canCreateBiotechnologyCodes)
  }
  if (nextView === 'operaciones' && user?.activeWorker) return Boolean(user.activeWorker.canUseEquipment)
  const moduleId = VIEW_MODULE[nextView]
  return !moduleId || user?.role === 'admin' || Boolean(user?.permissions?.[moduleId]?.view)
}

export default function App() {
  const [user, setUser] = useState(null)
  const [initializing, setInitializing] = useState(true)
  const [loadingMessage, setLoadingMessage] = useState('Preparando tu espacio de trabajo…')
  const [view, setView] = useState('dashboard')
  const [toast, setToast] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showReleaseNotice, setShowReleaseNotice] = useState(false)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [view, user])

  useEffect(() => {
    if (user && !canOpen(user, view)) {
      const fallback = ['proveedores', 'dashboard', 'asistencia', 'operaciones', 'biotecnologia', 'ordenes', 'tracking', 'dna', 'zonas', 'resultados', 'analistas', 'cuenta']
        .find((candidate) => canOpen(user, candidate))
      setView(fallback || 'cuenta')
    }
  }, [user, view])

  useEffect(() => {
    if (!user) return
    try {
      setShowReleaseNotice(window.localStorage.getItem(RELEASE_NOTICE_KEY) !== '1')
    } catch {
      setShowReleaseNotice(true)
    }
  }, [user])

  useEffect(() => {
    api.me()
      .then((result) => {
        setUser(result.user)
        if (result.user?.role === 'supplier') setView('proveedores')
      })
      .catch(() => setUser(null))
      .finally(() => setInitializing(false))
    const recoveryTimer = window.setTimeout(() => sessionStorage.removeItem('aslabs-view-recovery'), 5000)
    return () => window.clearTimeout(recoveryTimer)
  }, [])

  const notify = useCallback((text) => {
    setToast(text)
    setTimeout(() => setToast(null), 3200)
  }, [])

  const go = useCallback((nextView) => {
    if (canOpen(user, nextView)) setView(nextView)
  }, [user])

  const login = useCallback(async (nextUser) => {
    setLoadingMessage(nextUser?.requiresWorkerPin && !nextUser?.activeWorker
      ? 'Preparando el acceso de trabajadores…'
      : 'Abriendo tu espacio de trabajo…')
    setInitializing(true)

    let sessionUser = nextUser
    try {
      const [session] = await Promise.all([
        api.me(),
        loadDashboard(),
      ])
      sessionUser = session.user || nextUser
    } catch (error) {
      // El inicio de sesión ya fue aceptado. Conservamos la respuesta segura del
      // servidor si la comprobación adicional se interrumpe momentáneamente.
      console.warn('No fue posible completar la precarga posterior al acceso.', error)
    }

    setUser(sessionUser)
    setView(sessionUser?.role === 'supplier' ? 'proveedores' : 'dashboard')
    setInitializing(false)
  }, [])

  const logout = async () => {
    await api.logout().catch(() => {})
    setUser(null)
    setView('dashboard')
    setMenuOpen(false)
  }

  const lockWorker = async () => {
    try {
      const result = await api.lockWorker()
      setUser(result.user)
      setView('operaciones')
      setMenuOpen(false)
    } catch {
      await logout()
    }
  }

  const dismissReleaseNotice = () => {
    try {
      window.localStorage.setItem(RELEASE_NOTICE_KEY, '1')
    } catch {
      // El aviso se cierra igualmente si el navegador bloquea el almacenamiento.
    }
    setShowReleaseNotice(false)
  }

  if (initializing) {
    return <div className="app-loading"><span /><strong>{loadingMessage}</strong></div>
  }
  if (!user) return <Login onLogin={login} />
  if (user.requiresWorkerPin && !user.activeWorker) {
    return <WorkerPinGate account={user} onUnlock={login} onExit={logout} />
  }

  return (
    <AppErrorBoundary key={`${user.id}-${user.activeWorker?.id || 'account'}-${view}`}>
    <div className={`app-shell ${user.role === 'admin' ? 'admin-shell' : user.role === 'client' ? 'client-shell' : user.role === 'supplier' ? 'supplier-shell' : 'worker-shell'}`}>
      <Sidebar
        view={view === 'nueva' ? 'ordenes' : view}
        setView={go}
        user={user}
        onLogout={user.requiresWorkerPin ? lockWorker : logout}
        quickWorkerExit={user.requiresWorkerPin}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />
      {menuOpen && <button className="mobile-overlay" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú" />}

      <div className="main-area">
        <Topbar view={view} user={user} onMenu={() => setMenuOpen(true)} onNavigate={go} onWorkerLock={user.requiresWorkerPin ? lockWorker : null} />
        <main className="page-scroll" key={view}><Suspense fallback={<div className="page-module-loading"><span /><strong>Abriendo módulo…</strong></div>}>
          {view === 'dashboard' && (user.role !== 'admin' && user.role !== 'client'
            ? <WorkerDashboard go={go} user={user} notify={notify} />
            : <Dashboard go={go} user={user} notify={notify} />)}
          {view === 'ordenes' && <Ordenes go={go} notify={notify} user={user} />}
          {view === 'nueva' && <NuevaOrden go={go} notify={notify} user={user} />}
          {view === 'tracking' && <Tracking user={user} />}
          {view === 'operaciones' && <OperationsHub user={user} notify={notify} go={setView} />}
          {view === 'biotecnologia' && <Biotechnology user={user} notify={notify} />}
          {view === 'dna' && <DnaTracking user={user} />}
          {view === 'zonas' && <Zonas go={go} notify={notify} user={user} />}
          {view === 'resultados' && <Resultados user={user} />}
          {view === 'proveedores' && <Procurement user={user} notify={notify} />}
          {view === 'asistencia' && <Assistance user={user} notify={notify} />}
          {view === 'correos' && user.role === 'admin' && <EmailDeliveries />}
          {view === 'analistas' && user.role === 'admin' && <Analysts notify={notify} />}
          {view === 'accesos' && user.role === 'admin' && <UserManagement notify={notify} />}
          {view === 'cuenta' && <Cuenta notify={notify} user={user} onLogout={logout} />}
        </Suspense></main>
      </div>

      {user.role === 'client' && (
        <button
          className={`client-support-fab ${view === 'asistencia' ? 'active' : ''}`}
          type="button"
          onClick={() => go('asistencia')}
          aria-label="Abrir asistencia"
        >
          <span className="client-support-fab-icon"><IcoChat /></span>
          <span><small>¿Necesitas ayuda?</small><strong>Asistencia</strong></span>
        </button>
      )}

      {toast && (
        <div className="toast">
          <span><IcoCheck /></span>
          {toast}
        </div>
      )}

      {showReleaseNotice && (
        <div className="release-notice-backdrop" role="presentation" onMouseDown={dismissReleaseNotice}>
          <section
            className="release-notice"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-notice-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="release-notice-close" type="button" onClick={dismissReleaseNotice} aria-label="Cerrar aviso">×</button>
            <div className="release-notice-version">AS LABS · V2.9.1</div>
            <div className="release-notice-mark" aria-hidden="true"><span>2.9</span></div>
            <div className="release-notice-copy">
              <span className="release-notice-eyebrow">Nueva versión disponible</span>
              <h2 id="release-notice-title">Una experiencia más clara, rápida y elegante.</h2>
              <p>Renovamos la navegación, la organización de las órdenes y la apariencia general del portal para que cada tarea sea más fácil de encontrar y completar.</p>
              <div className="release-notice-points">
                <span>Nuevo diseño visual</span>
                <span>Mejor lectura y orden</span>
                <span>Optimizado para tablet</span>
              </div>
              <button className="btn btn-primary release-notice-action" type="button" onClick={dismissReleaseNotice}>
                Explorar la nueva versión
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
    </AppErrorBoundary>
  )
}
