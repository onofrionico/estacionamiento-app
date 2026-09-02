# Impresión de tickets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Imprimir tickets térmicos (80mm) al registrar el ingreso y/o egreso de un vehículo, con datos del negocio (nombre, dirección, teléfono, logo) y número de ticket secuencial, con impresión automática configurable por evento y reimpresión manual.

**Architecture:** Se agregan columnas nuevas a `config` (identidad del negocio + flags de impresión) y `visitas` (numeración secuencial vía `generated always as identity`). Un componente `Ticket.jsx` de presentación pura, montado siempre pero oculto por CSS salvo en `@media print`, se llena con un `printJob` de estado en `App.jsx` y se dispara con `window.print()`. `registrarIngreso`/`registrarSalida` en `App.jsx` devuelven el vehículo actualizado (con `numeroTicket`) para que cada tab lo use tanto para imprimir automáticamente como para ofrecer un botón de reimpresión local.

**Tech Stack:** React 18 + Vite, Supabase (Postgres + Storage + Realtime), Vitest, Tailwind. Sin librerías nuevas — `window.print()` nativo del navegador.

---

## File Structure

- **Create** `supabase/add_tickets.sql` — migración idempotente para proyectos existentes (columnas + bucket de Storage).
- **Modify** `supabase/schema.sql` — que un proyecto nuevo nazca ya con estas columnas/bucket.
- **Modify** `src/lib/format.js` — nuevo helper `fmtDateTime`.
- **Modify** `src/lib/format.test.js` — test de `fmtDateTime`.
- **Modify** `src/constants.js` — nuevos campos en `DEFAULT_CONFIG`.
- **Modify** `src/storage.js` — leer/escribir los campos nuevos de `config`, `numeroTicket` en vehículos, nuevo `uploadLogo`.
- **Create** `src/components/Ticket.jsx` — presentación del ticket imprimible.
- **Modify** `src/index.css` — reglas `@media print`.
- **Modify** `src/App.jsx` — estado `printJob`, función `imprimir`, wiring en `registrarIngreso`/`registrarSalida`, render del ticket oculto, props nuevas a los tabs.
- **Modify** `src/components/EntradaTab.jsx` — botón de reimprimir tras un ingreso.
- **Modify** `src/components/SalidaTab.jsx` — botón de reimprimir tras un cobro.
- **Modify** `src/components/EstadoTab.jsx` — botón de reimprimir por fila.
- **Modify** `src/components/ConfigTab.jsx` — sección de datos del negocio (+ logo) y sección de impresión.
- **Modify** `README.md` — documentar la migración nueva y la feature.

---

### Task 1: Migración de base de datos

**Files:**
- Create: `supabase/add_tickets.sql`
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Escribir la migración idempotente**

Crear `supabase/add_tickets.sql`:

```sql
-- Correr UNA SOLA VEZ en el SQL editor de Supabase, en proyectos que ya
-- tienen las tablas `config` y `visitas` del esquema relacional (ver
-- supabase/schema.sql). Agrega los datos de identidad del negocio (nombre,
-- dirección, teléfono, logo) y los flags de impresión automática a
-- `config`, numeración secuencial de ticket a `visitas`, y un bucket de
-- Storage público para los logos. Ver
-- docs/superpowers/specs/2026-08-31-impresion-tickets-design.md.
--
-- Importante: correr esto ANTES de deployar el código que empieza a leer y
-- escribir estas columnas (la app hace `select("*")` así que tolera leer
-- antes de que existan, pero `setConfig`/`insertVehicle` van a fallar al
-- intentar escribirlas si todavía no existen).

alter table config add column if not exists nombre text not null default 'Mi Estacionamiento';
alter table config add column if not exists direccion text;
alter table config add column if not exists telefono text;
alter table config add column if not exists logo_url text;
alter table config add column if not exists imprimir_ingreso boolean not null default false;
alter table config add column if not exists imprimir_egreso boolean not null default false;

alter table visitas add column if not exists numero_ticket int generated always as identity;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visitas_numero_ticket_unique'
  ) then
    alter table visitas add constraint visitas_numero_ticket_unique unique (numero_ticket);
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

drop policy if exists "authenticated write logos" on storage.objects;
create policy "authenticated write logos" on storage.objects for all
  using (bucket_id = 'logos' and auth.role() = 'authenticated')
  with check (bucket_id = 'logos' and auth.role() = 'authenticated');

drop policy if exists "public read logos" on storage.objects;
create policy "public read logos" on storage.objects for select using (bucket_id = 'logos');
```

- [ ] **Step 2: Actualizar `schema.sql` para proyectos nuevos**

En `supabase/schema.sql`, reemplazar el bloque de creación de `config` (bajo el comentario `create table config (`) por:

```sql
create table config (
  id int primary key default 1,
  nombre text not null default 'Mi Estacionamiento',
  direccion text,
  telefono text,
  logo_url text,
  total_espacios int not null,
  umbral_media_estadia_horas int not null,
  umbral_estadia_completa_horas int not null,
  umbral_tolerancia_min int not null default 15,
  imprimir_ingreso boolean not null default false,
  imprimir_egreso boolean not null default false,
  updated_at timestamptz not null default now(),
  check (id = 1)
);
```

En la creación de `visitas`, reemplazar:

```sql
create table visitas (
  id text primary key,
  vehiculo_id text not null references vehiculos (patente),
  hora_ingreso timestamptz not null,
  estado text not null check (estado in ('dentro', 'afuera')),
  created_at timestamptz not null default now()
);
```

por:

```sql
create table visitas (
  id text primary key,
  vehiculo_id text not null references vehiculos (patente),
  hora_ingreso timestamptz not null,
  numero_ticket int generated always as identity,
  estado text not null check (estado in ('dentro', 'afuera')),
  created_at timestamptz not null default now(),
  unique (numero_ticket)
);
```

El archivo no tiene todavía ninguna sección de Storage. Agregar al final del archivo (después del bloque `create trigger on_auth_user_created ...` con el que termina hoy):

```sql
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "authenticated write logos" on storage.objects for all
  using (bucket_id = 'logos' and auth.role() = 'authenticated')
  with check (bucket_id = 'logos' and auth.role() = 'authenticated');

create policy "public read logos" on storage.objects for select using (bucket_id = 'logos');
```

- [ ] **Step 3: Commit**

```bash
git add supabase/add_tickets.sql supabase/schema.sql
git commit -m "feat(db): columnas de identidad del negocio, flags de impresión y numeración de ticket"
```

---

### Task 2: Helper `fmtDateTime`

**Files:**
- Modify: `src/lib/format.js`
- Modify: `src/lib/format.test.js`

- [ ] **Step 1: Escribir el test que falla**

En `src/lib/format.test.js`, agregar al principio del archivo (después del import existente, cambiándolo para incluir `fmtDateTime`):

```js
import { describe, it, expect } from "vitest";
import { calcularMonto, tramoLabel, fmtDateTime } from "./format";
```

Y agregar al final del archivo:

```js

describe("fmtDateTime", () => {
  it("incluye la fecha en formato dd/mm/aaaa y la hora en formato hh:mm", () => {
    const ts = new Date(2026, 7, 31, 14, 5, 0).getTime(); // 31/ago/2026 14:05 (mes 0-indexed)
    const out = fmtDateTime(ts);
    expect(out).toContain("31/08/2026");
    expect(out).toContain("14:05");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- format.test.js`
Expected: FAIL — `fmtDateTime` no está exportado por `./format`.

- [ ] **Step 3: Implementar `fmtDateTime`**

En `src/lib/format.js`, agregar después de `fmtDateShort` (línea 22):

```js
export const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- format.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.js src/lib/format.test.js
git commit -m "feat: agregar fmtDateTime para el ticket imprimible"
```

---

### Task 3: `DEFAULT_CONFIG` con campos nuevos

**Files:**
- Modify: `src/constants.js`
- Modify: `src/constants.test.js`

- [ ] **Step 1: Escribir el test que falla**

En `src/constants.test.js`, agregar al final del archivo:

```js

describe("DEFAULT_CONFIG.impresión", () => {
  it("tiene la impresión automática desactivada por defecto", () => {
    expect(DEFAULT_CONFIG.imprimirIngreso).toBe(false);
    expect(DEFAULT_CONFIG.imprimirEgreso).toBe(false);
  });

  it("tiene los campos de identidad del negocio como string vacío por defecto", () => {
    expect(DEFAULT_CONFIG.direccion).toBe("");
    expect(DEFAULT_CONFIG.telefono).toBe("");
    expect(DEFAULT_CONFIG.logoUrl).toBe("");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- constants.test.js`
Expected: FAIL — los campos son `undefined`, no `false`/`""`.

- [ ] **Step 3: Agregar los campos a `DEFAULT_CONFIG`**

En `src/constants.js`, dentro de `DEFAULT_CONFIG` (después de `nombre: "Mi Estacionamiento",` en la línea 4):

```js
export const DEFAULT_CONFIG = {
  nombre: "Mi Estacionamiento",
  direccion: "",
  telefono: "",
  logoUrl: "",
  imprimirIngreso: false,
  imprimirEgreso: false,
  totalEspacios: 40,
  rates: {
```

(Mantener el resto de `rates`/`umbrales` sin cambios.)

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- constants.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/constants.js src/constants.test.js
git commit -m "feat: agregar campos de identidad del negocio e impresión a DEFAULT_CONFIG"
```

---

### Task 4: `storage.js` — leer/escribir config e insertar con `numeroTicket`

**Files:**
- Modify: `src/storage.js`

No hay tests unitarios existentes para `storage.js` (depende de un cliente Supabase real); este módulo se verifica manualmente en la Task 9. Los cambios son mecánicos y acotados.

- [ ] **Step 1: Actualizar `configFromRows`**

Reemplazar (líneas 29-44):

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
      ...(configRow.umbral_tolerancia_min != null ? { toleranciaMin: configRow.umbral_tolerancia_min } : {}),
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
    nombre: configRow.nombre,
    direccion: configRow.direccion || "",
    telefono: configRow.telefono || "",
    logoUrl: configRow.logo_url || "",
    imprimirIngreso: !!configRow.imprimir_ingreso,
    imprimirEgreso: !!configRow.imprimir_egreso,
    totalEspacios: configRow.total_espacios,
    rates,
    umbrales: {
      mediaEstadiaHoras: configRow.umbral_media_estadia_horas,
      estadiaCompletaHoras: configRow.umbral_estadia_completa_horas,
      ...(configRow.umbral_tolerancia_min != null ? { toleranciaMin: configRow.umbral_tolerancia_min } : {}),
    },
  };
}
```

- [ ] **Step 2: Actualizar `setConfig`**

Reemplazar (líneas 132-140):

```js
  async setConfig(config) {
    const { error: eC } = await supabase.from("config").upsert({
      id: 1,
      total_espacios: config.totalEspacios,
      umbral_media_estadia_horas: config.umbrales.mediaEstadiaHoras,
      umbral_estadia_completa_horas: config.umbrales.estadiaCompletaHoras,
      umbral_tolerancia_min: config.umbrales.toleranciaMin,
    });
    if (eC) throw eC;
```

por:

```js
  async setConfig(config) {
    const { error: eC } = await supabase.from("config").upsert({
      id: 1,
      nombre: config.nombre,
      direccion: config.direccion || null,
      telefono: config.telefono || null,
      logo_url: config.logoUrl || null,
      imprimir_ingreso: !!config.imprimirIngreso,
      imprimir_egreso: !!config.imprimirEgreso,
      total_espacios: config.totalEspacios,
      umbral_media_estadia_horas: config.umbrales.mediaEstadiaHoras,
      umbral_estadia_completa_horas: config.umbrales.estadiaCompletaHoras,
      umbral_tolerancia_min: config.umbrales.toleranciaMin,
    });
    if (eC) throw eC;
```

- [ ] **Step 3: Agregar `numeroTicket` a `flattenVehicle`**

Reemplazar (líneas 13-27):

```js
function flattenVehicle(visita, vehiculo, egreso) {
  if (!vehiculo) {
    console.error(`storage: visita ${visita.id} referencia un vehiculo inexistente (${visita.vehiculo_id})`);
    return null;
  }
  return {
    id: visita.id,
    patente: vehiculo.patente,
    tipo: vehiculo.tipo_id,
    horaIngreso: new Date(visita.hora_ingreso).getTime(),
    horaSalida: egreso ? new Date(egreso.hora_salida).getTime() : null,
    monto: egreso ? Number(egreso.monto) : null,
    estado: visita.estado,
  };
}
```

por:

```js
function flattenVehicle(visita, vehiculo, egreso) {
  if (!vehiculo) {
    console.error(`storage: visita ${visita.id} referencia un vehiculo inexistente (${visita.vehiculo_id})`);
    return null;
  }
  return {
    id: visita.id,
    patente: vehiculo.patente,
    tipo: vehiculo.tipo_id,
    horaIngreso: new Date(visita.hora_ingreso).getTime(),
    horaSalida: egreso ? new Date(egreso.hora_salida).getTime() : null,
    monto: egreso ? Number(egreso.monto) : null,
    estado: visita.estado,
    numeroTicket: visita.numero_ticket,
  };
}
```

- [ ] **Step 4: `insertVehicle` devuelve `numeroTicket`**

Reemplazar (líneas 86-107):

```js
  async insertVehicle(vehicle) {
    const { error: upsertError } = await supabase
      .from("vehiculos")
      .upsert({ patente: vehicle.patente, tipo_id: vehicle.tipo }, { onConflict: "patente" });
    if (upsertError) throw upsertError;

    const { error } = await supabase.from("visitas").insert({
      id: vehicle.id,
      vehiculo_id: vehicle.patente,
      hora_ingreso: new Date(vehicle.horaIngreso).toISOString(),
      estado: "dentro",
    });
    if (error) {
      if (error.code === "23505") {
        const dupError = new Error(`${vehicle.patente} ya está registrado dentro`);
        dupError.code = "DUPLICATE_PATENTE";
        throw dupError;
      }
      throw error;
    }
    return vehicle;
  },
```

por:

```js
  async insertVehicle(vehicle) {
    const { error: upsertError } = await supabase
      .from("vehiculos")
      .upsert({ patente: vehicle.patente, tipo_id: vehicle.tipo }, { onConflict: "patente" });
    if (upsertError) throw upsertError;

    const { data, error } = await supabase
      .from("visitas")
      .insert({
        id: vehicle.id,
        vehiculo_id: vehicle.patente,
        hora_ingreso: new Date(vehicle.horaIngreso).toISOString(),
        estado: "dentro",
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        const dupError = new Error(`${vehicle.patente} ya está registrado dentro`);
        dupError.code = "DUPLICATE_PATENTE";
        throw dupError;
      }
      throw error;
    }
    return { ...vehicle, numeroTicket: data.numero_ticket };
  },
```

- [ ] **Step 5: Agregar `uploadLogo`**

Agregar dentro del objeto `storage`, después del método `setConfig` (después del cierre de su bloque, antes de `subscribeToChanges`):

```js
  async uploadLogo(file) {
    const ext = file.name.split(".").pop();
    const path = `logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
    if (error) throw error;
    return supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
  },

```

- [ ] **Step 6: Correr toda la suite para verificar que nada se rompió**

Run: `npm test`
Expected: PASS (los tests existentes no ejercitan `storage.js` directamente, así que deben seguir pasando igual que antes).

- [ ] **Step 7: Commit**

```bash
git add src/storage.js
git commit -m "feat(storage): persistir identidad del negocio, flags de impresión, numeroTicket y uploadLogo"
```

---

### Task 5: Componente `Ticket.jsx`

**Files:**
- Create: `src/components/Ticket.jsx`

- [ ] **Step 1: Crear el componente**

```jsx
import React from "react";
import { TIPOS } from "../constants";
import { fmtMoney, fmtDur, fmtDateTime, tramoLabel } from "../lib/format";

export default function Ticket({ config, job }) {
  if (!job) return null;
  const { tipo, vehicle } = job;
  const tipoLabel = TIPOS.find((t) => t.id === vehicle.tipo)?.label || vehicle.tipo;
  const minutos = tipo === "egreso" ? (vehicle.horaSalida - vehicle.horaIngreso) / 60000 : null;

  return (
    <div style={{ fontFamily: "monospace", color: "#000", background: "#fff", width: "80mm", padding: "4mm", fontSize: "12px" }}>
      <div style={{ textAlign: "center", marginBottom: "2mm" }}>
        {config.logoUrl && (
          <img src={config.logoUrl} alt="" style={{ maxWidth: "40mm", maxHeight: "20mm", margin: "0 auto 2mm" }} />
        )}
        <p style={{ fontWeight: "bold", fontSize: "14px" }}>{config.nombre}</p>
        {config.direccion && <p>{config.direccion}</p>}
        {config.telefono && <p>{config.telefono}</p>}
      </div>

      <hr style={{ border: "none", borderTop: "1px dashed #000", margin: "2mm 0" }} />

      <p style={{ textAlign: "center", fontWeight: "bold" }}>
        {tipo === "ingreso" ? "INGRESO" : "COMPROBANTE DE SALIDA"}
      </p>
      <p>N&deg; Ticket: {vehicle.numeroTicket}</p>
      <p>Patente: {vehicle.patente}</p>
      <p>Tipo: {tipoLabel}</p>
      <p>Ingreso: {fmtDateTime(vehicle.horaIngreso)}</p>

      {tipo === "egreso" && (
        <>
          <p>Salida: {fmtDateTime(vehicle.horaSalida)}</p>
          <p>Duración: {fmtDur(minutos)}</p>
          <p>Tramo: {tramoLabel(minutos, config.umbrales)}</p>
          <hr style={{ border: "none", borderTop: "1px dashed #000", margin: "2mm 0" }} />
          <p style={{ fontWeight: "bold", fontSize: "14px", textAlign: "center" }}>Total: {fmtMoney(vehicle.monto)}</p>
        </>
      )}

      <hr style={{ border: "none", borderTop: "1px dashed #000", margin: "2mm 0" }} />
      <p style={{ textAlign: "center", fontSize: "10px" }}>Impreso: {fmtDateTime(Date.now())}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Ticket.jsx
git commit -m "feat: agregar componente Ticket para impresión de ingreso/egreso"
```

---

### Task 6: CSS de impresión

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Agregar las reglas de impresión**

En `src/index.css`, agregar al final del archivo:

```css

@media screen {
  #ticket-print {
    display: none;
  }
}

@media print {
  body * {
    visibility: hidden;
  }
  #ticket-print,
  #ticket-print * {
    visibility: visible;
  }
  #ticket-print {
    position: absolute;
    top: 0;
    left: 0;
    width: 80mm;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/index.css
git commit -m "feat: estilos de impresión para el ticket oculto"
```

---

### Task 7: Wiring en `App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Importar `Ticket`**

Después de la línea `import LoginScreen from "./components/LoginScreen";` (línea 14), agregar:

```js
import Ticket from "./components/Ticket";
```

- [ ] **Step 2: Agregar el estado `printJob`**

Reemplazar (línea 58):

```js
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
```

por:

```js
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [printJob, setPrintJob] = useState(null);
```

- [ ] **Step 3: Agregar la función `imprimir`**

Justo antes de `const registrarIngreso = async (patente, tipo) => {` (línea 178), agregar:

```js
  const imprimir = (tipo, vehicle) => {
    setPrintJob({ tipo, vehicle });
    requestAnimationFrame(() => window.print());
  };

```

- [ ] **Step 4: `registrarIngreso` devuelve el vehículo con `numeroTicket` e imprime si corresponde**

Reemplazar (líneas 178-207):

```js
  const registrarIngreso = async (patente, tipo) => {
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
    setVehicles((prev) => [vehicle, ...prev]);
    try {
      await storage.insertVehicle(vehicle);
      setSaveError(false);
      showToast(`Ingreso registrado: ${pat}`);
    } catch (e) {
      setVehicles((prev) => prev.filter((v) => v.id !== vehicle.id));
      if (e.code === "DUPLICATE_PATENTE") {
        showToast(`${pat} ya está registrado dentro`);
      } else {
        setSaveError(true);
      }
    }
  };
```

por:

```js
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
```

- [ ] **Step 5: `registrarSalida` devuelve el vehículo actualizado e imprime si corresponde**

Reemplazar (líneas 209-222):

```js
  const registrarSalida = async (id, monto) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    const patch = { horaSalida: Date.now(), monto, estado: "afuera" };
    setVehicles((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      await storage.updateVehicle(id, patch);
      setSaveError(false);
      showToast(`Salida registrada: ${v.patente} · ${fmtMoney(monto)}`);
    } catch (e) {
      setVehicles((prev) => prev.map((x) => (x.id === id ? v : x)));
      setSaveError(true);
    }
  };
```

por:

```js
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
```

- [ ] **Step 6: Pasar `onReimprimir` a los tabs y renderizar el ticket oculto**

Reemplazar (líneas 280-311):

```js
          {activeTab === "entrada" && (
            <EntradaTab onRegistrar={registrarIngreso} disponibles={disponibles} />
          )}
          {activeTab === "salida" && (
            <SalidaTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              rates={config.rates}
              umbrales={config.umbrales}
              onSalida={registrarSalida}
            />
          )}
          {activeTab === "estado" && (
            <EstadoTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              totalEspacios={config.totalEspacios}
              disponibles={disponibles}
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
```

por:

```js
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
```

- [ ] **Step 7: Renderizar el contenedor del ticket**

Buscar el cierre del componente, donde termina el `return (...)` de `App` (después del bloque de `BottomNav` y del `toast`, antes del cierre de la etiqueta `</div>` raíz). Agregar justo antes de esa etiqueta de cierre:

```jsx
      <div id="ticket-print">
        <Ticket config={config} job={printJob} />
      </div>
```

- [ ] **Step 8: Correr la suite completa**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/App.jsx
git commit -m "feat: disparar impresión automática de tickets y wiring de reimpresión"
```

---

### Task 8: Botones de reimpresión en los tabs

**Files:**
- Modify: `src/components/EntradaTab.jsx`
- Modify: `src/components/SalidaTab.jsx`
- Modify: `src/components/EstadoTab.jsx`

- [ ] **Step 1: `EntradaTab` — guardar el último registro y mostrar botón**

Reemplazar todo el contenido de `src/components/EntradaTab.jsx` por:

```jsx
import React, { useState } from "react";
import { LogIn, Check, Printer } from "lucide-react";
import { TIPOS } from "../constants";
import { SectionTitle } from "./ui";

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

export default function EntradaTab({ onRegistrar, disponibles, onReimprimir }) {
  const [patente, setPatente] = useState("");
  const [tipo, setTipo] = useState("auto");
  const [ultimoRegistro, setUltimoRegistro] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const registrado = await onRegistrar(patente, tipo);
    if (registrado) setUltimoRegistro(registrado);
    setPatente("");
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
```

- [ ] **Step 2: `SalidaTab` — guardar el último cobro y mostrar botón**

Reemplazar todo el contenido de `src/components/SalidaTab.jsx` por:

```jsx
import React, { useState } from "react";
import { LogOut, Search, Clock3, Check, X, ChevronRight, Car, Printer } from "lucide-react";
import { TIPOS } from "../constants";
import { fmtMoney, fmtDur, fmtTime, calcularMonto, tramoLabel } from "../lib/format";
import { SectionTitle, EmptyState } from "./ui";

/* ------------------------------------------------------------------ */
/* Salida                                                               */
/* ------------------------------------------------------------------ */

export default function SalidaTab({ vehiculosDentro, now, rates, umbrales, onSalida, onReimprimir }) {
  const [q, setQ] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [ultimoCobro, setUltimoCobro] = useState(null);

  const filtered = vehiculosDentro.filter((v) => v.patente.includes(q.toUpperCase()));

  const confirmarCobro = async (id, monto) => {
    const resultado = await onSalida(id, monto);
    if (resultado) setUltimoCobro(resultado);
    setConfirmId(null);
  };

  return (
    <div>
      <SectionTitle icon={LogOut} title="Registrar salida" subtitle={`${vehiculosDentro.length} vehículo(s) dentro`} />

      {ultimoCobro && (
        <div className="rounded-xl p-3.5 mb-4 flex items-center justify-between" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm">
            Cobrado a <span style={{ fontFamily: "var(--font-display)" }} className="font-bold">{ultimoCobro.patente}</span> · {fmtMoney(ultimoCobro.monto)}
          </p>
          <button
            onClick={() => onReimprimir("egreso", ultimoCobro)}
            className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5"
            style={{ background: "var(--surface2)", color: "var(--text)" }}
          >
            <Printer size={14} /> Reimprimir
          </button>
        </div>
      )}

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setUltimoCobro(null);
          }}
          placeholder="Buscar patente…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl outline-none text-sm"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          Icon={LogOut}
          text={vehiculosDentro.length === 0 ? "No hay vehículos dentro para dar salida." : "Ningún vehículo coincide con la búsqueda."}
        />
      ) : (
        <div className="space-y-2.5">
          {filtered
            .sort((a, b) => a.horaIngreso - b.horaIngreso)
            .map((v) => {
              const minutos = (now - v.horaIngreso) / 60000;
              const vehicleRates = rates[v.tipo] || rates.auto;
              const monto = calcularMonto(minutos, vehicleRates, umbrales);
              const Icon = TIPOS.find((t) => t.id === v.tipo)?.Icon || Car;
              const confirming = confirmId === v.id;
              return (
                <div key={v.id} className="rounded-xl p-3.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--surface2)" }}>
                        <Icon size={17} style={{ color: "var(--accent)" }} />
                      </div>
                      <div>
                        <p style={{ fontFamily: "var(--font-display)" }} className="font-bold tracking-wide text-sm">{v.patente}</p>
                        <p style={{ color: "var(--muted)" }} className="text-xs flex items-center gap-1">
                          <Clock3 size={11} /> {fmtTime(v.horaIngreso)} · {fmtDur(minutos)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p style={{ fontFamily: "var(--font-display)" }} className="font-bold text-sm">{fmtMoney(monto)}</p>
                      <p style={{ color: "var(--muted)" }} className="text-[10px]">{tramoLabel(minutos, umbrales)}</p>
                    </div>
                  </div>

                  {confirming ? (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => confirmarCobro(v.id, monto)}
                        className="flex-1 py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-1.5"
                        style={{ background: "var(--accent2)", color: "#08210F" }}
                      >
                        <Check size={16} /> Confirmar cobro
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="px-4 py-2.5 rounded-lg font-medium text-sm"
                        style={{ background: "var(--surface2)", color: "var(--muted)" }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(v.id)}
                      className="w-full mt-3 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-1.5"
                      style={{ background: "var(--surface2)", color: "var(--text)" }}
                    >
                      Dar salida <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `EstadoTab` — botón de reimprimir por fila**

Reemplazar todo el contenido de `src/components/EstadoTab.jsx` por:

```jsx
import React from "react";
import { Gauge, ParkingSquare, Car, Printer } from "lucide-react";
import { TIPOS } from "../constants";
import { fmtTime, fmtDur } from "../lib/format";
import { SectionTitle, StatCard, EmptyState } from "./ui";

/* ------------------------------------------------------------------ */
/* Estado                                                               */
/* ------------------------------------------------------------------ */

export default function EstadoTab({ vehiculosDentro, now, totalEspacios, disponibles, onReimprimir }) {
  return (
    <div>
      <SectionTitle icon={Gauge} title="Estado del estacionamiento" subtitle="Ocupación en tiempo real" />

      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <StatCard label="Ocupados" value={vehiculosDentro.length} color="var(--accent)" />
        <StatCard label="Libres" value={disponibles} color="var(--accent2)" />
        <StatCard label="Total" value={totalEspacios} color="var(--text)" />
      </div>

      {vehiculosDentro.length === 0 ? (
        <EmptyState Icon={ParkingSquare} text="El estacionamiento está vacío por ahora." />
      ) : (
        <div className="space-y-2">
          {vehiculosDentro
            .sort((a, b) => a.horaIngreso - b.horaIngreso)
            .map((v) => {
              const Icon = TIPOS.find((t) => t.id === v.tipo)?.Icon || Car;
              const minutos = (now - v.horaIngreso) / 60000;
              return (
                <div key={v.id} className="flex items-center justify-between rounded-lg px-3.5 py-2.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2.5">
                    <Icon size={16} style={{ color: "var(--muted)" }} />
                    <span style={{ fontFamily: "var(--font-display)" }} className="font-semibold text-sm tracking-wide">{v.patente}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span style={{ color: "var(--muted)" }} className="text-xs">desde {fmtTime(v.horaIngreso)} · {fmtDur(minutos)}</span>
                    <button
                      onClick={() => onReimprimir("ingreso", v)}
                      aria-label={`Reimprimir ticket de ${v.patente}`}
                      className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                      style={{ background: "var(--surface2)" }}
                    >
                      <Printer size={13} style={{ color: "var(--muted)" }} />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr la suite completa**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/EntradaTab.jsx src/components/SalidaTab.jsx src/components/EstadoTab.jsx
git commit -m "feat: botones de reimpresión en Entrada, Salida y Estado"
```

---

### Task 9: `ConfigTab.jsx` — datos del negocio, logo e impresión

**Files:**
- Modify: `src/components/ConfigTab.jsx`

- [ ] **Step 1: Importar `storage` y `Printer`**

Reemplazar (líneas 1-5):

```jsx
import React, { useState } from "react";
import { Settings2, Check, RotateCcw, Trash2 } from "lucide-react";
import { TIPOS } from "../constants";
import { SectionTitle, ConfigField, RateField } from "./ui";
import UserManagement from "./UserManagement";
```

por:

```jsx
import React, { useState } from "react";
import { Settings2, Check, RotateCcw, Trash2 } from "lucide-react";
import { TIPOS } from "../constants";
import { SectionTitle, ConfigField, RateField } from "./ui";
import UserManagement from "./UserManagement";
import { storage } from "../storage";
```

- [ ] **Step 2: Estado local para la subida del logo**

Reemplazar (líneas 11-16):

```jsx
export default function ConfigTab({ config, onSave, onResetDemo, onBorrarTodo, currentUserId }) {
  const [local, setLocal] = useState(config);
  const [tipoActivo, setTipoActivo] = useState(TIPOS[0].id);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [saved, setSaved] = useState(false);
```

por:

```jsx
export default function ConfigTab({ config, onSave, onResetDemo, onBorrarTodo, currentUserId }) {
  const [local, setLocal] = useState(config);
  const [tipoActivo, setTipoActivo] = useState(TIPOS[0].id);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState("");

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setLogoError("");
    try {
      const url = await storage.uploadLogo(file);
      setLocal((prev) => ({ ...prev, logoUrl: url }));
    } catch (err) {
      setLogoError("No se pudo subir el logo.");
    } finally {
      setUploadingLogo(false);
    }
  };
```

- [ ] **Step 3: Agregar la sección "Datos del negocio"**

Reemplazar (líneas 49-56, el `ConfigField` de "Capacidad total"):

```jsx
        <ConfigField label="Capacidad total (espacios)">
          <input
            type="number"
            value={local.totalEspacios}
            onChange={(e) => setLocal({ ...local, totalEspacios: Number(e.target.value) || 0 })}
            className="input-field"
          />
        </ConfigField>
```

por:

```jsx
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
```

- [ ] **Step 4: Agregar la sección "Impresión de tickets"**

Reemplazar (líneas 90-97, el bloque de "Umbrales de tramo"):

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

        <div>
          <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-2">Impresión de tickets</p>
          <label className="flex items-center gap-2.5 py-2">
            <input
              type="checkbox"
              checked={!!local.imprimirIngreso}
              onChange={(e) => setLocal({ ...local, imprimirIngreso: e.target.checked })}
            />
            <span className="text-sm">Imprimir automáticamente al ingreso</span>
          </label>
          <label className="flex items-center gap-2.5 py-2">
            <input
              type="checkbox"
              checked={!!local.imprimirEgreso}
              onChange={(e) => setLocal({ ...local, imprimirEgreso: e.target.checked })}
            />
            <span className="text-sm">Imprimir automáticamente al egreso</span>
          </label>
        </div>
```

- [ ] **Step 5: Correr la suite completa**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/ConfigTab.jsx
git commit -m "feat: sección de datos del negocio, logo e impresión en Config"
```

---

### Task 10: Documentación y verificación manual en navegador

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Documentar la migración y la feature en `README.md`**

En la sección "Backend (Supabase)" del `README.md`, dentro del punto 3 ("Correr el SQL"), agregar después del párrafo que menciona `migrate_vehicles_to_3fn.sql`:

```markdown
   - Proyecto existente que ya corrió el esquema 3FN de arriba pero es de
     antes de la feature de impresión de tickets: correr además
     `supabase/add_tickets.sql`, que agrega los datos de identidad del
     negocio (nombre, dirección, teléfono, logo), los flags de impresión
     automática y la numeración secuencial de ticket.
```

Y agregar una sección nueva antes de "## Configuración":

```markdown
## Impresión de tickets

Desde **Config** se puede activar la impresión automática de un ticket al
registrar el ingreso y/o el egreso de un vehículo (dos interruptores
independientes). El ticket se imprime con el diálogo de impresión nativo del
navegador (`window.print()`) contra la impresora térmica de 80mm que ya esté
instalada como impresora del sistema — no requiere ningún driver ni
integración especial. También se puede reimprimir manualmente un ticket:
justo después de registrar un ingreso (botón bajo el formulario), justo
después de cobrar una salida (botón en el resumen que aparece), o en
cualquier momento desde el listado de **Estado** (ícono de impresora en cada
vehículo dentro).

El nombre, dirección, teléfono y logo del estacionamiento que aparecen en el
ticket se configuran también desde **Config**; el logo se sube como imagen y
queda alojado en Supabase Storage.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: documentar impresión de tickets y migración add_tickets.sql"
```

- [ ] **Step 3: Verificación manual en el navegador**

Esta verificación no se puede automatizar (no hay impresora térmica física
disponible en este entorno; tampoco hay tests de componentes React en el
proyecto). Correr:

```bash
npm run dev
```

Y con la app abierta:

1. Ir a **Config**, completar dirección, teléfono, subir un logo, activar
   ambos toggles de impresión, guardar.
2. Ir a **Entrada**, registrar una patente nueva. Verificar que se abre el
   diálogo de impresión del navegador y que la vista previa muestra: logo,
   nombre, dirección, teléfono, "INGRESO", N° de ticket, patente, tipo,
   hora de ingreso. Cancelar el diálogo y verificar que aparece el botón
   "Reimprimir ticket" bajo el formulario; probarlo.
3. Ir a **Estado**, verificar que el vehículo recién ingresado tiene un
   ícono de impresora y que al tocarlo se abre el mismo ticket de ingreso.
4. Ir a **Salida**, dar salida a ese vehículo confirmando el cobro.
   Verificar que se abre el diálogo de impresión con "COMPROBANTE DE
   SALIDA", duración, tramo y monto correctos, y que aparece el botón
   "Reimprimir" en el resumen posterior al cobro.
5. Volver a **Config**, desactivar ambos toggles, guardar, y repetir un
   ingreso/egreso: verificar que esta vez NO se abre el diálogo de
   impresión automáticamente (los botones de reimpresión manual igual
   deben seguir funcionando).

Si algún paso falla, volver a la task correspondiente, corregir y repetir
esta verificación antes de continuar.
