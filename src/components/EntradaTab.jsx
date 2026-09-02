import React, { useState } from "react";
import { LogIn, Check, Printer, AlertTriangle, X } from "lucide-react";
import { TIPOS } from "../constants";
import { suggestPatenteSuffix } from "../lib/format";
import { SectionTitle } from "./ui";

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

export default function EntradaTab({ onRegistrar, disponibles, onReimprimir, vehiculosDentro }) {
  const [patente, setPatente] = useState("");
  const [tipo, setTipo] = useState("auto");
  const [ultimoRegistro, setUltimoRegistro] = useState(null);
  const [colision, setColision] = useState(null); // { base, sugerida } | null

  const registrar = async (pat) => {
    const registrado = await onRegistrar(pat, tipo);
    if (registrado) setUltimoRegistro(registrado);
    setPatente("");
    setColision(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const pat = patente.trim().toUpperCase();
    if (!pat) return;
    const enUso = vehiculosDentro.some((v) => v.patente === pat);
    if (enUso) {
      setColision({ base: pat, sugerida: suggestPatenteSuffix(pat, vehiculosDentro) });
      return;
    }
    await registrar(pat);
  };

  const confirmarComoDistinto = () => {
    registrar(colision.sugerida);
  };

  return (
    <div>
      <SectionTitle icon={LogIn} title="Registrar ingreso" subtitle="Cargá la patente y confirmá" />

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-1.5 block">
            Patente
          </label>
          <input
            autoFocus
            value={patente}
            onChange={(e) => {
              setPatente(e.target.value.toUpperCase());
              setUltimoRegistro(null);
              setColision(null);
            }}
            placeholder="AB123CD"
            className="w-full text-2xl font-bold tracking-widest text-center py-4 rounded-xl outline-none"
            style={{
              background: "var(--surface)",
              border: "2px solid var(--border)",
              color: "var(--text)",
              fontFamily: "var(--font-display)",
            }}
            maxLength={8}
          />
        </div>

        {colision && (
          <div className="rounded-xl p-3.5 flex items-start gap-2.5" style={{ background: "var(--surface)", border: "1px solid var(--danger)" }}>
            <AlertTriangle size={18} style={{ color: "var(--danger)" }} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm mb-2.5">
                Ya hay un vehículo con patente <strong>{colision.base}</strong> registrado. ¿Es otro vehículo?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={confirmarComoDistinto}
                  className="flex-1 py-2.5 rounded-lg font-semibold text-sm"
                  style={{ background: "var(--accent2)", color: "#08210F" }}
                >
                  Registrar como {colision.sugerida}
                </button>
                <button
                  type="button"
                  onClick={() => setColision(null)}
                  className="px-4 py-2.5 rounded-lg text-sm"
                  style={{ background: "var(--surface2)", color: "var(--muted)" }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        <div>
          <label style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-1.5 block">
            Tipo de vehículo
          </label>
          <div className="grid grid-cols-3 gap-2">
            {TIPOS.map(({ id, label, Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() => setTipo(id)}
                className="flex flex-col items-center gap-1.5 py-3 rounded-xl transition"
                style={{
                  background: tipo === id ? "var(--accent)" : "var(--surface)",
                  color: tipo === id ? "#1A1300" : "var(--text)",
                  border: `1px solid ${tipo === id ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                <Icon size={20} />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={disponibles <= 0}
          className="w-full py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: "var(--accent2)", color: "#08210F" }}
        >
          <Check size={20} /> Registrar ingreso
        </button>
        {disponibles <= 0 && (
          <p className="text-center text-sm" style={{ color: "var(--danger)" }}>
            Estacionamiento completo — no hay espacio disponible.
          </p>
        )}
      </form>

      {ultimoRegistro && (
        <button
          type="button"
          onClick={() => onReimprimir("ingreso", ultimoRegistro)}
          className="w-full mt-3 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2"
          style={{ background: "var(--surface2)", color: "var(--text)" }}
        >
          <Printer size={16} /> Reimprimir ticket de {ultimoRegistro.patente}
        </button>
      )}
    </div>
  );
}
