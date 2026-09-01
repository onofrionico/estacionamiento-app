import React, { useState } from "react";
import { Settings2, Check, RotateCcw, Trash2 } from "lucide-react";
import { TIPOS } from "../constants";
import { slugify } from "../lib/format";
import { SectionTitle, ConfigField, RateField } from "./ui";
import UserManagement from "./UserManagement";
import { storage } from "../storage";

/* ------------------------------------------------------------------ */
/* Config                                                               */
/* ------------------------------------------------------------------ */

export default function ConfigTab({ config, onSave, onResetDemo, onBorrarTodo, currentUserId, mediosPago, onSaveMedioPago }) {
  const [local, setLocal] = useState(config);
  const [tipoActivo, setTipoActivo] = useState(TIPOS[0].id);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [nuevoMedioPago, setNuevoMedioPago] = useState("");
  const [medioPagoError, setMedioPagoError] = useState("");

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setLogoError("");
    try {
      const url = await storage.uploadLogo(file);
      setLocal((prev) => ({ ...prev, logoUrl: url }));
    } catch (err) {
      console.error(err);
      setLogoError("No se pudo subir el logo.");
    } finally {
      setUploadingLogo(false);
    }
  };

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

  const agregarMedioPago = () => {
    const nombre = nuevoMedioPago.trim();
    if (!nombre) {
      setMedioPagoError("Ingresá un nombre.");
      return;
    }
    const yaExiste = mediosPago.some((m) => m.nombre.trim().toLowerCase() === nombre.toLowerCase());
    if (yaExiste) {
      setMedioPagoError(`Ya existe un medio de pago llamado "${nombre}".`);
      return;
    }
    const base = slugify(nombre) || `medio-${Date.now()}`;
    const id = mediosPago.some((m) => m.id === base) ? `${base}-${Date.now()}` : base;
    onSaveMedioPago({ id, nombre, activo: true });
    setNuevoMedioPago("");
    setMedioPagoError("");
  };

  const toggleMedioPago = (medio) => onSaveMedioPago({ ...medio, activo: !medio.activo });

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

        <ConfigField label="Dirección (para el ticket, opcional)">
          <input
            value={local.direccion || ""}
            onChange={(e) => setLocal({ ...local, direccion: e.target.value })}
            className="input-field"
          />
        </ConfigField>

        <ConfigField label="Teléfono (para el ticket, opcional)">
          <input
            value={local.telefono || ""}
            onChange={(e) => setLocal({ ...local, telefono: e.target.value })}
            className="input-field"
          />
        </ConfigField>

        <ConfigField label="Logo (para el ticket, opcional)">
          <div className="flex items-center gap-3">
            {local.logoUrl && (
              <img
                src={local.logoUrl}
                alt="Logo"
                className="w-12 h-12 object-contain rounded-lg"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              />
            )}
            <input type="file" accept="image/*" onChange={handleLogoChange} className="text-xs" disabled={uploadingLogo} />
          </div>
          {uploadingLogo && <p style={{ color: "var(--muted)" }} className="text-xs mt-1">Subiendo…</p>}
          {logoError && <p style={{ color: "var(--danger)" }} className="text-xs mt-1">{logoError}</p>}
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
            <RateField label="Tolerancia antes de cobrar el tramo siguiente" value={local.umbrales.toleranciaMin} onChange={(v) => setUmbral("toleranciaMin", v)} suffix="min" />
          </div>
        </div>

        <div>
          <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-2">Medios de pago</p>
          <div className="space-y-2 mb-2.5">
            {mediosPago.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg px-3 py-2.5"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <span className="text-sm">{m.nombre}</span>
                <button
                  type="button"
                  onClick={() => toggleMedioPago(m)}
                  className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{
                    background: m.activo ? "var(--accent2)" : "var(--surface2)",
                    color: m.activo ? "#08210F" : "var(--muted)",
                  }}
                >
                  {m.activo ? "Activo" : "Inactivo"}
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={nuevoMedioPago}
              onChange={(e) => {
                setNuevoMedioPago(e.target.value);
                setMedioPagoError("");
              }}
              placeholder="Nuevo medio de pago"
              className="input-field flex-1"
            />
            <button
              type="button"
              onClick={agregarMedioPago}
              className="px-4 rounded-lg text-sm font-semibold"
              style={{ background: "var(--surface2)", color: "var(--text)" }}
            >
              Agregar
            </button>
          </div>
          {medioPagoError && <p style={{ color: "var(--danger)" }} className="text-xs mt-1">{medioPagoError}</p>}
        </div>

        <div>
          <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-2">Impresión de tickets</p>
          <label className="flex items-center gap-2.5 py-2">
            <input
              type="checkbox"
              checked={!!local.imprimirIngreso}
              onChange={(e) => setLocal({ ...local, imprimirIngreso: e.target.checked })}
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="text-sm">Imprimir automáticamente al ingreso</span>
          </label>
          <label className="flex items-center gap-2.5 py-2">
            <input
              type="checkbox"
              checked={!!local.imprimirEgreso}
              onChange={(e) => setLocal({ ...local, imprimirEgreso: e.target.checked })}
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="text-sm">Imprimir automáticamente al egreso</span>
          </label>
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

        <UserManagement currentUserId={currentUserId} />
      </div>
    </div>
  );
}
