import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Car, Bike, Truck, BarChart3, Settings2,
  Search, Check, Clock3, TrendingUp, AlertTriangle, RotateCcw,
  Trash2, ParkingSquare, Download
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { storage } from "./storage";
import { STORAGE_KEY, DEFAULT_CONFIG, DEFAULT_DATA, TIPOS } from "./constants";
import {
  fmtMoney, fmtDur, fmtTime, fmtDateShort, calcularMonto,
  downloadXLSX, dayKey, startOfDay,
} from "./lib/format";
import {
  SectionTitle, StatCard, CorteCard, ChartCard, EmptyState, ConfigField, RateField,
} from "./components/ui";
import RootStyles from "./components/RootStyles";
import { TopBar, BottomNav } from "./components/Nav";
import EntradaTab from "./components/EntradaTab";
import SalidaTab from "./components/SalidaTab";
import EstadoTab from "./components/EstadoTab";

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [tab, setTab] = useState("entrada");
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setData({
            config: { ...DEFAULT_CONFIG, ...parsed.config, rates: { ...DEFAULT_CONFIG.rates, ...(parsed.config?.rates || {}) }, umbrales: { ...DEFAULT_CONFIG.umbrales, ...(parsed.config?.umbrales || {}) } },
            vehicles: parsed.vehicles || [],
          });
        } else {
          setData(DEFAULT_DATA);
        }
      } catch (e) {
        setData(DEFAULT_DATA);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const persist = useCallback(async (newData) => {
    setData(newData);
    try {
      await storage.set(STORAGE_KEY, JSON.stringify(newData));
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
  }, []);

  if (loading || !data) {
    return (
      <div style={{ background: "var(--bg)" }} className="min-h-screen flex items-center justify-center">
        <RootStyles />
        <div className="text-center">
          <ParkingSquare className="animate-pulse mx-auto mb-3" size={40} style={{ color: "var(--accent)" }} />
          <p style={{ color: "var(--muted)" }} className="text-sm">Cargando estacionamiento…</p>
        </div>
      </div>
    );
  }

  const vehiculosDentro = data.vehicles.filter((v) => v.estado === "dentro");
  const ocupados = vehiculosDentro.length;
  const disponibles = Math.max(0, data.config.totalEspacios - ocupados);
  const ocupacionPct = Math.min(100, Math.round((ocupados / Math.max(1, data.config.totalEspacios)) * 100));

  const registrarIngreso = (patente, tipo) => {
    const pat = patente.trim().toUpperCase();
    if (!pat) return showToast("Ingresá una patente");
    if (vehiculosDentro.some((v) => v.patente === pat)) {
      return showToast(`${pat} ya está registrado dentro`);
    }
    if (disponibles <= 0) return showToast("No hay espacio disponible");
    const vehicle = {
      id: `${pat}-${Date.now()}`,
      patente: pat,
      tipo,
      horaIngreso: Date.now(),
      horaSalida: null,
      monto: null,
      estado: "dentro",
    };
    persist({ ...data, vehicles: [vehicle, ...data.vehicles] });
    showToast(`Ingreso registrado: ${pat}`);
  };

  const registrarSalida = (id) => {
    const v = data.vehicles.find((x) => x.id === id);
    if (!v) return;
    const minutos = (Date.now() - v.horaIngreso) / 60000;
    const monto = calcularMonto(minutos, data.config.rates, data.config.umbrales);
    const updated = data.vehicles.map((x) =>
      x.id === id ? { ...x, horaSalida: Date.now(), monto, estado: "afuera" } : x
    );
    persist({ ...data, vehicles: updated });
    showToast(`Salida registrada: ${v.patente} · ${fmtMoney(monto)}`);
  };

  const updateConfig = (config) => persist({ ...data, config });

  const resetDemo = () => {
    persist(DEFAULT_DATA);
    showToast("Datos reiniciados");
  };

  const borrarTodo = () => {
    persist({ ...data, vehicles: [] });
    showToast("Historial borrado");
  };

  return (
    <div style={{ background: "var(--bg)", color: "var(--text)" }} className="min-h-screen flex flex-col font-sans">
      <RootStyles />
      <TopBar config={data.config} ocupados={ocupados} disponibles={disponibles} ocupacionPct={ocupacionPct} />

      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-4 max-w-md w-full mx-auto">
        {tab === "entrada" && (
          <EntradaTab onRegistrar={registrarIngreso} disponibles={disponibles} />
        )}
        {tab === "salida" && (
          <SalidaTab
            vehiculosDentro={vehiculosDentro}
            now={now}
            rates={data.config.rates}
            umbrales={data.config.umbrales}
            onSalida={registrarSalida}
          />
        )}
        {tab === "estado" && (
          <EstadoTab
            vehiculosDentro={vehiculosDentro}
            now={now}
            totalEspacios={data.config.totalEspacios}
            disponibles={disponibles}
          />
        )}
        {tab === "reportes" && (
          <ReportesTab vehicles={data.vehicles} now={now} />
        )}
        {tab === "config" && (
          <ConfigTab
            config={data.config}
            onSave={updateConfig}
            onResetDemo={resetDemo}
            onBorrarTodo={borrarTodo}
          />
        )}
      </main>

      <BottomNav tab={tab} setTab={setTab} disponibles={disponibles} />

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-24 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium z-50"
          style={{ background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {toast}
        </div>
      )}
      {saveError && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 z-50"
          style={{ background: "var(--danger)", color: "#fff" }}
        >
          <AlertTriangle size={13} /> No se pudo guardar
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reportes                                                             */
/* ------------------------------------------------------------------ */

function ReportesTab({ vehicles, now }) {
  const [periodo, setPeriodo] = useState("hoy"); // hoy | semana | quincena | mes

  const cortes = useMemo(() => computeCortes(vehicles, now), [vehicles, now]);

  const chartData = useMemo(() => {
    if (periodo === "hoy") return movimientosPorHora(vehicles, now);
    const dias = periodo === "semana" ? 7 : periodo === "quincena" ? 15 : 30;
    return movimientosPorDia(vehicles, now, dias);
  }, [vehicles, periodo, now]);

  const xKey = periodo === "hoy" ? "hora" : "fecha";

  const exportarReporte = () => {
    const resumenRows = [
      { Período: "Hoy", Recaudado: cortes.hoy },
      { Período: "Últimos 7 días", Recaudado: cortes.semanal },
      { Período: "Últimos 15 días", Recaudado: cortes.quincenal },
      { Período: "Últimos 30 días", Recaudado: cortes.mensual },
    ];
    const detalleRows = chartData.map((d) =>
      periodo === "hoy"
        ? { Hora: d.hora, Ingresos: d.ingresos, Egresos: d.egresos, Ocupación: d.ocupacion }
        : { Fecha: d.fecha, Ingresos: d.ingresos, Egresos: d.egresos, Recaudado: d.recaudado, "Ocupación pico": d.picoOcupacion }
    );
    downloadXLSX(`reporte-estacionamiento-${dayKey(now)}.xlsx`, { Resumen: resumenRows, Detalle: detalleRows });
  };

  return (
    <div>
      <SectionTitle icon={BarChart3} title="Reportes" subtitle="Recaudación y ocupación" />

      <div className="grid grid-cols-2 gap-2.5 mb-3">
        <CorteCard label="Hoy" value={cortes.hoy} />
        <CorteCard label="Últimos 7 días" value={cortes.semanal} />
        <CorteCard label="Últimos 15 días" value={cortes.quincenal} />
        <CorteCard label="Últimos 30 días" value={cortes.mensual} />
      </div>

      <button
        onClick={exportarReporte}
        className="w-full mb-4 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
      >
        <Download size={14} /> Exportar resumen y detalle (.xlsx)
      </button>

      <div className="flex gap-1.5 mb-4">
        {[
          { id: "hoy", label: "Hoy" },
          { id: "semana", label: "Semana" },
          { id: "quincena", label: "Quincena" },
          { id: "mes", label: "Mes" },
        ].map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriodo(p.id)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold"
            style={{
              background: periodo === p.id ? "var(--accent)" : "var(--surface)",
              color: periodo === p.id ? "#1A1300" : "var(--muted)",
              border: `1px solid ${periodo === p.id ? "var(--accent)" : "var(--border)"}`,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <ChartCard title="Ingresos y egresos">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "var(--text)" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="ingresos" name="Ingresos" fill="var(--accent2)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="egresos" name="Egresos" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={periodo === "hoy" ? "Ocupación por hora" : "Ocupación pico por día"}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "var(--text)" }} />
            <Bar dataKey={periodo === "hoy" ? "ocupacion" : "picoOcupacion"} name="Ocupación" fill="#5B8DEF" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <HistorialSection vehicles={vehicles} now={now} />
    </div>
  );
}

function HistorialSection({ vehicles, now }) {
  const [q, setQ] = useState("");
  const filtered = vehicles
    .filter((v) => v.patente.includes(q.toUpperCase()))
    .sort((a, b) => b.horaIngreso - a.horaIngreso);

  const exportar = () => {
    const rows = filtered.map((v) => ({
      Patente: v.patente,
      Tipo: TIPOS.find((t) => t.id === v.tipo)?.label || v.tipo,
      Ingreso: new Date(v.horaIngreso).toLocaleString("es-AR"),
      Salida: v.horaSalida ? new Date(v.horaSalida).toLocaleString("es-AR") : "-",
      "Duración": fmtDur(((v.horaSalida || now) - v.horaIngreso) / 60000) + (v.horaSalida ? "" : " (en curso)"),
      Monto: v.monto ?? "",
      Estado: v.estado === "dentro" ? "Dentro" : "Afuera",
    }));
    downloadXLSX(`historial-vehiculos-${dayKey(now)}.xlsx`, { Historial: rows });
  };

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-2.5">
        <p style={{ fontFamily: "var(--font-display)" }} className="font-bold text-sm">
          Historial de vehículos
        </p>
        <button
          onClick={exportar}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
          style={{ background: "var(--surface2)", color: "var(--text)" }}
        >
          <Download size={13} /> Exportar .xlsx
        </button>
      </div>

      <div className="relative mb-2.5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar patente…"
          className="w-full pl-8 pr-3 py-2 rounded-lg outline-none text-xs"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState Icon={Clock3} text="Todavía no hay registros que coincidan." />
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="max-h-72 overflow-y-auto">
            {filtered.map((v, i) => {
              const Icon = TIPOS.find((t) => t.id === v.tipo)?.Icon || Car;
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between px-3 py-2.5"
                  style={{ background: "var(--surface)", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={14} style={{ color: "var(--muted)" }} />
                    <div>
                      <p style={{ fontFamily: "var(--font-display)" }} className="text-xs font-semibold tracking-wide">
                        {v.patente}
                      </p>
                      <p style={{ color: "var(--muted)" }} className="text-[10px]">
                        {fmtDateShort(v.horaIngreso)} {fmtTime(v.horaIngreso)}
                        {v.horaSalida ? ` → ${fmtTime(v.horaSalida)}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {v.estado === "dentro" ? (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "var(--accent2)", color: "#08210F" }}
                      >
                        Dentro
                      </span>
                    ) : (
                      <p style={{ fontFamily: "var(--font-display)" }} className="text-xs font-bold">
                        {fmtMoney(v.monto)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function computeCortes(vehicles, now) {
  const salidas = vehicles.filter((v) => v.estado === "afuera" && v.horaSalida);
  const sum = (fromTs) => salidas.filter((v) => v.horaSalida >= fromTs).reduce((a, v) => a + (v.monto || 0), 0);
  const hoyStart = startOfDay(now);
  return {
    hoy: sum(hoyStart),
    semanal: sum(now - 7 * 24 * 3600 * 1000),
    quincenal: sum(now - 15 * 24 * 3600 * 1000),
    mensual: sum(now - 30 * 24 * 3600 * 1000),
  };
}

function movimientosPorHora(vehicles, now) {
  const dayStart = startOfDay(now);
  const horaActual = new Date(now).getHours();
  const arr = Array.from({ length: horaActual + 1 }, (_, h) => ({ hora: `${h}h`, ingresos: 0, egresos: 0, ocupacion: 0 }));
  vehicles.forEach((v) => {
    if (v.horaIngreso >= dayStart) {
      const h = new Date(v.horaIngreso).getHours();
      if (arr[h]) arr[h].ingresos++;
    }
    if (v.horaSalida && v.horaSalida >= dayStart) {
      const h = new Date(v.horaSalida).getHours();
      if (arr[h]) arr[h].egresos++;
    }
  });
  for (let h = 0; h <= horaActual; h++) {
    const t = dayStart + h * 3600000;
    arr[h].ocupacion = vehicles.filter((v) => v.horaIngreso <= t && (v.horaSalida ? v.horaSalida > t : true)).length;
  }
  return arr;
}

function movimientosPorDia(vehicles, now, dias) {
  const start = startOfDay(now) - (dias - 1) * 24 * 3600 * 1000;
  const buckets = {};
  const order = [];
  for (let i = 0; i < dias; i++) {
    const t = start + i * 24 * 3600 * 1000;
    const k = dayKey(t);
    buckets[k] = { fecha: fmtDateShort(t), ts: t, ingresos: 0, egresos: 0, recaudado: 0, picoOcupacion: 0 };
    order.push(k);
  }
  vehicles.forEach((v) => {
    const kin = dayKey(v.horaIngreso);
    if (buckets[kin]) buckets[kin].ingresos++;
    if (v.horaSalida) {
      const kout = dayKey(v.horaSalida);
      if (buckets[kout]) {
        buckets[kout].egresos++;
        buckets[kout].recaudado += v.monto || 0;
      }
    }
  });
  order.forEach((k) => {
    const dayStart = buckets[k].ts;
    let max = 0;
    for (let h = 0; h < 24; h += 2) {
      const t = dayStart + h * 3600000;
      if (t > now) break;
      const c = vehicles.filter((v) => v.horaIngreso <= t && (v.horaSalida ? v.horaSalida > t : true)).length;
      if (c > max) max = c;
    }
    buckets[k].picoOcupacion = max;
  });
  return order.map((k) => buckets[k]);
}

/* ------------------------------------------------------------------ */
/* Config                                                               */
/* ------------------------------------------------------------------ */

function ConfigTab({ config, onSave, onResetDemo, onBorrarTodo }) {
  const [local, setLocal] = useState(config);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [saved, setSaved] = useState(false);

  const setRate = (key, val) => setLocal({ ...local, rates: { ...local.rates, [key]: Number(val) || 0 } });
  const setUmbral = (key, val) => setLocal({ ...local, umbrales: { ...local.umbrales, [key]: Number(val) || 0 } });

  const save = () => {
    onSave(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div>
      <SectionTitle icon={Settings2} title="Configuración" subtitle="Espacios y tarifas" />

      <div className="space-y-5">
        <ConfigField label="Nombre del estacionamiento">
          <input
            value={local.nombre}
            onChange={(e) => setLocal({ ...local, nombre: e.target.value })}
            className="input-field"
          />
        </ConfigField>

        <ConfigField label="Capacidad total (espacios)">
          <input
            type="number"
            value={local.totalEspacios}
            onChange={(e) => setLocal({ ...local, totalEspacios: Number(e.target.value) || 0 })}
            className="input-field"
          />
        </ConfigField>

        <div>
          <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-2">Tarifas</p>
          <div className="grid grid-cols-2 gap-2.5">
            <RateField label="Media hora" value={local.rates.mediaHora} onChange={(v) => setRate("mediaHora", v)} />
            <RateField label="Hora" value={local.rates.hora} onChange={(v) => setRate("hora", v)} />
            <RateField label="Media estadía" value={local.rates.mediaEstadia} onChange={(v) => setRate("mediaEstadia", v)} />
            <RateField label="Estadía completa" value={local.rates.estadiaCompleta} onChange={(v) => setRate("estadiaCompleta", v)} />
            <RateField label="Semanal" value={local.rates.semanal} onChange={(v) => setRate("semanal", v)} />
            <RateField label="Mensual" value={local.rates.mensual} onChange={(v) => setRate("mensual", v)} />
          </div>
        </div>

        <div>
          <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-2">Umbrales de tramo</p>
          <div className="grid grid-cols-2 gap-2.5">
            <RateField label="Media estadía desde (hs)" value={local.umbrales.mediaEstadiaHoras} onChange={(v) => setUmbral("mediaEstadiaHoras", v)} suffix="hs" />
            <RateField label="Estadía completa desde (hs)" value={local.umbrales.estadiaCompletaHoras} onChange={(v) => setUmbral("estadiaCompletaHoras", v)} suffix="hs" />
          </div>
        </div>

        <button
          onClick={save}
          className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
          style={{ background: saved ? "var(--accent2)" : "var(--accent)", color: "#1A1300" }}
        >
          {saved ? <Check size={17} /> : null} {saved ? "Guardado" : "Guardar cambios"}
        </button>

        <div className="pt-4 mt-2 space-y-2.5" style={{ borderTop: "1px solid var(--border)" }}>
          <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide">Zona de riesgo</p>

          {confirmBorrar ? (
            <div className="flex gap-2">
              <button onClick={() => { onBorrarTodo(); setConfirmBorrar(false); }} className="flex-1 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "var(--danger)", color: "#fff" }}>
                Confirmar borrado
              </button>
              <button onClick={() => setConfirmBorrar(false)} className="px-4 py-2.5 rounded-lg text-sm" style={{ background: "var(--surface2)", color: "var(--muted)" }}>Cancelar</button>
            </div>
          ) : (
            <button onClick={() => setConfirmBorrar(true)} className="w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2" style={{ background: "var(--surface)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
              <Trash2 size={15} /> Borrar historial de vehículos
            </button>
          )}

          {confirmReset ? (
            <div className="flex gap-2">
              <button onClick={() => { onResetDemo(); setConfirmReset(false); }} className="flex-1 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "var(--surface2)", color: "var(--text)" }}>
                Confirmar reinicio total
              </button>
              <button onClick={() => setConfirmReset(false)} className="px-4 py-2.5 rounded-lg text-sm" style={{ background: "var(--surface2)", color: "var(--muted)" }}>Cancelar</button>
            </div>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)" }}>
              <RotateCcw size={15} /> Restablecer configuración por defecto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

