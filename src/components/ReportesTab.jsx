import { useState, useMemo } from "react";
import { Car, BarChart3, Search, Clock3, Download, Trash2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { TIPOS } from "../constants";
import {
  fmtMoney, fmtDur, fmtTime, fmtDateShort,
  downloadXLSX, dayKey, startOfDay,
} from "../lib/format";
import {
  SectionTitle, CorteCard, ChartCard, EmptyState,
} from "./ui";

/* ------------------------------------------------------------------ */
/* Reportes                                                             */
/* ------------------------------------------------------------------ */

const PERIODOS = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Semana" },
  { id: "quincena", label: "Quincena" },
  { id: "mes", label: "Mes" },
];

export default function ReportesTab({ vehicles, now, onEliminar }) {
  const [periodo, setPeriodo] = useState("hoy"); // hoy | semana | quincena | mes
  const [fechaDesde, setFechaDesde] = useState(dayKey(now - 29 * 24 * 3600 * 1000));
  const [fechaHasta, setFechaHasta] = useState(dayKey(now));

  const cortes = useMemo(() => computeCortes(vehicles, now), [vehicles, now]);

  const desglosePorMedioPago = useMemo(
    () => montosPorMedioPago(vehicles, periodoFromTs(periodo, now)),
    [vehicles, periodo, now]
  );

  const chartData = useMemo(() => {
    if (periodo === "hoy") return movimientosPorHora(vehicles, now);
    const dias = periodo === "semana" ? 7 : periodo === "quincena" ? 15 : 30;
    return movimientosPorDia(vehicles, now, dias);
  }, [vehicles, periodo, now]);

  const xKey = periodo === "hoy" ? "hora" : "fecha";
  const scrollable = periodo === "hoy";
  const chartWidth = Math.max(chartData.length * 44, 320);

  const exportarReporte = () => {
    const desdeTs = startOfDay(new Date(`${fechaDesde}T00:00:00`));
    const hastaTsRaw = startOfDay(new Date(`${fechaHasta}T00:00:00`));
    const hastaTs = Math.max(hastaTsRaw, desdeTs) + 24 * 3600 * 1000 - 1;

    const resumenRows = [
      { Período: "Hoy", Recaudado: cortes.hoy },
      { Período: "Últimos 7 días", Recaudado: cortes.semanal },
      { Período: "Últimos 15 días", Recaudado: cortes.quincenal },
      { Período: "Últimos 30 días", Recaudado: cortes.mensual },
    ];

    const ingresosRows = vehicles
      .filter((v) => v.horaIngreso >= desdeTs && v.horaIngreso <= hastaTs)
      .sort((a, b) => a.horaIngreso - b.horaIngreso)
      .map((v) => ({
        Patente: v.patente,
        Tipo: TIPOS.find((t) => t.id === v.tipo)?.label || v.tipo,
        Fecha: fmtDateShort(v.horaIngreso),
        Hora: fmtTime(v.horaIngreso),
      }));

    const egresosRows = vehicles
      .filter((v) => v.horaSalida && v.horaSalida >= desdeTs && v.horaSalida <= hastaTs)
      .sort((a, b) => a.horaSalida - b.horaSalida)
      .map((v) => ({
        Patente: v.patente,
        Tipo: TIPOS.find((t) => t.id === v.tipo)?.label || v.tipo,
        "Fecha ingreso": fmtDateShort(v.horaIngreso),
        "Hora ingreso": fmtTime(v.horaIngreso),
        "Fecha salida": fmtDateShort(v.horaSalida),
        "Hora salida": fmtTime(v.horaSalida),
        "Duración": fmtDur((v.horaSalida - v.horaIngreso) / 60000),
        Monto: v.monto ?? "",
        "Medio de pago": v.medioPago || "",
      }));

    downloadXLSX(`reporte-estacionamiento-${fechaDesde}_a_${fechaHasta}.xlsx`, {
      Resumen: resumenRows,
      Ingresos: ingresosRows,
      "Egresos y pagos": egresosRows,
    });
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

      <div className="rounded-xl p-3 mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <p style={{ color: "var(--muted)" }} className="text-xs font-semibold mb-2">Exportar registros por rango de fecha</p>
        <div className="flex gap-2 mb-2.5">
          <div className="flex-1">
            <label style={{ color: "var(--muted)" }} className="text-[10px] block mb-1">Desde</label>
            <input
              type="date"
              value={fechaDesde}
              max={fechaHasta}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg outline-none text-xs"
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
          <div className="flex-1">
            <label style={{ color: "var(--muted)" }} className="text-[10px] block mb-1">Hasta</label>
            <input
              type="date"
              value={fechaHasta}
              min={fechaDesde}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg outline-none text-xs"
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
        </div>
        <button
          onClick={exportarReporte}
          className="w-full py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
          style={{ background: "var(--accent)", border: "1px solid var(--accent)", color: "#1A1300" }}
        >
          <Download size={14} /> Exportar ingresos, egresos y pagos (.xlsx)
        </button>
      </div>

      <div className="flex gap-1.5 mb-4">
        {PERIODOS.map((p) => (
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

      {desglosePorMedioPago.length > 0 && (
        <div className="rounded-xl p-3.5 mb-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p style={{ color: "var(--muted)" }} className="text-xs font-semibold mb-2">
            Recaudación por medio de pago — {PERIODOS.find((p) => p.id === periodo)?.label}
          </p>
          <div className="space-y-1.5">
            {desglosePorMedioPago.map((d) => (
              <div key={d.nombre} className="flex items-center justify-between text-sm">
                <span>{d.nombre}</span>
                <span style={{ fontFamily: "var(--font-display)" }} className="font-semibold">
                  {fmtMoney(d.monto)}
                </span>
              </div>
            ))}
          </div>
          <div
            className="flex items-center justify-between text-sm mt-2 pt-2"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <span className="font-semibold">Total</span>
            <span style={{ fontFamily: "var(--font-display)" }} className="font-bold">
              {fmtMoney(desglosePorMedioPago.reduce((a, d) => a + d.monto, 0))}
            </span>
          </div>
        </div>
      )}

      <ChartCard title="Ingresos y egresos">
        <div className={scrollable ? "overflow-x-auto" : ""}>
          <div style={{ width: scrollable ? chartWidth : "100%" }}>
            <ResponsiveContainer width={scrollable ? chartWidth : "100%"} height={200}>
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
          </div>
        </div>
      </ChartCard>

      <ChartCard title={periodo === "hoy" ? "Ocupación por hora" : "Ocupación pico por día"}>
        <div className={scrollable ? "overflow-x-auto" : ""}>
          <div style={{ width: scrollable ? chartWidth : "100%" }}>
            <ResponsiveContainer width={scrollable ? chartWidth : "100%"} height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "var(--text)" }} />
                <Bar dataKey={periodo === "hoy" ? "ocupacion" : "picoOcupacion"} name="Ocupación" fill="#5B8DEF" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </ChartCard>

      <HistorialSection vehicles={vehicles} now={now} onEliminar={onEliminar} />
    </div>
  );
}

function HistorialSection({ vehicles, now, onEliminar }) {
  const [q, setQ] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
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
      "Medio de pago": v.medioPago || "",
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
              const confirming = confirmDeleteId === v.id;
              return (
                <div
                  key={v.id}
                  className="px-3 py-2.5"
                  style={{ background: "var(--surface)", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
                >
                  <div className="flex items-center justify-between">
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
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        {v.estado === "dentro" ? (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "var(--accent2)", color: "#08210F" }}
                          >
                            Dentro
                          </span>
                        ) : (
                          <>
                            <p style={{ fontFamily: "var(--font-display)" }} className="text-xs font-bold">
                              {fmtMoney(v.monto)}
                            </p>
                            {v.medioPago && (
                              <p style={{ color: "var(--muted)" }} className="text-[10px]">{v.medioPago}</p>
                            )}
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(v.id)}
                        className="p-1.5 rounded-lg"
                        style={{ color: "var(--muted)" }}
                        aria-label="Borrar registro"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {confirming && (
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => { onEliminar(v.id); setConfirmDeleteId(null); }}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold"
                        style={{ background: "var(--danger)", color: "#fff" }}
                      >
                        Confirmar borrado
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-3 py-2 rounded-lg text-xs"
                        style={{ background: "var(--surface2)", color: "var(--muted)" }}
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
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
  const arr = Array.from({ length: 24 }, (_, h) => ({ hora: `${h}h`, ingresos: 0, egresos: 0, ocupacion: 0 }));
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

/** Resuelve el timestamp "desde" para un id de período (mismos umbrales que computeCortes). */
function periodoFromTs(periodo, now) {
  if (periodo === "hoy") return startOfDay(now);
  const dias = periodo === "semana" ? 7 : periodo === "quincena" ? 15 : 30;
  return now - dias * 24 * 3600 * 1000;
}

/** Recaudación agrupada por medio de pago desde fromTs. Sin medio cargado -> "Sin especificar". */
function montosPorMedioPago(vehicles, fromTs) {
  const salidas = vehicles.filter((v) => v.estado === "afuera" && v.horaSalida && v.horaSalida >= fromTs);
  const totales = new Map();
  salidas.forEach((v) => {
    const nombre = v.medioPago || "Sin especificar";
    totales.set(nombre, (totales.get(nombre) || 0) + (v.monto || 0));
  });
  return [...totales.entries()]
    .map(([nombre, monto]) => ({ nombre, monto }))
    .sort((a, b) => b.monto - a.monto);
}
