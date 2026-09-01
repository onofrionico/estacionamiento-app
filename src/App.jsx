import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import {
  AlertTriangle, ParkingSquare
} from "lucide-react";
import { storage } from "./storage";
import { supabase } from "./supabaseClient";
import { DEFAULT_CONFIG, TIPOS } from "./constants";
import {
  fmtMoney,
} from "./lib/format";
import { signOut, fetchProfile, TABS_POR_ROL, ROLES } from "./lib/auth";
import RootStyles from "./components/RootStyles";
import { TopBar, BottomNav } from "./components/Nav";
import LoginScreen from "./components/LoginScreen";
import Ticket from "./components/Ticket";

const EntradaTab = lazy(() => import("./components/EntradaTab"));
const SalidaTab = lazy(() => import("./components/SalidaTab"));
const EstadoTab = lazy(() => import("./components/EstadoTab"));
const ReportesTab = lazy(() => import("./components/ReportesTab"));
const ConfigTab = lazy(() => import("./components/ConfigTab"));

/** Combina la config guardada con los defaults, tarifa por tipo incluida. */
function mergeConfig(config) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    rates: TIPOS.reduce((acc, { id }) => {
      acc[id] = { ...DEFAULT_CONFIG.rates[id], ...(config?.rates?.[id] || {}) };
      return acc;
    }, {}),
    umbrales: { ...DEFAULT_CONFIG.umbrales, ...(config?.umbrales || {}) },
  };
}

function LoadingScreen({ text }) {
  return (
    <div style={{ background: "var(--bg)" }} className="min-h-screen flex items-center justify-center">
      <RootStyles />
      <div className="text-center">
        <ParkingSquare className="animate-pulse mx-auto mb-3" size={40} style={{ color: "var(--accent)" }} />
        <p style={{ color: "var(--muted)" }} className="text-sm">{text}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = todavía no se chequeó
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [vehicles, setVehicles] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [tab, setTab] = useState("entrada");
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [printJob, setPrintJob] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    fetchProfile(session.user.id)
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
  }, [session]);

  useEffect(() => {
    if (!session) {
      setVehicles([]);
      setConfig(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const [vehiclesRes, configRes] = await Promise.all([
          storage.getVehicles(),
          storage.getConfig(),
        ]);
        setVehicles(vehiclesRes);
        if (configRes) {
          setConfig(mergeConfig(configRes));
        } else {
          setConfig(DEFAULT_CONFIG);
          await storage.setConfig(DEFAULT_CONFIG);
        }
      } catch (e) {
        setVehicles([]);
        setConfig(DEFAULT_CONFIG);
      } finally {
        setLoading(false);
      }
    })();
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session || loading) return;
    const unsubscribe = storage.subscribeToChanges({
      onVehicleChange: ({ eventType, vehicle }) => {
        setVehicles((prev) => {
          if (eventType === "DELETE") {
            return prev.filter((v) => v.id !== vehicle.id);
          }
          const idx = prev.findIndex((v) => v.id === vehicle.id);
          if (idx === -1) return [vehicle, ...prev];
          const next = [...prev];
          next[idx] = vehicle;
          return next;
        });
      },
      onConfigChange: (configRow) => setConfig(mergeConfig(configRow)),
    });
    return unsubscribe;
  }, [session?.user?.id, loading]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  if (session === undefined || (session && profileLoading)) {
    return <LoadingScreen text="Cargando…" />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (!profile) {
    return (
      <div style={{ background: "var(--bg)" }} className="min-h-screen flex items-center justify-center px-6">
        <RootStyles />
        <div className="text-center">
          <AlertTriangle className="mx-auto mb-3" size={32} style={{ color: "var(--danger)" }} />
          <p className="text-sm mb-4">No se encontró tu perfil de usuario. Pedile a un administrador que revise tu cuenta.</p>
          <button onClick={() => signOut()} className="px-4 py-2 rounded-lg text-xs font-semibold" style={{ background: "var(--surface2)", color: "var(--text)" }}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  if (loading || !config) {
    return <LoadingScreen text="Cargando estacionamiento…" />;
  }

  const role = profile.role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.USUARIO;
  const allowedTabs = TABS_POR_ROL[role];
  const activeTab = allowedTabs.includes(tab) ? tab : allowedTabs[0];

  const vehiculosDentro = vehicles.filter((v) => v.estado === "dentro");
  const ocupados = vehiculosDentro.length;
  const disponibles = Math.max(0, config.totalEspacios - ocupados);
  const ocupacionPct = Math.min(100, Math.round((ocupados / Math.max(1, config.totalEspacios)) * 100));

  const imprimir = (tipo, vehicle) => {
    setPrintJob({ tipo, vehicle });
    requestAnimationFrame(() => window.print());
  };

  const registrarIngreso = async (patente, tipo) => {
    const pat = patente.trim().toUpperCase();
    if (!pat) {
      showToast("Ingresá una patente");
      return null;
    }
    if (vehiculosDentro.some((v) => v.patente === pat)) {
      showToast(`${pat} ya está registrado dentro`);
      return null;
    }
    if (disponibles <= 0) {
      showToast("No hay espacio disponible");
      return null;
    }
    const vehicle = {
      id: `${pat}-${Date.now()}`,
      patente: pat,
      tipo,
      horaIngreso: Date.now(),
      horaSalida: null,
      monto: null,
      estado: "dentro",
    };
    setVehicles((prev) => [vehicle, ...prev]);
    try {
      const inserted = await storage.insertVehicle(vehicle);
      const vehicleConTicket = { ...vehicle, numeroTicket: inserted.numeroTicket };
      setVehicles((prev) => prev.map((v) => (v.id === vehicle.id ? vehicleConTicket : v)));
      setSaveError(false);
      showToast(`Ingreso registrado: ${pat}`);
      if (config.imprimirIngreso) imprimir("ingreso", vehicleConTicket);
      return vehicleConTicket;
    } catch (e) {
      setVehicles((prev) => prev.filter((v) => v.id !== vehicle.id));
      if (e.code === "DUPLICATE_PATENTE") {
        showToast(`${pat} ya está registrado dentro`);
      } else {
        setSaveError(true);
      }
      return null;
    }
  };

  const registrarSalida = async (id, monto) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return null;
    const patch = { horaSalida: Date.now(), monto, estado: "afuera" };
    const vehicleActualizado = { ...v, ...patch };
    setVehicles((prev) => prev.map((x) => (x.id === id ? vehicleActualizado : x)));
    try {
      await storage.updateVehicle(id, patch);
      setSaveError(false);
      showToast(`Salida registrada: ${v.patente} · ${fmtMoney(monto)}`);
      if (config.imprimirEgreso) imprimir("egreso", vehicleActualizado);
      return vehicleActualizado;
    } catch (e) {
      setVehicles((prev) => prev.map((x) => (x.id === id ? v : x)));
      setSaveError(true);
      return null;
    }
  };

  const updateConfig = async (newConfig) => {
    const prevConfig = config;
    setConfig(newConfig);
    try {
      await storage.setConfig(newConfig);
      setSaveError(false);
    } catch (e) {
      setConfig(prevConfig);
      setSaveError(true);
    }
  };

  const resetDemo = async () => {
    setVehicles([]);
    setConfig(DEFAULT_CONFIG);
    try {
      await storage.deleteAllVehicles();
      await storage.setConfig(DEFAULT_CONFIG);
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
    showToast("Datos reiniciados");
  };

  const borrarTodo = async () => {
    setVehicles([]);
    try {
      await storage.deleteAllVehicles();
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
    showToast("Historial borrado");
  };

  return (
    <div style={{ background: "var(--bg)", color: "var(--text)" }} className="min-h-screen flex flex-col font-sans">
      <RootStyles />
      <TopBar
        config={config}
        ocupados={ocupados}
        disponibles={disponibles}
        ocupacionPct={ocupacionPct}
        userEmail={profile.email}
        onLogout={signOut}
      />

      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-4 max-w-md w-full mx-auto">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20">
              <ParkingSquare className="animate-pulse" size={32} style={{ color: "var(--accent)" }} />
            </div>
          }
        >
          {activeTab === "entrada" && (
            <EntradaTab onRegistrar={registrarIngreso} disponibles={disponibles} onReimprimir={imprimir} />
          )}
          {activeTab === "salida" && (
            <SalidaTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              rates={config.rates}
              umbrales={config.umbrales}
              onSalida={registrarSalida}
              onReimprimir={imprimir}
            />
          )}
          {activeTab === "estado" && (
            <EstadoTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              totalEspacios={config.totalEspacios}
              disponibles={disponibles}
              onReimprimir={imprimir}
            />
          )}
          {activeTab === "reportes" && (
            <ReportesTab vehicles={vehicles} now={now} />
          )}
          {activeTab === "config" && (
            <ConfigTab
              config={config}
              onSave={updateConfig}
              onResetDemo={resetDemo}
              onBorrarTodo={borrarTodo}
              currentUserId={profile.id}
            />
          )}
        </Suspense>
      </main>

      <BottomNav tab={activeTab} setTab={setTab} disponibles={disponibles} role={role} />

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

      <div id="ticket-print">
        <Ticket config={config} job={printJob} />
      </div>
    </div>
  );
}
