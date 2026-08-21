import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  AlertTriangle, ParkingSquare
} from "lucide-react";
import { storage } from "./storage";
import { STORAGE_KEY, DEFAULT_CONFIG, DEFAULT_DATA } from "./constants";
import {
  fmtMoney, calcularMonto,
} from "./lib/format";
import RootStyles from "./components/RootStyles";
import { TopBar, BottomNav } from "./components/Nav";
import EntradaTab from "./components/EntradaTab";
import SalidaTab from "./components/SalidaTab";
import EstadoTab from "./components/EstadoTab";
import ReportesTab from "./components/ReportesTab";
import ConfigTab from "./components/ConfigTab";

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


