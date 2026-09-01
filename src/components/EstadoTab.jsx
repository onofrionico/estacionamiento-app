import React from "react";
import { Gauge, ParkingSquare, Car, Printer } from "lucide-react";
import { TIPOS } from "../constants";
import { fmtTime, fmtDur } from "../lib/format";
import { SectionTitle, StatCard, EmptyState } from "./ui";

/* ------------------------------------------------------------------ */
/* Estado                                                               */
/* ------------------------------------------------------------------ */

export default function EstadoTab({ vehiculosDentro, now, totalEspacios, disponibles, onReimprimir }) {
  return (
    <div>
      <SectionTitle icon={Gauge} title="Estado del estacionamiento" subtitle="Ocupación en tiempo real" />

      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <StatCard label="Ocupados" value={vehiculosDentro.length} color="var(--accent)" />
        <StatCard label="Libres" value={disponibles} color="var(--accent2)" />
        <StatCard label="Total" value={totalEspacios} color="var(--text)" />
      </div>

      {vehiculosDentro.length === 0 ? (
        <EmptyState Icon={ParkingSquare} text="El estacionamiento está vacío por ahora." />
      ) : (
        <div className="space-y-2">
          {vehiculosDentro
            .sort((a, b) => a.horaIngreso - b.horaIngreso)
            .map((v) => {
              const Icon = TIPOS.find((t) => t.id === v.tipo)?.Icon || Car;
              const minutos = (now - v.horaIngreso) / 60000;
              return (
                <div key={v.id} className="flex items-center justify-between rounded-lg px-3.5 py-2.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2.5">
                    <Icon size={16} style={{ color: "var(--muted)" }} />
                    <span style={{ fontFamily: "var(--font-display)" }} className="font-semibold text-sm tracking-wide">{v.patente}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span style={{ color: "var(--muted)" }} className="text-xs">desde {fmtTime(v.horaIngreso)} · {fmtDur(minutos)}</span>
                    <button
                      onClick={() => onReimprimir("ingreso", v)}
                      aria-label={`Reimprimir ticket de ${v.patente}`}
                      className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                      style={{ background: "var(--surface2)" }}
                    >
                      <Printer size={13} style={{ color: "var(--muted)" }} />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
