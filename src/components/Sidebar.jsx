import {
  IcoChart, IcoDashboard, IcoDna, IcoLocation, IcoLogout,
  IcoBox, IcoChat, IcoFlask, IcoLeaf, IcoMap, IcoOrders, IcoSend, IcoShield, IcoUser, IcoUsers,
} from './Icons.jsx'
import logo from '../assets/aslabs-logo.png'

const NAV = [
  { id: 'dashboard', module: 'dashboard', label: 'Centro de trabajo', Ico: IcoDashboard },
  { id: 'asistencia', label: 'Asistencia', Ico: IcoChat, support: true },
  { id: 'ordenes', module: 'orders', label: 'Órdenes', Ico: IcoOrders },
  { id: 'tracking', module: 'tracking', label: 'Muestreo en campo', Ico: IcoLocation },
  { id: 'operaciones', module: 'lab_operations', label: 'Operaciones de laboratorio', Ico: IcoFlask },
  { id: 'biotecnologia', module: 'biotechnology', label: 'Biotecnología', Ico: IcoLeaf },
  { id: 'dna', module: 'dna', label: 'Extracción de DNA', Ico: IcoDna },
  { id: 'zonas', module: 'zones', label: 'Zonas de campo', Ico: IcoMap },
  { id: 'resultados', module: 'results', label: 'Resultados', Ico: IcoChart },
  { id: 'proveedores', module: 'procurement', label: 'Proveedores y compras', Ico: IcoBox },
  { id: 'correos', module: 'notifications', label: 'Correos enviados', Ico: IcoSend },
  { id: 'analistas', module: 'analysts', label: 'Analistas', Ico: IcoFlask },
  { id: 'accesos', module: 'users', label: 'Administración', Ico: IcoUsers, emphasis: true },
  { id: 'cuenta', label: 'Mi cuenta', Ico: IcoUser },
]

export default function Sidebar({ view, setView, user, onLogout, quickWorkerExit, open, onClose }) {
  const displayName = user.activeWorker?.fullName || user.nombre
  const displayInitials = user.activeWorker?.initials || user.iniciales
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <button className="sidebar-close" onClick={onClose} aria-label="Cerrar menú">×</button>
      <button className="brand" onClick={() => { setView('dashboard'); onClose() }} aria-label="Ir al resumen">
        <img src={logo} alt="AS Labs" />
      </button>

      <div className="nav-section-label">{user.role === 'admin' ? 'Centro de operaciones' : user.role === 'client' ? 'Mi laboratorio' : user.role === 'supplier' ? 'Portal de proveedores' : 'Trabajo de laboratorio'}</div>
      <nav className="nav">
        {NAV.filter((item) => (
          (!user.activeWorker?.codeCreatorOnly || ['dashboard', 'biotecnologia', 'operaciones', 'cuenta'].includes(item.id))
          &&
          (!item.module || user.role === 'admin' || (item.id === 'dashboard' && user.activeWorker) || user.permissions?.[item.module]?.view)
          && (item.id !== 'asistencia' || ['admin', 'client'].includes(user.role))
          && (item.id !== 'biotecnologia' || user.role === 'admin' || user.activeWorker?.biotechnologyAccess || user.activeWorker?.canCreateBiotechnologyCodes)
          && (item.id !== 'operaciones' || !user.activeWorker || user.activeWorker?.canUseEquipment)
        )).map(({ id, label, Ico, emphasis, support }) => (
          <button
            key={id}
            className={`nav-item ${view === id ? 'active' : ''} ${emphasis ? 'admin-nav-item' : ''} ${support ? 'support-nav-item' : ''}`}
            onClick={() => { setView(id); onClose() }}
          >
            <Ico />
            <span className="nav-label">{label}</span>
            {emphasis && <span className="admin-nav-chip">Admin</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-user">
          <div className="avatar">{displayInitials}</div>
          <div>
            <strong>{displayName}</strong>
            <span>{user.activeWorker ? 'Trabajador identificado' : user.role === 'admin' ? 'Administrador' : user.role === 'client' ? user.empresa : user.role === 'supplier' ? user.empresa : user.roleName}</span>
          </div>
        </div>
        <div className="sidebar-cert"><IcoShield /> Cuenta verificada</div>
        <button className="logout-button" onClick={onLogout}>
          <IcoLogout /> {quickWorkerExit ? 'Salida rápida' : 'Cerrar sesión'}
        </button>
      </div>
    </aside>
  )
}
