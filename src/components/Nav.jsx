import React, { useState, useEffect } from "react";
import { LogIn, LogOut, Gauge, BarChart3, Settings2, Power } from "lucide-react";
import { TABS_POR_ROL } from "../lib/auth";

/* ------------------------------------------------------------------ */
/* Top bar + bottom nav                                                */
/* ------------------------------------------------------------------ */

export function TopBar({ config, ocupados, disponibles, ocupacionPct, userEmail, onLogout }) {
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);
  return (
    <header style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }} className="sticky top-0 z-40">
      <div className="max-w-md mx-auto px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontFamily: "var(--font-display)" }} className="text-lg font-bold leading-tight tracking-tight">
              {config.nombre}
            </h1>
            <p style={{ color: "var(--muted)" }} className="text-xs mt-0.5">
              {clock.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "short" })} · {clock.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <div className="text-right">
            <div style={{ fontFamily: "var(--font-display)", color: disponibles === 0 ? "var(--danger)" : "var(--accent2)" }} className="text-2xl font-bold leading-none">
              {disponibles}
            </div>
            <p style={{ color: "var(--muted)" }} className="text-[10px] uppercase tracking-wide mt-0.5">
              libres / {config.totalEspacios}
            </p>
          </div>
        </div>
        {/* barrera indicator */}
        <div className="mt-3 h-1.5 w-full rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${ocupacionPct}%`,
              background: ocupacionPct >= 90 ? "var(--danger)" : ocupacionPct >= 70 ? "var(--accent)" : "var(--accent2)",
            }}
          />
        </div>
        {userEmail && (
          <div className="mt-3 flex items-center justify-between">
            <p style={{ color: "var(--muted)" }} className="text-[11px] truncate">{userEmail}</p>
            <button
              onClick={onLogout}
              className="flex items-center gap-1 text-[11px] font-medium"
              style={{ color: "var(--muted)" }}
            >
              <Power size={12} /> Salir
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function BottomNav({ tab, setTab, disponibles, role }) {
  const allItems = [
    { id: "entrada", label: "Entrada", Icon: LogIn },
    { id: "salida", label: "Salida", Icon: LogOut },
    { id: "estado", label: "Estado", Icon: Gauge },
    { id: "reportes", label: "Reportes", Icon: BarChart3 },
    { id: "config", label: "Config", Icon: Settings2 },
  ];
  const allowed = TABS_POR_ROL[role] || TABS_POR_ROL.usuario;
  const items = allItems.filter((i) => allowed.includes(i.id));
  return (
    <nav
      style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}
      className="fixed bottom-0 left-0 right-0 z-40"
    >
      <div className="max-w-md mx-auto grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex flex-col items-center justify-center gap-1 py-2.5 relative"
              style={{ color: active ? "var(--accent)" : "var(--muted)" }}
            >
              <div className="relative">
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                {id === "estado" && disponibles === 0 && (
                  <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full" style={{ background: "var(--danger)" }} />
                )}
              </div>
              <span className="text-[10px] font-medium">{label}</span>
              {active && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full" style={{ background: "var(--accent)" }} />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
