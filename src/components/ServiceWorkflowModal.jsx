import { useEffect, useMemo, useState } from 'react'
import { api } from '../data/api.js'
import { IcoArrow, IcoCalendar, IcoCamera, IcoCheck, IcoFile, IcoFlask, IcoShield, IcoUser } from './Icons.jsx'
import ClientLabTraceability from './ClientLabTraceability.jsx'
import SampleIntakeFlow from './SampleIntakeFlow.jsx'
import { orderWarning } from '../utils/orderWarnings.js'

const STAGE_STATUS = {
  pending: 'Pendiente',
  current: 'Etapa actual',
  completed: 'Completada',
}

function toDateTimeInput(value) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

async function compressPhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Selecciona imágenes JPG, PNG o WebP.')
  let objectUrl = ''
  const source = typeof createImageBitmap === 'function'
    ? await createImageBitmap(file)
    : await new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('No fue posible leer esta fotografía.'))
        objectUrl = URL.createObjectURL(file)
        image.src = objectUrl
      })
  const maxSide = 900
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  const context = canvas.getContext('2d')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  source.close?.()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  let quality = .68
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > 350_000 && quality > .4) {
    quality -= .08
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > 350_000) throw new Error('Una fotografía sigue siendo demasiado grande después de comprimirla. Prueba con una imagen de menor resolución.')
  return {
    fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg',
    title: file.name.replace(/\.[^.]+$/, ''),
    note: '',
    mimeType: 'image/jpeg',
    dataUrl,
  }
}

async function readFinalReport(file) {
  if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Selecciona un archivo PDF.')
  }
  if (file.size > 3_000_000) throw new Error('El informe final no puede superar los 3 MB.')
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  if (String.fromCharCode(...header) !== '%PDF-') throw new Error('El archivo seleccionado no es un PDF válido.')
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('No fue posible leer el informe final.'))
    reader.readAsDataURL(file)
  })
  return {
    fileName: file.name,
    mimeType: 'application/pdf',
    dataUrl,
    fileSize: file.size,
  }
}

function fileSizeLabel(bytes = 0) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function blankResult(item = null, groupKey = `result-${Date.now()}-${Math.random()}`, groupLabel = 'Resultado 1') {
  return {
    key: `${Date.now()}-${Math.random()}`,
    groupKey, groupLabel,
    serviceItemId: item?.id || '', sampleCode: '', parameter: item?.name || '', resultValue: '', unit: '',
    minimumValue: '', maximumValue: '', referenceValue: '', identifiedAgent: '', method: '', observations: '',
  }
}

function sampleCodesFor(service) {
  const count = Math.max(1, Number(service?.sample_count || 1))
  const code = String(service?.code || '').trim()
  return Array.from({ length: count }, (_, index) => `${code}-${index + 1}`)
}

function resultFromApi(item) {
  return {
    key: item.id || `${Date.now()}-${Math.random()}`,
    groupKey: item.result_group_key || 'result-1', groupLabel: item.result_group_label || 'Resultado 1',
    serviceItemId: item.service_item_id || '', sampleCode: item.sample_code || '', parameter: item.parameter || '',
    resultValue: item.result_value || '', unit: item.unit || '', minimumValue: item.minimum_value || '',
    maximumValue: item.maximum_value || '', referenceValue: item.reference_value || '', identifiedAgent: item.identified_agent || '', method: item.method || '', observations: item.observations || '',
  }
}

function sampleResultRows(service, apiResults = []) {
  const configuredCodes = sampleCodesFor(service)
  const existingRows = apiResults.map(resultFromApi)
  const extraCodes = existingRows
    .map((row) => row.sampleCode)
    .filter((code, index, list) => code && !configuredCodes.includes(code) && list.indexOf(code) === index)
  const codes = [...configuredCodes, ...extraCodes]
  const firstRequestedParameter = service?.service_items?.[0] || null

  return codes.flatMap((code, index) => {
    const groupKey = `sample-${service?.id || 'service'}-${index + 1}`
    const groupLabel = `Muestra ${index + 1}`
    const saved = existingRows.filter((row) => (row.sampleCode || configuredCodes[0]) === code)
    if (saved.length) {
      return saved.map((row) => ({ ...row, groupKey, groupLabel, sampleCode: code }))
    }
    return [{ ...blankResult(firstRequestedParameter, groupKey, groupLabel), sampleCode: code }]
  })
}

function numberValue(value) {
  const normalized = String(value ?? '').trim().replace(',', '.')
  if (!normalized || !Number.isFinite(Number(normalized))) return null
  return Number(normalized)
}

function ParameterRangeGraph({ result, minimum, maximum }) {
  const value = numberValue(result), min = numberValue(minimum), max = numberValue(maximum)
  if (value === null || min === null || max === null || max <= min) return null
  const rawPosition = ((value - min) / (max - min)) * 100
  const position = Math.max(2, Math.min(98, rawPosition))
  const state = value < min ? 'low' : value > max ? 'high' : 'ok'
  return <div className={`parameter-range-graph ${state}`}><div className="parameter-range-track"><i style={{ left: `${position}%` }} /></div><span>{min}</span><strong>{value} · {state === 'ok' ? 'Dentro del rango' : state === 'low' ? 'Bajo el mínimo' : 'Sobre el máximo'}</strong><span>{max}</span></div>
}

function equipmentForm(item = null, operatorUserId = '', materialDescription = '') {
  const type = item?.equipment_type || ''
  return {
    equipmentId: item?.id || '', materialDescription,
    storagePosition: ['incubator', 'shaker_incubator'].includes(type) ? 'Ubicación general' : '', observations: '',
    temperatureC: type === 'autoclave' ? '121' : type === 'oven' ? '105' : '',
    pressureBar: type === 'autoclave' ? '1.05' : '',
    durationMinutes: type === 'autoclave' ? '15' : '',
    rpm: type === 'shaker_incubator' ? '120' : type === 'centrifuge' ? '3000' : '', operatorUserId,
  }
}

const EQUIPMENT_NAMES = {
  autoclave: 'Autoclave', spectrophotometer: 'Espectrofotómetro', incubator: 'Incubadora',
  shaker_incubator: 'Shaker incubador', centrifuge: 'Centrífuga', oven: 'Horno', flow_cabinet: 'Cabina de flujo laminar',
}

function EquipmentTimer({ startedAt, endedAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (endedAt) return undefined
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [endedAt])
  const seconds = Math.max(0, Math.floor(((endedAt ? new Date(endedAt).getTime() : now) - new Date(startedAt).getTime()) / 1000))
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const remaining = String(seconds % 60).padStart(2, '0')
  return <span className={`equipment-stopwatch ${endedAt ? 'stopped' : 'running'}`}><i />{hours}:{minutes}:{remaining}</span>
}

export default function ServiceWorkflowModal({ service, user, onClose, onChanged, notify, onEditService }) {
  const isAdmin = user.role === 'admin'
  const isWorker = Boolean(user.activeWorker)
  const canEditStages = isAdmin || isWorker
  const canMoveStages = isAdmin || isWorker
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [moveNote, setMoveNote] = useState('')
  const [editing, setEditing] = useState(null)
  const [stageForm, setStageForm] = useState({
    performedBy: '',
    analystId: '',
    observations: '',
    startedAt: '',
    completedAt: '',
    changeNote: '',
  })
  const [newPhotos, setNewPhotos] = useState([])
  const [finalReport, setFinalReport] = useState(null)
  const [reportNotes, setReportNotes] = useState('')
  const [reportNarrative, setReportNarrative] = useState({ interpretation: '', notes: '', observations: '' })
  const [resultRows, setResultRows] = useState([])
  const [activeResultSample, setActiveResultSample] = useState('')
  const [resultPhotos, setResultPhotos] = useState([])
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [activePanel, setActivePanel] = useState(null)
  const [sampleOpenRequest, setSampleOpenRequest] = useState(0)
  const [sampleActionRequest, setSampleActionRequest] = useState({ key: 0, action: null })
  const [equipmentOpen, setEquipmentOpen] = useState(false)
  const [equipmentLoading, setEquipmentLoading] = useState(false)
  const [equipmentData, setEquipmentData] = useState({ equipment: [], equipmentRuns: [] })
  const [runForm, setRunForm] = useState(equipmentForm(null, user.id))
  const [nonconformityRun, setNonconformityRun] = useState(null)
  const [nonconformityForm, setNonconformityForm] = useState({ description: '', immediateAction: '', rootCause: '', correctiveAction: '' })
  const [expandedStages, setExpandedStages] = useState([])
  const [crewForm, setCrewForm] = useState({
    crewId: '',
    assignmentType: 'sampling',
    scheduledAt: '',
    notes: '',
  })

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await api.serviceWorkflow(service.id)
      setData(result)
      if (!silent) {
        const rows = sampleResultRows(result.service, result.results || [])
        const codes = [...new Set(rows.map((row) => row.sampleCode).filter(Boolean))]
        setResultRows(rows)
        setActiveResultSample((current) => codes.includes(current) ? current : codes[0] || '')
      }
      if (!silent) setResultPhotos((result.resultPhotos || []).map((photo, index) => ({ id: photo.id, fileName: photo.file_name, title: photo.title || photo.file_name?.replace(/\.[^.]+$/, '') || `Fotografía ${index + 1}`, note: photo.note || '', mimeType: photo.mime_type, dataUrl: photo.data_url })))
      setActivePanel((current) => current || (result.sampleGate?.required === false ? 'trace' : Number(result.sampleGate?.total || 0) === 0 ? 'sample' : 'trace'))
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { load() }, [service.id])
  useEffect(() => {
    if (user.role !== 'client') return undefined
    const interval = setInterval(() => load(true), 10000)
    return () => clearInterval(interval)
  }, [service.id, user.role])
  useEffect(() => {
    setActivePanel(null)
    setEquipmentOpen(false)
    setSampleOpenRequest(0)
    setSampleActionRequest({ key: 0, action: null })
    setReviewNotes('')
    setReviewError('')
    setActiveResultSample('')
  }, [service.id])

  const currentPosition = Number(data?.service?.current_stage_position || 0)
  const currentStage = data?.stages?.find((stage) => stage.position === currentPosition)
  const nextStage = data?.stages?.find((stage) => stage.position === currentPosition + 1)
  const lastPosition = Math.max(0, (data?.stages?.length || 1) - 1)
  const progress = data?.service?.status === 'completed'
    ? 100
    : data?.stages?.length
      ? Math.min(95, Math.round(((currentPosition + 1) / data.stages.length) * 100))
      : 0

  const sortedEvents = useMemo(() => data?.events || [], [data])
  const availableSampleCodes = useMemo(() => sampleCodesFor(data?.service || service), [data?.service, service])
  const resultGroups = useMemo(() => {
    const groups = new Map()
    resultRows.forEach((row) => {
      const key = row.groupKey || 'result-1'
      if (!groups.has(key)) groups.set(key, {
        key,
        label: row.groupLabel || `Muestra ${groups.size + 1}`,
        sampleCode: row.sampleCode || '',
        rows: [],
      })
      groups.get(key).rows.push(row)
    })
    return [...groups.values()].sort((a, b) => {
      const aIndex = availableSampleCodes.indexOf(a.sampleCode)
      const bIndex = availableSampleCodes.indexOf(b.sampleCode)
      return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex)
    })
  }, [resultRows, availableSampleCodes])
  const activeResultGroup = resultGroups.find((group) => group.sampleCode === activeResultSample) || resultGroups[0]
  const currentReport = data?.finalReports?.find((report) => report.is_current && report.approval_status === 'approved')
  const pendingReport = data?.finalReports?.find((report) => report.approval_status === 'pending')
  const equipmentRequirements = data?.equipmentRequirements || []
  const sampleGate = data?.sampleGate || { total: 0, started: 0, completed: 0, unprinted: 0, unstored: 0, stored: 0, required: true, canAdvance: false }
  const modalWarning = orderWarning({
    ...service,
    received_samples: sampleGate.total,
    stored_samples: Math.max(0, Number(sampleGate.total) - Number(sampleGate.started)),
    processing_samples: Math.max(0, Number(sampleGate.started) - Number(sampleGate.completed)),
  }, { internal: user.role === 'admin' || Boolean(user.activeWorker) })
  const selectedEquipment = equipmentData.equipment.find((item) => item.id === runForm.equipmentId)
  const linkedEquipmentRuns = equipmentData.equipmentRuns.filter((run) => (run.services || []).some((item) => item.id === service.id))
  const canRegisterResults = data?.service?.status === 'completed' || currentPosition >= lastPosition || /informe|resultado|emisi/i.test(`${currentStage?.stage_key || ''} ${currentStage?.title || ''}`)
  const canEnterResults = isWorker || isAdmin

  const toggleStage = (stageId) => {
    setExpandedStages((current) => current.includes(stageId)
      ? current.filter((id) => id !== stageId)
      : [...current, stageId])
  }

  const move = async (direction) => {
    setWorking(true)
    setError('')
    try {
      const result = await api.moveServiceStage(service.id, direction, {
        note: moveNote,
      })
      setData(result)
      setMoveNote('')
      onChanged?.()
      notify(direction === 'back' ? 'El servicio retrocedió una etapa.' : 'Etapa actualizada correctamente.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setWorking(false)
    }
  }

  const edit = (stage) => {
    setEditing(stage)
    setStageForm({
      performedBy: isWorker ? user.activeWorker.fullName : stage.performed_by || '',
      analystId: isWorker ? user.activeWorker.id : stage.analyst_id || (stage.analyst ? '__existing__' : ''),
      observations: stage.observations || '',
      startedAt: toDateTimeInput(stage.started_at),
      completedAt: toDateTimeInput(stage.completed_at),
      changeNote: '',
    })
    setNewPhotos([])
    setError('')
  }

  const addPhotos = async (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length + newPhotos.length > 3) {
      setError('Puedes añadir como máximo 3 fotografías cada vez.')
      return
    }
    setWorking(true)
    try {
      const compressed = []
      for (const file of files) compressed.push(await compressPhoto(file))
      setNewPhotos((current) => [...current, ...compressed])
      setError('')
    } catch (photoError) {
      setError(photoError.message)
    } finally {
      setWorking(false)
      event.target.value = ''
    }
  }

  const saveStage = async (event) => {
    event.preventDefault()
    setWorking(true)
    setError('')
    try {
      const result = await api.saveServiceStage(service.id, {
        stageId: editing.id,
        ...stageForm,
        startedAt: stageForm.startedAt ? new Date(stageForm.startedAt).toISOString() : '',
        completedAt: stageForm.completedAt ? new Date(stageForm.completedAt).toISOString() : '',
        photos: newPhotos,
      })
      setData(result)
      setEditing(null)
      setNewPhotos([])
      notify('Detalles y evidencias de la etapa guardados.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setWorking(false)
    }
  }

  const deletePhoto = async (photoId) => {
    setWorking(true)
    try {
      const result = await api.deleteStagePhoto(service.id, photoId)
      setData(result)
      setEditing((current) => current ? {
        ...current,
        photos: current.photos.filter((photo) => photo.id !== photoId),
      } : current)
      notify('Fotografía eliminada.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setWorking(false)
    }
  }

  const assignCrew = async (event) => {
    event.preventDefault()
    setWorking(true)
    setError('')
    try {
      const result = await api.assignServiceCrew(service.id, {
        ...crewForm,
        scheduledAt: crewForm.scheduledAt ? new Date(crewForm.scheduledAt).toISOString() : null,
      })
      setData(result)
      setCrewForm({ crewId: '', assignmentType: 'sampling', scheduledAt: '', notes: '' })
      notify('Cuadrilla asignada al servicio.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setWorking(false)
    }
  }

  const chooseFinalReport = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setWorking(true)
    setError('')
    try {
      setFinalReport(await readFinalReport(file))
    } catch (reportError) {
      setFinalReport(null)
      setError(reportError.message)
    } finally {
      setWorking(false)
      event.target.value = ''
    }
  }

  const uploadFinalReport = async (event) => {
    event.preventDefault()
    if (!finalReport) {
      setError('Selecciona el informe final en PDF.')
      return
    }
    setWorking(true)
    setError('')
    try {
      const result = await api.uploadFinalReport(service.id, finalReport, reportNotes)
      setData(result)
      setFinalReport(null)
      setReportNotes('')
      onChanged?.()
      notify('Informe enviado a aprobación. Todavía no es visible para el cliente.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setWorking(false)
    }
  }

  const updateResult = (key, values) => setResultRows((current) => current.map((row) => row.key === key ? { ...row, ...values } : row))
  const updateResultGroup = (groupKey, values) => setResultRows((current) => current.map((row) => row.groupKey === groupKey ? { ...row, ...values } : row))
  const addParameterToResult = (group, item = null) => setResultRows((current) => [...current, {
    ...blankResult(item, group.key, group.label),
    sampleCode: group.rows[0]?.sampleCode || '',
    identifiedAgent: group.rows[0]?.identifiedAgent || '',
  }])

  const addResultPhotos = async (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length + resultPhotos.length > 10) {
      setError('Puedes adjuntar como máximo 10 fotografías de resultados.')
      event.target.value = ''
      return
    }
    setWorking(true); setError('')
    try {
      const compressed = []
      for (const file of files) compressed.push(await compressPhoto(file))
      setResultPhotos((current) => [...current, ...compressed])
    } catch (requestError) { setError(requestError.message) }
    finally { setWorking(false); event.target.value = '' }
  }

  const saveResults = async () => {
    setWorking(true); setError('')
    try {
      const result = await api.saveServiceResults(service.id, resultRows, resultPhotos.map(({ id, fileName, title, note, mimeType, dataUrl }) => id ? ({ id, title, note }) : ({ fileName, title, note, mimeType, dataUrl })))
      setData(result)
      const rows = sampleResultRows(result.service, result.results || [])
      const codes = [...new Set(rows.map((row) => row.sampleCode).filter(Boolean))]
      setResultRows(rows)
      setActiveResultSample((current) => codes.includes(current) ? current : codes[0] || '')
      setResultPhotos((result.resultPhotos || []).map((photo, index) => ({ id: photo.id, fileName: photo.file_name, title: photo.title || photo.file_name?.replace(/\.[^.]+$/, '') || `Fotografía ${index + 1}`, note: photo.note || '', mimeType: photo.mime_type, dataUrl: photo.data_url })))
      notify('Resultados guardados en la orden.')
    } catch (requestError) { setError(requestError.message) }
    finally { setWorking(false) }
  }

  const generateReport = async () => {
    setWorking(true); setError('')
    try {
      const result = await api.generateFinalReport(service.id, reportNarrative)
      setData(result); setReportNarrative({ interpretation: '', notes: '', observations: '' }); onChanged?.()
      notify('Informe generado y enviado a Luis, Andy y Antonio para aprobación.')
    } catch (requestError) { setError(requestError.message) }
    finally { setWorking(false) }
  }

  const reviewReport = async (reportId, decision) => {
    const notes = decision === 'reject'
      ? reviewNotes.trim() || 'Requiere corrección antes de su publicación.'
      : reviewNotes.trim()
    setWorking(true); setError(''); setReviewError('')
    try {
      const result = await api.reviewFinalReport(service.id, reportId, decision, notes)
      setData(result); setReviewNotes(''); onChanged?.()
      notify(decision === 'approve' ? 'Informe aprobado y publicado para el cliente.' : 'Informe rechazado para corrección.')
    } catch (requestError) { setReviewError(requestError.message) }
    finally { setWorking(false) }
  }

  const loadEquipment = async () => {
    setEquipmentLoading(true)
    setError('')
    try {
      const result = await api.equipmentOperations()
      setEquipmentData(result)
      const first = result.equipment?.find((item) => item.status === 'active') || null
      setRunForm((current) => current.equipmentId ? current : equipmentForm(first, user.id, `${service.code} · ${currentStage?.title || 'Etapa actual'}`))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setEquipmentLoading(false)
    }
  }

  const toggleEquipment = async () => {
    const next = !equipmentOpen
    setEquipmentOpen(next)
    setActivePanel(next ? 'equipment' : null)
    if (next && !equipmentData.equipment.length) await loadEquipment()
  }

  const togglePanel = (panel) => {
    const next = activePanel === panel ? null : panel
    setActivePanel(next)
    if (panel !== 'equipment') setEquipmentOpen(false)
  }

  const chooseEquipment = (equipmentId) => {
    const item = equipmentData.equipment.find((candidate) => candidate.id === equipmentId)
    setRunForm(equipmentForm(item, user.id, `${service.code} · ${currentStage?.title || 'Etapa actual'}`))
  }

  const startEquipment = async (event) => {
    event.preventDefault()
    setWorking(true)
    setError('')
    try {
      await api.createEquipmentOperation({ action: 'start_equipment_run', ...runForm, serviceIds: [service.id], stageId: currentStage?.id || null })
      await loadEquipment()
      notify(`Cronómetro iniciado y vinculado a la etapa “${currentStage?.title || 'actual'}”.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setWorking(false)
    }
  }

  const finishEquipment = async (run) => {
    setWorking(true)
    setError('')
    try {
      await api.updateEquipmentOperation({ action: 'finish_equipment_run', id: run.id })
      await Promise.all([loadEquipment(), load()])
      notify(`${run.equipment_name} finalizado. Ya cuenta para la trazabilidad de esta etapa.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setWorking(false)
    }
  }

  const reportEquipmentNonconformity = async (event) => {
    event.preventDefault()
    setWorking(true)
    setError('')
    try {
      await api.createEquipmentOperation({
        action: 'create_equipment_run_nonconformity', runId: nonconformityRun.id, ...nonconformityForm,
      })
      setNonconformityRun(null)
      setNonconformityForm({ description: '', immediateAction: '', rootCause: '', correctiveAction: '' })
      await loadEquipment()
      notify('No conformidad registrada y añadida al PDF de trazabilidad del equipo.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setWorking(false)
    }
  }

  const focusStep = sampleGate.required === false
    ? 'stage'
    : sampleGate.total === 0
    ? 'intake'
    : Number(sampleGate.unprinted || 0) > 0
      ? 'print'
      : Number(sampleGate.unstored || 0) > 0
        ? 'custody'
        : 'stage'
  const focusAction = () => {
    if (focusStep === 'stage' && currentStage) return edit(currentStage)
    if (focusStep === 'print') {
      const intakeId = sampleGate.unprintedId || sampleGate.unprinted_id
      if (intakeId) {
        window.open(`/api/service-workflow?sampleIntake=1&serviceId=${encodeURIComponent(service.id)}&id=${encodeURIComponent(intakeId)}&format=pdf`, '_blank', 'noopener,noreferrer')
        api.updateSampleIntake(service.id, { action: 'mark_client_copy_printed', id: intakeId })
          .then(() => {
            load(true)
            setSampleActionRequest((current) => ({ key: current.key + 1, action: 'reload' }))
          })
          .catch((requestError) => setError(requestError.message))
        return
      }
    }
    setActivePanel('sample')
    setEquipmentOpen(false)
    setSampleActionRequest((current) => ({ key: current.key + 1, action: focusStep }))
    window.setTimeout(() => document.getElementById('sample-intake-flow')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const openWarning = () => {
    if (modalWarning?.panel === 'equipment') return toggleEquipment()
    setEquipmentOpen(false)
    setActivePanel(modalWarning?.panel === 'sample' ? 'sample' : 'trace')
    if (modalWarning?.panel === 'sample') setSampleOpenRequest((current) => current + 1)
  }

  return (
    <div className="modal-overlay workflow-overlay" onClick={onClose}>
      <section className="modal workflow-modal" onClick={(event) => event.stopPropagation()}>
        <header className="workflow-head">
          <div>
            <span className="eyebrow">{service.code}</span>
            <h2>{service.service_type_name}</h2>
            <p>{isWorker ? `Orden asignada a ${user.activeWorker.fullName} · identidad del cliente protegida` : `${service.client_name} · ${service.zone_name} · Cotización ${service.quote_reference}`}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar seguimiento">×</button>
        </header>

        {loading ? <div className="services-loading">Cargando etapas…</div> : error && !data ? (
          <div className="form-error">{error}</div>
        ) : (
          <>
            <div className="workflow-summary">
              <div>
                <span>Progreso del servicio</span>
                <strong>{progress}%</strong>
              </div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
              <span className={`badge ${data.service.status === 'completed' ? 'listo' : 'analisis'}`}>
                {data.service.status === 'completed' ? 'Completado' : currentStage?.title || 'En preparación'}
              </span>
            </div>

            {modalWarning && (!canEditStages || modalWarning.panel === 'equipment') && <section className={`workflow-smart-warning ${modalWarning.tone}`}>
              <span><IcoShield /></span>
              <div><small>Atención en esta orden</small><strong>{modalWarning.title}</strong><p>{modalWarning.detail}</p></div>
              <button type="button" onClick={openWarning}>{modalWarning.panel === 'equipment' ? 'Ver equipo' : modalWarning.panel === 'sample' ? 'Ir a muestra' : 'Ver etapas'} <IcoArrow /></button>
            </section>}

            {canEditStages && <section className="workflow-action-dock">
              <div className="workflow-action-now">
                <span className="workflow-action-pulse"><i /></span>
                <div>
                  <span className="eyebrow">Siguiente acción</span>
                  <h3>{focusStep === 'intake' ? 'Recibir la muestra' : focusStep === 'print' ? 'Imprimir copia del cliente' : focusStep === 'custody' ? 'Indicar dónde se guarda' : currentStage?.title || 'Etapa actual'}</h3>
                  <p>{focusStep === 'intake' ? 'Captura la firma del cliente y guarda.' : focusStep === 'print' ? 'Se abrirá el PDF firmado listo para imprimir.' : focusStep === 'custody' ? 'Selecciona refrigeradora, mesa u otra ubicación.' : sampleGate.required === false ? 'Esta orden no requiere muestra. Continúa directamente con la etapa.' : 'Al avanzar, el cronómetro de la muestra comenzará automáticamente.'}</p>
                </div>
                <button className="btn btn-primary" type="button" onClick={focusAction}>{focusStep === 'intake' ? 'Recibir muestra' : focusStep === 'print' ? 'Imprimir copia' : focusStep === 'custody' ? 'Guardar ubicación' : 'Continuar etapa'} <IcoArrow /></button>
              </div>
              <nav className="workflow-quick-tools" aria-label="Herramientas de la orden">
                <button className={activePanel === 'sample' ? 'active' : ''} type="button" disabled={sampleGate.required === false} onClick={() => togglePanel('sample')}><span><IcoFlask /></span><strong>Muestra</strong><small>{sampleGate.required === false ? 'No requerida' : sampleGate.total ? `${sampleGate.total} registrada${sampleGate.total === 1 ? '' : 's'}` : 'Sin ingreso'}</small></button>
                <button className={activePanel === 'trace' ? 'active' : ''} type="button" onClick={() => togglePanel('trace')}><span><IcoCheck /></span><strong>Etapas</strong><small>{currentPosition + 1} de {data.stages.length}</small></button>
                <button className={activePanel === 'equipment' ? 'active' : ''} type="button" onClick={toggleEquipment}><span><IcoFlask /></span><strong>Equipo</strong><small>{linkedEquipmentRuns.some((run) => run.status === 'running') ? 'Cronómetro activo' : 'Solo si aplica'}</small></button>
                <button className={activePanel === 'report' ? 'active' : ''} type="button" onClick={() => togglePanel('report')}><span><IcoFile /></span><strong>Resultados</strong><small>{currentReport ? 'Publicado' : pendingReport ? 'Por aprobar' : data.results?.length ? 'Listos' : 'Pendientes'}</small></button>
                <button className={activePanel === 'more' ? 'active' : ''} type="button" onClick={() => togglePanel('more')}><span><IcoShield /></span><strong>Más</strong><small>{isAdmin ? 'Servicios y cuadrilla' : 'Datos de la orden'}</small></button>
              </nav>
            </section>}

            {isAdmin && activePanel === 'more' && <section className="workflow-related-services"><div><IcoFlask /><span><strong>Servicios incluidos en la orden</strong><small>Puedes añadir, quitar o cambiar análisis sin afectar la trazabilidad existente.</small></span></div><div>{onEditService && <button className="btn btn-primary" onClick={() => onEditService(service)}>Editar servicios</button>}</div></section>}

            {(isWorker || isAdmin) && equipmentOpen && <section className="workflow-inline-equipment">
              <header><div><span className="eyebrow">Dentro de {service.code}</span><h3>Registrar uso de equipo</h3><p>Se vinculará automáticamente con la etapa actual: <strong>{currentStage?.title || 'Sin etapa activa'}</strong>.</p></div></header>
              {equipmentLoading ? <div className="services-loading">Cargando equipos…</div> : <>
                {linkedEquipmentRuns.length > 0 && <div className="workflow-equipment-runs">{linkedEquipmentRuns.map((run) => { const linkedStage = run.services?.find((item) => item.id === service.id)?.stageTitle; return <article key={run.id}><div><span>{run.record_code}</span><strong>{run.equipment_code} · {run.equipment_name}</strong><small>{linkedStage ? `Etapa: ${linkedStage} · ` : ''}{run.material_description}</small></div><div className="workflow-equipment-run-actions"><EquipmentTimer startedAt={run.started_at} endedAt={run.ended_at} />{run.status === 'running' ? <button className="btn btn-primary btn-sm" disabled={working} onClick={() => finishEquipment(run)}>Terminar</button> : <><a className="text-link" href={`/api/services?labOperations=1&format=pdf&type=equipment-run&id=${run.id}`} target="_blank" rel="noreferrer"><IcoFile /> PDF</a>{run.nonconformities?.length ? <span className="equipment-nc-registered"><IcoShield /> NC registrada</span> : <button className="btn btn-ghost btn-sm" onClick={() => { setNonconformityRun(run); setNonconformityForm({ description: '', immediateAction: '', rootCause: '', correctiveAction: '' }) }}><IcoShield /> Reportar no conformidad</button>}</>}</div></article> })}</div>}
                {nonconformityRun && <form className="workflow-equipment-nc" onSubmit={reportEquipmentNonconformity}><header><IcoShield /><div><strong>No conformidad · {nonconformityRun.equipment_code}</strong><span>{nonconformityRun.record_code} · se incorporará al PDF del equipo</span></div></header><div className="form-grid"><label className="field field-wide"><span>Descripción de la desviación</span><textarea rows="3" value={nonconformityForm.description} onChange={(event) => setNonconformityForm({ ...nonconformityForm, description: event.target.value })} required /></label><label className="field field-wide"><span>Acción inmediata</span><textarea rows="3" value={nonconformityForm.immediateAction} onChange={(event) => setNonconformityForm({ ...nonconformityForm, immediateAction: event.target.value })} required /></label><label className="field"><span>Causa raíz</span><textarea rows="2" value={nonconformityForm.rootCause} onChange={(event) => setNonconformityForm({ ...nonconformityForm, rootCause: event.target.value })} /></label><label className="field"><span>Acción correctiva</span><textarea rows="2" value={nonconformityForm.correctiveAction} onChange={(event) => setNonconformityForm({ ...nonconformityForm, correctiveAction: event.target.value })} /></label></div><footer><button type="button" className="btn btn-ghost" onClick={() => setNonconformityRun(null)}>Cancelar</button><button className="btn btn-primary" disabled={working}>{working ? 'Registrando…' : 'Registrar no conformidad'}</button></footer></form>}
                <form className="workflow-equipment-form" onSubmit={startEquipment}>
                  <label className="field field-wide"><span>Equipo</span><select value={runForm.equipmentId} onChange={(event) => chooseEquipment(event.target.value)} required><option value="">Seleccionar equipo…</option>{equipmentData.equipment.filter((item) => item.status === 'active').map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name} · {EQUIPMENT_NAMES[item.equipment_type]}</option>)}</select></label>
                  {selectedEquipment && <>
                    <div className="workflow-equipment-ready field-wide"><span><IcoCheck /></span><div><strong>Todo listo para iniciar</strong><small>{service.code} · {currentStage?.title || 'Etapa actual'} · operador y hora automáticos</small></div></div>
                    <details className="workflow-equipment-advanced"><summary>Revisar o cambiar datos <small>La configuración ya está completada</small></summary><div className="form-grid">
                      <label className="field field-wide"><span>Qué se coloca o analiza</span><textarea rows="2" value={runForm.materialDescription} onChange={(event) => setRunForm({ ...runForm, materialDescription: event.target.value })} placeholder={selectedEquipment.equipment_type === 'flow_cabinet' ? 'Opcional para cabina' : 'Muestra, medio, material, carga o cantidad'} required={selectedEquipment.equipment_type !== 'flow_cabinet'} /></label>
                      {['incubator','shaker_incubator'].includes(selectedEquipment.equipment_type) && <label className="field"><span>Ubicación interna</span><input value={runForm.storagePosition} onChange={(event) => setRunForm({ ...runForm, storagePosition: event.target.value })} placeholder="Bandeja, nivel o posición" required /></label>}
                      {['autoclave','oven'].includes(selectedEquipment.equipment_type) && <label className="field"><span>Temperatura (°C)</span><input type="number" value={runForm.temperatureC} onChange={(event) => setRunForm({ ...runForm, temperatureC: event.target.value })} required /></label>}
                      {selectedEquipment.equipment_type === 'autoclave' && <label className="field"><span>Presión (bar)</span><input type="number" step="0.01" value={runForm.pressureBar} onChange={(event) => setRunForm({ ...runForm, pressureBar: event.target.value })} required /></label>}
                      {['autoclave','incubator','shaker_incubator','centrifuge','oven'].includes(selectedEquipment.equipment_type) && <label className="field"><span>Tiempo previsto (opcional)</span><input type="number" min="1" value={runForm.durationMinutes} onChange={(event) => setRunForm({ ...runForm, durationMinutes: event.target.value })} placeholder="El cronómetro medirá el tiempo real" /></label>}
                      {['shaker_incubator','centrifuge'].includes(selectedEquipment.equipment_type) && <label className="field"><span>RPM</span><input type="number" min="1" value={runForm.rpm} onChange={(event) => setRunForm({ ...runForm, rpm: event.target.value })} required /></label>}
                      {isAdmin && <label className="field"><span>Operador</span><select value={runForm.operatorUserId} onChange={(event) => setRunForm({ ...runForm, operatorUserId: event.target.value })} required>{(equipmentData.operators || []).map((operator) => <option value={operator.id} key={operator.id}>{operator.full_name}</option>)}</select></label>}
                      <label className="field field-wide"><span>Observaciones</span><textarea rows="2" value={runForm.observations} onChange={(event) => setRunForm({ ...runForm, observations: event.target.value })} /></label>
                    </div></details>
                  </>}
                  <footer><button className="btn btn-primary equipment-start-button" disabled={working || !runForm.equipmentId}>{working ? 'Iniciando…' : '▶ Iniciar ahora'}</button></footer>
                </form>
              </>}
            </section>}

            {!isAdmin && !isWorker && data.stages.length > 0 && (
              <section className="client-trace-overview">
                <div className="client-trace-current">
                  <div className="client-trace-current-icon">
                    {data.service.status === 'completed' ? <IcoCheck /> : currentPosition + 1}
                  </div>
                  <div className="client-trace-current-copy">
                    <span>{data.service.status === 'completed' ? 'Servicio finalizado' : 'Estamos trabajando ahora en'}</span>
                    <h3>{currentStage?.title || 'Preparación del servicio'}</h3>
                    <p>
                      {data.service.status === 'completed'
                        ? 'Todas las etapas del servicio han sido completadas. Puedes revisar el detalle y las evidencias debajo.'
                        : nextStage
                          ? `La siguiente etapa será: ${nextStage.title}.`
                          : 'Esta es la última etapa antes de completar el servicio.'}
                    </p>
                  </div>
                  <div className="client-trace-position">
                    <strong>{currentPosition + 1}<small>/{data.stages.length}</small></strong>
                    <span>etapas</span>
                  </div>
                </div>
                <div className="client-trace-roadmap" aria-label="Recorrido de etapas">
                  {data.stages.map((stage, index) => (
                    <div className={`client-roadmap-step ${stage.status}`} key={stage.id}>
                      <span>{stage.status === 'completed' ? <IcoCheck /> : index + 1}</span>
                      <strong>{stage.title}</strong>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {(data.service.service_items?.length || 0) > 0 && (!canEditStages || activePanel === 'more') && (
              <section className="workflow-analysis-list">
                <div>
                  <span className="card-kicker">Alcance de la muestra</span>
                  <strong>{data.service.service_items.length} {data.service.service_items.length === 1 ? 'análisis incluido' : 'análisis incluidos'}</strong>
                </div>
                <div>
                  {data.service.service_items.map((item) => (
                    <span key={item.id}>
                      <IcoCheck />
                      <span>{item.name}</span>
                      <small>{item.categoryName}</small>
                    </span>
                  ))}
                </div>
              </section>
            )}

            {(!canEditStages || activePanel === 'sample') && <SampleIntakeFlow
              serviceId={service.id}
              user={user}
              notify={notify}
              autoOpenKey={sampleOpenRequest}
              actionRequest={canEditStages ? sampleActionRequest : null}
              compactActions={canEditStages}
              onStateChange={(nextGate) => setData((current) => current ? ({ ...current, sampleGate: nextGate }) : current)}
            />}

            {(!canEditStages || activePanel === 'trace') && <ClientLabTraceability
              serviceId={service.id}
              processes={data.laboratoryProcesses || []}
              equipmentRuns={data.equipmentRuns || []}
            />}

            {canEditStages && equipmentRequirements.length > 0 && <section className={`workflow-equipment-suggestion ${equipmentRequirements.every((item) => item.completed) ? 'complete' : ''}`}>
              <span className="workflow-equipment-suggestion-icon"><IcoFlask /></span>
              <div className="workflow-equipment-suggestion-copy">
                <small>Equipo recomendado · no obligatorio</small>
                <strong>{equipmentRequirements.map((item) => item.label).join(' · ')}</strong>
                <span>{equipmentRequirements.every((item) => item.completed) ? 'El uso ya quedó registrado en la trazabilidad.' : '¿Lo utilizaste en esta etapa? Inicia el registro desde aquí. Puedes avanzar sin hacerlo.'}</span>
              </div>
              <div className="workflow-equipment-suggestion-status">
                {equipmentRequirements.map((item) => <span className={item.completed ? 'completed' : 'pending'} key={item.key}>{item.completed ? <IcoCheck /> : <i />} {item.completed ? 'Registrado' : 'Sin registrar'}</span>)}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={toggleEquipment}>{equipmentOpen ? 'Cerrar equipo' : equipmentRequirements.every((item) => item.completed) ? 'Ver registro' : 'Usar equipo'} <IcoArrow /></button>
            </section>}

            {canMoveStages && data.stages.length > 0 && (
              <>
              <div className="workflow-controls">
                <div className="workflow-move-essential">
                  <div className="workflow-stage-owner"><IcoShield /><span><small>Responsable automático</small><strong>{user.activeWorker?.fullName || user.nombre}</strong></span></div>
                  <details className="workflow-move-note"><summary>Añadir nota (opcional)</summary><label className="field"><span>{isWorker ? 'Nota del avance' : 'Motivo del cambio de etapa'}</span><input value={moveNote} onChange={(event) => setMoveNote(event.target.value)} placeholder="Solo si necesitas dejar una aclaración" /></label></details>
                </div>
                <button
                  className="btn btn-ghost"
                  disabled={working || (currentPosition === 0 && data.service.status !== 'completed')}
                  onClick={() => move('back')}
                >
                  ← Retroceder etapa
                </button>
                <button className={`btn btn-primary ${data.service.status === 'completed' ? 'is-completed' : ''}`} disabled={working || data.service.status === 'completed'} onClick={() => move('forward')}>
                  {data.service.status === 'completed'
                    ? '✓ Servicio ya completado'
                    : currentPosition >= lastPosition
                      ? 'Completar servicio'
                      : 'Avanzar etapa'} <IcoArrow />
                </button>
              </div>
              </>
            )}

            {error && <div className="form-error workflow-error">{error}</div>}

            {canEditStages && activePanel === 'report' && <section className="workflow-results-entry">
              <header>
                <span className="workflow-result-step">1</span>
                <div><span className="card-kicker">Cierre analítico</span><h3>{canEnterResults ? 'Resultados por muestra' : 'Resultados del analista'}</h3><p>{canEnterResults ? 'Selecciona una muestra y agrega sus parámetros uno por uno.' : 'Consulta cada muestra y sus parámetros publicados.'}</p></div>
                <span className="count-pill">{resultGroups.length}</span>
              </header>
              {!canRegisterResults && canEnterResults && <div className="workflow-results-gate"><IcoShield /><span><strong>Disponible al llegar a la etapa de informe</strong><small>Avanza hasta el cierre para registrar los resultados finales.</small></span></div>}
              {canEnterResults && <div className="workflow-results-signer"><IcoShield /><span><small>Responsable técnico automático</small><strong>{user.activeWorker?.fullName || user.nombre}</strong><em>{isWorker ? 'Firma automática mediante PIN' : 'Firma automática mediante sesión administrativa'}</em></span></div>}
              <nav className="workflow-sample-switcher" aria-label="Muestras del servicio">
                {resultGroups.map((group, index) => {
                  const completed = group.rows.filter((row) => row.parameter.trim() && row.resultValue.trim()).length
                  return <button type="button" key={group.key} className={group.sampleCode === activeResultGroup?.sampleCode ? 'active' : ''} onClick={() => setActiveResultSample(group.sampleCode)}>
                    <span>{index + 1}</span>
                    <div><strong>Muestra {index + 1}</strong><small>{group.sampleCode}</small></div>
                    <em>{completed}/{group.rows.length} listos</em>
                  </button>
                })}
              </nav>
              <div className="workflow-result-list">{activeResultGroup && (() => {
                const group = activeResultGroup
                const common = group.rows[0]
                const sampleIndex = Math.max(0, resultGroups.findIndex((item) => item.key === group.key))
                const availableParameters = (data?.service?.service_items || []).filter((item) => !group.rows.some((row) => row.serviceItemId === item.id || row.parameter.trim().toLowerCase() === String(item.name || '').trim().toLowerCase()))
                return <article className="workflow-result-group" key={group.key}>
                <header className="workflow-sample-panel-header">
                  <span className="workflow-sample-number">{sampleIndex + 1}</span>
                  <div><small>Trabajando ahora</small><strong>Muestra {sampleIndex + 1}</strong><em>{group.sampleCode}</em></div>
                  <span className="workflow-parameter-count">{group.rows.length} {group.rows.length === 1 ? 'parámetro' : 'parámetros'}</span>
                </header>
                <div className="workflow-result-group-data">
                  <div className="workflow-sample-code"><small>Código de muestra</small><strong>{common.sampleCode}</strong><span>Asignado automáticamente</span></div>
                  <label className="field"><span>Agente identificado</span><input disabled={!canEnterResults} value={common.identifiedAgent} onChange={(event) => updateResultGroup(group.key, { identifiedAgent: event.target.value })} placeholder="Ej. E. coli, Fusarium spp. o no detectado" /></label>
                </div>
                <div className="workflow-result-parameters">{group.rows.map((row, parameterIndex) => <section key={row.key}>
                  <header><span>Parámetro {parameterIndex + 1}</span>{canEnterResults && group.rows.length > 1 && <button type="button" onClick={() => setResultRows((current) => current.filter((item) => item.key !== row.key))}>Quitar</button>}</header>
                  <div className="workflow-result-main">
                    <label className="field"><span>Parámetro</span><input disabled={!canEnterResults} value={row.parameter} onChange={(event) => updateResult(row.key, { parameter: event.target.value })} placeholder="Ej. pH" /></label>
                    <label className="field"><span>Resultado</span><input disabled={!canEnterResults} value={row.resultValue} onChange={(event) => updateResult(row.key, { resultValue: event.target.value })} placeholder="Valor obtenido" /></label>
                    <label className="field"><span>Unidad</span><input disabled={!canEnterResults} value={row.unit} onChange={(event) => updateResult(row.key, { unit: event.target.value })} placeholder="mg/kg, UFC/mL…" /></label>
                  </div>
                  <details><summary>Mínimo, máximo, referencia y método <small>Opcional</small></summary><div className="workflow-result-extra">
                    <label className="field"><span>Mínimo</span><input disabled={!canEnterResults} inputMode="decimal" value={row.minimumValue} onChange={(event) => updateResult(row.key, { minimumValue: event.target.value })} /></label>
                    <label className="field"><span>Máximo</span><input disabled={!canEnterResults} inputMode="decimal" value={row.maximumValue} onChange={(event) => updateResult(row.key, { maximumValue: event.target.value })} /></label>
                    <label className="field"><span>Valor referencial</span><input disabled={!canEnterResults} value={row.referenceValue} onChange={(event) => updateResult(row.key, { referenceValue: event.target.value })} /></label>
                    <label className="field"><span>Método</span><input disabled={!canEnterResults} value={row.method} onChange={(event) => updateResult(row.key, { method: event.target.value })} /></label>
                  </div></details>
                  <ParameterRangeGraph result={row.resultValue} minimum={row.minimumValue} maximum={row.maximumValue} />
                </section>)}</div>
                {canEnterResults && <div className="workflow-parameter-add">
                  <div><strong>Agregar otro parámetro</strong><small>Elige un análisis solicitado o crea uno personalizado.</small></div>
                  <div className="workflow-parameter-quick">
                    {availableParameters.map((item) => <button type="button" key={item.id} onClick={() => addParameterToResult(group, item)}>+ {item.name}</button>)}
                    <button type="button" className="custom" onClick={() => addParameterToResult(group)}>+ Parámetro personalizado</button>
                  </div>
                </div>}
              </article> })()}</div>
              <div className="workflow-result-photos">
                <div><span className="field-label">Fotografías de resultados <b>{resultPhotos.length}/10</b></span><small>El PDF mostrará 4 fotografías por hoja horizontal, en dos columnas, y las agrupará automáticamente por tamaño y orientación. Edita el título y agrega una nota cuando sea necesario.</small></div>
                {canEnterResults && <label className={`btn btn-ghost btn-sm photo-upload ${resultPhotos.length >= 10 ? 'disabled' : ''}`}><IcoCamera /> Agregar fotografías<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple disabled={resultPhotos.length >= 10} onChange={addResultPhotos} /></label>}
                {resultPhotos.length > 0 && <div className="workflow-result-photo-grid">{resultPhotos.map((photo, index) => <figure key={photo.id || `${photo.fileName}-${index}`}>
                  <div className="workflow-result-photo-preview"><img src={photo.dataUrl} alt={photo.title || photo.fileName} /><span>{index + 1}</span>{canEnterResults && <button type="button" aria-label={`Eliminar fotografía ${index + 1}`} onClick={() => setResultPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</div>
                  <figcaption>
                    <label><span>Título</span><input disabled={!canEnterResults} value={photo.title || ''} maxLength="120" onChange={(event) => setResultPhotos((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} placeholder={`Fotografía ${index + 1}`} /></label>
                    <label><span>Nota <small>Opcional</small></span><textarea disabled={!canEnterResults} value={photo.note || ''} maxLength="500" rows="2" onChange={(event) => setResultPhotos((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value } : item))} placeholder="Describe lo observado en la imagen" /></label>
                  </figcaption>
                </figure>)}</div>}
              </div>
              {canEnterResults && <footer><div className="workflow-results-save-note"><strong>{resultGroups.length} {resultGroups.length === 1 ? 'muestra preparada' : 'muestras preparadas'}</strong><small>Puedes volver a cualquier muestra antes de guardar.</small></div><button type="button" className="btn btn-primary" disabled={working || !canRegisterResults} onClick={saveResults}>{working ? 'Guardando…' : 'Guardar todos los resultados'}</button></footer>}
            </section>}

            {(!canEditStages || activePanel === 'report') && <section className={`workflow-final-report ${currentReport ? 'available' : pendingReport ? 'pending-approval' : ''}`}>
              <header>
                <span className="final-report-icon"><IcoFile /></span>
                <div>
                  <div className="card-kicker">Documento de cierre</div>
                  <h3>Informe final del servicio</h3>
                  <p>
                    {currentReport
                      ? `Aprobado${currentReport.approved_by ? ` por ${currentReport.approved_by}` : ''} y disponible para el cliente.`
                      : pendingReport
                        ? 'El informe ya fue generado y espera aprobación antes de mostrarse al cliente.'
                      : isAdmin
                        ? 'Guarda los resultados y genera el informe automáticamente con el formato de AS Labs.'
                        : 'El laboratorio publicará aquí el informe cuando esté validado.'}
                  </p>
                </div>
                {currentReport ? <span className="badge listo">Aprobado</span> : pendingReport ? <span className="badge proceso">Por aprobar</span> : null}
              </header>

              {pendingReport && canEditStages && <div className="final-report-pending">
                <div className="final-report-file"><span><IcoFile /></span><div><strong>{pendingReport.file_name}</strong><small>Versión {pendingReport.version} · {fileSizeLabel(pendingReport.file_size)} · enviado {new Date(pendingReport.approval_requested_at || pendingReport.created_at).toLocaleString('es-PE')}</small><p>El cliente todavía no puede ver este archivo.</p></div></div>
                <a className="btn btn-ghost btn-sm" href={`/api/service-workflow?serviceId=${encodeURIComponent(service.id)}&format=final-report&reportId=${encodeURIComponent(pendingReport.id)}`}>Vista previa</a>
              </div>}

              {pendingReport && data.canApproveReport && <div className="final-report-review">
                <div><IcoShield /><span><strong>Aprobación autorizada</strong><small>Luis Guevara · Andy Espinales · Antonio Guevara</small></span></div>
                <label className="field"><span>Observación para la corrección <small>Opcional</small></span><input value={reviewNotes} onChange={(event) => { setReviewNotes(event.target.value); setReviewError('') }} placeholder="Ej. Corregir resultados, firma o interpretación" /></label>
                {reviewError && <div className="form-error final-report-review-error">{reviewError}</div>}
                <footer><button type="button" className="btn btn-ghost" disabled={working} onClick={() => reviewReport(pendingReport.id, 'reject')}>{working ? 'Procesando…' : 'Rechazar y corregir'}</button><button type="button" className="btn btn-primary" disabled={working} onClick={() => reviewReport(pendingReport.id, 'approve')}><IcoCheck /> {working ? 'Procesando…' : 'Aprobar y publicar'}</button></footer>
              </div>}

              {currentReport && (
                <div className="final-report-current">
                  <div className="final-report-file">
                    <span><IcoFile /></span>
                    <div>
                      <strong>{currentReport.file_name}</strong>
                      <small>
                        Versión {currentReport.version} · {fileSizeLabel(currentReport.file_size)} · {new Date(currentReport.created_at).toLocaleString('es-PE')}
                      </small>
                      {currentReport.notes && <p>{currentReport.notes}</p>}
                    </div>
                  </div>
                  <a
                    className="btn btn-primary btn-sm"
                    href={`/api/service-workflow?serviceId=${encodeURIComponent(service.id)}&format=final-report&reportId=${encodeURIComponent(currentReport.id)}`}
                  >
                    Descargar PDF
                  </a>
                </div>
              )}

              {canEditStages && !pendingReport && <div className="final-report-generate">
                <span className="workflow-result-step">2</span><div><strong>Generar informe automático</strong><small>Informe A4 horizontal, con la tabla completa y la información distribuida en dos columnas.</small></div>
                <button type="button" className="btn btn-primary" disabled={working || !data.results?.length || !canRegisterResults} onClick={generateReport}>{working ? 'Generando…' : 'Generar para aprobación'} <IcoArrow /></button>
                <div className="final-report-narrative">
                  <label className="field"><span>Interpretación</span><textarea value={reportNarrative.interpretation} maxLength="1800" onChange={(event) => setReportNarrative((current) => ({ ...current, interpretation: event.target.value }))} placeholder="Interpretación técnica de los resultados" /></label>
                  <label className="field"><span>Notas</span><textarea value={reportNarrative.notes} maxLength="1200" onChange={(event) => setReportNarrative((current) => ({ ...current, notes: event.target.value }))} placeholder="Notas o alcance del informe" /></label>
                  <label className="field"><span>Observaciones</span><textarea value={reportNarrative.observations} maxLength="1800" onChange={(event) => setReportNarrative((current) => ({ ...current, observations: event.target.value }))} placeholder="Observaciones adicionales" /></label>
                </div>
              </div>}

              {isAdmin && <details className="final-report-manual"><summary>Usar un PDF externo <small>Opcional</small></summary>
                <form className="final-report-form" onSubmit={uploadFinalReport}>
                  <label className={`final-report-drop ${finalReport ? 'selected' : ''}`}>
                    <input type="file" accept="application/pdf,.pdf" onChange={chooseFinalReport} />
                    <IcoFile />
                    <span>
                      <strong>{finalReport ? finalReport.fileName : 'Seleccionar informe final externo'}</strong>
                      <small>{finalReport ? fileSizeLabel(finalReport.fileSize) : 'Archivo PDF de hasta 3 MB'}</small>
                    </span>
                  </label>
                  <label className="field">
                    <span>Nota de entrega</span>
                    <input
                      value={reportNotes}
                      maxLength="500"
                      onChange={(event) => setReportNotes(event.target.value)}
                      placeholder="Opcional: alcance, versión o indicación para el cliente"
                    />
                  </label>
                  <button className="btn btn-primary" disabled={working || !finalReport}>
                    {working ? 'Enviando…' : 'Enviar a aprobación'}
                  </button>
                </form>
              </details>}

              {isAdmin && (data.finalReports?.length || 0) > 0 && (
                <details className="final-report-history">
                  <summary>Ver historial de versiones ({data.finalReports.length})</summary>
                  <div>
                    {data.finalReports.map((report) => (
                      <a
                        key={report.id}
                        href={`/api/service-workflow?serviceId=${encodeURIComponent(service.id)}&format=final-report&reportId=${encodeURIComponent(report.id)}`}
                      >
                        <span>v{report.version} · {report.file_name}</span>
                        <small>{report.approval_status === 'approved' ? `Aprobado${report.approved_by ? ` por ${report.approved_by}` : ''}` : report.approval_status === 'rejected' ? 'Rechazado' : 'Pendiente'} · {new Date(report.created_at).toLocaleString('es-PE')}</small>
                      </a>
                    ))}
                  </div>
                </details>
              )}
            </section>}

            {(!canEditStages || activePanel === 'more') && <section className="workflow-crews">
              <div className="workflow-crews-head">
                <div><div className="card-kicker">Operación de campo</div><h3>Cuadrillas asignadas</h3></div>
                <span className="count-pill">{data.crewAssignments?.length || 0}</span>
              </div>
              {data.crewAssignments?.length > 0 ? (
                <div className="workflow-crew-grid">
                  {data.crewAssignments.map((assignment) => (
                    <article key={assignment.id}>
                      <header>
                        <div className="worker-avatar">{assignment.members?.slice(0, 2).map((member) => member.initials?.[0]).join('') || 'EQ'}<span /></div>
                        <div><strong>{assignment.crew_name}</strong><span>{assignment.status_text || assignment.operational_state}</span></div>
                        <span className="badge analisis">{assignment.assignment_type === 'application' ? 'Aplicación' : assignment.assignment_type === 'sampling' ? 'Muestreo' : assignment.assignment_type === 'logistics' ? 'Logística' : 'Laboratorio'}</span>
                      </header>
                      <div className="crew-member-stack">
                        {assignment.members?.length
                          ? assignment.members.map((member) => <span key={member.id}>{member.fullName} · {member.roleTitle || 'Integrante'}</span>)
                          : <span>Integrantes pendientes de asignación</span>}
                      </div>
                      <div className="spread workflow-crew-meta">
                        <span>{assignment.current_site_name || assignment.home_laboratory_name || 'Ubicación por actualizar'}</span>
                        <strong>{assignment.progress}%</strong>
                      </div>
                      <div className="progress-track"><div className="progress-fill" style={{ width: `${assignment.progress}%` }} /></div>
                      {assignment.scheduled_at && <time><IcoCalendar /> Programado: {new Date(assignment.scheduled_at).toLocaleString('es-PE')}</time>}
                      {assignment.notes && <p>{assignment.notes}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="workflow-crew-empty">Este servicio no requiere cuadrilla o todavía no se ha asignado una. La asignación es opcional.</div>
              )}
              {isAdmin && (
                <details className="workflow-admin-collapsible">
                  <summary><span><strong>Asignar una cuadrilla</strong><small>Opcional · actividad, horario e indicaciones ya tienen valores simples</small></span></summary>
                  <form className="workflow-crew-form" onSubmit={assignCrew}>
                    <label className="field"><span>Cuadrilla</span><select value={crewForm.crewId} onChange={(event) => setCrewForm({ ...crewForm, crewId: event.target.value })} required><option value="">Seleccionar cuadrilla</option>{(data.availableCrews || []).map((crew) => <option value={crew.id} key={crew.id}>{crew.name}{crew.home_laboratory_name ? ` · ${crew.home_laboratory_name}` : ''}</option>)}</select></label>
                    <label className="field"><span>Actividad</span><select value={crewForm.assignmentType} onChange={(event) => setCrewForm({ ...crewForm, assignmentType: event.target.value })}><option value="sampling">Muestreo / recolección</option><option value="application">Aplicación en campo</option><option value="logistics">Logística</option><option value="laboratory">Apoyo de laboratorio</option></select></label>
                    <details className="workflow-crew-optional"><summary>Programación e indicaciones (opcional)</summary><div>
                      <label className="field"><span>Fecha y hora programada</span><input type="datetime-local" value={crewForm.scheduledAt} onChange={(event) => setCrewForm({ ...crewForm, scheduledAt: event.target.value })} /></label>
                      <label className="field"><span>Indicaciones</span><input value={crewForm.notes} onChange={(event) => setCrewForm({ ...crewForm, notes: event.target.value })} placeholder="Punto de encuentro, equipo, alcance…" /></label>
                    </div></details>
                    <button className="btn btn-primary" disabled={working || !(data.availableCrews || []).length}>Asignar cuadrilla</button>
                  </form>
                </details>
              )}
            </section>}

            {(!canEditStages || activePanel === 'trace') && <div className={`workflow-layout ${!isAdmin && !isWorker ? 'client-view' : ''} ${isWorker ? 'worker-view' : ''}`}>
              <div className="workflow-stages">
                {data.stages.map((stage, index) => {
                  const showDetails = canEditStages || stage.status === 'current' || expandedStages.includes(stage.id)
                  return (
                  <article className={`workflow-stage ${stage.status} ${!isAdmin && !isWorker ? 'client-trace-stage' : ''}`} key={stage.id}>
                    <div className="workflow-stage-line" />
                    <div className="workflow-stage-node">{stage.status === 'completed' ? <IcoCheck /> : index + 1}</div>
                    <div className="workflow-stage-body">
                      <header>
                        <div>
                          <span>Etapa {index + 1}</span><h3>{stage.title}</h3>
                          {!isAdmin && !isWorker && <p className="client-stage-caption">{stage.status === 'completed' ? 'Etapa finalizada' : stage.status === 'current' ? 'Etapa en curso' : 'Se iniciará más adelante'}</p>}
                        </div>
                        <div className="client-stage-head-actions">
                          <span className={`stage-status ${stage.status}`}>{STAGE_STATUS[stage.status]}</span>
                          {!isAdmin && !isWorker && stage.status !== 'current' && (
                            <button className="client-stage-toggle" onClick={() => toggleStage(stage.id)}>{showDetails ? 'Ocultar detalle' : 'Ver detalle'}</button>
                          )}
                        </div>
                      </header>
                      {showDetails && <>
                      <div className="stage-evidence-grid">
                        <div><IcoUser /><span>Responsable</span><strong>{stage.performed_by || 'Sin registrar'}</strong></div>
                        <div><IcoShield /><span>Analista</span><strong>{stage.analyst || 'Sin registrar'}</strong></div>
                        <div><IcoCamera /><span>Fotografías</span><strong>{stage.photos.length}</strong></div>
                      </div>
                      {stage.observations && <p className="stage-observations">{stage.observations}</p>}
                      {stage.photos.length > 0 && (
                        <div className="stage-photo-strip">
                          {stage.photos.map((photo) => (
                            <a key={photo.id} href={photo.dataUrl} target="_blank" rel="noreferrer" title={`Abrir ${photo.fileName}`}>
                              <img src={photo.dataUrl} alt={photo.fileName} />
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="stage-footer">
                        <span className="stage-date"><IcoCalendar /> {stage.completed_at ? `Completada ${new Date(stage.completed_at).toLocaleString('es-PE')}` : stage.started_at ? `Iniciada ${new Date(stage.started_at).toLocaleString('es-PE')}` : 'Aún no iniciada'}</span>
                        <div className="stage-footer-actions">
                          <a
                            className="text-link stage-pdf-link"
                            href={`/api/service-workflow?serviceId=${encodeURIComponent(service.id)}&stageId=${encodeURIComponent(stage.id)}&format=pdf`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <IcoFile /> PDF de trazabilidad
                          </a>
                          {canEditStages && <button className="text-link" onClick={() => edit(stage)}>{isWorker ? 'Registrar trabajo y fotos' : 'Editar etapa'}</button>}
                        </div>
                      </div>
                      </>}
                    </div>
                  </article>
                )})}
              </div>

              {isAdmin && <aside className="workflow-audit">
                <div className="card-kicker">Historial de cambios</div>
                <h3>Trazabilidad interna</h3>
                <div className="workflow-events">
                  {sortedEvents.map((event) => (
                    <div key={event.id}>
                      <span />
                      <strong>{event.actor_name}</strong>
                      <p>{event.action === 'stage_moved_back' ? 'Retrocedió una etapa' : event.action === 'stage_moved_forward' ? 'Avanzó una etapa' : event.action === 'stage_details_updated' ? 'Actualizó detalles' : event.action === 'results_saved' ? 'Registró los resultados' : event.action === 'final_report_submitted' || event.action === 'final_report_uploaded' ? 'Envió el informe a aprobación' : event.action === 'final_report_approved' ? 'Aprobó y publicó el informe' : event.action === 'final_report_rejected' ? 'Solicitó corregir el informe' : 'Creó el flujo de trabajo'}</p>
                      {event.note && <em>{event.note}</em>}
                      <time>{new Date(event.created_at).toLocaleString('es-PE')}</time>
                    </div>
                  ))}
                </div>
              </aside>}
            </div>}
          </>
        )}

        {editing && (
          <div className="stage-editor-overlay" onClick={() => setEditing(null)}>
            <form className="stage-editor" onSubmit={saveStage} onClick={(event) => event.stopPropagation()}>
              <header><div><span className="eyebrow">Etapa {editing.position + 1}</span><h3>{editing.title}</h3></div><button type="button" onClick={() => setEditing(null)}>×</button></header>
              {isWorker && <div className="worker-stage-signature"><IcoShield /><div><strong>{user.activeWorker.fullName}</strong><span>Registro firmado con PIN · solo en una orden asignada</span></div></div>}
              <div className="stage-editor-quick">
                <div><IcoCheck /><span><strong>Registro rápido</strong><small>Si todo está conforme, puedes guardar sin escribir nada. La identidad y la hora quedan registradas automáticamente.</small></span></div>
                <label className="field"><span>Observación, resultado o incidencia (opcional)</span><textarea rows="3" value={stageForm.observations} onChange={(event) => setStageForm({ ...stageForm, observations: event.target.value })} placeholder="Escribe únicamente si necesitas dejar una observación…" /></label>
              </div>
              <details className="stage-editor-advanced">
                <summary>Información adicional <small>Responsable, analista, fechas y nota interna</small></summary>
                <div className="form-grid">
                  {!isWorker && <label className="field"><span>Quién realizó la etapa</span><input value={stageForm.performedBy} onChange={(event) => setStageForm({ ...stageForm, performedBy: event.target.value })} placeholder="Nombre del responsable" /></label>}
                  {!isWorker && <>
                  <label className="field"><span>Analista</span><select value={stageForm.analystId} onChange={(event) => setStageForm({ ...stageForm, analystId: event.target.value })}><option value="">Sin asignar</option>{stageForm.analystId === '__existing__' && <option value="__existing__">{editing.analyst} (registro anterior)</option>}{(data?.analysts || []).map((analyst) => <option value={analyst.id} key={analyst.id}>{analyst.full_name}{analyst.specialty ? ` · ${analyst.specialty}` : ''}</option>)}</select></label>
                  <label className="field"><span>Inicio</span><input type="datetime-local" value={stageForm.startedAt} onChange={(event) => setStageForm({ ...stageForm, startedAt: event.target.value })} /></label>
                  <label className="field"><span>Finalización</span><input type="datetime-local" value={stageForm.completedAt} onChange={(event) => setStageForm({ ...stageForm, completedAt: event.target.value })} /></label>
                  </>}
                  <label className="field field-wide"><span>{isWorker ? 'Detalle interno de la actividad' : 'Nota interna de este cambio'}</span><input value={stageForm.changeNote} onChange={(event) => setStageForm({ ...stageForm, changeNote: event.target.value })} placeholder="Opcional" /></label>
                </div>
              </details>
              <div className="photo-editor">
                <div className="spread"><div><span className="field-label">Evidencia fotográfica</span><small>Máximo 3 imágenes por carga. Se comprimen automáticamente.</small></div><label className="btn btn-ghost btn-sm photo-upload"><IcoCamera /> Añadir fotos<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={addPhotos} /></label></div>
                <div className="photo-editor-grid">
                  {editing.photos.map((photo) => (
                    <figure key={photo.id}><img src={photo.dataUrl} alt={photo.fileName} />{isAdmin && <button type="button" onClick={() => deletePhoto(photo.id)}>×</button>}</figure>
                  ))}
                  {newPhotos.map((photo, index) => (
                    <figure className="new" key={`${photo.fileName}-${index}`}><img src={photo.dataUrl} alt={photo.fileName} /><button type="button" onClick={() => setNewPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></figure>
                  ))}
                </div>
              </div>
              {error && <div className="form-error">{error}</div>}
              <footer><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" disabled={working}>{working ? 'Guardando…' : 'Guardar etapa'}</button></footer>
            </form>
          </div>
        )}
      </section>
    </div>
  )
}
