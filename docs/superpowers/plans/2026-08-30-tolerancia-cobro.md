# Tolerancia de cobro y monto único en salida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar 15 minutos de tolerancia configurables antes de cobrar el tramo/bloque de tarifa siguiente, y eliminar la doble fórmula de cálculo de monto entre la vista previa de "Registrar salida" y el cobro real.

**Architecture:** `calcularMonto`/`tramoLabel` en `src/lib/format.js` restan `umbrales.toleranciaMin` (nuevo campo, default 15) al tiempo transcurrido antes de evaluar en qué tramo/bloque cae, para todo lo que esté por encima de los primeros 30 minutos. `toleranciaMin` se persiste como una columna más de `config` en Supabase (igual que `mediaEstadiaHoras`/`estadiaCompletaHoras`) y se edita desde `ConfigTab`. Por separado, `SalidaTab` deja de dejar que `App.jsx` recalcule el monto: lo calcula una sola vez y lo pasa a `onSalida`.

**Tech Stack:** React + Vite, Supabase (Postgres), Vitest (nuevo, para tests de las funciones puras de `format.js`).

**Spec:** [docs/superpowers/specs/2026-08-30-tolerancia-cobro-design.md](../specs/2026-08-30-tolerancia-cobro-design.md)

---

## Antes de empezar

Todos los comandos de este plan asumen que el directorio de trabajo es la carpeta del proyecto (la que tiene `package.json`, `src/`, `supabase/`) — en esta máquina: `C:\Users\onofr\Downloads\estacionamiento-app\estacionamiento-app`. Verificá con `pwd` / `ls package.json` antes del Task 1 si no estás seguro.

Rama de trabajo: `fix/tolerancia-cobro` (ya creada desde `develop`).

---

### Task 1: Agregar Vitest al proyecto

El proyecto no tiene ningún framework de test todavía. Se agrega Vitest (se integra directo con la config de Vite que ya existe).

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`

- [ ] **Step 1: Instalar vitest como devDependency**

Run: `npm install -D vitest`

Expected: se agrega `vitest` a `devDependencies` en `package.json` y se actualiza `package-lock.json`.

- [ ] **Step 2: Agregar el script `test`**

En `package.json`, dentro de `"scripts"`, agregar:

```json
    "test": "vitest run"
```

Quedando (agregado como primera entrada de `scripts`, antes de `"dev"`):

```json
  "scripts": {
    "test": "vitest run",
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
```

- [ ] **Step 3: Crear `vitest.config.js`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Verificar que corre (sin tests todavía)**

Run: `npm test`
Expected: Vitest arranca y reporta "No test files found" (o similar) — sin errores de configuración.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js
git commit -m "chore: agregar vitest para tests de funciones puras"
```

---

### Task 2: Tolerancia en `calcularMonto`

**Files:**
- Modify: `src/lib/format.js:25-51`
- Test: `src/lib/format.test.js` (crear)

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/lib/format.test.js`:

```js
import { describe, it, expect } from "vitest";
import { calcularMonto } from "./format";

const rates = {
  mediaHora: 1500,
  hora: 2500,
  mediaEstadia: 8000,
  estadiaCompleta: 14000,
  semanal: 70000,
  mensual: 220000,
};

const umbrales = {
  mediaEstadiaHoras: 6,
  estadiaCompletaHoras: 24,
  toleranciaMin: 15,
};

describe("calcularMonto con tolerancia", () => {
  it("cobra media hora en los primeros 30 minutos, sin tolerancia", () => {
    expect(calcularMonto(30, rates, umbrales)).toBe(1500);
  });

  it("sigue cobrando media hora hasta 30+tolerancia minutos", () => {
    expect(calcularMonto(31, rates, umbrales)).toBe(1500);
    expect(calcularMonto(45, rates, umbrales)).toBe(1500);
  });

  it("pasa a tarifa hora recien despues de 30+tolerancia minutos", () => {
    expect(calcularMonto(46, rates, umbrales)).toBe(2500);
    expect(calcularMonto(60, rates, umbrales)).toBe(2500);
  });

  it("sigue cobrando hora hasta 60+tolerancia minutos", () => {
    expect(calcularMonto(75, rates, umbrales)).toBe(2500);
  });

  it("cobra el primer bloque de media hora recien despues de 60+tolerancia", () => {
    expect(calcularMonto(76, rates, umbrales)).toBe(2500 + 1500); // hora + 1 bloque
    expect(calcularMonto(105, rates, umbrales)).toBe(2500 + 1500); // 60+30+15, todavia bloque 1
  });

  it("cobra el segundo bloque recien despues del bloque 1 + tolerancia", () => {
    expect(calcularMonto(106, rates, umbrales)).toBe(2500 + 2 * 1500);
  });

  it("sin toleranciaMin en umbrales, se comporta como antes (sin gracia)", () => {
    const umbralesSinTolerancia = { mediaEstadiaHoras: 6, estadiaCompletaHoras: 24 };
    expect(calcularMonto(31, rates, umbralesSinTolerancia)).toBe(2500);
    expect(calcularMonto(61, rates, umbralesSinTolerancia)).toBe(2500 + 1500);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — varios `expect` no coinciden porque `calcularMonto` todavía no aplica tolerancia (ej. `calcularMonto(31, ...)` hoy devuelve `2500`, no `1500`).

- [ ] **Step 3: Implementar la tolerancia en `calcularMonto`**

Reemplazar el archivo `src/lib/format.js` completo (mismo contenido, con `calcularMonto` modificado):

```js
import * as XLSX from "xlsx";

export const fmtMoney = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n || 0);

export const fmtDur = (mins) => {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return `${h} h ${r > 0 ? r + " min" : ""}`.trim();
};

export const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

export const fmtDateShort = (ts) =>
  new Date(ts).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

/**
 * Calcula el monto a cobrar dado un tiempo de estadía en minutos.
 * `umbrales.toleranciaMin` (default 0) da minutos de gracia antes de pasar
 * al tramo/bloque siguiente — no aplica a los primeros 30 minutos, que se
 * cobran a tarifa "media hora" desde el minuto 1.
 */
export function calcularMonto(minutos, rates, umbrales) {
  const { mediaHora, hora, mediaEstadia, estadiaCompleta, semanal, mensual } = rates;
  const mediaEstadiaMin = umbrales.mediaEstadiaHoras * 60;
  const estadiaCompletaMin = umbrales.estadiaCompletaHoras * 60;
  const toleranciaMin = umbrales.toleranciaMin ?? 0;

  if (minutos <= 30) return mediaHora;

  const t = minutos - toleranciaMin;

  if (t <= 30) return mediaHora;
  if (t <= 60) return hora;

  if (t <= mediaEstadiaMin) {
    const bloques = Math.ceil((t - 60) / 30);
    return Math.min(hora + bloques * mediaHora, mediaEstadia);
  }

  if (t <= estadiaCompletaMin) {
    const bloques = Math.ceil((t - mediaEstadiaMin) / 60);
    return Math.min(mediaEstadia + bloques * hora, estadiaCompleta);
  }

  const dias = Math.ceil(t / (24 * 60));
  if (dias < 7) return Math.min(dias * estadiaCompleta, semanal);

  const semanas = Math.ceil(dias / 7);
  if (dias < 30) return Math.min(semanas * semanal, mensual);

  const meses = Math.ceil(dias / 30);
  return meses * mensual;
}

export function tramoLabel(minutos, umbrales) {
  const mediaEstadiaMin = umbrales.mediaEstadiaHoras * 60;
  const estadiaCompletaMin = umbrales.estadiaCompletaHoras * 60;
  if (minutos <= 30) return "Media hora";
  if (minutos <= 60) return "Hora";
  if (minutos <= mediaEstadiaMin) return "Media estadía";
  if (minutos <= estadiaCompletaMin) return "Estadía completa";
  const dias = Math.ceil(minutos / (24 * 60));
  if (dias < 7) return `Estadía por día (${dias}d)`;
  if (dias < 30) return `Tarifa semanal`;
  return `Tarifa mensual`;
}

/** Genera y descarga un archivo .xlsx con una o más hojas. sheets = { NombreHoja: [ {col: val, ...}, ... ] } */
export function downloadXLSX(filename, sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "Sin datos": "" }]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

export const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
export const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};
```

(`tramoLabel` se actualiza en el Task 3 — de momento queda igual que antes, solo se tocó `calcularMonto`.)

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — los 7 tests de `calcularMonto con tolerancia` en verde.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.js src/lib/format.test.js
git commit -m "feat: tolerancia configurable antes de cobrar el tramo siguiente"
```

---

### Task 3: Tolerancia en `tramoLabel`

Mismo criterio que `calcularMonto`, para que la etiqueta que se muestra coincida con el precio.

**Files:**
- Modify: `src/lib/format.js:53-64` (función `tramoLabel`)
- Test: `src/lib/format.test.js`

- [ ] **Step 1: Agregar los tests que fallan**

Agregar al final de `src/lib/format.test.js` (mismo archivo del Task 2):

```js
import { tramoLabel } from "./format";
```

Sumar ese import a la línea existente `import { calcularMonto } from "./format";` (queda como `import { calcularMonto, tramoLabel } from "./format";`), y agregar al final del archivo:

```js
describe("tramoLabel con tolerancia", () => {
  it("muestra 'Media hora' hasta 30+tolerancia minutos", () => {
    expect(tramoLabel(30, umbrales)).toBe("Media hora");
    expect(tramoLabel(45, umbrales)).toBe("Media hora");
  });

  it("muestra 'Hora' recien despues de 30+tolerancia minutos", () => {
    expect(tramoLabel(46, umbrales)).toBe("Hora");
  });

  it("es consistente con calcularMonto en el limite de un bloque", () => {
    // 105 min: todavia bloque 1 de "Media estadía" (ver Task 2)
    expect(tramoLabel(105, umbrales)).toBe("Media estadía");
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL en `tramoLabel(45, umbrales)` (hoy devuelve "Hora" en vez de "Media hora") y en `tramoLabel(46, umbrales)` según corresponda.

- [ ] **Step 3: Implementar la tolerancia en `tramoLabel`**

En `src/lib/format.js`, reemplazar la función `tramoLabel` completa:

```js
export function tramoLabel(minutos, umbrales) {
  const mediaEstadiaMin = umbrales.mediaEstadiaHoras * 60;
  const estadiaCompletaMin = umbrales.estadiaCompletaHoras * 60;
  const toleranciaMin = umbrales.toleranciaMin ?? 0;

  if (minutos <= 30) return "Media hora";

  const t = minutos - toleranciaMin;

  if (t <= 30) return "Media hora";
  if (t <= 60) return "Hora";
  if (t <= mediaEstadiaMin) return "Media estadía";
  if (t <= estadiaCompletaMin) return "Estadía completa";
  const dias = Math.ceil(t / (24 * 60));
  if (dias < 7) return `Estadía por día (${dias}d)`;
  if (dias < 30) return `Tarifa semanal`;
  return `Tarifa mensual`;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — los 10 tests en `src/lib/format.test.js` en verde.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.js src/lib/format.test.js
git commit -m "feat: tramoLabel consistente con la tolerancia de calcularMonto"
```

---

### Task 4: Default de `toleranciaMin` en la config

**Files:**
- Modify: `src/constants.js:32-36`
- Test: `src/constants.test.js` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `src/constants.test.js`:

```js
import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "./constants";

describe("DEFAULT_CONFIG.umbrales", () => {
  it("tiene toleranciaMin por defecto en 15", () => {
    expect(DEFAULT_CONFIG.umbrales.toleranciaMin).toBe(15);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — `DEFAULT_CONFIG.umbrales.toleranciaMin` es `undefined`.

- [ ] **Step 3: Agregar el campo**

En `src/constants.js`, reemplazar:

```js
  umbrales: {
    mediaEstadiaHoras: 6,
    estadiaCompletaHoras: 24,
  },
```

por:

```js
  umbrales: {
    mediaEstadiaHoras: 6,
    estadiaCompletaHoras: 24,
    toleranciaMin: 15,
  },
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — todos los tests (incluye los de `format.test.js` y el nuevo de `constants.test.js`).

- [ ] **Step 5: Commit**

```bash
git add src/constants.js src/constants.test.js
git commit -m "feat: default de toleranciaMin=15 en DEFAULT_CONFIG"
```

---

### Task 5: Migración SQL — columna `umbral_tolerancia_min`

Agrega la columna a instalaciones nuevas (`schema.sql`) y a instalaciones existentes (script de migración nuevo). Este task no toca código de la app — es preparación de base de datos que **debe aplicarse antes de deployar los tasks 6-7** (que empiezan a leer/escribir la columna).

**Files:**
- Modify: `supabase/schema.sql`
- Create: `supabase/add_umbral_tolerancia_min.sql`

- [ ] **Step 1: Sumar la columna en `schema.sql` (instalaciones nuevas)**

En `supabase/schema.sql`, en la definición de `create table config`, reemplazar:

```sql
create table config (
  id int primary key default 1,
  total_espacios int not null,
  umbral_media_estadia_horas int not null,
  umbral_estadia_completa_horas int not null,
  updated_at timestamptz not null default now(),
  check (id = 1)
);
```

por:

```sql
create table config (
  id int primary key default 1,
  total_espacios int not null,
  umbral_media_estadia_horas int not null,
  umbral_estadia_completa_horas int not null,
  umbral_tolerancia_min int not null default 15,
  updated_at timestamptz not null default now(),
  check (id = 1)
);
```

- [ ] **Step 2: Crear el script de migración para instalaciones existentes**

Crear `supabase/add_umbral_tolerancia_min.sql`:

```sql
-- Correr UNA SOLA VEZ en el SQL editor de Supabase, en proyectos que ya
-- tienen la tabla `config` del esquema relacional (ver supabase/schema.sql).
-- Agrega la columna de tolerancia de cobro (minutos de gracia antes de
-- pasar al tramo/bloque de tarifa siguiente). Ver
-- docs/superpowers/specs/2026-08-30-tolerancia-cobro-design.md.
--
-- Importante: correr esto ANTES de deployar el código que empieza a leer y
-- escribir `umbral_tolerancia_min` (la app hace `select("*")` así que
-- tolera leer antes de que exista la columna, pero `setConfig` va a fallar
-- al intentar escribirla si la columna todavía no existe).

alter table config
  add column if not exists umbral_tolerancia_min int not null default 15;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql supabase/add_umbral_tolerancia_min.sql
git commit -m "feat: columna umbral_tolerancia_min en config (schema + migracion)"
```

No hay test automatizado para este task (es SQL que corre manualmente contra Supabase). La verificación es manual: correr el script en el SQL editor del proyecto de Supabase de `staging`/`master` antes de deployar el resto de los cambios.

---

### Task 6: `storage.js` — leer/escribir `toleranciaMin`

**Files:**
- Modify: `src/storage.js:29-43` (`configFromRows`)
- Modify: `src/storage.js:131-138` (`setConfig`)

- [ ] **Step 1: Mapear la columna en `configFromRows`**

En `src/storage.js`, reemplazar:

```js
function configFromRows(configRow, tarifaRows) {
  const rates = {};
  for (const t of tarifaRows) {
    if (!rates[t.tipo_id]) rates[t.tipo_id] = {};
    rates[t.tipo_id][t.concepto] = Number(t.monto);
  }
  return {
    totalEspacios: configRow.total_espacios,
    rates,
    umbrales: {
      mediaEstadiaHoras: configRow.umbral_media_estadia_horas,
      estadiaCompletaHoras: configRow.umbral_estadia_completa_horas,
    },
  };
}
```

por:

```js
function configFromRows(configRow, tarifaRows) {
  const rates = {};
  for (const t of tarifaRows) {
    if (!rates[t.tipo_id]) rates[t.tipo_id] = {};
    rates[t.tipo_id][t.concepto] = Number(t.monto);
  }
  return {
    totalEspacios: configRow.total_espacios,
    rates,
    umbrales: {
      mediaEstadiaHoras: configRow.umbral_media_estadia_horas,
      estadiaCompletaHoras: configRow.umbral_estadia_completa_horas,
      toleranciaMin: configRow.umbral_tolerancia_min,
    },
  };
}
```

- [ ] **Step 2: Escribir la columna en `setConfig`**

En `src/storage.js`, dentro de `setConfig`, reemplazar:

```js
    const { error: eC } = await supabase.from("config").upsert({
      id: 1,
      total_espacios: config.totalEspacios,
      umbral_media_estadia_horas: config.umbrales.mediaEstadiaHoras,
      umbral_estadia_completa_horas: config.umbrales.estadiaCompletaHoras,
    });
```

por:

```js
    const { error: eC } = await supabase.from("config").upsert({
      id: 1,
      total_espacios: config.totalEspacios,
      umbral_media_estadia_horas: config.umbrales.mediaEstadiaHoras,
      umbral_estadia_completa_horas: config.umbrales.estadiaCompletaHoras,
      umbral_tolerancia_min: config.umbrales.toleranciaMin,
    });
```

- [ ] **Step 3: Verificar que el build sigue compilando**

Run: `npm run build`
Expected: build exitoso, sin errores.

No hay test unitario para este archivo porque `storage.js` habla directo con Supabase (I/O real) — no se mockea el cliente de Supabase en este proyecto. La cobertura de este task es el build de Step 3 más la verificación manual end-to-end del Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/storage.js
git commit -m "feat: persistir toleranciaMin en la tabla config de Supabase"
```

---

### Task 7: Campo "Tolerancia (min)" en `ConfigTab`

**Files:**
- Modify: `src/components/ConfigTab.jsx:90-96`

- [ ] **Step 1: Agregar el campo al formulario**

En `src/components/ConfigTab.jsx`, reemplazar:

```jsx
        <div>
          <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-2">Umbrales de tramo</p>
          <div className="grid grid-cols-2 gap-2.5">
            <RateField label="Media estadía desde (hs)" value={local.umbrales.mediaEstadiaHoras} onChange={(v) => setUmbral("mediaEstadiaHoras", v)} suffix="hs" />
            <RateField label="Estadía completa desde (hs)" value={local.umbrales.estadiaCompletaHoras} onChange={(v) => setUmbral("estadiaCompletaHoras", v)} suffix="hs" />
          </div>
        </div>
```

por:

```jsx
        <div>
          <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-2">Umbrales de tramo</p>
          <div className="grid grid-cols-2 gap-2.5">
            <RateField label="Media estadía desde (hs)" value={local.umbrales.mediaEstadiaHoras} onChange={(v) => setUmbral("mediaEstadiaHoras", v)} suffix="hs" />
            <RateField label="Estadía completa desde (hs)" value={local.umbrales.estadiaCompletaHoras} onChange={(v) => setUmbral("estadiaCompletaHoras", v)} suffix="hs" />
            <RateField label="Tolerancia antes de cobrar el tramo siguiente" value={local.umbrales.toleranciaMin} onChange={(v) => setUmbral("toleranciaMin", v)} suffix="min" />
          </div>
        </div>
```

`setUmbral` ya existe (línea 26 de este archivo, sin cambios) y funciona genéricamente para cualquier clave de `umbrales`, así que no hace falta tocarlo.

- [ ] **Step 2: Verificar que el build sigue compilando**

Run: `npm run build`
Expected: build exitoso, sin errores.

- [ ] **Step 3: Verificación visual (dev server)**

Run: `npm run dev`, abrir la app en el navegador, iniciar sesión, ir a la pestaña **Config**. Confirmar que aparece el campo "Tolerancia antes de cobrar el tramo siguiente" con valor `15` (o el que tenga guardado), que se puede editar, y que "Guardar cambios" no tira error. Frenar el servidor al terminar.

- [ ] **Step 4: Commit**

```bash
git add src/components/ConfigTab.jsx
git commit -m "feat: campo de tolerancia editable en ConfigTab"
```

---

### Task 8: Monto único — `SalidaTab` calcula y pasa el monto

**Files:**
- Modify: `src/components/SalidaTab.jsx:44-91`

- [ ] **Step 1: Pasar el monto ya calculado a `onSalida`**

En `src/components/SalidaTab.jsx`, dentro del botón "Confirmar cobro", reemplazar:

```jsx
                      <button
                        onClick={() => { onSalida(v.id); setConfirmId(null); }}
                        className="flex-1 py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-1.5"
                        style={{ background: "var(--accent2)", color: "#08210F" }}
                      >
                        <Check size={16} /> Confirmar cobro
                      </button>
```

por:

```jsx
                      <button
                        onClick={() => { onSalida(v.id, monto); setConfirmId(null); }}
                        className="flex-1 py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-1.5"
                        style={{ background: "var(--accent2)", color: "#08210F" }}
                      >
                        <Check size={16} /> Confirmar cobro
                      </button>
```

`monto` ya está calculado más arriba en el mismo `.map()` (línea 44: `const monto = calcularMonto(minutos, vehicleRates, umbrales);`), así que solo hace falta pasarlo — no hace falta recalcular nada nuevo en este archivo.

- [ ] **Step 2: Verificar que el build sigue compilando**

Run: `npm run build`
Expected: build exitoso. (Este cambio por sí solo no rompe nada porque `onSalida` — implementado en el Task 9 — todavía acepta y usa un solo argumento; JS ignora argumentos extra hasta que actualicemos la firma.)

- [ ] **Step 3: Commit**

```bash
git add src/components/SalidaTab.jsx
git commit -m "feat: SalidaTab pasa el monto ya calculado a onSalida"
```

---

### Task 9: Monto único — `App.jsx` deja de recalcular

**Files:**
- Modify: `src/App.jsx:209-215`

- [ ] **Step 1: Usar el monto recibido en vez de recalcularlo**

En `src/App.jsx`, reemplazar la función `registrarSalida`:

```jsx
  const registrarSalida = async (id) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    const minutos = (Date.now() - v.horaIngreso) / 60000;
    const rates = config.rates[v.tipo] || config.rates.auto;
    const monto = calcularMonto(minutos, rates, config.umbrales);
    const patch = { horaSalida: Date.now(), monto, estado: "afuera" };
```

por:

```jsx
  const registrarSalida = async (id, monto) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    const patch = { horaSalida: Date.now(), monto, estado: "afuera" };
```

- [ ] **Step 2: Quitar el import de `calcularMonto` si quedó sin uso**

Buscar otros usos de `calcularMonto` en `src/App.jsx`:

Run: `grep -n "calcularMonto" src/App.jsx`
Expected: una sola coincidencia, la línea del `import` (ej. `import { fmtMoney, calcularMonto } from "./lib/format";`).

Si es el único resultado, en `src/App.jsx` reemplazar:

```jsx
import {
  fmtMoney, calcularMonto,
} from "./lib/format";
```

por:

```jsx
import {
  fmtMoney,
} from "./lib/format";
```

- [ ] **Step 3: Verificar que el build sigue compilando**

Run: `npm run build`
Expected: build exitoso, sin warnings de import sin usar ni de variable no definida.

- [ ] **Step 4: Verificación end-to-end (dev server)**

Run: `npm run dev`, iniciar sesión, ir a **Entrada** y registrar el ingreso de una patente de prueba. Ir a **Salida**, confirmar que aparece con un monto (tarifa "media hora" recién ingresado). Dar clic en "Dar salida" → "Confirmar cobro" y verificar en el toast que el monto cobrado coincide exactamente con el que se mostraba en la lista. Revisar en **Reportes → Historial** que la salida quedó registrada con ese mismo monto. Frenar el servidor al terminar.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "fix: no recalcular el monto al confirmar salida, usar el ya mostrado"
```

---

### Task 10: Suite completa y cierre

**Files:** ninguno (task de verificación final).

- [ ] **Step 1: Correr toda la suite de tests**

Run: `npm test`
Expected: PASS — todos los tests de `src/lib/format.test.js` y `src/constants.test.js` en verde.

- [ ] **Step 2: Build final**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Revisar el diff completo antes de terminar**

Run: `git log --oneline develop..fix/tolerancia-cobro`
Expected: un commit por task (10 commits aprox.), mensajes describen cada cambio.

- [ ] **Step 4: Recordatorio de deploy**

Anotar para el deploy a `staging`/`master`: correr `supabase/add_umbral_tolerancia_min.sql` contra la base de Supabase de ese ambiente **antes** de deployar esta rama — si se deploya el código primero, "Guardar cambios" en Config va a fallar hasta que la columna exista.

---

## Self-review

- **Cobertura del spec:** tolerancia en `calcularMonto` (Task 2), en `tramoLabel` (Task 3), default `15` (Task 4), persistencia en Supabase (Tasks 5-6), UI en ConfigTab (Task 7), monto único entre preview y cobro (Tasks 8-9). Los dos puntos de "Fuera de alcance" del spec no tienen tasks, como corresponde.
- **Placeholders:** ninguno — cada step tiene código completo o comando exacto con output esperado.
- **Consistencia de tipos/nombres:** `toleranciaMin` se usa igual en `umbrales.toleranciaMin` (JS) en Tasks 2-4 y 7-9; `umbral_tolerancia_min` (SQL/columna) se usa igual en Tasks 5-6. `registrarSalida(id, monto)` (Task 9) coincide con la llamada `onSalida(v.id, monto)` (Task 8).
