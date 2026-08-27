import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import {
  AlertTriangle, ParkingSquare
} from "lucide-react";
import { storage } from "./storage";
import { supabase } from "./supabaseClient";
import { STORAGE_KEY, DEFAULT_CONFIG, DEFAULT_DATA, TIPOS } from "./constants";
import {
  fmtMoney, calcularMonto,
} from "./lib/format";
import { signOut, fetchProfile, TABS_POR_ROL, ROLES } from "./lib/auth";
import RootStyles from "./components/RootStyles";
import { TopBar, BottomNav } from "./components/Nav";
import LoginScreen from "./components/LoginScreen";

const EntradaTab = lazy(() => import("./components/EntradaTab"));
const SalidaTab = lazy(() => import("./components/SalidaTab"));
const EstadoTab = lazy(() => import("./components/EstadoTab"));
const ReportesTab = lazy(() => import("./components/ReportesTab"));
const ConfigTab = lazy(() => import("./components/ConfigTab"));

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

/** Combina las tarifas guardadas con las por defecto, migrando el formato
 * viejo (una única tarifa para todos los tipos) al formato por tipo. */
function mergeRates(savedRates) {
  const raw = savedRates || {};
  const isLegacyFlat = typeof raw.mediaHora === "number";
  return TIPOS.reduce((acc, { id }) => {
    const override = isLegacyFlat ? raw : raw[id] || {};
    acc[id] = { ...DEFAULT_CONFIG.rates[id], ...override };
    return acc;
  }, {});
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

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [tab, setTab] = useState("entrada");
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

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
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setData({
            config: { ...DEFAULT_CONFIG, ...parsed.config, rates: mergeRates(parsed.config?.rates), umbrales: { ...DEFAULT_CONFIG.umbrales, ...(parsed.config?.umbrales || {}) } },
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
  }, [session?.user?.id]);

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

  if (loading || !data) {
    return <LoadingScreen text="Cargando estacionamiento…" />;
  }

  const role = profile.role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.USUARIO;
  const allowedTabs = TABS_POR_ROL[role];
  const activeTab = allowedTabs.includes(tab) ? tab : allowedTabs[0];

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
    const rates = data.config.rates[v.tipo] || data.config.rates.auto;
    const monto = calcularMonto(minutos, rates, data.config.umbrales);
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
      <TopBar
        config={data.config}
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
            <EntradaTab onRegistrar={registrarIngreso} disponibles={disponibles} />
          )}
          {activeTab === "salida" && (
            <SalidaTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              rates={data.config.rates}
              umbrales={data.config.umbrales}
              onSalida={registrarSalida}
            />
          )}
          {activeTab === "estado" && (
            <EstadoTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              totalEspacios={data.config.totalEspacios}
              disponibles={disponibles}
            />
          )}
          {activeTab === "reportes" && (
            <ReportesTab vehicles={data.vehicles} now={now} />
          )}
          {activeTab === "config" && (
            <ConfigTab
              config={data.config}
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
    </div>
  );
}
