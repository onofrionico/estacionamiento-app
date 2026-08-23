import React, { useState } from "react";
import { LogOut, Search, Clock3, Check, X, ChevronRight, Car } from "lucide-react";
import { TIPOS } from "../constants";
import { fmtMoney, fmtDur, fmtTime, calcularMonto, tramoLabel } from "../lib/format";
import { SectionTitle, EmptyState } from "./ui";

/* ------------------------------------------------------------------ */
/* Salida                                                               */
/* ------------------------------------------------------------------ */

export default function SalidaTab({ vehiculosDentro, now, rates, umbrales, onSalida }) {
  const [q, setQ] = useState("");
  const [confirmId, setConfirmId] = useState(null);

  const filtered = vehiculosDentro.filter((v) => v.patente.includes(q.toUpperCase()));

  return (
    <div>
      <SectionTitle icon={LogOut} title="Registrar salida" subtitle={`${vehiculosDentro.length} vehículo(s) dentro`} />

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar patente…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl outline-none text-sm"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          Icon={LogOut}
          text={vehiculosDentro.length === 0 ? "No hay vehículos dentro para dar salida." : "Ningún vehículo coincide con la búsqueda."}
        />
      ) : (
        <div className="space-y-2.5">
          {filtered
            .sort((a, b) => a.horaIngreso - b.horaIngreso)
            .map((v) => {
              const minutos = (now - v.horaIngreso) / 60000;
              const monto = calcularMonto(minutos, rates, umbrales);
              const Icon = TIPOS.find((t) => t.id === v.tipo)?.Icon || Car;
              const confirming = confirmId === v.id;
              return (
                <div key={v.id} className="rounded-xl p-3.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--surface2)" }}>
                        <Icon size={17} style={{ color: "var(--accent)" }} />
                      </div>
                      <div>
                        <p style={{ fontFamily: "var(--font-display)" }} className="font-bold tracking-wide text-sm">{v.patente}</p>
                        <p style={{ color: "var(--muted)" }} className="text-xs flex items-center gap-1">
                          <Clock3 size={11} /> {fmtTime(v.horaIngreso)} · {fmtDur(minutos)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p style={{ fontFamily: "var(--font-display)" }} className="font-bold text-sm">{fmtMoney(monto)}</p>
                      <p style={{ color: "var(--muted)" }} className="text-[10px]">{tramoLabel(minutos, umbrales)}</p>
                    </div>
                  </div>

                  {confirming ? (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => { onSalida(v.id); setConfirmId(null); }}
                        className="flex-1 py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-1.5"
                        style={{ background: "var(--accent2)", color: "#08210F" }}
                      >
                        <Check size={16} /> Confirmar cobro
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="px-4 py-2.5 rounded-lg font-medium text-sm"
                        style={{ background: "var(--surface2)", color: "var(--muted)" }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(v.id)}
                      className="w-full mt-3 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-1.5"
                      style={{ background: "var(--surface2)", color: "var(--text)" }}
                    >
                      Dar salida <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
