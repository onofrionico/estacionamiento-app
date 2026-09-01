# Desglose de recaudación por medio de pago en Reportes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en la pestaña Reportes cuánto se recaudó por cada medio de pago, para el mismo período que ya elige el selector Hoy/Semana/Quincena/Mes.

**Architecture:** Un único componente (`src/components/ReportesTab.jsx`) recibe una nueva tarjeta de desglose calculada con una función pura nueva (mismo patrón que `computeCortes`/`movimientosPorHora`, ya definidas al final de ese archivo), atada al `periodo` que ya vive en el estado del componente.

**Tech Stack:** React 18, Tailwind. Sin cambios de backend — el dato (`v.medioPago`) ya lo devuelve `storage.getVehicles()` desde la feature anterior de medios de pago.

**Ver también:** spec en `docs/superpowers/specs/2026-09-01-reportes-desglose-medio-pago-design.md`.

---

## Contexto de archivos relevantes (ya explorado)

- `src/components/ReportesTab.jsx` (390 líneas) — único archivo a tocar. Ya importa `fmtMoney` de `../lib/format` y `startOfDay`/`dayKey`. Al final del archivo viven `computeCortes(vehicles, now)`, `movimientosPorHora(vehicles, now)`, `movimientosPorDia(vehicles, now, dias)` — funciones puras, sin tests (este archivo no tiene un `.test.js`; el proyecto solo testea helpers de `src/lib/`, no lógica interna de componentes — se sigue esa misma convención acá, no se agrega un test runner nuevo para esto).
- Cada vehículo en `vehicles` (prop) ya trae `medioPago` (nombre del medio de pago, o `null` si el egreso no tiene uno cargado — datos previos a la migración de medios de pago) y `monto`, `estado`, `horaSalida` — ver `flattenVehicle` en `src/storage.js` (no se toca en este plan).
- Verificación: no hay test framework para componentes (`npm test` solo corre los de `src/lib/`). Se verifica con `npm run build` + recorrido manual en `npm run dev`.

---

## Task 1: Desglose por medio de pago en `ReportesTab`

**Files:**
- Modify: `src/components/ReportesTab.jsx`

- [ ] **Paso 1: Extraer la lista de períodos a una constante de módulo**

Hoy el selector de período arma su lista de botones con un array literal inline. Se extrae a una constante para poder reusar el `label` de cada período en la tarjeta nueva (evita repetir "Hoy"/"Semana"/"Quincena"/"Mes" en dos lugares).

En `src/components/ReportesTab.jsx`, ubicar el bloque de imports al tope del archivo y agregar, justo debajo de los imports (antes de `export default function ReportesTab`):

```jsx
const PERIODOS = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Semana" },
  { id: "quincena", label: "Quincena" },
  { id: "mes", label: "Mes" },
];
```

Luego, dentro del JSX de `ReportesTab`, reemplazar:

```jsx
      <div className="flex gap-1.5 mb-4">
        {[
          { id: "hoy", label: "Hoy" },
          { id: "semana", label: "Semana" },
          { id: "quincena", label: "Quincena" },
          { id: "mes", label: "Mes" },
        ].map((p) => (
```

por:

```jsx
      <div className="flex gap-1.5 mb-4">
        {PERIODOS.map((p) => (
```

(el resto de ese bloque `.map` — `<button key={p.id} ...>{p.label}</button>` y el cierre `))}` — no cambia).

- [ ] **Paso 2: Agregar los helpers puros `periodoFromTs` y `montosPorMedioPago`**

Al final de `src/components/ReportesTab.jsx`, después de la función `movimientosPorDia` (la última función del archivo), agregar:

```jsx

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
```

- [ ] **Paso 3: Calcular el desglose en el componente**

Dentro de `ReportesTab`, ubicar:

```jsx
  const cortes = useMemo(() => computeCortes(vehicles, now), [vehicles, now]);
```

Justo debajo, agregar:

```jsx
  const desglosePorMedioPago = useMemo(
    () => montosPorMedioPago(vehicles, periodoFromTs(periodo, now)),
    [vehicles, periodo, now]
  );
```

- [ ] **Paso 4: Renderizar la tarjeta**

Ubicar el bloque del selector de período (ya actualizado en el Paso 1) seguido del `ChartCard` de "Ingresos y egresos":

```jsx
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

      <ChartCard title="Ingresos y egresos">
```

Insertar la tarjeta nueva entre esos dos bloques (después del `</div>` que cierra el selector, antes de `<ChartCard title="Ingresos y egresos">`):

```jsx
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
```

- [ ] **Paso 5: Build**

Run: `npm run build`
Expected: compila sin errores.

- [ ] **Paso 6: Prueba manual**

Run: `npm run dev`, ir a la pestaña Reportes:
- Con al menos un vehículo con salida cobrada hoy, la tarjeta nueva aparece entre el selector de período y el gráfico "Ingresos y egresos", mostrando el medio de pago usado y el monto, más una fila de Total.
- El total de la tarjeta coincide con la tarjeta de corte "Hoy" cuando el período seleccionado es "Hoy" (mismo criterio que ya usa `computeCortes`).
- Cambiar el selector a Semana/Quincena/Mes actualiza la tarjeta y el título ("Recaudación por medio de pago — Semana", etc.), y el total sigue coincidiendo con la tarjeta de corte equivalente (Últimos 7/15/30 días).
- Si no hay ninguna salida cobrada en el período elegido, la tarjeta no se muestra (no aparece vacía).
- Si existe algún egreso sin medio de pago cargado (dato viejo, previo a la migración), aparece agrupado como "Sin especificar".

- [ ] **Paso 7: Commit**

```bash
git add src/components/ReportesTab.jsx
git commit -m "feat: desglose de recaudacion por medio de pago en Reportes"
```

---

## Self-review (cobertura contra el spec)

- Cálculo agrupado por medio de pago, atado al mismo período que el selector existente, con "Sin especificar" para egresos sin medio cargado → Paso 2-3.
- Ubicación de la tarjeta (debajo del selector, antes del gráfico de ingresos/egresos), mismo estilo visual que las tarjetas existentes, fila de total, se omite si no hay datos → Paso 4.
- Fuera de alcance confirmado sin cambios: export `.xlsx` y tarjetas de corte fijas no se tocan.
- Sin placeholders: cada paso trae el código completo a escribir o el snippet exacto de antes/después a reemplazar.
