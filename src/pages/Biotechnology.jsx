import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  IcoArrow,
  IcoCheck,
  IcoDna,
  IcoLeaf,
  IcoPlus,
  IcoShield,
  IcoUsers,
} from "../components/Icons.jsx";
import { api } from "../data/api.js";

const EMPTY = {
  settings: { default_plants_per_bag: 4 },
  cultivars: [],
  batches: [],
  assignments: [],
  workers: [],
  availableWorkers: [],
  recentEvents: [],
  analyticsEvents: [],
  personalAssignments: [],
  personalMetrics: {},
  metrics: {},
  canManageAssignments: false,
  canCreateCodes: false,
  canAdminCodes: false,
  canManageCultivars: false,
};
const LABEL = {
  introduction: "Introducción",
  multiplication: "Multiplicación",
  rooting: "Enraizamiento",
  field_ready: "Lista para enviar a campo",
  completed: "Completado",
};
const STAGE_LIMIT_DAYS = 20;

function number(value) {
  return Number(value || 0).toLocaleString("es-PE");
}
function decimal(value) {
  return Number(value || 0).toLocaleString("es-PE", {
    maximumFractionDigits: 2,
  });
}
function initials(name = "") {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
function today() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function stageName(item) {
  return item.stage === "multiplication" ||
    item.current_stage === "multiplication"
    ? `Subcultivo ${item.subculture_number || Number(item.current_subculture) + 1}`
    : LABEL[item.stage || item.current_stage];
}
function codeChoiceName(item) {
  const stageDate = item.current_stage_started_on || item.started_on;
  const date = stageDate
    ? new Date(`${String(stageDate).slice(0, 10)}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : "Sin fecha";
  return `${item.code} · ${stageName(item)} · ${date}`;
}
function compactSearch(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function sourceBagSearchText(item) {
  const raw = String(item.current_stage_started_on || item.started_on || "").slice(0, 10);
  const [year, month, day] = raw.split("-");
  const subculture = item.current_stage === "multiplication" ? Number(item.current_subculture) + 1 : "";
  return compactSearch([item.code, `c${subculture}`, `subcultivo ${subculture}`, raw, day && month ? `${day}-${month}` : "", day && month ? `${day}/${month}` : ""].join(" "));
}
function searchSourceBags(items, search) {
  const tokens = compactSearch(search).split(/\s+/).filter(Boolean);
  return tokens.length ? items.filter((item) => {
    const text = sourceBagSearchText(item);
    return tokens.every((token) => text.includes(token));
  }) : [];
}
function filterSourceBags(items, { sourceCode = "", sourceSubculture = "", sourceDate = "" }) {
  const wantedSubculture = Number(String(sourceSubculture).replace(/\D/g, "")) || null;
  return items.filter((item) => {
    const currentSubculture = item.current_stage === "multiplication" ? Number(item.current_subculture) + 1 : null;
    const stageDate = String(item.current_stage_started_on || item.started_on || "").slice(0, 10);
    return (!sourceCode.trim() || compactSearch(item.code).includes(compactSearch(sourceCode)))
      && (!wantedSubculture || currentSubculture === wantedSubculture)
      && (!sourceDate || stageDate === sourceDate);
  });
}
function stageDeadline(item) {
  if (["field_ready", "completed"].includes(item.current_stage)) return null;
  const rawDate = item.current_stage_started_on || item.started_on;
  if (!rawDate) return { level: "warning", remaining: null, text: "Falta registrar la fecha de esta etapa" };
  const start = new Date(`${String(rawDate).slice(0, 10)}T12:00:00`).getTime();
  const now = new Date(`${today()}T12:00:00`).getTime();
  const elapsed = Math.max(0, Math.floor((now - start) / 86400000));
  const remaining = STAGE_LIMIT_DAYS - elapsed;
  if (remaining < 0) return { level: "overdue", remaining, text: `Alerta: etapa vencida hace ${Math.abs(remaining)} ${Math.abs(remaining) === 1 ? "día" : "días"}` };
  if (remaining === 0) return { level: "due", remaining, text: "Alerta: debe pasar a la siguiente etapa hoy" };
  const action = item.current_stage === "rooting" ? "enviar a campo" : "multiplicar";
  return { level: remaining <= 3 ? "due" : "ok", remaining, text: `Se recomienda ${action} en ${remaining} ${remaining === 1 ? "día" : "días"}` };
}
function analyticsDate(value) {
  return String(value || "").slice(0, 10);
}
function analyticsDayLabel(value) {
  const raw = analyticsDate(value);
  return raw ? new Date(`${raw}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }) : "Sin fecha";
}
function AnalyticsDashboard({ data }) {
  const [personId, setPersonId] = useState("");
  const [period, setPeriod] = useState("month");
  const [month, setMonth] = useState(today().slice(0, 7));
  const events = data.analyticsEvents || [];
  const filteredEvents = useMemo(() => {
    const end = new Date(`${today()}T12:00:00`);
    const start = new Date(end);
    if (period === "quarter") start.setMonth(start.getMonth() - 2);
    if (period === "year") start.setFullYear(start.getFullYear() - 1);
    const minDate = start.toISOString().slice(0, 10);
    return events.filter((item) => {
      const eventDate = analyticsDate(item.performed_at);
      const matchesPerson = !personId || item.worker_analyst_id === personId;
      const matchesPeriod = period === "all" || (period === "month" ? eventDate.startsWith(month) : eventDate >= minDate);
      return matchesPerson && matchesPeriod;
    });
  }, [events, personId, period, month]);
  const totals = filteredEvents.reduce((acc, item) => ({
    records: acc.records + 1,
    bags: acc.bags + Number(item.bags_processed || 0),
    input: acc.input + Number(item.input_plants || 0),
    output: acc.output + Number(item.viable_output_plants || 0),
    expected: acc.expected + Number(item.expected_output_plants || 0),
    contamination: acc.contamination + Number(item.contaminated_plants || 0),
    rooting: acc.rooting + Number(item.rooting_bags || 0),
  }), { records: 0, bags: 0, input: 0, output: 0, expected: 0, contamination: 0, rooting: 0 });
  const multiplier = totals.input ? totals.output / totals.input : 0;
  const conformity = totals.expected ? Math.round((totals.output / totals.expected) * 100) : 0;
  const timeline = Object.values(filteredEvents.reduce((acc, item) => {
    const key = analyticsDate(item.performed_at);
    if (!acc[key]) acc[key] = { date: key, label: analyticsDayLabel(key), plantas: 0, esperado: 0, contaminacion: 0, bolsas: 0 };
    acc[key].plantas += Number(item.viable_output_plants || 0);
    acc[key].esperado += Number(item.expected_output_plants || 0);
    acc[key].contaminacion += Number(item.contaminated_plants || 0);
    acc[key].bolsas += Number(item.bags_processed || 0);
    return acc;
  }, {})).sort((a, b) => a.date.localeCompare(b.date));
  const peopleData = Object.values(filteredEvents.reduce((acc, item) => {
    const key = item.worker_analyst_id || item.worker_name;
    if (!acc[key]) acc[key] = { name: item.worker_name || "Sin asignar", plantas: 0, esperado: 0, contaminacion: 0, registros: 0, bolsas: 0 };
    acc[key].plantas += Number(item.viable_output_plants || 0);
    acc[key].esperado += Number(item.expected_output_plants || 0);
    acc[key].contaminacion += Number(item.contaminated_plants || 0);
    acc[key].bolsas += Number(item.bags_processed || 0);
    acc[key].registros += 1;
    return acc;
  }, {})).sort((a, b) => b.plantas - a.plantas);
  const latest = [...filteredEvents].sort((a, b) => new Date(b.performed_at) - new Date(a.performed_at)).slice(0, 12);
  return <section className="biotech-analytics">
    <header className="biotech-analytics-head">
      <div><span className="eyebrow">Analítica administrativa</span><h2>Producción, rendimiento y calidad</h2><p>Los datos se actualizan desde cada registro de bolsas guardado por el equipo.</p></div>
      <div className="biotech-analytics-filters">
        <label><span>Persona</span><select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Todo el equipo</option>{data.workers.map((worker) => <option value={worker.id} key={worker.id}>{worker.full_name}</option>)}</select></label>
        <label><span>Mes</span><input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setPeriod("month"); }} /></label>
        <div className="biotech-period-picks"><button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>Mes</button><button className={period === "quarter" ? "active" : ""} onClick={() => setPeriod("quarter")}>3 meses</button><button className={period === "year" ? "active" : ""} onClick={() => setPeriod("year")}>12 meses</button><button className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>Todo</button></div>
      </div>
    </header>
    <div className="biotech-analytics-kpis">
      <article><span>Registros</span><strong>{number(totals.records)}</strong><small>operaciones registradas</small></article>
      <article><span>Plantas producidas</span><strong>{number(totals.output)}</strong><small>{number(totals.bags)} bolsas finales</small></article>
      <article><span>Multiplicación real</span><strong>×{decimal(multiplier)}</strong><small>salida / plantas iniciales</small></article>
      <article><span>Conformidad estimada</span><strong>{conformity}%</strong><small>{number(totals.contamination)} plantas contaminadas</small></article>
      <article><span>Enraizamiento</span><strong>{number(totals.rooting)}</strong><small>bolsas derivadas</small></article>
    </div>
    {filteredEvents.length ? <>
      <div className="biotech-analytics-charts">
        <article><header><h3>Producción por fecha</h3><span>Plantas reales vs. estimadas</span></header><ResponsiveContainer width="100%" height={260}><LineChart data={timeline} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dce8df" /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="plantas" name="Plantas reales" stroke="#1d7047" strokeWidth={3} dot={{ r: 3 }} /><Line type="monotone" dataKey="esperado" name="Esperadas" stroke="#d7942e" strokeWidth={2} strokeDasharray="5 4" dot={false} /></LineChart></ResponsiveContainer></article>
        <article><header><h3>Producción por persona</h3><span>Plantas reales registradas</span></header><ResponsiveContainer width="100%" height={260}><BarChart data={peopleData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dce8df" /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-16} textAnchor="end" height={58} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="plantas" name="Plantas" fill="#1d7047" radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer></article>
        <article><header><h3>Calidad por persona</h3><span>Real, estimado y contaminación</span></header><ResponsiveContainer width="100%" height={260}><BarChart data={peopleData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dce8df" /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-16} textAnchor="end" height={58} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="esperado" name="Esperadas" fill="#a8c9ad" radius={[6, 6, 0, 0]} /><Bar dataKey="plantas" name="Reales" fill="#1d7047" radius={[6, 6, 0, 0]} /><Bar dataKey="contaminacion" name="Contaminación" fill="#cc594b" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></article>
      </div>
      <article className="biotech-analytics-table"><header><div><h3>Últimos registros del periodo</h3><span>Detalle de producción para revisión rápida</span></div><b>{number(filteredEvents.length)} registros</b></header><div>{latest.map((item) => <div key={item.id}><time>{analyticsDayLabel(item.performed_at)}</time><strong>{item.worker_name || "Sin asignar"}</strong><span>{item.code} · {item.stage === "multiplication" ? `C${item.subculture_number}` : LABEL[item.stage]}</span><em>{number(item.viable_output_plants)} plantas</em><small>{number(item.bags_processed)} bolsas</small></div>)}</div></article>
    </> : <div className="biotech-simple-empty"><IcoDna /><strong>Sin registros para este filtro</strong><span>Elige otro mes, periodo o persona para ver la actividad.</span></div>}
  </section>;
}
function duration(seconds = 0) {
  const total = Math.max(0, Number(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
function Field({ label, children, wide = false, hint }) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function LiveTimer({ startedAt, base = 0 }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = startedAt
    ? Math.floor((now - new Date(startedAt).getTime()) / 1000)
    : Number(base);
  return (
    <strong className="biotech-live-timer">
      <i />
      {duration(seconds)}
    </strong>
  );
}

function WorkerPortal({
  data,
  user,
  loading,
  error,
  onReload,
  onManage,
  notify,
}) {
  const [period, setPeriod] = useState("week");
  const [finish, setFinish] = useState(null);
  const [form, setForm] = useState({
    introducedPlants: "",
    inputBags: "",
    outputBags: "",
  });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const metrics = data.personalMetrics?.[period] || {};
  const active = data.personalAssignments.filter((item) =>
    ["assigned", "in_progress"].includes(item.status),
  );
  const completed = data.personalAssignments.filter(
    (item) => item.status === "completed",
  );
  const start = async (item) => {
    setSaving(true);
    setLocalError("");
    try {
      const result = await api.createBiotechnology({
        action: "start_assignment",
        assignmentId: item.id,
      });
      await onReload(result);
      notify(
        item.stage === "multiplication"
          ? "Cabina iniciada. El cronómetro ya está corriendo."
          : "Actividad iniciada.",
      );
    } catch (requestError) {
      setLocalError(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  const openFinish = (item) => {
    const suggested = Math.max(
      0,
      Math.ceil(
        Number(item.current_viable_plants || 0) /
          Number(item.plants_per_bag || 1),
      ),
    );
    setFinish(item);
    setLocalError("");
    setForm(
      item.stage === "introduction"
        ? { introducedPlants: "", inputBags: "", outputBags: "" }
        : {
            introducedPlants: "",
            inputBags: String(suggested),
            outputBags: "",
          },
    );
  };
  const submitFinish = async (event) => {
    event.preventDefault();
    setSaving(true);
    setLocalError("");
    try {
      const result = await api.createBiotechnology({
        action: "finish_assignment",
        assignmentId: finish.id,
        ...form,
      });
      await onReload(result);
      setFinish(null);
      notify("Trabajo guardado. El código avanzó automáticamente.");
    } catch (requestError) {
      setLocalError(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  const chart = completed
    .slice(0, 8)
    .reverse()
    .map((item) => ({
      name: item.code,
      entrada: Number(item.input_plants || item.introduced_plants || 0),
      salida: Number(item.output_plants || item.introduced_plants || 0),
    }));
  return (
    <div className="biotech-simple-worker">
      <section className="biotech-simple-hero">
        <div>
          <span className="eyebrow">Mi jornada · PIN verificado</span>
          <h1>Hola, {user.activeWorker.fullName.split(" ")[0]}</h1>
          <p>
            Aquí solo aparecen los códigos que te asignaron. Inicia, trabaja y
            registra el resultado.
          </p>
          {data.canManageAssignments && (
            <button className="btn btn-white" onClick={onManage}>
              Asignar códigos
            </button>
          )}
        </div>
        <aside>
          <span>Pendientes ahora</span>
          <strong>{active.length}</strong>
          <small>
            {active.some((item) => item.status === "in_progress")
              ? "Hay una actividad en curso"
              : "Lista personal actualizada"}
          </small>
        </aside>
      </section>
      {(error || localError) && (
        <div className="form-error">{localError || error}</div>
      )}
      {loading ? (
        <div className="card biotech-loading">Preparando tus códigos…</div>
      ) : (
        <>
          <section className="biotech-today">
            <header>
              <div>
                <span className="eyebrow">Lo importante</span>
                <h2>Mi trabajo asignado</h2>
                <p>
                  Un código, una acción. No necesitas completar información
                  técnica.
                </p>
              </div>
              <strong>{active.length}</strong>
            </header>
            {active.length ? (
              <div className="biotech-task-grid">
                {active.map((item) => (
                  <article
                    className={item.status === "in_progress" ? "running" : ""}
                    key={item.id}
                  >
                    <div className="biotech-task-top">
                      <span className={`biotech-stage-dot ${item.stage}`}>
                        <IcoLeaf />
                      </span>
                      <div>
                        <small>
                          {item.period_type === "week" ? "Esta semana" : "Hoy"}{" "}
                          · {stageName(item)}
                        </small>
                        <h3>{item.code}</h3>
                      </div>
                      {item.status === "in_progress" ? (
                        <span className="biotech-status running">En curso</span>
                      ) : (
                        <span className="biotech-status">Asignado</span>
                      )}
                    </div>
                    <div className="biotech-task-stage">
                      <span>Estado actual</span>
                      <strong>
                        {stageName(item)}
                        {item.stage === "multiplication"
                          ? ` de ${item.target_subcultures}`
                          : ""}
                      </strong>
                    </div>
                    {item.status === "in_progress" && (
                      <div className="biotech-cabinet-running">
                        <div>
                          <IcoDna />
                          <span>
                            <small>
                              {item.equipment_code
                                ? "Cabina automática"
                                : "Tiempo de trabajo"}
                            </small>
                            <strong>
                              {item.equipment_code || "Actividad iniciada"}
                            </strong>
                          </span>
                        </div>
                        <LiveTimer startedAt={item.started_at} />
                      </div>
                    )}
                    {item.stage === "introduction" &&
                    item.status === "assigned" ? (
                      <button
                        className="btn btn-primary biotech-main-action"
                        onClick={() => openFinish(item)}
                      >
                        Registrar plantas introducidas <IcoArrow />
                      </button>
                    ) : item.status === "assigned" ? (
                      <button
                        className="btn btn-primary biotech-main-action"
                        disabled={saving}
                        onClick={() => start(item)}
                      >
                        Iniciar trabajo <IcoArrow />
                      </button>
                    ) : (
                      <button
                        className="btn btn-accent biotech-main-action"
                        onClick={() => openFinish(item)}
                      >
                        Terminar y registrar bolsas <IcoArrow />
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="biotech-simple-empty">
                <IcoCheck />
                <strong>No tienes códigos pendientes</strong>
                <span>
                  Cuando te asignen uno aparecerá aquí automáticamente.
                </span>
              </div>
            )}
          </section>
          <section className="biotech-personal-tabs">
            <div>
              {[
                ["week", "Semana"],
                ["month", "Mes"],
                ["quarter", "3 meses"],
              ].map(([id, label]) => (
                <button
                  className={period === id ? "active" : ""}
                  onClick={() => setPeriod(id)}
                  key={id}
                >
                  {label}
                </button>
              ))}
            </div>
            <span>Solo tu producción</span>
          </section>
          <section className="biotech-simple-kpis">
            <article>
              <span>Trabajos terminados</span>
              <strong>{number(metrics.completed)}</strong>
              <small>de {number(metrics.assigned)} asignados</small>
            </article>
            <article>
              <span>Bolsas de salida</span>
              <strong>{number(metrics.outputBags)}</strong>
              <small>producción declarada</small>
            </article>
            <article>
              <span>Plantas producidas</span>
              <strong>{number(metrics.outputPlants)}</strong>
              <small>cálculo automático</small>
            </article>
            <article>
              <span>Tiempo trabajado</span>
              <strong>{duration(Number(metrics.minutes || 0) * 60)}</strong>
              <small>actividades cronometradas</small>
            </article>
          </section>
          <div className="biotech-simple-reports">
            <section className="card">
              <header>
                <span className="eyebrow">Evolución personal</span>
                <h2>Entrada frente a salida</h2>
              </header>
              {chart.length ? (
                <ResponsiveContainer width="100%" height={245}>
                  <BarChart data={chart}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#e4ebe5"
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                    />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} />
                    <Tooltip />
                    <Bar
                      dataKey="entrada"
                      fill="#c6d5ca"
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="salida"
                      fill="#2f6b4f"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="biotech-simple-empty small">
                  Tu evolución aparecerá al terminar el primer código.
                </div>
              )}
            </section>
            <section className="card biotech-simple-history">
              <header>
                <span className="eyebrow">Últimos trabajos</span>
                <h2>Mi historial</h2>
              </header>
              {completed.slice(0, 6).map((item) => {
                const real = Number(
                  item.output_plants || item.introduced_plants || 0,
                );
                const expected = Number(item.expected_output_plants || real);
                const rate = expected ? (real / expected) * 100 : 100;
                return (
                  <article key={item.id}>
                    <span className={rate >= 90 ? "good" : "low"}>
                      {rate >= 90 ? <IcoCheck /> : "!"}
                    </span>
                    <div>
                      <strong>
                        {item.code} · {stageName(item)}
                      </strong>
                      <small>
                        {number(real)} plantas ·{" "}
                        {rate >= 90
                          ? "Buen rendimiento"
                          : "Por debajo del estimado"}
                      </small>
                    </div>
                  </article>
                );
              })}
              {!completed.length && (
                <div className="biotech-simple-empty small">
                  Aún no hay trabajos terminados.
                </div>
              )}
            </section>
          </div>
        </>
      )}
      {finish && (
        <div className="modal-overlay" onClick={() => setFinish(null)}>
          <form
            className="modal biotech-simple-modal"
            onSubmit={submitFinish}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="modal-icon">
                <IcoLeaf />
              </span>
              <div>
                <span className="eyebrow">
                  {finish.code} · {stageName(finish)}
                </span>
                <h2>
                  {finish.stage === "introduction"
                    ? "¿Cuántas plantas introdujiste?"
                    : "Terminar trabajo"}
                </h2>
                <p>
                  {finish.stage === "introduction"
                    ? "Cada planta, cormo o meristemo equivale a una bolsa. No necesitas registrar nada más."
                    : `Indica solamente las bolsas recibidas y las bolsas que obtuviste. El sistema usa ${finish.plants_per_bag} plantas por bolsa.`}
                </p>
              </div>
            </div>
            {finish.stage === "introduction" ? (
              <Field label="Plantas introducidas" hint="Una planta por bolsa">
                <input
                  type="number"
                  min="1"
                  value={form.introducedPlants}
                  onChange={(e) =>
                    setForm({ ...form, introducedPlants: e.target.value })
                  }
                  autoFocus
                  required
                />
              </Field>
            ) : (
              <div className="biotech-finish-grid">
                <Field label="Bolsas iniciales">
                  <input
                    type="number"
                    min="0"
                    value={form.inputBags}
                    onChange={(e) =>
                      setForm({ ...form, inputBags: e.target.value })
                    }
                    autoFocus
                    required
                  />
                </Field>
                <Field label="Bolsas finales">
                  <input
                    type="number"
                    min="0"
                    value={form.outputBags}
                    onChange={(e) =>
                      setForm({ ...form, outputBags: e.target.value })
                    }
                    required
                  />
                </Field>
              </div>
            )}
            <div className="biotech-live-result">
              <div>
                <span>Entrada</span>
                <strong>
                  {number(
                    finish.stage === "introduction"
                      ? form.introducedPlants
                      : Number(form.inputBags || 0) *
                          Number(finish.plants_per_bag),
                  )}{" "}
                  plantas
                </strong>
              </div>
              <IcoArrow />
              <div>
                <span>Resultado</span>
                <strong>
                  {number(
                    finish.stage === "introduction"
                      ? form.introducedPlants
                      : Number(form.outputBags || 0) *
                          Number(finish.plants_per_bag),
                  )}{" "}
                  plantas
                </strong>
              </div>
            </div>
            {localError && <div className="form-error">{localError}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFinish(null)}
              >
                Cancelar
              </button>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? "Guardando…" : "Guardar y avanzar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function SimpleBiotechRecorder({ data, user, loading, error, onReload, onManage, notify, embedded = false }) {
  const activeCodes = data.batches.filter((item) => item.status === "active" && !item.archived_at && !["field_ready", "completed"].includes(item.current_stage));
  const people = data.availableWorkers || [];
  const makeEntry = () => ({
    id: `${Date.now()}-${Math.random()}`,
    batchId: "",
    sourceQuery: "",
    analystIds: [user.activeWorker?.id].filter(Boolean),
    performedOn: today(),
    inputBags: "",
    outputBags: "",
    rootingBags: "0",
    targetSubculture: "",
  });
  const [entries, setEntries] = useState(() => [makeEntry()]);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const [tab, setTab] = useState(embedded ? "register" : "home");
  const personal = (data.workers || []).find((item) => item.id === user.activeWorker?.id) || {};
  const personalRate = Number(personal.multiplication_input)
    ? Number(personal.multiplication_output) / Number(personal.multiplication_input)
    : 0;
  const personalHistory = (data.recentEvents || []).filter((item) => item.worker_name === user.activeWorker?.fullName).slice(0, 8);

  const updateEntry = (id, values) => setEntries((current) =>
    current.map((entry) => entry.id === id ? { ...entry, ...values } : entry));
  const toggleAnalyst = (entry, analystId) => {
    const selected = entry.analystIds.includes(analystId);
    const next = selected
      ? entry.analystIds.filter((id) => id !== analystId)
      : entry.analystIds.length < 2
        ? [...entry.analystIds, analystId]
        : [analystId];
    updateEntry(entry.id, { analystIds: next });
  };
  const addEntry = () => setEntries((current) => [...current, makeEntry()]);
  const removeEntry = (id) => setEntries((current) => current.filter((entry) => entry.id !== id));

  const submit = async (event) => {
    event.preventDefault();
    if (entries.some((entry) => !entry.batchId)) {
      setLocalError("Escribe y toca una bolsa de la lista para cada registro.");
      return;
    }
    if (entries.some((entry) => !entry.analystIds.length)) {
      setLocalError("Selecciona quién realizó cada registro.");
      return;
    }
    setSaving(true);
    setLocalError("");
    try {
      const result = await api.createBiotechnology({
        action: "record_simple_bulk",
        records: entries.map((entry) => ({
          batchId: entry.batchId,
          analystId: entry.analystIds[0],
          collaboratorAnalystId: entry.analystIds[1] || "",
          performedOn: entry.performedOn,
          inputBags: entry.inputBags,
          outputBags: entry.outputBags,
          rootingBags: entry.rootingBags || "0",
          targetSubculture: entry.targetSubculture || "",
        })),
      });
      await onReload(result);
      notify(entries.length === 1 ? "Registro guardado." : `${entries.length} registros guardados.`);
      setEntries([makeEntry()]);
    } catch (requestError) {
      setLocalError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="biotech-simple-worker biotech-one-step">
      {!embedded && <header className="biotech-worktop">
        <div>
          <span className="eyebrow">Biotecnología</span>
          <h1>Hola, {user.activeWorker.fullName.split(" ")[0]}</h1>
        </div>
        {data.canCreateCodes && <button className="btn btn-ghost" onClick={onManage}>Administrar códigos</button>}
      </header>}

      {(error || localError) && <div className="form-error">{localError || error}</div>}
      {!embedded && <nav className="biotech-worker-tabs" aria-label="Centro de trabajo">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}><IcoLeaf /> Biotecnología</button>
        <button className={tab === "register" ? "active" : ""} onClick={() => setTab("register")}><IcoPlus /> Centro de trabajo</button>
        <button className={tab === "performance" ? "active" : ""} onClick={() => setTab("performance")}><IcoDna /> Mi rendimiento</button>
      </nav>}
      {!embedded && tab === "home" ? (
        <section className="biotech-worker-home">
          <div className="biotech-home-welcome">
            <span className="eyebrow">Panel principal</span>
            <h2>Biotecnología vegetal</h2>
            <p>Registra la producción del día en pocos segundos y consulta tu avance cuando lo necesites.</p>
            <button className="btn btn-primary" onClick={() => setTab("register")}><IcoPlus /> Abrir centro de trabajo <IcoArrow /></button>
          </div>
          <div className="biotech-home-numbers">
            <article><span>Códigos disponibles</span><strong>{number(activeCodes.length)}</strong><small>listos para registrar</small></article>
            <article><span>Mis registros</span><strong>{number(personal.event_count)}</strong><small>historial acumulado</small></article>
            <article><span>Mis plantas</span><strong>{number(personal.viable_output)}</strong><small>producción registrada</small></article>
          </div>
          <div className="biotech-home-recent">
            <header><div><span className="eyebrow">Códigos recientes</span><h3>Listos para trabajar</h3></div><button type="button" onClick={() => setTab("register")}>Registrar ahora <IcoArrow /></button></header>
            <div>{activeCodes.slice(0, 6).map((item) => { const stageDate = item.current_stage_started_on || item.started_on; const deadline = stageDeadline(item); return <article key={item.id} className={deadline?.level === "overdue" ? "deadline-overdue" : ""}><span className={`biotech-stage-dot ${item.current_stage}`}><IcoLeaf /></span><div><strong>{item.code}</strong><small>{stageName(item)}</small><em className={`biotech-stage-deadline ${deadline?.level || ""}`}>{deadline?.text}</em></div><time>{stageDate ? new Date(`${String(stageDate).slice(0, 10)}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }) : "Sin fecha"}</time></article> })}</div>
          </div>
        </section>
      ) : tab === "register" ? <section className="card biotech-one-step-card">
        <header>
          <span className="eyebrow">Registro del día</span>
          <h2>Toca, escribe y guarda.</h2>
          <p>El nuevo código llevará la fecha que indiques. Puedes registrar las bolsas iniciales reales, sin límites.</p>
        </header>
        {loading ? <div className="biotech-loading">Cargando códigos…</div> : activeCodes.length ? (
          <form onSubmit={submit}>
            <div className="biotech-entry-list">
              {entries.map((entry, index) => {
                const selectedCode = activeCodes.find((item) => item.id === entry.batchId);
                const sourceMatches = searchSourceBags(activeCodes, entry.sourceQuery).slice(0, 10);
                return (
                  <section className="biotech-entry" key={entry.id}>
                    <header>
                      <strong>{entries.length > 1 ? `Registro ${index + 1}` : "Nuevo registro"}</strong>
                      {entries.length > 1 && <button type="button" onClick={() => removeEntry(entry.id)}>Quitar</button>}
                    </header>
                    <div className="biotech-analyst-picks">
                      <span>Paso 2 · Selecciona quién lo hizo</span>
                      <div>
                        {people.map((person) => (
                          <button
                            type="button"
                            key={person.id}
                            className={entry.analystIds.includes(person.id) ? "active" : ""}
                            onClick={() => toggleAnalyst(entry, person.id)}
                          >
                            <i>{initials(person.full_name)}</i>
                            {person.full_name.split(" ")[0]}
                            {entry.analystIds.includes(person.id) && <IcoCheck />}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="biotech-entry-fields">
                      <Field label="1. Busca y toca la bolsa que vas a trabajar" wide>
                        <div className="biotech-bag-search"><input value={entry.sourceQuery} onChange={(e) => updateEntry(entry.id, { sourceQuery: e.target.value, batchId: "" })} placeholder="Escribe 5G, C6 o 10-08" autoComplete="off" required />
                          {entry.sourceQuery.trim() && !entry.batchId && <div className="biotech-bag-suggestions">{sourceMatches.length ? sourceMatches.map((item) => <button type="button" className={entry.batchId === item.id ? "selected" : ""} onClick={() => updateEntry(entry.id, { batchId: item.id, sourceQuery: codeChoiceName(item) })} key={item.id}><span className={`biotech-stage-dot ${item.current_stage}`}><IcoLeaf /></span><div><strong>{item.code}</strong><small>{stageName(item)} · {analyticsDayLabel(item.current_stage_started_on || item.started_on)}</small></div>{entry.batchId === item.id && <IcoCheck />}</button>) : <div className="biotech-bag-no-result">No encontramos esa bolsa. Prueba con el código, C6 o la fecha.</div>}</div>}
                        </div>
                      </Field>
                      <Field label="Fecha de este registro">
                        <input type="date" value={entry.performedOn} onChange={(e) => updateEntry(entry.id, { performedOn: e.target.value })} required />
                      </Field>
                      <Field label="Bolsas iniciales · lo que recibiste">
                        <input inputMode="numeric" type="number" min="0" value={entry.inputBags} onChange={(e) => updateEntry(entry.id, { inputBags: e.target.value })} placeholder="0" required />
                      </Field>
                      <Field label="Bolsas finales · lo que obtuviste">
                        <input inputMode="numeric" type="number" min="0" value={entry.outputBags} onChange={(e) => updateEntry(entry.id, { outputBags: e.target.value })} placeholder="0" required />
                      </Field>
                      {selectedCode?.current_stage === "multiplication" && Number(selectedCode.current_subculture) + 1 < Number(selectedCode.target_subcultures) && <Field label="Pasa a subcultivo">
                        <select value={entry.targetSubculture} onChange={(e) => updateEntry(entry.id, { targetSubculture: e.target.value })}>
                          <option value="">Siguiente · Subcultivo {Number(selectedCode.current_subculture) + 2}</option>
                          {Array.from({ length: Math.max(0, Number(selectedCode.target_subcultures) - Number(selectedCode.current_subculture) - 1) }, (_, offset) => Number(selectedCode.current_subculture) + 2 + offset).map((subculture) => <option value={subculture} key={subculture}>Subcultivo {subculture}</option>)}
                        </select>
                      </Field>}
                      <div className="field field-wide biotech-rooting-field"><span>Bolsas para enraizamiento · opcional</span>
                        <input inputMode="numeric" type="number" min="0" value={entry.rootingBags} onChange={(e) => updateEntry(entry.id, { rootingBags: e.target.value })} />
                      </div>
                    </div>
                    {selectedCode && <div className="biotech-entry-summary"><strong>{codeChoiceName(selectedCode)}</strong><span>Paso 3 · Escribe bolsas iniciales y finales · {selectedCode.plants_per_bag || data.settings?.default_plants_per_bag || 4} plantas por bolsa</span><em className={`biotech-stage-deadline ${stageDeadline(selectedCode)?.level || ""}`}>{stageDeadline(selectedCode)?.text}</em></div>}
                  </section>
                );
              })}
            </div>
            <div className="biotech-one-step-actions">
              <button type="button" className="btn biotech-add-entry" onClick={addEntry}><IcoPlus /> Añadir otro registro</button>
              <button className="btn btn-primary" disabled={saving}>{saving ? "Guardando…" : entries.length > 1 ? `Crear ${entries.length} códigos` : "Guardar y crear código"} <IcoArrow /></button>
            </div>
          </form>
        ) : <div className="biotech-simple-empty"><IcoCheck /><strong>No hay códigos activos</strong><span>Administración puede crear el siguiente código.</span></div>}
      </section> : (
        <section className="biotech-worker-performance">
          <header><span className="eyebrow">Mi rendimiento</span><h2>Resumen de {user.activeWorker.fullName.split(" ")[0]}</h2><p>Tu producción queda calculada automáticamente con cada registro.</p></header>
          <div className="biotech-personal-kpis">
            <article><span>Registros realizados</span><strong>{number(personal.event_count)}</strong></article>
            <article><span>Plantas producidas</span><strong>{number(personal.viable_output)}</strong></article>
            <article><span>Multiplicación real</span><strong>×{decimal(personalRate)}</strong></article>
          </div>
          <div className="biotech-personal-history">
            <h3>Actividad reciente</h3>
            {personalHistory.map((item) => <article key={item.id}><span className={`biotech-stage-dot ${item.stage}`}><IcoLeaf /></span><div><strong>{item.code}</strong><small>{item.stage === "multiplication" ? `Subcultivo ${item.subculture_number}` : LABEL[item.stage]} · {new Date(item.performed_at).toLocaleDateString("es-PE")}</small></div><b>{number(item.viable_output_plants)} plantas</b></article>)}
            {!personalHistory.length && <div className="biotech-simple-empty small">Tu actividad aparecerá después del primer registro.</div>}
          </div>
        </section>
      )}
      {embedded && <section className="biotech-inline-statistics">
        <header><span className="eyebrow">Estadísticas</span><h2>Tu producción</h2><p>Se actualiza automáticamente cada vez que guardas bolsas.</p></header>
        <div className="biotech-personal-kpis">
          <article><span>Registros realizados</span><strong>{number(personal.event_count)}</strong></article>
          <article><span>Plantas producidas</span><strong>{number(personal.viable_output)}</strong></article>
          <article><span>Multiplicación real</span><strong>×{decimal(personalRate)}</strong></article>
        </div>
        <div className="biotech-personal-history">
          <h3>Actividad reciente</h3>
          {personalHistory.map((item) => <article key={item.id}><span className={`biotech-stage-dot ${item.stage}`}><IcoLeaf /></span><div><strong>{item.code}</strong><small>{item.stage === "multiplication" ? `Subcultivo ${item.subculture_number}` : LABEL[item.stage]} · {new Date(item.performed_at).toLocaleDateString("es-PE")}</small></div><b>{number(item.viable_output_plants)} plantas</b></article>)}
          {!personalHistory.length && <div className="biotech-simple-empty small">La actividad aparecerá después del primer registro.</div>}
        </div>
      </section>}
    </div>
  );
}

export default function Biotechnology({ user, notify }) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState(user.activeWorker && !user.activeWorker.codeCreatorOnly ? "personal" : "codes");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [codeSearch, setCodeSearch] = useState("");
  const load = async (prefetched = null) => {
    setLoading(true);
    try {
      const result = prefetched || (await api.biotechnology());
      setData(result);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const cropOptions = useMemo(
    () => [
      ...new Set(
        data.cultivars
          .filter((item) => item.active)
          .map((item) => item.crop_name),
      ),
    ],
    [data.cultivars],
  );
  const selectedCultivar = data.cultivars.find(
    (item) => item.id === form?.cultivarId,
  );
  const setValue = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const openCreate = () => {
    const first = data.cultivars.find((item) => item.active);
    setForm({
      code: "",
      cropChoice: first?.crop_name || "",
      cultivarId: first?.id || "",
      initialStage: "introduction",
      initialSubculture: "1",
      startedOn: today(),
    });
    setModal("create");
    setError("");
  };
  const openCultivar = (item = null) => {
    setForm({
      id: item?.id || "",
      cropName: item?.crop_name || "",
      variety: item?.variety || "",
      multiplicationFactor: String(item?.multiplication_factor || "2.5"),
      targetSubcultures: String(item?.target_subcultures || "10"),
      active: item?.active !== false,
    });
    setModal("cultivar");
    setError("");
  };
  const openConfig = (batch) => {
    setForm({
      batchId: batch.id,
      code: batch.code,
      currentStage: batch.current_stage,
      activeSubculture: String(Number(batch.current_subculture || 0) + 1),
      startedOn: batch.started_on ? String(batch.started_on).slice(0, 10) : "",
      currentStageStartedOn: batch.current_stage_started_on ? String(batch.current_stage_started_on).slice(0, 10) : batch.started_on ? String(batch.started_on).slice(0, 10) : "",
      status: batch.status,
      sourceNote: batch.source_note || "",
      multiplicationFactor: String(batch.multiplication_factor),
      targetSubcultures: String(batch.target_subcultures),
      needsReview: Boolean(batch.needs_review),
    });
    setModal("config");
    setError("");
  };
  const openSettings = () => {
    setForm({
      defaultPlantsPerBag: String(data.settings.default_plants_per_bag || 4),
    });
    setModal("settings");
    setError("");
  };
  const openTrashAction = (batch, mode = "archive") => {
    setForm({ batchId: batch.id, code: batch.code });
    setModal(mode);
    setError("");
  };
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      let result;
      if (modal === "create")
        result = await api.createBiotechnology({
          action: "create_batch",
          ...form,
        });
      if (modal === "cultivar")
        result = form.id
          ? await api.updateBiotechnology({
              action: "update_cultivar",
              ...form,
            })
          : await api.createBiotechnology({
              action: "create_cultivar",
              ...form,
            });
      if (modal === "config")
        result = await api.updateBiotechnology({
          action: "update_batch",
          ...form,
        });
      if (modal === "settings")
        result = await api.updateBiotechnology({
          action: "update_settings",
          ...form,
        });
      if (modal === "archive")
        result = await api.updateBiotechnology({
          action: "archive_batch",
          ...form,
        });
      if (modal === "restore")
        result = await api.updateBiotechnology({
          action: "restore_batch",
          ...form,
        });
      if (result) setData(result);
      const completedModal = modal;
      setModal(null);
      setForm(null);
      notify(
        completedModal === "create"
            ? "Código creado y disponible para todo el equipo."
            : completedModal === "archive"
              ? "Código enviado a la papelera. Puedes restaurarlo cuando quieras."
              : completedModal === "restore"
                ? "Código restaurado y disponible nuevamente."
                : "Configuración guardada.",
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  if (user.activeWorker && !user.activeWorker.codeCreatorOnly && view === "personal")
    return (
      <SimpleBiotechRecorder
        data={data}
        user={user}
        loading={loading}
        error={error}
        onReload={load}
        onManage={() => setView("codes")}
        notify={notify}
      />
    );
  const activeBatches = data.batches.filter(
    (item) => ["active", "paused"].includes(item.status) && !item.archived_at,
  );
  const filteredActiveBatches = codeSearch.trim()
    ? searchSourceBags(activeBatches, codeSearch)
    : activeBatches;
  const trashedBatches = data.batches.filter((item) => item.archived_at);
  return (
    <div className="biotech-simple-admin">
      <section className="biotech-simple-admin-hero">
        <div>
          <span className="eyebrow">Biotecnología vegetal</span>
          <h1>Códigos y producción.</h1>
          <p>
            {user.activeWorker?.codeCreatorOnly
              ? "Crea nuevos códigos de propagación. La producción y el registro de bolsas permanecen restringidos."
              : "Crea los códigos y sigue su avance. Cualquier integrante autorizada puede registrar lo que hizo."}
          </p>
          <div>
            {data.canCreateCodes && (
              <button className="btn btn-accent" onClick={openCreate}>
                <IcoPlus /> Crear código
              </button>
            )}
            {user.activeWorker && !user.activeWorker.codeCreatorOnly && (
              <button
                className="btn btn-white"
                onClick={() => setView("personal")}
              >
                Volver a mi trabajo
              </button>
            )}
          </div>
        </div>
        <aside>
          <span>Producción actual</span>
          <strong>{number(data.metrics.currentPlants)}</strong>
          <small>{data.metrics.activeCodes || 0} códigos activos</small>
        </aside>
      </section>
      <nav className="biotech-tabs">
        <button
          className={view === "codes" ? "active" : ""}
          onClick={() => setView("codes")}
        >
          Códigos
        </button>
        {user.role === "admin" && <button
          className={view === "analytics" ? "active" : ""}
          onClick={() => setView("analytics")}
        >
          Analítica
        </button>}
        {!user.activeWorker?.codeCreatorOnly && <button
          className={view === "team" ? "active" : ""}
          onClick={() => setView("team")}
        >
          Rendimiento
        </button>}
        {data.canManageCultivars && (
          <button
            className={view === "catalog" ? "active" : ""}
            onClick={() => setView("catalog")}
          >
            Plantas y variedades
          </button>
        )}
        {data.canAdminCodes && (
          <button
            className={view === "trash" ? "active" : ""}
            onClick={() => setView("trash")}
          >
            Papelera {trashedBatches.length ? `(${trashedBatches.length})` : ""}
          </button>
        )}
        {data.canAdminCodes && (
          <button className="biotech-setting-button" onClick={openSettings}>
            <IcoShield /> {data.settings.default_plants_per_bag} plantas por
            bolsa
          </button>
        )}
      </nav>
      {error && !modal && <div className="form-error">{error}</div>}
      {loading ? (
        <div className="card biotech-loading">Preparando Biotecnología…</div>
      ) : view === "codes" ? (
        <section className="biotech-simple-code-page">
          <header>
            <div>
              <span className="eyebrow">Producción</span>
              <h2>Códigos activos</h2>
              <p>Busca por código, subcultivo y fecha para editar una bolsa sin recorrer la lista.</p>
            </div>
            <div className="biotech-code-page-actions">
              <label className="biotech-code-search"><span>Buscar subcultivo</span><input value={codeSearch} onChange={(event) => setCodeSearch(event.target.value)} placeholder="Ej. 5G C6 10-08" autoComplete="off" /></label>
              {data.canCreateCodes && (
                <button className="btn btn-primary" onClick={openCreate}>
                  <IcoPlus /> Nuevo código
                </button>
              )}
            </div>
          </header>
          {codeSearch.trim() && <p className="biotech-code-search-result">{filteredActiveBatches.length} {filteredActiveBatches.length === 1 ? "bolsa encontrada" : "bolsas encontradas"}</p>}
          <div className="biotech-simple-code-grid">
            {filteredActiveBatches.map((batch) => {
              return (
                <article key={batch.id}>
                  <div className="biotech-code-card-head">
                    <span
                      className={`biotech-stage-dot ${batch.current_stage}`}
                    >
                      <IcoLeaf />
                    </span>
                    <div>
                      <small>
                        {data.canCreateCodes
                          ? `${batch.crop_name || "Planta"}${batch.variety ? ` · ${batch.variety}` : ""}`
                          : "Código interno"}
                      </small>
                      <h3>{batch.code}</h3>
                    </div>
                    <b>
                      {batch.status === "paused" ? "REVISAR" : batch.current_stage === "multiplication"
                        ? `S${Number(batch.current_subculture) + 1}`
                        : LABEL[batch.current_stage]}
                    </b>
                  </div>
                  {stageDeadline(batch) && <div className={`biotech-stage-deadline-card ${stageDeadline(batch).level}`}><IcoShield /><span>{stageDeadline(batch).text}</span></div>}
                  <div className="biotech-code-progress">
                    <span>Etapa actual</span>
                    <strong>
                      {batch.current_stage === "multiplication"
                        ? `Subcultivo ${Number(batch.current_subculture) + 1} de ${batch.target_subcultures}`
                        : LABEL[batch.current_stage]}
                    </strong>
                    <div>
                      <i
                        style={{
                          width: `${Math.min(100, batch.current_stage === "multiplication" ? (Number(batch.current_subculture) / Number(batch.target_subcultures)) * 100 : ["rooting", "field_ready", "completed"].includes(batch.current_stage) ? 100 : 5)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="biotech-code-card-meta">
                    <span>
                      <small>Plantas actuales</small>
                      <strong>{number(batch.current_viable_plants)}</strong>
                    </span>
                    <span>
                      <small>Fecha de esta etapa</small>
                      <strong>{(batch.current_stage_started_on || batch.started_on) ? new Date(`${String(batch.current_stage_started_on || batch.started_on).slice(0, 10)}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }) : "Por revisar"}</strong>
                    </span>
                  </div>
                  {data.canAdminCodes && batch.needs_review && <div className="biotech-import-review"><IcoShield /> Revisar dato importado</div>}
                  {batch.status === "paused" ? (
                    <div className="biotech-code-paused"><IcoShield /><span><small>En pausa</small><strong>Completa subcultivo o fecha para habilitarlo</strong></span></div>
                  ) : (
                    <div className="biotech-code-available">
                      <IcoCheck />
                      <span><small>Registro abierto</small><strong>Disponible para todo el equipo</strong></span>
                    </div>
                  )}
                  {data.canAdminCodes && (
                    <div className="biotech-code-secondary-actions">
                      <button
                        className="biotech-text-action"
                        onClick={() => openConfig(batch)}
                      >
                        Editar parámetros
                      </button>
                      <button
                        className="biotech-text-action danger"
                        onClick={() => openTrashAction(batch)}
                      >
                        Enviar a papelera
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!activeBatches.length && (
            <div className="biotech-simple-empty">
              <IcoLeaf />
              <strong>Aún no hay códigos activos</strong>
              <span>
                Crea el primero seleccionando su planta, variedad y etapa
                actual.
              </span>
            </div>
          )}
        </section>
      ) : view === "analytics" && user.role === "admin" ? (
        <AnalyticsDashboard data={data} />
      ) : view === "team" ? (
        <section className="biotech-simple-team">
          <header>
            <span className="eyebrow">Evolución del personal</span>
            <h2>Producción real por persona</h2>
            <p>
              La salida se calcula con las bolsas finales y el estándar global.
            </p>
          </header>
          <div>
            {data.workers.map((worker) => {
              const rate = Number(worker.multiplication_input)
                ? Number(worker.multiplication_output) /
                  Number(worker.multiplication_input)
                : 0;
              return (
                <article key={worker.id}>
                  <span>{initials(worker.full_name)}</span>
                  <div>
                    <strong>{worker.full_name}</strong>
                    <small>{worker.event_count} trabajos registrados</small>
                  </div>
                  <b>
                    {number(worker.viable_output)}
                    <small> plantas</small>
                  </b>
                  <em>×{decimal(rate)} real</em>
                </article>
              );
            })}
          </div>
        </section>
      ) : view === "trash" ? (
        <section className="biotech-simple-trash">
          <header>
            <div>
              <span className="eyebrow">Respaldo de códigos</span>
              <h2>Papelera</h2>
              <p>
                Ningún dato se elimina. Restaura un código para devolverlo a
                producción.
              </p>
            </div>
          </header>
          <div>
            {trashedBatches.map((batch) => (
              <article key={batch.id}>
                <span className="biotech-stage-dot">
                  <IcoLeaf />
                </span>
                <div>
                  <small>
                    {batch.crop_name || "Planta"}
                    {batch.variety ? ` · ${batch.variety}` : ""}
                  </small>
                  <strong>{batch.code}</strong>
                </div>
                <div>
                  <small>Etapa conservada</small>
                  <strong>
                    {batch.current_stage === "multiplication"
                      ? `Subcultivo ${Number(batch.current_subculture) + 1}`
                      : LABEL[batch.current_stage]}
                  </strong>
                </div>
                <div>
                  <small>En papelera desde</small>
                  <strong>
                    {new Date(batch.archived_at).toLocaleDateString("es-PE")}
                  </strong>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => openTrashAction(batch, "restore")}
                >
                  Restaurar código
                </button>
              </article>
            ))}
          </div>
          {!trashedBatches.length && (
            <div className="biotech-simple-empty">
              <IcoCheck />
              <strong>La papelera está vacía</strong>
              <span>
                Los códigos archivados aparecerán aquí con todo su historial
                intacto.
              </span>
            </div>
          )}
        </section>
      ) : (
        <section className="biotech-simple-catalog">
          <header>
            <div>
              <span className="eyebrow">Configuración privada</span>
              <h2>Plantas y variedades</h2>
              <p>
                Cada variedad conserva su multiplicador y cantidad de
                subcultivos.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => openCultivar()}>
              <IcoPlus /> Nueva variedad
            </button>
          </header>
          <div>
            {data.cultivars.map((item) => (
              <article className={!item.active ? "inactive" : ""} key={item.id}>
                <span className="biotech-stage-dot">
                  <IcoLeaf />
                </span>
                <div>
                  <small>{item.crop_name}</small>
                  <strong>{item.variety || "Sin variedad"}</strong>
                </div>
                <span>
                  <small>Multiplicador</small>
                  <strong>×{decimal(item.multiplication_factor)}</strong>
                </span>
                <span>
                  <small>Subcultivos</small>
                  <strong>{item.target_subcultures}</strong>
                </span>
                <button
                  className="btn btn-ghost"
                  onClick={() => openCultivar(item)}
                >
                  Editar
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {modal && form && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <form
            className="modal biotech-simple-modal"
            onSubmit={submit}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="modal-icon">
                <IcoLeaf />
              </span>
              <div>
                <span className="eyebrow">Biotecnología simple</span>
                <h2>
                  {modal === "create"
                    ? "Crear código"
                    : modal === "cultivar"
                        ? form.id
                          ? "Editar variedad"
                          : "Nueva variedad"
                        : modal === "config"
                          ? "Editar parámetros del código"
                          : modal === "archive"
                            ? "Enviar a papelera"
                            : modal === "restore"
                              ? "Restaurar código"
                              : "Parámetro global"}
                </h2>
                <p>
                  {modal === "settings"
                      ? "Este número se aplicará a todos los códigos activos y trabajos futuros."
                      : "Solo los datos indispensables."}
                </p>
              </div>
            </div>
            {modal === "create" && (
              <>
                <div className="form-grid biotech-code-quick-form">
                  <Field label="Código">
                    <input
                      value={form.code}
                      onChange={(e) => setValue("code", e.target.value)}
                      placeholder="Escribe cualquier nombre o código"
                      required
                    />
                  </Field>
                  <Field label="Planta">
                    <select
                      value={form.cropChoice}
                      onChange={(e) => {
                        const first = data.cultivars.find(
                          (item) =>
                            item.active && item.crop_name === e.target.value,
                        );
                        setForm({
                          ...form,
                          cropChoice: e.target.value,
                          cultivarId: first?.id || "",
                          initialSubculture: "1",
                        });
                      }}
                      required
                    >
                      <option value="">Seleccionar…</option>
                      {cropOptions.map((crop) => (
                        <option value={crop} key={crop}>
                          {crop}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Variedad">
                    <select
                      value={form.cultivarId}
                      onChange={(e) => setValue("cultivarId", e.target.value)}
                      required
                    >
                      <option value="">Seleccionar…</option>
                      {data.cultivars
                        .filter(
                          (item) =>
                            item.active && item.crop_name === form.cropChoice,
                        )
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.variety || "Sin variedad"}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Comienza en">
                    <select
                      value={form.initialStage}
                      onChange={(e) => setValue("initialStage", e.target.value)}
                    >
                      <option value="introduction">Introducción</option>
                      <option value="multiplication">Multiplicación</option>
                      <option value="rooting">Enraizamiento</option>
                    </select>
                  </Field>
                  {form.initialStage === "multiplication" && (
                    <Field label="Subcultivo actual">
                      <select
                        value={form.initialSubculture}
                        onChange={(e) =>
                          setValue("initialSubculture", e.target.value)
                        }
                      >
                        {Array.from(
                          {
                            length: Number(
                              selectedCultivar?.target_subcultures || 10,
                            ),
                          },
                          (_, index) => (
                            <option value={index + 1} key={index + 1}>
                              Subcultivo {index + 1}
                            </option>
                          ),
                        )}
                      </select>
                    </Field>
                  )}
                  <Field label="Fecha de la etapa inicial">
                    <input type="date" value={form.startedOn} onChange={(e) => setValue("startedOn", e.target.value)} />
                  </Field>
                </div>
                {selectedCultivar && (
                  <div className="biotech-cultivar-auto">
                    <IcoCheck />
                    <div>
                      <strong>Configuración automática</strong>
                      <span>
                        ×{decimal(selectedCultivar.multiplication_factor)} ·{" "}
                        {selectedCultivar.target_subcultures} subcultivos ·{" "}
                        {data.settings.default_plants_per_bag} plantas por bolsa
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
            {modal === "cultivar" && (
              <div className="form-grid">
                <Field label="Planta">
                  <input
                    value={form.cropName}
                    onChange={(e) => setValue("cropName", e.target.value)}
                    placeholder="Ej. Banano"
                    required
                  />
                </Field>
                <Field label="Variedad">
                  <input
                    value={form.variety}
                    onChange={(e) => setValue("variety", e.target.value)}
                    placeholder="Ej. Cavendish Williams"
                  />
                </Field>
                <Field label="Multiplicador">
                  <input
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.1"
                    value={form.multiplicationFactor}
                    onChange={(e) =>
                      setValue("multiplicationFactor", e.target.value)
                    }
                    required
                  />
                </Field>
                <Field label="Subcultivos planificados">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={form.targetSubcultures}
                    onChange={(e) =>
                      setValue("targetSubcultures", e.target.value)
                    }
                    required
                  />
                </Field>
                {form.id && (
                  <Field label="Estado">
                    <select
                      value={form.active ? "active" : "inactive"}
                      onChange={(e) =>
                        setValue("active", e.target.value === "active")
                      }
                    >
                      <option value="active">Activa</option>
                      <option value="inactive">Inactiva</option>
                    </select>
                  </Field>
                )}
              </div>
            )}
            {modal === "config" && (
              <div className="form-grid">
                <Field label="Código">
                  <input value={form.code} onChange={(e) => setValue("code", e.target.value)} required />
                </Field>
                <Field label="Fecha original del código">
                  <input type="date" value={form.startedOn} onChange={(e) => setValue("startedOn", e.target.value)} />
                </Field>
                <Field label="Fecha de la etapa actual">
                  <input type="date" value={form.currentStageStartedOn} onChange={(e) => setValue("currentStageStartedOn", e.target.value)} />
                </Field>
                <Field label="Etapa actual">
                  <select value={form.currentStage} onChange={(e) => setValue("currentStage", e.target.value)}>
                    <option value="introduction">Introducción</option>
                    <option value="multiplication">Multiplicación</option>
                    <option value="rooting">Enraizamiento</option>
                    <option value="field_ready">Lista para enviar a campo</option>
                    <option value="completed">Completado</option>
                  </select>
                </Field>
                {form.currentStage === "multiplication" && <Field label="Subcultivo actual">
                  <input type="number" min="1" max={form.targetSubcultures || 20} value={form.activeSubculture} onChange={(e) => setValue("activeSubculture", e.target.value)} required />
                </Field>}
                <Field label="Multiplicador">
                  <input
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.1"
                    value={form.multiplicationFactor}
                    onChange={(e) =>
                      setValue("multiplicationFactor", e.target.value)
                    }
                    required
                  />
                </Field>
                <Field label="Subcultivos planificados">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={form.targetSubcultures}
                    onChange={(e) =>
                      setValue("targetSubcultures", e.target.value)
                    }
                    required
                  />
                </Field>
                <Field label="Dato importado">
                  <select value={form.needsReview ? "review" : "verified"} onChange={(e) => setValue("needsReview", e.target.value === "review")}>
                    <option value="verified">Verificado</option>
                    <option value="review">Pendiente de revisar</option>
                  </select>
                </Field>
                <Field label="Disponibilidad">
                  <select value={form.status} onChange={(e) => setValue("status", e.target.value)}>
                    <option value="active">Activo para registrar</option>
                    <option value="paused">En pausa</option>
                    <option value="completed">Completado</option>
                  </select>
                </Field>
                {form.sourceNote && <div className="biotech-source-note field-wide"><IcoShield /><span><strong>Dato original</strong>{form.sourceNote}</span></div>}
              </div>
            )}
            {modal === "settings" && (
              <Field
                label="Plantas por bolsa"
                hint="Parámetro global para todos los códigos activos."
              >
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={form.defaultPlantsPerBag}
                  onChange={(e) =>
                    setValue("defaultPlantsPerBag", e.target.value)
                  }
                  required
                />
              </Field>
            )}
            {modal === "archive" && (
              <div className="biotech-trash-confirm">
                <IcoShield />
                <div>
                  <strong>Enviar {form.code} a la papelera</strong>
                  <p>
                    El código dejará de aparecer en producción. Su etapa,
                    conteos e historial se conservarán y podrás restaurarlo.
                  </p>
                </div>
              </div>
            )}
            {modal === "restore" && (
              <div className="biotech-trash-confirm restore">
                <IcoLeaf />
                <div>
                  <strong>Restaurar {form.code}</strong>
                  <p>
                    Volverá a códigos activos exactamente en la etapa donde
                    quedó.
                  </p>
                </div>
              </div>
            )}
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button className="btn btn-primary" disabled={saving}>
                {saving
                  ? "Guardando…"
                  : modal === "archive"
                      ? "Enviar a papelera"
                      : modal === "restore"
                        ? "Restaurar código"
                        : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
