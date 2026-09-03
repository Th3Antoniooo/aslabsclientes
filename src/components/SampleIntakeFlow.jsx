import { useEffect, useRef, useState } from "react";
import { api } from "../data/api.js";
import {
  IcoArrow,
  IcoCalendar,
  IcoCheck,
  IcoFile,
  IcoFlask,
  IcoPlus,
  IcoShield,
  IcoUser,
} from "./Icons.jsx";

const LOCATION = {
  refrigerator: "Refrigeradora",
  room_temperature_table: "Mesa a temperatura ambiente",
  other: "Otra ubicación",
};
const STATUS = {
  stored: "Almacenada",
  processing: "En procesamiento",
  completed: "Procesamiento terminado",
};
function localInput(value = new Date()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function elapsed(start, end = new Date()) {
  if (!start) return "—";
  const minutes = Math.max(
    0,
    Math.floor((new Date(end) - new Date(start)) / 60000),
  );
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function SignaturePad({ label, value, onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvasRef.current.width / rect.width),
      y: (event.clientY - rect.top) * (canvasRef.current.height / rect.height),
    };
  };
  const start = (event) => {
    event.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvasRef.current.setPointerCapture?.(event.pointerId);
  };
  const move = (event) => {
    if (!drawing.current) return;
    event.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = point(event);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#173428";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL("image/png"));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };
  return (
    <div className={`sample-signature ${value ? "signed" : ""}`}>
      <header>
        <span>{label}</span>
        <button type="button" onClick={clear}>
          Limpiar
        </button>
      </header>
      <canvas
        ref={canvasRef}
        width="720"
        height="210"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <small>
        {value ? (
          <>
            <IcoCheck /> Firma capturada
          </>
        ) : (
          "Firma con el dedo dentro del recuadro"
        )}
      </small>
    </div>
  );
}

function IntakeForm({ onClose, onSaved, notify, receivingAnalysts = [] }) {
  const [form, setForm] = useState({
    intakeType: "client_delivery",
    receivedAt: localInput(),
    analysisDueAt: "",
    sampleDescription: "",
    clientRepresentativeName: "",
    clientSignature: "",
    receivedByAnalystId: "",
    sampleConforming: true,
    materialConforming: true,
    nonconformityNotes: "",
    satisfactionRating: "5",
    satisfactionNotes: "",
    storageLocation: "refrigerator",
    storageDetail: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const goStep = (step) => document.getElementById(`sample-intake-step-${step}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSaved({
        ...form,
        receivedAt: new Date(form.receivedAt).toISOString(),
        analysisDueAt: form.analysisDueAt
          ? new Date(form.analysisDueAt).toISOString()
          : null,
      });
      notify("Ingreso de muestra firmado. El equipo ya fue notificado.");
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal sample-intake-modal"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <span className="modal-icon">
            <IcoFlask />
          </span>
          <div>
            <span className="eyebrow">Cadena de ingreso</span>
            <h2>Registrar muestra</h2>
            <p>
              Completa el formato en orden. El sistema te indicará siempre el siguiente paso.
            </p>
          </div>
        </div>
        <nav className="sample-form-sequence" aria-label="Secuencia del formato de ingreso">
          <button type="button" className="done" onClick={() => goStep(1)}><b>1</b><span><small>Primero</small><strong>Tipo de ingreso</strong></span></button>
          <i />
          <button type="button" className={form.sampleDescription || form.clientRepresentativeName ? "done" : "current"} onClick={() => goStep(2)}><b>2</b><span><small>Luego</small><strong>Datos de muestra</strong></span></button>
          <i />
          <button type="button" className={form.clientSignature ? "done" : "current"} onClick={() => goStep(3)}><b>3</b><span><small>Cliente</small><strong>Firmar conformidad</strong></span></button>
          <i />
          <button type="button" className={form.clientSignature ? "current" : "pending"} onClick={() => goStep(4)}><b>4</b><span><small>Final</small><strong>Guardar formato</strong></span></button>
        </nav>
        <section id="sample-intake-step-1" className="sample-form-step">
          <header><b>1</b><div><strong>¿Cómo ingresó la muestra?</strong><span>Selecciona una opción.</span></div></header>
          <div className="sample-intake-mode">
          <button
            type="button"
            className={form.intakeType === "client_delivery" ? "active" : ""}
            onClick={() => set("intakeType", "client_delivery")}
          >
            <IcoUser />
            <strong>Entregada por el cliente</strong>
            <span>La muestra llega al laboratorio</span>
          </button>
          <button
            type="button"
            className={form.intakeType === "aslabs_collection" ? "active" : ""}
            onClick={() => set("intakeType", "aslabs_collection")}
          >
            <IcoFlask />
            <strong>Tomada o recogida por AS Labs</strong>
            <span>Incluye conformidad y satisfacción</span>
          </button>
          </div>
        </section>
        <section id="sample-intake-step-2" className="sample-form-step">
          <header><b>2</b><div><strong>Datos del ingreso</strong><span>Completa lo disponible; la orden y el cliente se incorporan automáticamente.</span></div></header>
            <div className="form-grid sample-primary-fields">
              <label className="field field-wide"><span>Descripción o código de la muestra</span><textarea rows="2" value={form.sampleDescription} onChange={(e) => set("sampleDescription", e.target.value)} placeholder="Ej. Agua de pozo · Frasco 01 · Lote A" /></label>
              <label className="field"><span>Nombre de quien entrega</span><input value={form.clientRepresentativeName} onChange={(e) => set("clientRepresentativeName", e.target.value)} placeholder="Nombre del cliente o representante" /></label>
              <label className="field sample-receiver-select"><span>Analista que recibió la muestra</span><select value={form.receivedByAnalystId} onChange={(e) => set("receivedByAnalystId", e.target.value)} required><option value="">Seleccionar responsable…</option>{receivingAnalysts.map((analyst) => <option value={analyst.id} key={analyst.id}>{analyst.full_name}</option>)}</select><small>Solo se muestran responsables con firma registrada.</small></label>
              <label className="field"><span>Fecha y hora de ingreso</span><input type="datetime-local" value={form.receivedAt} onChange={(e) => set("receivedAt", e.target.value)} required /></label>
              <label className="field"><span>Fecha límite (opcional)</span><input type="datetime-local" value={form.analysisDueAt} onChange={(e) => set("analysisDueAt", e.target.value)} /></label>
              <label className="field"><span>Ubicación inicial</span><select value={form.storageLocation} onChange={(e) => set("storageLocation", e.target.value)}><option value="refrigerator">Refrigeradora</option><option value="room_temperature_table">Mesa a temperatura ambiente</option><option value="other">Otra ubicación</option></select></label>
              <label className="field"><span>Detalle de ubicación</span><input value={form.storageDetail} onChange={(e) => set("storageDetail", e.target.value)} placeholder="Refrigeradora 01 · bandeja superior" /></label>
            </div>
            <div className="sample-conformity-grid">
              <label><input type="checkbox" checked={form.sampleConforming} onChange={(e) => set("sampleConforming", e.target.checked)} /><span><IcoCheck /><strong>{form.intakeType === "client_delivery" ? "Entrega conforme" : "Toma o recojo conforme"}</strong></span></label>
              <label><input type="checkbox" checked={form.materialConforming} onChange={(e) => set("materialConforming", e.target.checked)} /><span><IcoShield /><strong>Material conforme</strong></span></label>
            </div>
            {(!form.sampleConforming || !form.materialConforming) && <label className="field"><span>Detalle de no conformidad</span><textarea rows="3" value={form.nonconformityNotes} onChange={(e) => set("nonconformityNotes", e.target.value)} required /></label>}
            {form.intakeType === "aslabs_collection" && <section className="sample-survey"><div><span>Satisfacción del cliente</span><div>{[1, 2, 3, 4, 5].map((rating) => <button type="button" className={Number(form.satisfactionRating) === rating ? "active" : ""} onClick={() => set("satisfactionRating", String(rating))} key={rating}>{rating}</button>)}</div></div><label className="field"><span>Comentario breve</span><input value={form.satisfactionNotes} onChange={(e) => set("satisfactionNotes", e.target.value)} /></label></section>}
            {form.receivedByAnalystId && <div className="sample-receiver-signature"><IcoCheck /><div><strong>Firma del laboratorio vinculada</strong><span>{receivingAnalysts.find((analyst) => analyst.id === form.receivedByAnalystId)?.full_name}</span><small>{receivingAnalysts.find((analyst) => analyst.id === form.receivedByAnalystId)?.signature_type === 'digital' ? 'Identidad digital registrada' : 'Firma automática disponible en el PDF'}</small></div></div>}
        </section>
        <section id="sample-intake-step-3" className="sample-sign-first">
          <header>
            <b>3</b>
            <div>
              <strong>Firma del cliente</strong>
              <span>Es el único dato obligatorio para guardar.</span>
            </div>
          </header>
          <div className="sample-client-declaration">
            <IcoShield />
            <p>{form.intakeType === "client_delivery" ? "Declaro que entrego la muestra descrita y confirmo que su identificación y condición fueron verificadas durante la recepción." : "Declaro estar conforme con la toma o recojo de la muestra realizado por AS Labs."}</p>
          </div>
          <SignaturePad
            label={form.intakeType === "client_delivery" ? "Firma del cliente · conformidad de entrega" : "Firma del cliente · conformidad de toma o recojo"}
            value={form.clientSignature}
            onChange={(value) => set("clientSignature", value)}
          />
        </section>
        {error && <div className="form-error">{error}</div>}
        <div id="sample-intake-step-4" className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || !form.clientSignature || !form.receivedByAnalystId}
          >
            {saving ? "Generando formato…" : "Confirmar ingreso y generar PDF"}
          </button>
        </div>
      </form>
    </div>
  );
}

function processingGate(intakes = []) {
  const started = intakes.filter((item) => item.processing_started_at).length;
  const unprinted = intakes.find((item) => !item.client_copy_printed_at);
  const unstored = intakes.find((item) => !item.storage_location);
  const stored = intakes.find((item) => item.processing_status === "stored");
  return {
    total: intakes.length,
    started,
    completed: intakes.filter((item) => item.processing_status === "completed").length,
    unprinted: intakes.filter((item) => !item.client_copy_printed_at).length,
    unstored: intakes.filter((item) => !item.storage_location).length,
    stored: intakes.filter((item) => item.processing_status === "stored").length,
    unprintedId: unprinted?.id || null,
    unstoredId: unstored?.id || null,
    storedId: stored?.id || null,
    canAdvance: intakes.length > 0,
  };
}

export default function SampleIntakeFlow({ serviceId, user, notify, onStateChange, autoOpenKey = 0, actionRequest = null, compactActions = false }) {
  const [data, setData] = useState({
    intakes: [],
    canReceive: false,
    receivingAnalysts: [],
    internal: false,
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [location, setLocation] = useState({
    storageLocation: "refrigerator",
    storageDetail: "",
  });
  const [error, setError] = useState("");
  const [now, setNow] = useState(new Date());
  const [latestIntakeId, setLatestIntakeId] = useState(null);
  const handledActionRef = useRef(0);
  const load = () =>
    api
      .sampleIntakes(serviceId)
      .then((result) => {
        setData(result);
        onStateChange?.(processingGate(result.intakes));
      })
      .catch((requestError) => setError(requestError.message));
  useEffect(() => {
    load();
  }, [serviceId]);
  useEffect(() => {
    if (autoOpenKey > 0 && data.canReceive) setCreating(true);
  }, [autoOpenKey, data.canReceive]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const update = async (payload) => {
    try {
      const result = await api.updateSampleIntake(serviceId, payload);
      setData(result);
      onStateChange?.(processingGate(result.intakes));
      setEditing(null);
      notify("Flujo interno de la muestra actualizado.");
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const gate = processingGate(data.intakes);
  const printPending = data.intakes.find((item) => !item.client_copy_printed_at);
  const storedSample = data.intakes.find((item) => item.processing_status === "stored");
  const custodySample = data.intakes.find((item) => !item.storage_location) || storedSample || data.intakes[0];
  const printTarget = printPending || data.intakes.find((item) => item.id === latestIntakeId) || data.intakes[0];
  const sequenceStep = !data.intakes.length ? 1 : printPending ? 2 : data.intakes.some((item) => !item.storage_location) ? 3 : 4;
  const pdfUrl = (item) => `/api/service-workflow?sampleIntake=1&serviceId=${encodeURIComponent(serviceId)}&id=${encodeURIComponent(item.id)}&format=pdf`;
  const markPrinted = async (id) => {
    try {
      const result = await api.updateSampleIntake(serviceId, { action: "mark_client_copy_printed", id });
      setData(result);
      onStateChange?.(processingGate(result.intakes));
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const openPrintCopy = (item) => {
    if (!item) return;
    window.open(pdfUrl(item), "_blank", "noopener,noreferrer");
    markPrinted(item.id);
  };
  const openCustody = (item) => {
    if (!item) return;
    setEditing(item);
    setLocation({
      storageLocation: item.storage_location || "refrigerator",
      storageDetail: item.storage_detail || "",
    });
  };
  useEffect(() => {
    if (!actionRequest?.key || handledActionRef.current === actionRequest.key) return;
    const action = actionRequest.action;
    if (action === "reload") {
      handledActionRef.current = actionRequest.key;
      load();
      return;
    }
    if (action === "intake" && !data.canReceive) return;
    if (action === "print" && !printTarget) return;
    if (action === "custody" && !custodySample) return;
    handledActionRef.current = actionRequest.key;
    if (action === "intake") setCreating(true);
    if (action === "print") openPrintCopy(printTarget);
    if (action === "custody") openCustody(custodySample);
  }, [actionRequest?.key, data.canReceive, printTarget?.id, custodySample?.id]);
  return (
    <section
      id="sample-intake-flow"
      className={`sample-intake-flow ${data.internal ? "internal" : "client"} ${compactActions ? "compact" : ""}`}
    >
      <header>
        <span className="sample-intake-icon">
          <IcoFlask />
        </span>
        <div>
          <span className="eyebrow">Flujo de muestras</span>
          <h3>
            {data.internal
              ? "Ingreso, custodia y procesamiento"
              : "Documentos de ingreso de muestra"}
          </h3>
          <p>
            {data.internal
              ? "Firmas, ubicación y cronómetro conectados a esta orden."
              : "Consulta únicamente los formatos que fueron firmados durante la recepción o toma."}
          </p>
        </div>
        {data.canReceive && !compactActions && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <IcoPlus /> Registrar muestra
          </button>
        )}
      </header>
      {error && <div className="form-error">{error}</div>}
      {data.sampleRequired === false && (
        <div className="sample-intake-empty sample-not-required">
          <IcoCheck />
          <strong>Esta orden no requiere muestra</strong>
          <span>El servicio puede avanzar directamente por sus etapas.</span>
        </div>
      )}
      {data.sampleRequired !== false && <>
      {data.internal && !compactActions && (
        <section className="sample-sequence-guide">
          <header>
            <div><span className="eyebrow">Secuencia de recepción</span><strong>{sequenceStep === 1 ? "Paso 1 · Registra y firma" : sequenceStep === 2 ? "Paso 2 · Imprime la copia del cliente" : sequenceStep === 3 ? "Paso 3 · Confirma la custodia" : "Ingreso completado"}</strong></div>
            <small>{sequenceStep < 4 ? "El paso resaltado es lo que debes hacer ahora." : "Al avanzar de etapa comenzará automáticamente el tiempo de proceso."}</small>
          </header>
          <div className="sample-sequence-steps">
            <button type="button" className={sequenceStep === 1 ? "current" : data.intakes.length ? "done" : "pending"} onClick={() => setCreating(true)} disabled={!data.canReceive}><b>{data.intakes.length ? <IcoCheck /> : 1}</b><span><small>Paso 1</small><strong>Registrar y firmar</strong></span></button>
            <i />
            <button type="button" className={sequenceStep === 2 ? "current" : data.intakes.length && !printPending ? "done" : "pending"} onClick={() => openPrintCopy(printTarget)} disabled={!printTarget}><b>{data.intakes.length && !printPending ? <IcoCheck /> : 2}</b><span><small>Paso 2</small><strong>Imprimir copia</strong></span></button>
            <i />
            <button type="button" className={sequenceStep === 3 ? "current" : data.intakes.length && data.intakes.every((item) => item.storage_location) ? "done" : "pending"} onClick={() => custodySample && setEditing(custodySample)} disabled={!custodySample}><b>{data.intakes.length && data.intakes.every((item) => item.storage_location) ? <IcoCheck /> : 3}</b><span><small>Paso 3</small><strong>Custodia</strong></span></button>
            <i />
            <button type="button" className={sequenceStep === 4 ? "current" : "pending"} disabled><b>{gate.started ? <IcoCheck /> : 4}</b><span><small>Paso 4</small><strong>Avanzar etapa</strong></span></button>
          </div>
        </section>
      )}
      {data.internal && !compactActions && (
        <div className={`sample-processing-gate ${gate.total ? "ready" : "blocked"}`}>
          <span>{gate.total ? <IcoCheck /> : <IcoShield />}</span>
          <div>
            <strong>{gate.total === 0 ? "Primero registra el ingreso de la muestra" : gate.started ? "Tiempo de proceso activo" : "Muestra lista para iniciar"}</strong>
            <small>{gate.total === 0 ? "Registra la muestra firmada antes de continuar." : gate.started ? `${gate.started} de ${gate.total} muestras tienen el cronómetro activo.` : "El cronómetro comenzará automáticamente cuando pulses “Avanzar etapa”."}</small>
          </div>
          {gate.total === 0 && data.canReceive && <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><IcoPlus /> Registrar muestra</button>}
        </div>
      )}
      {data.intakes.length ? (
        <div className="sample-intake-list">
          {data.intakes.map((item) => (
            <article
              className={!data.internal ? "client-copy" : ""}
              key={item.id}
            >
              <div className="sample-intake-code">
                <span>{item.sample_code}</span>
                <strong>
                  {data.internal
                    ? item.sample_description
                    : "Formato firmado disponible"}
                </strong>
                <small>
                  {new Date(item.received_at).toLocaleString("es-PE")}
                  {data.internal
                    ? ` · ${item.intake_type === "aslabs_collection" ? "Recojo AS Labs" : "Entrega del cliente"}${item.microbiologist_name ? ` · Recibida por ${item.microbiologist_name}` : ""}`
                    : ""}
                </small>
              </div>
              {data.internal && (
                <>
                  <div className="sample-intake-state">
                    <span
                      className={
                        item.sample_conforming && item.material_conforming
                          ? "good"
                          : "bad"
                      }
                    >
                      <i />
                      {item.sample_conforming && item.material_conforming
                        ? "Conforme"
                        : "No conforme"}
                    </span>
                    <strong>{STATUS[item.processing_status]}</strong>
                    <small>
                      {item.storage_location
                        ? `${LOCATION[item.storage_location]}${item.storage_detail ? ` · ${item.storage_detail}` : ""}`
                        : "Ubicación por registrar"}
                    </small>
                  </div>
                  <div className="sample-intake-timer">
                    <span>Tiempo de proceso</span>
                    <strong>
                      {item.processing_started_at
                        ? elapsed(
                            item.processing_started_at,
                            item.processing_ended_at || now,
                          )
                        : "Sin iniciar"}
                    </strong>
                    <small>
                      {item.processing_by_name || "Analista pendiente"}
                    </small>
                  </div>
                </>
              )}
              <div className="sample-intake-actions">
                {(!compactActions || !data.internal || item.client_copy_printed_at) && <a
                  className={`lab-pdf-link ${data.internal && !item.client_copy_printed_at ? "sample-print-action" : ""}`}
                  href={pdfUrl(item)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => data.internal && markPrinted(item.id)}
                >
                  {data.internal && !item.client_copy_printed_at && <b>2</b>}<IcoFile /> {data.internal ? "Imprimir copia cliente" : "PDF firmado"}
                </a>}
                {data.internal && !compactActions && item.processing_status === "stored" && (
                  <>
                    <button className="table-action" onClick={() => openCustody(item)}>
                      Ubicación
                    </button>
                    <span className="sample-auto-finish"><i /> Iniciará al avanzar de etapa</span>
                  </>
                )}
                {data.internal && item.processing_status === "processing" && <span className="sample-auto-finish"><i /> Cronómetro activo · finalizará al emitir informe</span>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="sample-intake-empty">
          <IcoFile />
          <strong>Aún no hay formatos de ingreso</strong>
          <span>
            {data.internal
              ? "Registra la primera recepción o toma de muestra."
              : "El laboratorio publicará aquí el PDF firmado."}
          </span>
        </div>
      )}
      </>}
      {compactActions && data.internal && data.canReceive && data.intakes.length > 0 && (
        <button type="button" className="sample-add-another" onClick={() => setCreating(true)}><IcoPlus /> Añadir otra muestra</button>
      )}
      {creating && (
        <IntakeForm
          onClose={() => setCreating(false)}
          onSaved={async (payload) => {
            const result = await api.createSampleIntake(serviceId, payload);
            setData(result);
            setLatestIntakeId(result.createdIntakeId || null);
            onStateChange?.(processingGate(result.intakes));
            return result;
          }}
          notify={notify}
          receivingAnalysts={data.receivingAnalysts || []}
        />
      )}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <form
            className="modal sample-location-modal"
            onSubmit={(event) => {
              event.preventDefault();
              update({ action: "set_storage", id: editing.id, ...location });
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="modal-icon">
                <IcoCalendar />
              </span>
              <div>
                <span className="eyebrow">{editing.sample_code}</span>
                <h2>Ubicación de la muestra</h2>
                <p>
                  Esta información es interna y nunca aparecerá en el portal del
                  cliente.
                </p>
              </div>
            </div>
            <label className="field">
              <span>Ubicación</span>
              <select
                value={location.storageLocation}
                onChange={(e) =>
                  setLocation({ ...location, storageLocation: e.target.value })
                }
              >
                <option value="refrigerator">Refrigeradora</option>
                <option value="room_temperature_table">
                  Mesa a temperatura ambiente
                </option>
                <option value="other">Otra ubicación</option>
              </select>
            </label>
            <label className="field">
              <span>Detalle</span>
              <input
                value={location.storageDetail}
                onChange={(e) =>
                  setLocation({ ...location, storageDetail: e.target.value })
                }
                placeholder="Equipo, bandeja, nivel o posición"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
              <button className="btn btn-primary">Guardar ubicación</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
