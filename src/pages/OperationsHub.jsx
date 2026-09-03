import { useState } from 'react'
import { IcoFlask, IcoOrders } from '../components/Icons.jsx'
import LabOperations from './LabOperations.jsx'
import MicrobiologyOperations from './MicrobiologyOperations.jsx'

export default function OperationsHub({ user, notify, go }) {
  const [section, setSection] = useState('equipment')
  if (user.activeWorker?.codeCreatorOnly) {
    return <div className="operations-hub restricted-equipment-hub"><LabOperations user={user} notify={notify} /></div>
  }
  return <div className="operations-hub">
    <nav className="operations-hub-switch" aria-label="Áreas de operaciones de laboratorio">
      <button className={section === 'equipment' ? 'active' : ''} onClick={() => setSection('equipment')}><IcoFlask /><span><strong>Uso de equipos</strong><small>Inicio, final, alertas y PDFs</small></span></button>
      <button className={section === 'flows' ? 'active' : ''} onClick={() => setSection('flows')}><IcoOrders /><span><strong>Flujos por código</strong><small>Etapas microbiológicas vinculadas</small></span></button>
    </nav>
    {section === 'equipment'
      ? <LabOperations user={user} notify={notify} />
      : <MicrobiologyOperations user={user} notify={notify} go={go} />}
  </div>
}
