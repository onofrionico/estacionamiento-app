import React, { useState } from "react";
import { Settings2, Check, RotateCcw, Trash2 } from "lucide-react";
import { TIPOS } from "../constants";
import { SectionTitle, ConfigField, RateField } from "./ui";

/* ------------------------------------------------------------------ */
/* Config                                                               */
/* ------------------------------------------------------------------ */

export default function ConfigTab({ config, onSave, onResetDemo, onBorrarTodo }) {
  const [local, setLocal] = useState(config);
  const [tipoActivo, setTipoActivo] = useState(TIPOS[0].id);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [saved, setSaved] = useState(false);

  const setRate = (key, val) =>
    setLocal({
      ...local,
      rates: {
        ...local.rates,
        [tipoActivo]: { ...local.rates[tipoActivo], [key]: Number(val) || 0 },
      },
    });
  const setUmbral = (key, val) => setLocal({ ...local, umbrales: { ...local.umbrales, [key]: Number(val) || 0 } });

  const rates = local.rates[tipoActivo];

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
          <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-2">Tarifas por tipo de vehículo</p>

          <div className="grid grid-cols-3 gap-2 mb-3">
            {TIPOS.map(({ id, label, Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() => setTipoActivo(id)}
                className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl transition"
                style={{
                  background: tipoActivo === id ? "var(--accent)" : "var(--surface)",
                  color: tipoActivo === id ? "#1A1300" : "var(--text)",
                  border: `1px solid ${tipoActivo === id ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                <Icon size={18} />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <RateField label="Media hora" value={rates.mediaHora} onChange={(v) => setRate("mediaHora", v)} />
            <RateField label="Hora" value={rates.hora} onChange={(v) => setRate("hora", v)} />
            <RateField label="Media estadía" value={rates.mediaEstadia} onChange={(v) => setRate("mediaEstadia", v)} />
            <RateField label="Estadía completa" value={rates.estadiaCompleta} onChange={(v) => setRate("estadiaCompleta", v)} />
            <RateField label="Semanal" value={rates.semanal} onChange={(v) => setRate("semanal", v)} />
            <RateField label="Mensual" value={rates.mensual} onChange={(v) => setRate("mensual", v)} />
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
