// Datos simulados del panel (solo front-end)

export const CLIENTE = {
  nombre: 'Maxim Balakarev',
  empresa: 'Skyeast',
  email: 'maxim.balakarev@skyeast.co.uk',
  telefono: '+44 20 7946 0284',
  ruc: 'Cliente internacional',
  plan: 'Corporativo',
  iniciales: 'MB',
  role: 'client',
}

export const ADMIN = {
  nombre: 'Antonio Guevara',
  empresa: 'AS Laboratorios',
  email: 'antoniog@aslaboratorios.com',
  telefono: '+51 987 654 321',
  ruc: '20123456789',
  plan: 'Administrador',
  iniciales: 'AG',
  role: 'admin',
}

export const TIPOS_ANALISIS = [
  { id: 'suelo', icon: '🌱', name: 'Análisis de Suelo', desc: 'Fertilidad, pH, materia orgánica, macro y micronutrientes.', dur: '5 días' },
  { id: 'agua', icon: '💧', name: 'Análisis de Agua', desc: 'Riego, potabilidad, salinidad, metales pesados.', dur: '4 días' },
  { id: 'alimentos', icon: '🌾', name: 'Análisis de Alimentos', desc: 'Nutricional, microbiológico, residuos de plaguicidas.', dur: '7 días' },
  { id: 'fito', icon: '🔬', name: 'Detección de Fitopatógenos', desc: 'Hongos, bacterias, virus y nematodos por PCR.', dur: '6 días' },
  { id: 'foliar', icon: '🍃', name: 'Análisis Foliar', desc: 'Estado nutricional de la planta vía tejido vegetal.', dur: '5 días' },
  { id: 'microbio', icon: '🧫', name: 'Microbiología de Suelo', desc: 'Biomasa microbiana y actividad biológica.', dur: '8 días' },
  { id: 'dna', icon: '🧬', name: 'Extracción de DNA', desc: 'Aislamiento, purificación y control de calidad de DNA vegetal o microbiano.', dur: '7 días' },
]

export const ESTADOS = ['recibido', 'laboratorio', 'analisis', 'listo']
export const ESTADO_LABEL = {
  recibido: 'Recibido', laboratorio: 'En laboratorio', analisis: 'En análisis', listo: 'Listo',
}
const prog = { recibido: 20, laboratorio: 50, analisis: 78, listo: 100 }
export const progresoDe = (e) => prog[e]

export const ORDENES = [
  { id: 'DNA-2510', tipo: 'Extracción de DNA', tipoId: 'dna', zona: 'Lote Skyeast Norte', estado: 'analisis', fecha: '27 Jul 2026', eta: '04 Ago', muestras: 8 },
  { id: 'OS-2451', tipo: 'Análisis de Suelo', tipoId: 'suelo', zona: 'Lote Norte A', estado: 'analisis', fecha: '08 Jul 2026', eta: '13 Jul', muestras: 6 },
  { id: 'OS-2447', tipo: 'Detección de Fitopatógenos', tipoId: 'fito', zona: 'Invernadero 3', estado: 'laboratorio', fecha: '07 Jul 2026', eta: '13 Jul', muestras: 4 },
  { id: 'OS-2440', tipo: 'Análisis de Agua', tipoId: 'agua', zona: 'Reservorio Sur', estado: 'listo', fecha: '02 Jul 2026', eta: '06 Jul', muestras: 3 },
  { id: 'OS-2438', tipo: 'Análisis Foliar', tipoId: 'foliar', zona: 'Lote Este B', estado: 'listo', fecha: '01 Jul 2026', eta: '06 Jul', muestras: 8 },
  { id: 'OS-2433', tipo: 'Análisis de Alimentos', tipoId: 'alimentos', zona: 'Planta empaque', estado: 'recibido', fecha: '09 Jul 2026', eta: '16 Jul', muestras: 2 },
  { id: 'OS-2429', tipo: 'Microbiología de Suelo', tipoId: 'microbio', zona: 'Lote Norte A', estado: 'analisis', fecha: '06 Jul 2026', eta: '14 Jul', muestras: 5 },
]

export const timelineDe = (estado) => {
  const pasos = [
    { key: 'recibido', label: 'Muestra recibida', time: '08 Jul · 09:14' },
    { key: 'laboratorio', label: 'Ingreso a laboratorio', time: '08 Jul · 14:30' },
    { key: 'analisis', label: 'Análisis en proceso', time: '10 Jul · 08:00' },
    { key: 'listo', label: 'Resultados disponibles', time: '—' },
  ]
  const idx = ESTADOS.indexOf(estado)
  return pasos.map((p, i) => ({
    ...p,
    state: i < idx ? 'done' : i === idx ? 'current' : 'pending',
  }))
}

// Zonas del campo (polígonos lat/lng) — zona agrícola simulada (costa peruana)
export const ZONAS = [
  {
    id: 'z1', nombre: 'Lote Skyeast Norte', color: '#2f6b4f', cultivo: 'Palto Hass', area: '12.4 ha',
    coords: [[-12.045, -77.028], [-12.045, -77.020], [-12.051, -77.020], [-12.051, -77.028]],
  },
  {
    id: 'z2', nombre: 'Lote Este B', color: '#d58c2f', cultivo: 'Arándano', area: '8.7 ha',
    coords: [[-12.046, -77.018], [-12.046, -77.011], [-12.052, -77.011], [-12.052, -77.018]],
  },
  {
    id: 'z3', nombre: 'Invernadero 3', color: '#7b9f8b', cultivo: 'Tomate', area: '3.1 ha',
    coords: [[-12.053, -77.027], [-12.053, -77.022], [-12.057, -77.022], [-12.057, -77.027]],
  },
]
export const CENTRO_MAPA = [-12.050, -77.020]

// Resultados analíticos (para gráficas)
export const NUTRIENTES = [
  { param: 'Nitrógeno', valor: 82, optimo: 75 },
  { param: 'Fósforo', valor: 54, optimo: 65 },
  { param: 'Potasio', valor: 91, optimo: 80 },
  { param: 'Calcio', valor: 68, optimo: 70 },
  { param: 'Magnesio', valor: 77, optimo: 60 },
  { param: 'Azufre', valor: 45, optimo: 55 },
]

export const SERIE_PH = [
  { mes: 'Feb', ph: 6.2, mo: 2.1 },
  { mes: 'Mar', ph: 6.4, mo: 2.3 },
  { mes: 'Abr', ph: 6.5, mo: 2.6 },
  { mes: 'May', ph: 6.7, mo: 2.9 },
  { mes: 'Jun', ph: 6.6, mo: 3.2 },
  { mes: 'Jul', ph: 6.8, mo: 3.4 },
]

export const RADAR_SUELO = [
  { eje: 'Fertilidad', A: 88 },
  { eje: 'Retención H₂O', A: 72 },
  { eje: 'M. Orgánica', A: 80 },
  { eje: 'Salinidad', A: 40 },
  { eje: 'Biología', A: 66 },
  { eje: 'Estructura', A: 78 },
]

export const DIST_ANALISIS = [
  { name: 'Suelo', value: 34, color: '#225c42' },
  { name: 'Agua', value: 22, color: '#7b9f8b' },
  { name: 'Fitopatógenos', value: 18, color: '#e6a84b' },
  { name: 'DNA', value: 15, color: '#b56f2b' },
  { name: 'Alimentos', value: 11, color: '#9ab5a4' },
]

export const TRABAJADORES = [
  {
    id: 'TR-017',
    nombre: 'Luis Mendoza',
    iniciales: 'LM',
    tarea: 'Muestreo foliar',
    zona: 'Lote Skyeast Norte',
    estado: 'Muestreando',
    progreso: 68,
    ultima: 'Ahora',
    coords: [-12.0472, -77.0254],
    precision: '± 4 m',
  },
  {
    id: 'TR-024',
    nombre: 'María Torres',
    iniciales: 'MT',
    tarea: 'Muestreo de suelo',
    zona: 'Lote Skyeast Norte',
    estado: 'Muestreando',
    progreso: 42,
    ultima: 'Hace 8 s',
    coords: [-12.0491, -77.0228],
    precision: '± 6 m',
  },
  {
    id: 'TR-031',
    nombre: 'Diego Ramos',
    iniciales: 'DR',
    tarea: 'Cadena de custodia',
    zona: 'Invernadero 3',
    estado: 'En traslado',
    progreso: 86,
    ultima: 'Hace 14 s',
    coords: [-12.0539, -77.0248],
    precision: '± 5 m',
  },
  {
    id: 'TR-009',
    nombre: 'Carla Ruiz',
    iniciales: 'CR',
    tarea: 'Supervisión de cuadrilla',
    zona: 'Lote Este B',
    estado: 'Supervisando',
    progreso: 55,
    ultima: 'Hace 5 s',
    coords: [-12.0481, -77.0152],
    precision: '± 3 m',
  },
]

export const DNA_STEPS = [
  { id: 'solicitud', title: 'Solicitud confirmada', detail: 'Orden y protocolo validados', time: '27 Jul · 09:10', state: 'done' },
  { id: 'recoleccion', title: 'Muestra recolectada', detail: '8 tubos identificados en campo', time: '27 Jul · 14:35', state: 'done' },
  { id: 'recepcion', title: 'Recepción en laboratorio', detail: 'Cadena de custodia conforme', time: '28 Jul · 08:42', state: 'done' },
  { id: 'lisis', title: 'Lisis celular', detail: 'Disrupción de tejido completada', time: '28 Jul · 12:18', state: 'done' },
  { id: 'purificacion', title: 'Purificación de DNA', detail: 'Separación y lavado de columnas', time: '29 Jul · 09:30', state: 'current' },
  { id: 'calidad', title: 'Control de calidad', detail: 'Concentración y pureza A260/A280', time: 'Pendiente', state: 'pending' },
  { id: 'preparacion', title: 'Preparación de envío', detail: 'Alícuotas, sellado y documentación', time: 'Pendiente', state: 'pending' },
  { id: 'envio', title: 'Envío al cliente', detail: 'Guía y trazabilidad de courier', time: 'Estimado 04 Ago', state: 'pending' },
]
