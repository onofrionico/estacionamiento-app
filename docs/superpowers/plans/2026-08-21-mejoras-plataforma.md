# Mejoras de Plataforma — Estacionamiento App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modularizar `App.jsx`, reducir el bundle inicial con code-splitting, reemplazar `localStorage` por Supabase (sincronización multi-dispositivo) y dejar el deploy automático a Render configurado.

**Architecture:** Cuatro pistas de trabajo (A: modularización, B: code-splitting, C: backend Supabase, D: deploy Render). A y B son secuenciales entre sí (B depende de que A termine porque `React.lazy` necesita módulos separados). C y D no tocan `src/App.jsx` ni entre sí, así que pueden dispatchearse en paralelo con A/B.

**Tech Stack:** React 18 + Vite (sin TypeScript), Tailwind, lucide-react, recharts, xlsx, `@supabase/supabase-js`, Render (static site vía `render.yaml`).

**No hay test framework instalado** (no vitest/jest en `package.json`). La verificación de cada tarea es: `npm run build` sin errores + chequeo manual en `npm run dev` de la pantalla afectada. No se agrega un test runner en este plan porque no fue pedido — si se quiere TDD real, es un plan aparte.

---

## Mapa de dependencias entre pistas

```
Track A (modularizar App.jsx)  ──┐
                                  ├──> Track B (code-splitting, depende de A)
Track C (Supabase)     [independiente, en paralelo]
Track D (Render)       [independiente, en paralelo]
```

Recomendación de dispatch: lanzar A, C y D en paralelo. B se dispatchea recién cuando A esté mergeado.

---

## Contexto de archivos actuales (leído antes de planificar)

- `src/App.jsx` (1085 líneas) — todo el código vive acá. Funciones ya identificadas por nombre y línea:
  - `STORAGE_KEY`, `DEFAULT_CONFIG`, `DEFAULT_DATA`, `TIPOS` — líneas 17-42
  - Helpers puros: `fmtMoney` (44), `fmtDur` (51), `fmtTime` (59), `fmtDateShort` (62), `calcularMonto` (66), `tramoLabel` (94), `downloadXLSX` (108), `dayKey` (117), `startOfDay` (118)
  - `App` (componente raíz, 128-299)
  - `TopBar` (305), `BottomNav` (347)
  - `EntradaTab` (392)
  - `SalidaTab` (473)
  - `EstadoTab` (567)
  - `ReportesTab` (607), `HistorialSection` (707), `computeCortes` (802), `movimientosPorHora` (814), `movimientosPorDia` (835)
  - `ConfigTab` (874)
  - UI átomos compartidos: `SectionTitle` (977), `StatCard` (991), `CorteCard` (1000), `ChartCard` (1009), `EmptyState` (1018), `ConfigField` (1027), `RateField` (1036)
  - `RootStyles` (1055, hasta EOF)
- `src/storage.js` — interfaz `{ get(key), set(key, value), delete(key) }`, todas async, hoy sobre `localStorage`. `App.jsx` la usa una sola vez con `STORAGE_KEY = "estacionamiento-datos"` guardando un blob JSON `{ config, vehicles }`.
- `src/main.jsx`, `index.html`, `vite.config.js` (solo plugin react), `tailwind.config.js`, `postcss.config.js` — sin cambios necesarios salvo lo indicado abajo.
- Ya es un repo git (`git init` + commit inicial ya hechos).

---

# Track A — Modularizar `App.jsx`

**Objetivo:** dejar `App.jsx` como orquestador delgado (estado global + composición de tabs), moviendo cada bloque a su propio archivo. Es un refactor de *extracción*: el código se mueve tal cual, no se reescribe lógica.

**Files:**
- Create: `src/constants.js`
- Create: `src/lib/format.js`
- Create: `src/components/ui.jsx`
- Create: `src/components/RootStyles.jsx`
- Create: `src/components/Nav.jsx`
- Create: `src/components/EntradaTab.jsx`
- Create: `src/components/SalidaTab.jsx`
- Create: `src/components/EstadoTab.jsx`
- Create: `src/components/ReportesTab.jsx`
- Create: `src/components/ConfigTab.jsx`
- Modify: `src/App.jsx` (se reduce a ~180 líneas)

### Task A1: Extraer constantes

- [ ] **Paso 1:** Crear `src/constants.js` con el contenido exacto de `App.jsx` líneas 17-42 (`STORAGE_KEY`, `DEFAULT_CONFIG`, `DEFAULT_DATA`, `TIPOS`). `TIPOS` importa los íconos `Car, Bike, Truck` de `lucide-react` — agregar ese import al tope del archivo nuevo.
- [ ] **Paso 2:** Exportar todo con `export const` (ya lo son en el original, solo hay que moverlos).
- [ ] **Paso 3:** En `App.jsx`, borrar esas líneas y agregar `import { STORAGE_KEY, DEFAULT_CONFIG, DEFAULT_DATA, TIPOS } from "./constants";`.
- [ ] **Paso 4:** Correr `npm run build` — debe compilar sin errores de `TIPOS`/`DEFAULT_CONFIG` no definidos.
- [ ] **Paso 5:** Commit: `git add src/constants.js src/App.jsx && git commit -m "refactor: extraer constantes a constants.js"`

### Task A2: Extraer helpers de formato/cálculo

- [ ] **Paso 1:** Crear `src/lib/format.js` con `fmtMoney`, `fmtDur`, `fmtTime`, `fmtDateShort`, `calcularMonto`, `tramoLabel`, `downloadXLSX`, `dayKey`, `startOfDay` (líneas 44-126 del original). `downloadXLSX` usa `XLSX` — agregar `import * as XLSX from "xlsx";` al tope.
- [ ] **Paso 2:** Exportar cada uno con `export`.
- [ ] **Paso 3:** En `App.jsx`, reemplazar esas definiciones por `import { fmtMoney, fmtDur, fmtTime, fmtDateShort, calcularMonto, tramoLabel, downloadXLSX, dayKey, startOfDay } from "./lib/format";` (importar solo lo que `App.jsx` siga usando directamente — el resto lo importan los componentes que los necesiten, ver tasks siguientes).
- [ ] **Paso 4:** `npm run build` sin errores.
- [ ] **Paso 5:** Commit: `git commit -m "refactor: extraer helpers de formato/calculo a lib/format.js"`

### Task A3: Extraer átomos de UI compartidos

- [ ] **Paso 1:** Crear `src/components/ui.jsx` con `SectionTitle`, `StatCard`, `CorteCard`, `ChartCard`, `EmptyState`, `ConfigField`, `RateField` (líneas 977-1054 del original). Revisar dentro de cada función qué íconos de `lucide-react` usa (ej. `SectionTitle` recibe `Icon` por prop, no necesita import propio; chequear el resto igual, importando solo lo que cada uno referencie directamente).
- [ ] **Paso 2:** Exportar cada componente.
- [ ] **Paso 3:** Borrar esos bloques de `App.jsx`.
- [ ] **Paso 4:** `npm run build`.
- [ ] **Paso 5:** Commit: `git commit -m "refactor: extraer atomos de UI a components/ui.jsx"`

### Task A4: Extraer `RootStyles`

- [ ] **Paso 1:** Crear `src/components/RootStyles.jsx` con la función `RootStyles` (línea 1055 hasta el final del archivo original — es el `<style>` con la paleta y las fuentes).
- [ ] **Paso 2:** `export default function RootStyles() { ... }`.
- [ ] **Paso 3:** En `App.jsx`, `import RootStyles from "./components/RootStyles";` y borrar la definición vieja.
- [ ] **Paso 4:** `npm run build`.
- [ ] **Paso 5:** Commit: `git commit -m "refactor: extraer RootStyles a su propio archivo"`

### Task A5: Extraer `TopBar` y `BottomNav`

- [ ] **Paso 1:** Crear `src/components/Nav.jsx` con `TopBar` y `BottomNav` (líneas 305-386 del original). Importan `useState, useEffect` de React y los íconos `LogIn, LogOut, Gauge, BarChart3, Settings2` de `lucide-react`.
- [ ] **Paso 2:** Exportar ambos: `export function TopBar(...)`, `export function BottomNav(...)`.
- [ ] **Paso 3:** En `App.jsx`, `import { TopBar, BottomNav } from "./components/Nav";`, borrar las definiciones viejas.
- [ ] **Paso 4:** `npm run build`.
- [ ] **Paso 5:** Commit: `git commit -m "refactor: extraer TopBar y BottomNav a components/Nav.jsx"`

### Task A6: Extraer `EntradaTab`

- [ ] **Paso 1:** Crear `src/components/EntradaTab.jsx` con la función completa (líneas 392-467). Usa `useState` de React, íconos `LogIn, Check` de `lucide-react`, `TIPOS` de `../constants`, `SectionTitle` de `./ui`.
- [ ] **Paso 2:** `export default function EntradaTab({ onRegistrar, disponibles }) { ... }`.
- [ ] **Paso 3:** En `App.jsx`: `import EntradaTab from "./components/EntradaTab";`, borrar la definición vieja.
- [ ] **Paso 4:** `npm run build`, luego `npm run dev` y probar manualmente: cargar patente, elegir tipo, registrar ingreso, ver que aparece en Estado.
- [ ] **Paso 5:** Commit: `git commit -m "refactor: extraer EntradaTab a su propio archivo"`

### Task A7: Extraer `SalidaTab`

- [ ] **Paso 1:** Crear `src/components/SalidaTab.jsx` con la función completa (líneas 473-566). Depende de `fmtMoney`, `fmtDur`, `calcularMonto`, `tramoLabel` de `../lib/format`, `EmptyState` de `./ui`, e íconos que use internamente (revisar el cuerpo — al menos `Search`, `Clock3`, `Check`, `X` aparecen usados en esta sección del archivo original).
- [ ] **Paso 2:** `export default function SalidaTab({ vehiculosDentro, now, rates, umbrales, onSalida }) { ... }`.
- [ ] **Paso 3:** En `App.jsx`: `import SalidaTab from "./components/SalidaTab";`, borrar definición vieja.
- [ ] **Paso 4:** `npm run build` + prueba manual: buscar un vehículo dentro, confirmar salida, verificar que el monto cobrado coincide con lo que mostraba antes del refactor.
- [ ] **Paso 5:** Commit: `git commit -m "refactor: extraer SalidaTab a su propio archivo"`

### Task A8: Extraer `EstadoTab`

- [ ] **Paso 1:** Crear `src/components/EstadoTab.jsx` con la función completa (líneas 567-606). Depende de `fmtTime`, `fmtDur` de `../lib/format`, `EmptyState` de `./ui`.
- [ ] **Paso 2:** `export default function EstadoTab({ vehiculosDentro, now, totalEspacios, disponibles }) { ... }`.
- [ ] **Paso 3:** En `App.jsx`: `import EstadoTab from "./components/EstadoTab";`, borrar definición vieja.
- [ ] **Paso 4:** `npm run build` + prueba manual: tab Estado muestra ocupados/libres y la lista de autos dentro con hora de ingreso.
- [ ] **Paso 5:** Commit: `git commit -m "refactor: extraer EstadoTab a su propio archivo"`

### Task A9: Extraer `ReportesTab` (+ `HistorialSection` y sus helpers)

- [ ] **Paso 1:** Crear `src/components/ReportesTab.jsx` con `ReportesTab` (607-706), `HistorialSection` (707-801), `computeCortes` (802-813), `movimientosPorHora` (814-834), `movimientosPorDia` (835-873) — este bloque completo se mueve junto porque `ReportesTab` usa `HistorialSection` y ambos usan los tres helpers de cómputo. Depende de `fmtMoney`, `fmtDur`, `fmtDateShort`, `dayKey`, `startOfDay`, `downloadXLSX` de `../lib/format`, `StatCard`, `CorteCard`, `ChartCard`, `EmptyState`, `SectionTitle` de `./ui`, componentes de `recharts` (`BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend`), e íconos usados en el cuerpo (al menos `BarChart3`, `TrendingUp`, `Search`, `Download`).
- [ ] **Paso 2:** `export default function ReportesTab({ vehicles, now }) { ... }`; `HistorialSection` y los tres helpers de cómputo quedan como funciones internas del mismo archivo (no hace falta exportarlos si nada más los usa).
- [ ] **Paso 3:** En `App.jsx`: `import ReportesTab from "./components/ReportesTab";`, borrar todo el bloque viejo (607-873).
- [ ] **Paso 4:** `npm run build` + prueba manual: tab Reportes — tarjetas de corte, gráficos, buscador de historial, y exportar a `.xlsx` (confirmar que descarga un archivo válido).
- [ ] **Paso 5:** Commit: `git commit -m "refactor: extraer ReportesTab a su propio archivo"`

### Task A10: Extraer `ConfigTab`

- [ ] **Paso 1:** Crear `src/components/ConfigTab.jsx` con la función completa (874-976). Depende de `ConfigField`, `RateField` de `./ui`, e íconos usados en el cuerpo (al menos `RotateCcw`, `Trash2`, `Check`, `X`).
- [ ] **Paso 2:** `export default function ConfigTab({ config, onSave, onResetDemo, onBorrarTodo }) { ... }`.
- [ ] **Paso 3:** En `App.jsx`: `import ConfigTab from "./components/ConfigTab";`, borrar definición vieja.
- [ ] **Paso 4:** `npm run build` + prueba manual: cambiar capacidad total y una tarifa, guardar, volver a Entrada y confirmar que el cálculo de un cobro usa la tarifa nueva.
- [ ] **Paso 5:** Commit: `git commit -m "refactor: extraer ConfigTab a su propio archivo"`

### Task A11: Dejar `App.jsx` como orquestador y verificación final

- [ ] **Paso 1:** Revisar que `App.jsx` solo tenga: imports, `App()` (estado + handlers `registrarIngreso`/`registrarSalida`/`updateConfig`/`resetDemo`/`borrarTodo` + JSX de composición). Debería quedar en el orden de 150-180 líneas.
- [ ] **Paso 2:** Revisar que no queden imports sin usar (íconos, hooks) — Vite no falla el build por esto pero conviene limpiarlo.
- [ ] **Paso 3:** `npm run build` limpio, sin warnings nuevos.
- [ ] **Paso 4:** `npm run dev` y hacer un recorrido completo manual: Entrada → Estado → Salida → Reportes → Config, confirmando que no se rompió nada de punta a punta.
- [ ] **Paso 5:** Commit final: `git commit -m "refactor: App.jsx queda como orquestador delgado"`

---

# Track B — Code-splitting de los tabs

**Depende de:** Track A completo (necesita que cada tab viva en su propio módulo para poder hacer `React.lazy` sobre archivos separados).

**Files:**
- Modify: `src/App.jsx`

### Task B1: Lazy-load de los 5 tabs

- [ ] **Paso 1:** En `src/App.jsx`, reemplazar los imports estáticos de los tabs por lazy imports:

```jsx
import { lazy, Suspense } from "react";

const EntradaTab = lazy(() => import("./components/EntradaTab"));
const SalidaTab = lazy(() => import("./components/SalidaTab"));
const EstadoTab = lazy(() => import("./components/EstadoTab"));
const ReportesTab = lazy(() => import("./components/ReportesTab"));
const ConfigTab = lazy(() => import("./components/ConfigTab"));
```

- [ ] **Paso 2:** Envolver el bloque de renderizado condicional de tabs (dentro de `<main>`) en `<Suspense>` con un fallback simple, reutilizando el estilo del loading state que ya existe en `App.jsx` (el `ParkingSquare` animado):

```jsx
<Suspense fallback={
  <div className="flex items-center justify-center py-20">
    <ParkingSquare className="animate-pulse" size={32} style={{ color: "var(--accent)" }} />
  </div>
}>
  {tab === "entrada" && <EntradaTab onRegistrar={registrarIngreso} disponibles={disponibles} />}
  {tab === "salida" && (
    <SalidaTab vehiculosDentro={vehiculosDentro} now={now} rates={data.config.rates} umbrales={data.config.umbrales} onSalida={registrarSalida} />
  )}
  {tab === "estado" && (
    <EstadoTab vehiculosDentro={vehiculosDentro} now={now} totalEspacios={data.config.totalEspacios} disponibles={disponibles} />
  )}
  {tab === "reportes" && <ReportesTab vehicles={data.vehicles} now={now} />}
  {tab === "config" && (
    <ConfigTab config={data.config} onSave={updateConfig} onResetDemo={resetDemo} onBorrarTodo={borrarTodo} />
  )}
</Suspense>
```

- [ ] **Paso 3:** `ParkingSquare` ya está importado en `App.jsx` (se usa en el loading inicial) — no hace falta agregar el import.
- [ ] **Paso 4:** `npm run build` — revisar el output: debería aparecer un chunk `.js` separado por cada tab (`EntradaTab-*.js`, `SalidaTab-*.js`, etc.) en vez de un solo bundle grande.
- [ ] **Paso 5:** `npm run dev`, navegar entre los 5 tabs y confirmar que cada uno carga bien (mirar la pestaña Network del navegador: cada tab debería traer su chunk la primera vez que se visita).
- [ ] **Paso 6:** Commit: `git commit -m "perf: lazy-load de tabs con React.lazy/Suspense"`

### Task B2: Confirmar mejora de bundle

- [ ] **Paso 1:** Correr `npm run build` y anotar el tamaño del chunk principal (`index-*.js`) contra el ~837kb original.
- [ ] **Paso 2:** Si `recharts` sigue empujando el bundle de `ReportesTab` muy alto, es aceptable — es el único tab que lo necesita y ahora carga bajo demanda, no en el bundle inicial. No se requiere acción extra en este plan.
- [ ] **Paso 3:** Commit si se ajustó algo: `git commit -m "chore: verificar tamaño de bundle post code-splitting"` (opcional, solo si hubo cambios).

---

# Track C — Backend real con Supabase

**Independiente de A y B** (solo toca `src/storage.js` y agrega un cliente nuevo). Puede dispatchearse en paralelo.

**Decisión de diseño:** en vez de migrar a un esquema relacional (tabla `vehicles` + tabla `config`), se mantiene la interfaz actual de `storage.js` (`get(key)/set(key,value)/delete(key)`) sobre una tabla genérica `kv_store(key text primary key, value text, updated_at timestamptz)` en Supabase. Esto evita reescribir la lógica de `App.jsx` (que ya asume un blob JSON bajo una sola key) y resuelve el problema real: que todos los dispositivos lean/escriban la misma fila en vez de su propio `localStorage`.

**Files:**
- Create: `src/supabaseClient.js`
- Modify: `src/storage.js`
- Create: `.env.example`
- Modify: `README.md` (sección de setup)
- Modify: `package.json` (nueva dependencia)

### Task C1: Setup manual en Supabase (para el usuario, no automatizable por un subagente)

- [ ] **Paso 1:** Crear un proyecto en https://supabase.com (tier free).
- [ ] **Paso 2:** En el SQL editor, correr:

```sql
create table kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table kv_store enable row level security;

create policy "allow anon read/write kv_store"
  on kv_store for all
  using (true)
  with check (true);
```

  Nota: la policy es permisiva a propósito (misma exposición que hoy tiene `localStorage` — cualquiera con la URL de la app puede leer/escribir). Si más adelante se agrega login de empleados, esta policy debe restringirse.
- [ ] **Paso 3:** Copiar `Project URL` y `anon public key` desde Settings → API. Estos valores los necesita el subagente de Task C2 en las variables de entorno — el usuario se los pasa por fuera del plan, nunca se hardcodean en el repo.

### Task C2: Cliente de Supabase

- [ ] **Paso 1:** `npm install @supabase/supabase-js`
- [ ] **Paso 2:** Crear `.env.example` en la raíz del proyecto:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- [ ] **Paso 3:** Crear `src/supabaseClient.js`:

```js
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env y completá los valores del proyecto Supabase."
  );
}

export const supabase = createClient(url, anonKey);
```

- [ ] **Paso 4:** Confirmar que `.env` está en `.gitignore` (ya lo está — el `.gitignore` actual incluye `.env` y `.env.*`).
- [ ] **Paso 5:** Commit: `git commit -m "feat: agregar cliente de Supabase"`

### Task C3: Reescribir `storage.js` sobre Supabase

- [ ] **Paso 1:** Reemplazar el contenido de `src/storage.js` completo por:

```js
/**
 * Capa de almacenamiento sobre Supabase (tabla kv_store).
 * Mantiene la misma interfaz que la versión local para no tocar App.jsx:
 * get(key) / set(key, value) / delete(key), todas async.
 */
import { supabase } from "./supabaseClient";

export const storage = {
  async get(key) {
    const { data, error } = await supabase
      .from("kv_store")
      .select("key, value")
      .eq("key", key)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error(`Storage key not found: ${key}`);
    }
    return { key: data.key, value: data.value, shared: true };
  },

  async set(key, value) {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key, value, updated_at: new Date().toISOString() });

    if (error) throw error;
    return { key, value, shared: true };
  },

  async delete(key) {
    const { error } = await supabase.from("kv_store").delete().eq("key", key);
    if (error) throw error;
    return { key, deleted: true, shared: true };
  },
};
```

- [ ] **Paso 2:** `npm run build` sin errores.
- [ ] **Paso 3:** Commit: `git commit -m "feat: storage.js sobre Supabase, reemplaza localStorage"`

### Task C4: Documentar el setup

- [ ] **Paso 1:** Agregar una sección al `README.md` explicando: crear proyecto Supabase, correr el SQL de Task C1, copiar `.env.example` a `.env`, completar las dos variables, `npm run dev`.
- [ ] **Paso 2:** Commit: `git commit -m "docs: instrucciones de setup de Supabase en README"`

### Task C5: Verificación manual

- [ ] **Paso 1:** Con `.env` completo localmente, correr `npm run dev`.
- [ ] **Paso 2:** Registrar un ingreso, refrescar la página, confirmar que el dato persiste (viene de Supabase, no de `localStorage`).
- [ ] **Paso 3:** Abrir la app en otra pestaña/navegador (simula "otro dispositivo"), confirmar que ve el mismo estado.
- [ ] **Paso 4:** Si algo falla, revisar la policy RLS de Task C1 antes de tocar código.

---

# Track D — Deploy automático a Render

**Independiente de A, B y C.** Solo agrega archivos de configuración, no toca `src/`.

**Files:**
- Create: `render.yaml`
- Modify: `README.md` (sección de deploy)

### Task D1: Config de Render como static site

- [ ] **Paso 1:** Crear `render.yaml` en la raíz:

```yaml
services:
  - type: web
    name: estacionamiento-app
    runtime: static
    buildCommand: npm install && npm run build
    staticPublishPath: dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
    envVars:
      - key: VITE_SUPABASE_URL
        sync: false
      - key: VITE_SUPABASE_ANON_KEY
        sync: false
```

  La ruta de rewrite es necesaria porque la app no usa un router de URLs propio pero conviene dejarla por si se agrega en el futuro; con una sola ruta (`/`) no rompe nada tenerla.
- [ ] **Paso 2:** Commit: `git commit -m "chore: agregar render.yaml para deploy como static site"`

### Task D2: Documentar conexión a Render

- [ ] **Paso 1:** Agregar sección al `README.md`: en Render → New → Blueprint, conectar el repo de GitHub (una vez que el usuario lo suba manualmente), Render detecta `render.yaml` solo. Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en el dashboard de Render (son `sync: false`, no van en el archivo). Cada push a la rama conectada dispara un deploy automático — no hace falta GitHub Actions.
- [ ] **Paso 2:** Commit: `git commit -m "docs: instrucciones de deploy en Render"`

---

## Self-review (cobertura contra lo pedido)

- Dividir `App.jsx` en componentes → Track A, tareas A1-A11, cubre las 5 tabs + nav + UI compartida + helpers + constantes.
- Code-splitting / bundle → Track B, lazy-load de los 5 tabs, verificación de tamaño.
- Backend real (Supabase) → Track C, cliente + storage.js + RLS + docs + verificación multi-dispositivo.
- CI/CD a Render → Track D, `render.yaml` + docs (Render no necesita GitHub Actions para autodeploy).
- Sin placeholders: cada paso de código trae el contenido real a escribir; los pasos de "extraer función X" dan el rango de líneas exacto del archivo actual en vez de reescribir 1000+ líneas dentro del plan.
