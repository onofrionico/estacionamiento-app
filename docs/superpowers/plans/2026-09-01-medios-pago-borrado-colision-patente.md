# Medios de pago, borrado lógico y colisión de patente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar registro de medio de pago al cobrar una salida (configurable desde Config), permitir borrar registros individuales del historial de forma reversible-por-auditoría (borrado lógico, visible en la base pero no en la app), y resolver la colisión de patentes duplicadas entre vehículos simultáneamente "dentro" sugiriendo un sufijo.

**Architecture:** Todo pasa por el mismo camino de datos ya existente (`supabase/schema.sql` → `src/storage.js` → `src/App.jsx` → tabs). Se agrega una tabla `medios_pago` (mismo patrón que `tipos_vehiculo`), dos columnas de borrado lógico en `visitas`, y dos RPCs nuevas/modificadas para mantener las operaciones atómicas del lado del servidor (mismo patrón que `cerrar_visita` ya usa). El frontend no cambia de arquitectura: se extienden los mismos componentes y el mismo flujo optimista-con-rollback que ya usan `registrarIngreso`/`registrarSalida`.

**Tech Stack:** React 18 + Vite, Supabase (Postgres + RLS + Realtime), Tailwind, lucide-react, xlsx, Vitest.

**Ver también:** spec en `docs/superpowers/specs/2026-09-01-medios-pago-borrado-colision-patente-design.md`.

---

## Mapa de dependencias entre tareas

```
Task 1 (SQL)  ──────────────────────────────────────────┐
                                                          │ (necesarias antes de
Task 2 (helpers puros + tests) ──┐                       │  poder probar manualmente
                                  ├──> Task 4 (App.jsx)   │  cada tab en el navegador)
Task 3 (storage.js, depende de Task 1) ──┘               │
                                                          │
Task 4 ──> Task 5 (EntradaTab)                           │
Task 4 ──> Task 6 (SalidaTab)                             │
Task 4 ──> Task 7 (ConfigTab)                              │
Task 4 ──> Task 8 (ReportesTab)                              │
Tasks 5-8 ──> Task 9 (verificación manual end-to-end) ───────┘
```

Task 1 puede correrse en paralelo con Task 2 (no dependen entre sí). Task 3 necesita que Task 1 ya haya corrido contra la base de Supabase que se use para desarrollo (la tabla `medios_pago` y las columnas nuevas tienen que existir para que las queries de `storage.js` no fallen en `npm run dev`). Tasks 5-8 son independientes entre sí una vez completada la Task 4, pero todas tocan `App.jsx`, así que conviene hacerlas en secuencia para evitar conflictos de merge sobre el mismo archivo.

---

## Contexto de archivos relevantes (ya explorado)

- `supabase/schema.sql` — script único para instalar de cero (ver comentario al tope del archivo). Contiene tablas `tipos_vehiculo`, `vehiculos`, `visitas`, `egresos`, `tarifas_por_tipo`/`tarifas_vigentes`, `config`, RLS/grants, la función `cerrar_visita`, la publicación de realtime, y al final (sección "Roles y permisos") la tabla `profiles` + trigger de alta automática.
- `src/storage.js` (192 líneas) — capa sobre Supabase; ver contenido completo ya citado en el spec. Expone `storage.getVehicles/insertVehicle/updateVehicle/deleteAllVehicles/getConfig/setConfig/subscribeToChanges`.
- `src/App.jsx` (336 líneas) — estado global (`vehicles`, `config`, `session`, `profile`, etc.), handlers (`registrarIngreso`, `registrarSalida`, `updateConfig`, `resetDemo`, `borrarTodo`), composición de tabs.
- `src/components/EntradaTab.jsx`, `SalidaTab.jsx`, `ConfigTab.jsx`, `ReportesTab.jsx` — ya citados completos más abajo en cada tarea.
- `src/lib/format.js` — helpers puros con tests en `src/lib/format.test.js` (Vitest, `npm test`).
- `src/components/ui.jsx` — átomos compartidos (`SectionTitle`, `EmptyState`, `ConfigField`, `RateField`, etc.), no requieren cambios.
- No hay test framework para `storage.js`/componentes (solo para helpers puros de `lib/`). La verificación de componentes/RPCs es manual: `npm run build` + recorrido en `npm run dev`.

---

## Task 1: Migración de base de datos (Supabase)

**Files:**
- Modify: `supabase/schema.sql`
- Create: `supabase/add_medios_pago_borrado_logico.sql`

### Paso 1: Agregar tabla `medios_pago` en `schema.sql`

En `supabase/schema.sql`, ubicar el bloque de `tipos_vehiculo` (líneas 13-21):

```sql
create table tipos_vehiculo (
  id text primary key,
  nombre text not null
);

insert into tipos_vehiculo (id, nombre) values
  ('auto', 'Auto'),
  ('moto', 'Moto'),
  ('camioneta', 'Camioneta');
```

Justo debajo, antes de `create table vehiculos (`, insertar:

```sql
create table medios_pago (
  id text primary key,
  nombre text not null,
  activo boolean not null default true
);

insert into medios_pago (id, nombre) values
  ('efectivo', 'Efectivo'),
  ('tarjeta', 'Tarjeta'),
  ('transferencia', 'Transferencia'),
  ('qr', 'QR / Mercado Pago');
```

### Paso 2: Agregar `medio_pago_id` a `egresos`

En `schema.sql`, reemplazar el bloque de `egresos`:

```sql
create table egresos (
  visita_id text primary key references visitas (id) on delete cascade,
  hora_salida timestamptz not null,
  monto numeric not null,
  created_at timestamptz not null default now()
);
```

por:

```sql
create table egresos (
  visita_id text primary key references visitas (id) on delete cascade,
  hora_salida timestamptz not null,
  monto numeric not null,
  medio_pago_id text references medios_pago (id),
  created_at timestamptz not null default now()
);
```

### Paso 3: RLS, grants y policy de `medios_pago`

En el bloque `alter table ... enable row level security;` (líneas 85-90), agregar una línea:

```sql
alter table medios_pago enable row level security;
```

(dejarla junto a las demás, cualquier orden sirve).

En el bloque de `grant` (líneas 92-98), agregar:

```sql
grant select, insert, update on public.medios_pago to authenticated;
```

Sin `delete`: los medios de pago se desactivan (`activo = false`), no se borran, para no perder la referencia desde egresos viejos.

En el bloque de `revoke ... from anon;` (líneas 100-106), agregar:

```sql
revoke all on public.medios_pago from anon;
```

Junto a la policy de `tipos_vehiculo` (líneas 108-111), agregar la policy de `medios_pago`:

```sql
drop policy if exists "allow authenticated read/write medios_pago" on medios_pago;
create policy "allow authenticated read/write medios_pago"
  on medios_pago for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
```

(La ausencia de `delete` en el `grant` ya impide borrar filas aunque la policy sea `for all` — mismo patrón que usan `vehiculos`/`visitas`/`egresos`.)

### Paso 4: Actualizar `cerrar_visita` para recibir el medio de pago

Reemplazar el bloque completo de la función (líneas 143-172):

```sql
-- Cierra una visita de forma atómica: crea el egreso y marca la visita como
-- "afuera" en una sola transacción, para que nunca queden desincronizados
-- (ej. si el cliente se cae entre los dos pasos). security invoker: corre
-- con los privilegios del usuario autenticado que la llama, así que las
-- policies RLS de egresos/visitas se siguen aplicando igual.
create or replace function public.cerrar_visita(
  p_visita_id text,
  p_hora_salida timestamptz,
  p_monto numeric
)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.egresos (visita_id, hora_salida, monto)
  values (p_visita_id, p_hora_salida, p_monto);

  update public.visitas
  set estado = 'afuera'
  where id = p_visita_id
    and estado = 'dentro';

  if not found then
    raise exception 'visita % no está dentro (ya salió o no existe)', p_visita_id;
  end if;
end;
$$;

grant execute on function public.cerrar_visita(text, timestamptz, numeric) to authenticated;
```

por:

```sql
-- Cierra una visita de forma atómica: crea el egreso y marca la visita como
-- "afuera" en una sola transacción, para que nunca queden desincronizados
-- (ej. si el cliente se cae entre los dos pasos). security invoker: corre
-- con los privilegios del usuario autenticado que la llama, así que las
-- policies RLS de egresos/visitas se siguen aplicando igual.
drop function if exists public.cerrar_visita(text, timestamptz, numeric);

create or replace function public.cerrar_visita(
  p_visita_id text,
  p_hora_salida timestamptz,
  p_monto numeric,
  p_medio_pago_id text
)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.egresos (visita_id, hora_salida, monto, medio_pago_id)
  values (p_visita_id, p_hora_salida, p_monto, p_medio_pago_id);

  update public.visitas
  set estado = 'afuera'
  where id = p_visita_id
    and estado = 'dentro';

  if not found then
    raise exception 'visita % no está dentro (ya salió o no existe)', p_visita_id;
  end if;
end;
$$;

grant execute on function public.cerrar_visita(text, timestamptz, numeric, text) to authenticated;
```

(El `drop function if exists` con la firma vieja es defensivo — en una instalación nueva no hay nada que borrar, pero mantiene el archivo copy-pasteable también contra una base que ya corrió una versión anterior de este mismo `schema.sql` en desarrollo.)

### Paso 5: Sumar `medios_pago` a la publicación de realtime

Reemplazar:

```sql
alter publication supabase_realtime add table vehiculos, visitas, egresos, tarifas_por_tipo, config;
```

por:

```sql
alter publication supabase_realtime add table vehiculos, visitas, egresos, tarifas_por_tipo, config, medios_pago;
```

### Paso 6: Borrado lógico de `visitas` (al final del archivo, después de que exista `profiles`)

`deleted_by` referencia `public.profiles`, que recién se crea en la sección "Roles y permisos" al final del archivo — por eso estas columnas van agregadas con `alter table` después de esa sección, no dentro del `create table visitas` original (evita una referencia hacia adelante que rompería un `schema.sql` corrido de punta a punta en un proyecto nuevo).

Al final de `supabase/schema.sql` (después del bloque `create trigger on_auth_user_created ...` que cierra el archivo), agregar:

```sql

-- ---------------------------------------------------------------------
-- Borrado lógico de visitas
-- ---------------------------------------------------------------------
-- deleted_at is null = registro activo y visible en la app. Nunca se hace
-- un delete real sobre visitas desde la app: el dato queda en la base para
-- auditoría (consultable directo en Supabase), la app simplemente deja de
-- traerlo. Va después de la sección de "Roles y permisos" porque deleted_by
-- referencia public.profiles, que recién existe a partir de acá.

alter table visitas add column deleted_at timestamptz;
alter table visitas add column deleted_by uuid references public.profiles (id);

-- Reemplaza visitas_vehiculo_dentro_uk (definido más arriba, junto al
-- create table visitas) para excluir filas borradas lógicamente: sin este
-- ajuste, una visita "dentro" borrada seguiría ocupando el índice único y
-- volver a registrar esa patente fallaría por violación de unicidad aunque
-- la app ya no la muestre.
drop index if exists visitas_vehiculo_dentro_uk;
create unique index visitas_vehiculo_dentro_uk
  on visitas (vehiculo_id) where estado = 'dentro' and deleted_at is null;

-- Mismo patrón atómico que cerrar_visita: security invoker respeta las
-- policies RLS de quien llama, y auth.uid() resuelve quién borra del lado
-- del servidor sin que el cliente tenga que mandarlo.
create or replace function public.soft_delete_visita(p_visita_id text)
returns void
language plpgsql
security invoker
as $$
begin
  update public.visitas
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_visita_id
    and deleted_at is null;

  if not found then
    raise exception 'visita % no existe o ya fue borrada', p_visita_id;
  end if;
end;
$$;

grant execute on function public.soft_delete_visita(text) to authenticated;
```

### Paso 7: Crear la migración para instalaciones existentes

Crear `supabase/add_medios_pago_borrado_logico.sql`:

```sql
-- Ejecutar una sola vez en el SQL editor de Supabase, en proyectos que ya
-- corrieron schema.sql antes de que existieran medios de pago / borrado
-- lógico / colisión de patente. Requiere que la sección "Roles y permisos"
-- de schema.sql (tabla public.profiles) ya haya sido ejecutada.

create table medios_pago (
  id text primary key,
  nombre text not null,
  activo boolean not null default true
);

insert into medios_pago (id, nombre) values
  ('efectivo', 'Efectivo'),
  ('tarjeta', 'Tarjeta'),
  ('transferencia', 'Transferencia'),
  ('qr', 'QR / Mercado Pago');

alter table egresos add column medio_pago_id text references medios_pago (id);

alter table medios_pago enable row level security;

grant select, insert, update on public.medios_pago to authenticated;
revoke all on public.medios_pago from anon;

drop policy if exists "allow authenticated read/write medios_pago" on medios_pago;
create policy "allow authenticated read/write medios_pago"
  on medios_pago for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop function if exists public.cerrar_visita(text, timestamptz, numeric);

create or replace function public.cerrar_visita(
  p_visita_id text,
  p_hora_salida timestamptz,
  p_monto numeric,
  p_medio_pago_id text
)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.egresos (visita_id, hora_salida, monto, medio_pago_id)
  values (p_visita_id, p_hora_salida, p_monto, p_medio_pago_id);

  update public.visitas
  set estado = 'afuera'
  where id = p_visita_id
    and estado = 'dentro';

  if not found then
    raise exception 'visita % no está dentro (ya salió o no existe)', p_visita_id;
  end if;
end;
$$;

grant execute on function public.cerrar_visita(text, timestamptz, numeric, text) to authenticated;

alter table visitas add column deleted_at timestamptz;
alter table visitas add column deleted_by uuid references public.profiles (id);

-- Reemplaza visitas_vehiculo_dentro_uk (creado por schema.sql con el
-- predicado viejo) para excluir filas borradas lógicamente: sin este
-- ajuste, una visita "dentro" borrada seguiría ocupando el índice único y
-- volver a registrar esa patente fallaría por violación de unicidad aunque
-- la app ya no la muestre.
drop index if exists visitas_vehiculo_dentro_uk;
create unique index visitas_vehiculo_dentro_uk
  on visitas (vehiculo_id) where estado = 'dentro' and deleted_at is null;

create or replace function public.soft_delete_visita(p_visita_id text)
returns void
language plpgsql
security invoker
as $$
begin
  update public.visitas
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_visita_id
    and deleted_at is null;

  if not found then
    raise exception 'visita % no existe o ya fue borrada', p_visita_id;
  end if;
end;
$$;

grant execute on function public.soft_delete_visita(text) to authenticated;

alter publication supabase_realtime add table medios_pago;
```

### Paso 8: Aplicar la migración en el proyecto de Supabase de desarrollo

Correr el contenido de `supabase/add_medios_pago_borrado_logico.sql` (o el `schema.sql` completo si es un proyecto nuevo) en el SQL editor del proyecto de Supabase que use `npm run dev` localmente. Esto es manual — no hay runner de migraciones en el repo (ver comentario al tope de `schema.sql`).

### Paso 9: Commit

```bash
git add supabase/schema.sql supabase/add_medios_pago_borrado_logico.sql
git commit -m "feat(db): medios de pago, borrado logico de visitas y RPC soft_delete_visita"
```

---

## Task 2: Helpers puros (`slugify`, `suggestPatenteSuffix`) con tests

**Files:**
- Modify: `src/lib/format.js`
- Modify: `src/lib/format.test.js`

### Paso 1: Escribir los tests primero

En `src/lib/format.test.js`, agregar al final del archivo (después del último `describe` de `tramoLabel`):

```js

describe("slugify", () => {
  it("pasa a minusculas y reemplaza espacios por guiones", () => {
    expect(slugify("Mercado Pago")).toBe("mercado-pago");
  });

  it("quita acentos", () => {
    expect(slugify("Débito")).toBe("debito");
  });

  it("quita caracteres que no sean letras/numeros", () => {
    expect(slugify("QR / Billetera!")).toBe("qr-billetera");
  });

  it("quita guiones al principio y al final", () => {
    expect(slugify("  Efectivo  ")).toBe("efectivo");
  });
});

describe("suggestPatenteSuffix", () => {
  it("sugiere -B si la base ya esta dentro y -B esta libre", () => {
    const vehiculosDentro = [{ patente: "234" }];
    expect(suggestPatenteSuffix("234", vehiculosDentro)).toBe("234-B");
  });

  it("sugiere la siguiente letra libre si -B tambien esta dentro", () => {
    const vehiculosDentro = [{ patente: "234" }, { patente: "234-B" }];
    expect(suggestPatenteSuffix("234", vehiculosDentro)).toBe("234-C");
  });

  it("no depende de que la base este en la lista, solo evita colisiones existentes", () => {
    const vehiculosDentro = [{ patente: "234-B" }];
    expect(suggestPatenteSuffix("234", vehiculosDentro)).toBe("234-C");
  });
});
```

Y actualizar el import del tope del archivo:

```js
import { describe, it, expect } from "vitest";
import { calcularMonto, tramoLabel, slugify, suggestPatenteSuffix } from "./format";
```

### Paso 2: Correr los tests y verificar que fallan

Run: `npm test`
Expected: FAIL — `slugify is not a function` / `suggestPatenteSuffix is not a function` (todavía no existen en `format.js`).

### Paso 3: Implementar los helpers

En `src/lib/format.js`, agregar al final del archivo (después de `startOfDay`):

```js

/** Convierte un nombre en un id de tabla: minusculas, sin acentos, solo [a-z0-9-]. */
export function slugify(nombre) {
  return nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Sugiere una patente sufijada (ej. "234-B") para diferenciar un vehiculo
 * de otro que ya esta "dentro" con el mismo valor cargado. Prueba -B, -C,
 * -D... hasta encontrar una que ningun vehiculo dentro tenga ocupada.
 */
export function suggestPatenteSuffix(basePatente, vehiculosDentro) {
  const enUso = new Set(vehiculosDentro.map((v) => v.patente));
  const letras = "BCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const letra of letras) {
    const candidata = `${basePatente}-${letra}`;
    if (!enUso.has(candidata)) return candidata;
  }
  return `${basePatente}-${Date.now()}`;
}
```

### Paso 4: Correr los tests y verificar que pasan

Run: `npm test`
Expected: PASS — todos los tests de `format.test.js`, incluidos los nuevos de `slugify` y `suggestPatenteSuffix`.

### Paso 5: Commit

```bash
git add src/lib/format.js src/lib/format.test.js
git commit -m "feat: helpers slugify y suggestPatenteSuffix con tests"
```

---

## Task 3: `storage.js` — medios de pago y borrado lógico

**Depende de:** Task 1 (la tabla `medios_pago` y las columnas nuevas tienen que existir en la base de Supabase usada en desarrollo).

**Files:**
- Modify: `src/storage.js`

### Paso 1: `flattenVehicle` incluye el medio de pago

Reemplazar la función completa (líneas 13-27 del archivo original):

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
function flattenVehicle(visita, vehiculo, egreso, medioPago) {
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
    medioPagoId: egreso ? egreso.medio_pago_id : null,
    medioPago: medioPago ? medioPago.nombre : null,
    estado: visita.estado,
  };
}
```

### Paso 2: `getVehicleById` resuelve el medio de pago del egreso

Reemplazar la función completa (líneas 46-56 del archivo original):

```js
async function getVehicleById(id) {
  const { data: visita, error: eV } = await supabase.from("visitas").select("*").eq("id", id).single();
  if (eV) throw eV;
  const [{ data: vehiculo, error: eA }, { data: egreso, error: eE }] = await Promise.all([
    supabase.from("vehiculos").select("*").eq("patente", visita.vehiculo_id).single(),
    supabase.from("egresos").select("*").eq("visita_id", id).maybeSingle(),
  ]);
  if (eA) throw eA;
  if (eE) throw eE;
  return flattenVehicle(visita, vehiculo, egreso);
}
```

por:

```js
async function getVehicleById(id) {
  const { data: visita, error: eV } = await supabase.from("visitas").select("*").eq("id", id).single();
  if (eV) throw eV;
  const [{ data: vehiculo, error: eA }, { data: egreso, error: eE }] = await Promise.all([
    supabase.from("vehiculos").select("*").eq("patente", visita.vehiculo_id).single(),
    supabase.from("egresos").select("*").eq("visita_id", id).maybeSingle(),
  ]);
  if (eA) throw eA;
  if (eE) throw eE;
  let medioPago = null;
  if (egreso?.medio_pago_id) {
    const { data, error: eM } = await supabase
      .from("medios_pago")
      .select("*")
      .eq("id", egreso.medio_pago_id)
      .maybeSingle();
    if (eM) throw eM;
    medioPago = data;
  }
  return flattenVehicle(visita, vehiculo, egreso, medioPago);
}
```

### Paso 3: `getVehicles` filtra borrados y trae medios de pago

Reemplazar el método completo dentro de `export const storage = { ... }`:

```js
  async getVehicles() {
    const { data: visitas, error: eV } = await supabase
      .from("visitas")
      .select("*")
      .order("created_at", { ascending: false });
    if (eV) throw eV;

    const patentes = [...new Set(visitas.map((v) => v.vehiculo_id))];
    const visitaIds = visitas.map((v) => v.id);

    const [{ data: vehiculos, error: eA }, { data: egresos, error: eE }] = await Promise.all([
      supabase.from("vehiculos").select("*").in("patente", patentes),
      supabase.from("egresos").select("*").in("visita_id", visitaIds),
    ]);
    if (eA) throw eA;
    if (eE) throw eE;

    const vehiculoByPatente = new Map(vehiculos.map((v) => [v.patente, v]));
    const egresoByVisitaId = new Map(egresos.map((e) => [e.visita_id, e]));

    return visitas
      .map((visita) =>
        flattenVehicle(visita, vehiculoByPatente.get(visita.vehiculo_id), egresoByVisitaId.get(visita.id))
      )
      .filter(Boolean);
  },
```

por:

```js
  async getVehicles() {
    const { data: visitas, error: eV } = await supabase
      .from("visitas")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (eV) throw eV;

    const patentes = [...new Set(visitas.map((v) => v.vehiculo_id))];
    const visitaIds = visitas.map((v) => v.id);

    const [
      { data: vehiculos, error: eA },
      { data: egresos, error: eE },
      { data: mediosPago, error: eM },
    ] = await Promise.all([
      supabase.from("vehiculos").select("*").in("patente", patentes),
      supabase.from("egresos").select("*").in("visita_id", visitaIds),
      supabase.from("medios_pago").select("*"),
    ]);
    if (eA) throw eA;
    if (eE) throw eE;
    if (eM) throw eM;

    const vehiculoByPatente = new Map(vehiculos.map((v) => [v.patente, v]));
    const egresoByVisitaId = new Map(egresos.map((e) => [e.visita_id, e]));
    const medioPagoById = new Map(mediosPago.map((m) => [m.id, m]));

    return visitas
      .map((visita) => {
        const egreso = egresoByVisitaId.get(visita.id);
        const medioPago = egreso?.medio_pago_id ? medioPagoById.get(egreso.medio_pago_id) : null;
        return flattenVehicle(visita, vehiculoByPatente.get(visita.vehiculo_id), egreso, medioPago);
      })
      .filter(Boolean);
  },
```

### Paso 4: `updateVehicle` pasa el medio de pago a `cerrar_visita`

Reemplazar:

```js
  async updateVehicle(id, patch) {
    const { error } = await supabase.rpc("cerrar_visita", {
      p_visita_id: id,
      p_hora_salida: new Date(patch.horaSalida).toISOString(),
      p_monto: patch.monto,
    });
    if (error) throw error;
  },
```

por:

```js
  async updateVehicle(id, patch) {
    const { error } = await supabase.rpc("cerrar_visita", {
      p_visita_id: id,
      p_hora_salida: new Date(patch.horaSalida).toISOString(),
      p_monto: patch.monto,
      p_medio_pago_id: patch.medioPagoId,
    });
    if (error) throw error;
  },
```

### Paso 5: `deleteVehicle` (borrado lógico) y medios de pago

Justo debajo de `deleteAllVehicles` (después de su cierre `},`), agregar:

```js
  async deleteVehicle(id) {
    const { error } = await supabase.rpc("soft_delete_visita", { p_visita_id: id });
    if (error) throw error;
  },

  async getMediosPago() {
    const { data, error } = await supabase.from("medios_pago").select("*").order("nombre");
    if (error) throw error;
    return data;
  },

  async upsertMedioPago(medio) {
    const { error } = await supabase
      .from("medios_pago")
      .upsert({ id: medio.id, nombre: medio.nombre, activo: medio.activo });
    if (error) throw error;
  },
```

### Paso 6: Realtime — tratar un `deleted_at` seteado como baja, y sincronizar medios de pago

Reemplazar el método `subscribeToChanges` completo:

```js
  subscribeToChanges({ onVehicleChange, onConfigChange }) {
    const refreshConfig = async () => {
      const config = await storage.getConfig();
      if (config) onConfigChange(config);
    };

    const channel = supabase
      .channel("parking-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "visitas" }, (payload) => {
        if (payload.eventType === "DELETE") {
          onVehicleChange({ eventType: "DELETE", vehicle: { id: payload.old.id } });
          return;
        }
        getVehicleById(payload.new.id)
          .then((vehicle) => {
            if (vehicle) onVehicleChange({ eventType: payload.eventType, vehicle });
          })
          .catch((err) => console.error("storage: error procesando cambio de visita en tiempo real", err));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "egresos" }, (payload) => {
        getVehicleById(payload.new.visita_id)
          .then((vehicle) => {
            if (vehicle) onVehicleChange({ eventType: "UPDATE", vehicle });
          })
          .catch((err) => console.error("storage: error procesando cambio de egreso en tiempo real", err));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, () => {
        refreshConfig().catch((err) => console.error("storage: error refrescando config en tiempo real", err));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tarifas_por_tipo" }, () => {
        refreshConfig().catch((err) => console.error("storage: error refrescando config en tiempo real", err));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
```

por:

```js
  subscribeToChanges({ onVehicleChange, onConfigChange, onMediosPagoChange }) {
    const refreshConfig = async () => {
      const config = await storage.getConfig();
      if (config) onConfigChange(config);
    };

    const refreshMediosPago = async () => {
      const mediosPago = await storage.getMediosPago();
      onMediosPagoChange(mediosPago);
    };

    const channel = supabase
      .channel("parking-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "visitas" }, (payload) => {
        if (payload.eventType === "DELETE") {
          onVehicleChange({ eventType: "DELETE", vehicle: { id: payload.old.id } });
          return;
        }
        if (payload.eventType === "UPDATE" && payload.new.deleted_at) {
          onVehicleChange({ eventType: "DELETE", vehicle: { id: payload.new.id } });
          return;
        }
        getVehicleById(payload.new.id)
          .then((vehicle) => {
            if (vehicle) onVehicleChange({ eventType: payload.eventType, vehicle });
          })
          .catch((err) => console.error("storage: error procesando cambio de visita en tiempo real", err));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "egresos" }, (payload) => {
        getVehicleById(payload.new.visita_id)
          .then((vehicle) => {
            if (vehicle) onVehicleChange({ eventType: "UPDATE", vehicle });
          })
          .catch((err) => console.error("storage: error procesando cambio de egreso en tiempo real", err));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, () => {
        refreshConfig().catch((err) => console.error("storage: error refrescando config en tiempo real", err));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tarifas_por_tipo" }, () => {
        refreshConfig().catch((err) => console.error("storage: error refrescando config en tiempo real", err));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "medios_pago" }, () => {
        refreshMediosPago().catch((err) => console.error("storage: error refrescando medios de pago en tiempo real", err));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
```

### Paso 7: Build

Run: `npm run build`
Expected: compila sin errores (todavía nadie llama a los métodos nuevos desde la UI, así que no hay chequeo funcional posible en este paso, solo sintáctico).

### Paso 8: Commit

```bash
git add src/storage.js
git commit -m "feat: storage.js soporta medios de pago y borrado logico de visitas"
```

---

## Task 4: `App.jsx` — estado global de medios de pago, borrado y salida con medio de pago

**Depende de:** Task 3.

**Files:**
- Modify: `src/App.jsx`

### Paso 1: Estado `mediosPago`

En `src/App.jsx`, junto a la declaración de `const [toast, setToast] = useState(null);` (línea 58), agregar debajo:

```js
  const [mediosPago, setMediosPago] = useState([]);
```

### Paso 2: Cargar medios de pago junto con vehículos y config

Reemplazar el efecto de carga inicial (líneas 81-109):

```js
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
```

por:

```js
  useEffect(() => {
    if (!session) {
      setVehicles([]);
      setConfig(null);
      setMediosPago([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const [vehiclesRes, configRes, mediosPagoRes] = await Promise.all([
          storage.getVehicles(),
          storage.getConfig(),
          storage.getMediosPago(),
        ]);
        setVehicles(vehiclesRes);
        setMediosPago(mediosPagoRes);
        if (configRes) {
          setConfig(mergeConfig(configRes));
        } else {
          setConfig(DEFAULT_CONFIG);
          await storage.setConfig(DEFAULT_CONFIG);
        }
      } catch (e) {
        setVehicles([]);
        setConfig(DEFAULT_CONFIG);
        setMediosPago([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [session?.user?.id]);
```

### Paso 3: Suscribirse a cambios de medios de pago

Reemplazar el `useEffect` de `subscribeToChanges` (líneas 111-129):

```js
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
```

por:

```js
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
      onMediosPagoChange: setMediosPago,
    });
    return unsubscribe;
  }, [session?.user?.id, loading]);
```

### Paso 4: `registrarSalida` recibe el medio de pago

Reemplazar:

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
  const registrarSalida = async (id, monto, medioPagoId) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    const medioPago = mediosPago.find((m) => m.id === medioPagoId)?.nombre || null;
    const patch = { horaSalida: Date.now(), monto, medioPagoId, medioPago, estado: "afuera" };
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

### Paso 5: Handlers `eliminarVehiculo` y `guardarMedioPago`

Debajo de la definición de `borrarTodo` (después de su cierre `};`), agregar:

```js

  const eliminarVehiculo = async (id) => {
    const prevVehicles = vehicles;
    setVehicles((prev) => prev.filter((v) => v.id !== id));
    try {
      await storage.deleteVehicle(id);
      setSaveError(false);
      showToast("Registro borrado");
    } catch (e) {
      setVehicles(prevVehicles);
      setSaveError(true);
    }
  };

  const guardarMedioPago = async (medio) => {
    const prevMediosPago = mediosPago;
    setMediosPago((prev) => {
      const idx = prev.findIndex((m) => m.id === medio.id);
      if (idx === -1) return [...prev, medio];
      const next = [...prev];
      next[idx] = medio;
      return next;
    });
    try {
      await storage.upsertMedioPago(medio);
      setSaveError(false);
    } catch (e) {
      setMediosPago(prevMediosPago);
      setSaveError(true);
    }
  };
```

### Paso 6: Build

Run: `npm run build`
Expected: compila sin errores. Los tabs todavía no reciben las props nuevas (eso pasa en las Tasks 5-8), así que `mediosPago`/`eliminarVehiculo`/`guardarMedioPago` quedan definidos pero sin usar por ahora — normal en este punto intermedio.

### Paso 7: Commit

```bash
git add src/App.jsx
git commit -m "feat: App.jsx orquesta medios de pago y borrado logico"
```

---

## Task 5: `EntradaTab` — colisión de patente

**Depende de:** Task 2 (usa `suggestPatenteSuffix`), Task 4 (necesita que `App.jsx` compile con el estado nuevo antes de agregarle esta prop).

**Files:**
- Modify: `src/components/EntradaTab.jsx`
- Modify: `src/App.jsx`

### Paso 1: Reescribir `EntradaTab.jsx`

Reemplazar el archivo completo:

```jsx
import React, { useState } from "react";
import { LogIn, Check, AlertTriangle, X } from "lucide-react";
import { TIPOS } from "../constants";
import { suggestPatenteSuffix } from "../lib/format";
import { SectionTitle } from "./ui";

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

export default function EntradaTab({ onRegistrar, disponibles, vehiculosDentro }) {
  const [patente, setPatente] = useState("");
  const [tipo, setTipo] = useState("auto");
  const [colision, setColision] = useState(null); // { base, sugerida } | null

  const submit = (e) => {
    e.preventDefault();
    const pat = patente.trim().toUpperCase();
    if (!pat) return;
    const enUso = vehiculosDentro.some((v) => v.patente === pat);
    if (enUso) {
      setColision({ base: pat, sugerida: suggestPatenteSuffix(pat, vehiculosDentro) });
      return;
    }
    onRegistrar(pat, tipo);
    setPatente("");
  };

  const confirmarComoDistinto = () => {
    onRegistrar(colision.sugerida, tipo);
    setColision(null);
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
    </div>
  );
}
```

### Paso 2: Pasar `vehiculosDentro` desde `App.jsx`

En `src/App.jsx`, reemplazar:

```jsx
          {activeTab === "entrada" && (
            <EntradaTab onRegistrar={registrarIngreso} disponibles={disponibles} />
          )}
```

por:

```jsx
          {activeTab === "entrada" && (
            <EntradaTab onRegistrar={registrarIngreso} disponibles={disponibles} vehiculosDentro={vehiculosDentro} />
          )}
```

### Paso 3: Build y prueba manual

Run: `npm run build`
Expected: sin errores.

Run: `npm run dev`, ir a la pestaña Entrada:
- Registrar un ingreso con patente "234" → entra normal.
- Sin sacar ese vehículo, volver a cargar "234" → aparece el aviso de colisión con el botón "Registrar como 234-B".
- Tocar ese botón → se registra un segundo vehículo con patente "234-B", ambos visibles en Estado.
- Dar salida al "234" original (pestaña Salida) y volver a cargar "234" en Entrada → entra normal, sin aviso (ya no hay colisión).

### Paso 4: Commit

```bash
git add src/components/EntradaTab.jsx src/App.jsx
git commit -m "feat: EntradaTab sugiere sufijo ante colision de patente dentro"
```

---

## Task 6: `SalidaTab` — medio de pago obligatorio al cobrar

**Depende de:** Task 4.

**Files:**
- Modify: `src/components/SalidaTab.jsx`
- Modify: `src/App.jsx`

### Paso 1: Reescribir `SalidaTab.jsx`

Reemplazar el archivo completo:

```jsx
import React, { useState } from "react";
import { LogOut, Search, Clock3, Check, X, ChevronRight, Car } from "lucide-react";
import { TIPOS } from "../constants";
import { fmtMoney, fmtDur, fmtTime, calcularMonto, tramoLabel } from "../lib/format";
import { SectionTitle, EmptyState } from "./ui";

/* ------------------------------------------------------------------ */
/* Salida                                                               */
/* ------------------------------------------------------------------ */

export default function SalidaTab({ vehiculosDentro, now, rates, umbrales, mediosPago, onSalida }) {
  const [q, setQ] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [medioPagoId, setMedioPagoId] = useState(null);

  const filtered = vehiculosDentro.filter((v) => v.patente.includes(q.toUpperCase()));
  const activos = mediosPago.filter((m) => m.activo);

  const cerrarConfirmacion = () => {
    setConfirmId(null);
    setMedioPagoId(null);
  };

  return (
    <div>
      <SectionTitle icon={LogOut} title="Registrar salida" subtitle={`${vehiculosDentro.length} vehículo(s) dentro`} />

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
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
                    <div className="mt-3">
                      <div className="flex flex-wrap gap-1.5 mb-2.5">
                        {activos.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setMedioPagoId(m.id)}
                            className="px-3 py-1.5 rounded-full text-xs font-medium"
                            style={{
                              background: medioPagoId === m.id ? "var(--accent)" : "var(--surface2)",
                              color: medioPagoId === m.id ? "#1A1300" : "var(--text)",
                              border: `1px solid ${medioPagoId === m.id ? "var(--accent)" : "var(--border)"}`,
                            }}
                          >
                            {m.nombre}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          disabled={!medioPagoId}
                          onClick={() => { onSalida(v.id, monto, medioPagoId); cerrarConfirmacion(); }}
                          className="flex-1 py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-1.5 disabled:opacity-40"
                          style={{ background: "var(--accent2)", color: "#08210F" }}
                        >
                          <Check size={16} /> Confirmar cobro
                        </button>
                        <button
                          onClick={cerrarConfirmacion}
                          className="px-4 py-2.5 rounded-lg font-medium text-sm"
                          style={{ background: "var(--surface2)", color: "var(--muted)" }}
                        >
                          <X size={16} />
                        </button>
                      </div>
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

### Paso 2: Pasar `mediosPago` desde `App.jsx`

Reemplazar:

```jsx
          {activeTab === "salida" && (
            <SalidaTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              rates={config.rates}
              umbrales={config.umbrales}
              onSalida={registrarSalida}
            />
          )}
```

por:

```jsx
          {activeTab === "salida" && (
            <SalidaTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              rates={config.rates}
              umbrales={config.umbrales}
              mediosPago={mediosPago}
              onSalida={registrarSalida}
            />
          )}
```

### Paso 3: Build y prueba manual

Run: `npm run build`
Expected: sin errores.

Run: `npm run dev`, ir a Salida con al menos un vehículo dentro:
- Tocar "Dar salida" → aparecen los chips de medios de pago (Efectivo/Tarjeta/Transferencia/QR según lo cargado en Task 1) y "Confirmar cobro" está deshabilitado.
- Elegir un medio de pago → el botón se habilita.
- Confirmar → el vehículo pasa a "afuera", y en Reportes → Historial (todavía sin la columna de medio de pago hasta la Task 8) el cobro quedó registrado sin error.

### Paso 4: Commit

```bash
git add src/components/SalidaTab.jsx src/App.jsx
git commit -m "feat: SalidaTab exige elegir medio de pago para confirmar el cobro"
```

---

## Task 7: `ConfigTab` — gestión de medios de pago

**Depende de:** Task 2 (usa `slugify`), Task 4.

**Files:**
- Modify: `src/components/ConfigTab.jsx`
- Modify: `src/App.jsx`

### Paso 1: Reescribir `ConfigTab.jsx`

Reemplazar el archivo completo:

```jsx
import React, { useState } from "react";
import { Settings2, Check, RotateCcw, Trash2 } from "lucide-react";
import { TIPOS } from "../constants";
import { slugify } from "../lib/format";
import { SectionTitle, ConfigField, RateField } from "./ui";
import UserManagement from "./UserManagement";

/* ------------------------------------------------------------------ */
/* Config                                                               */
/* ------------------------------------------------------------------ */

export default function ConfigTab({ config, onSave, onResetDemo, onBorrarTodo, currentUserId, mediosPago, onSaveMedioPago }) {
  const [local, setLocal] = useState(config);
  const [tipoActivo, setTipoActivo] = useState(TIPOS[0].id);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nuevoMedioPago, setNuevoMedioPago] = useState("");

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
    if (!nombre) return;
    const base = slugify(nombre) || `medio-${Date.now()}`;
    const id = mediosPago.some((m) => m.id === base) ? `${base}-${Date.now()}` : base;
    onSaveMedioPago({ id, nombre, activo: true });
    setNuevoMedioPago("");
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
              onChange={(e) => setNuevoMedioPago(e.target.value)}
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
```

### Paso 2: Pasar `mediosPago`/`onSaveMedioPago` desde `App.jsx`

Reemplazar:

```jsx
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

```jsx
          {activeTab === "config" && (
            <ConfigTab
              config={config}
              onSave={updateConfig}
              onResetDemo={resetDemo}
              onBorrarTodo={borrarTodo}
              currentUserId={profile.id}
              mediosPago={mediosPago}
              onSaveMedioPago={guardarMedioPago}
            />
          )}
```

### Paso 3: Build y prueba manual

Run: `npm run build`
Expected: sin errores.

Run: `npm run dev`, ir a Config (usuario admin):
- Se ven los 4 medios de pago sembrados en Task 1, todos "Activo".
- Tocar "Inactivo" en uno → pasa a inactivo y deja de listarse como opción en Salida (Task 6), pero sigue viéndose acá para poder reactivarlo.
- Escribir un nombre nuevo (ej. "Vale") y tocar "Agregar" → aparece en la lista, activo, y disponible como chip en Salida.

### Paso 4: Commit

```bash
git add src/components/ConfigTab.jsx src/App.jsx
git commit -m "feat: ConfigTab gestiona altas y activo/inactivo de medios de pago"
```

---

## Task 8: `ReportesTab` — mostrar medio de pago, exportar y borrar registros

**Depende de:** Task 4.

**Files:**
- Modify: `src/components/ReportesTab.jsx`
- Modify: `src/App.jsx`

### Paso 1: `exportarReporte` suma la columna "Medio de pago"

En `src/components/ReportesTab.jsx`, dentro de `exportarReporte`, reemplazar:

```js
    const egresosRows = vehicles
      .filter((v) => v.horaSalida && v.horaSalida >= desdeTs && v.horaSalida <= hastaTs)
      .sort((a, b) => a.horaSalida - b.horaSalida)
      .map((v) => ({
        Patente: v.patente,
        Tipo: TIPOS.find((t) => t.id === v.tipo)?.label || v.tipo,
        "Fecha ingreso": fmtDateShort(v.horaIngreso),
        "Hora ingreso": fmtTime(v.horaIngreso),
        "Fecha salida": fmtDateShort(v.horaSalida),
        "Hora salida": fmtTime(v.horaSalida),
        "Duración": fmtDur((v.horaSalida - v.horaIngreso) / 60000),
        Monto: v.monto ?? "",
      }));
```

por:

```js
    const egresosRows = vehicles
      .filter((v) => v.horaSalida && v.horaSalida >= desdeTs && v.horaSalida <= hastaTs)
      .sort((a, b) => a.horaSalida - b.horaSalida)
      .map((v) => ({
        Patente: v.patente,
        Tipo: TIPOS.find((t) => t.id === v.tipo)?.label || v.tipo,
        "Fecha ingreso": fmtDateShort(v.horaIngreso),
        "Hora ingreso": fmtTime(v.horaIngreso),
        "Fecha salida": fmtDateShort(v.horaSalida),
        "Hora salida": fmtTime(v.horaSalida),
        "Duración": fmtDur((v.horaSalida - v.horaIngreso) / 60000),
        Monto: v.monto ?? "",
        "Medio de pago": v.medioPago || "",
      }));
```

### Paso 2: `ReportesTab` recibe y reenvía `onEliminar`

Reemplazar la firma y el uso de `HistorialSection`:

```jsx
export default function ReportesTab({ vehicles, now }) {
```

por:

```jsx
export default function ReportesTab({ vehicles, now, onEliminar }) {
```

y:

```jsx
      <HistorialSection vehicles={vehicles} now={now} />
```

por:

```jsx
      <HistorialSection vehicles={vehicles} now={now} onEliminar={onEliminar} />
```

### Paso 3: `HistorialSection` — columna de medio de pago, export y borrado

Reemplazar la función `HistorialSection` completa:

```jsx
function HistorialSection({ vehicles, now }) {
  const [q, setQ] = useState("");
  const filtered = vehicles
    .filter((v) => v.patente.includes(q.toUpperCase()))
    .sort((a, b) => b.horaIngreso - a.horaIngreso);

  const exportar = () => {
    const rows = filtered.map((v) => ({
      Patente: v.patente,
      Tipo: TIPOS.find((t) => t.id === v.tipo)?.label || v.tipo,
      Ingreso: new Date(v.horaIngreso).toLocaleString("es-AR"),
      Salida: v.horaSalida ? new Date(v.horaSalida).toLocaleString("es-AR") : "-",
      "Duración": fmtDur(((v.horaSalida || now) - v.horaIngreso) / 60000) + (v.horaSalida ? "" : " (en curso)"),
      Monto: v.monto ?? "",
      Estado: v.estado === "dentro" ? "Dentro" : "Afuera",
    }));
    downloadXLSX(`historial-vehiculos-${dayKey(now)}.xlsx`, { Historial: rows });
  };

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-2.5">
        <p style={{ fontFamily: "var(--font-display)" }} className="font-bold text-sm">
          Historial de vehículos
        </p>
        <button
          onClick={exportar}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
          style={{ background: "var(--surface2)", color: "var(--text)" }}
        >
          <Download size={13} /> Exportar .xlsx
        </button>
      </div>

      <div className="relative mb-2.5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar patente…"
          className="w-full pl-8 pr-3 py-2 rounded-lg outline-none text-xs"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState Icon={Clock3} text="Todavía no hay registros que coincidan." />
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="max-h-72 overflow-y-auto">
            {filtered.map((v, i) => {
              const Icon = TIPOS.find((t) => t.id === v.tipo)?.Icon || Car;
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between px-3 py-2.5"
                  style={{ background: "var(--surface)", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={14} style={{ color: "var(--muted)" }} />
                    <div>
                      <p style={{ fontFamily: "var(--font-display)" }} className="text-xs font-semibold tracking-wide">
                        {v.patente}
                      </p>
                      <p style={{ color: "var(--muted)" }} className="text-[10px]">
                        {fmtDateShort(v.horaIngreso)} {fmtTime(v.horaIngreso)}
                        {v.horaSalida ? ` → ${fmtTime(v.horaSalida)}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {v.estado === "dentro" ? (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "var(--accent2)", color: "#08210F" }}
                      >
                        Dentro
                      </span>
                    ) : (
                      <p style={{ fontFamily: "var(--font-display)" }} className="text-xs font-bold">
                        {fmtMoney(v.monto)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

por:

```jsx
function HistorialSection({ vehicles, now, onEliminar }) {
  const [q, setQ] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const filtered = vehicles
    .filter((v) => v.patente.includes(q.toUpperCase()))
    .sort((a, b) => b.horaIngreso - a.horaIngreso);

  const exportar = () => {
    const rows = filtered.map((v) => ({
      Patente: v.patente,
      Tipo: TIPOS.find((t) => t.id === v.tipo)?.label || v.tipo,
      Ingreso: new Date(v.horaIngreso).toLocaleString("es-AR"),
      Salida: v.horaSalida ? new Date(v.horaSalida).toLocaleString("es-AR") : "-",
      "Duración": fmtDur(((v.horaSalida || now) - v.horaIngreso) / 60000) + (v.horaSalida ? "" : " (en curso)"),
      Monto: v.monto ?? "",
      "Medio de pago": v.medioPago || "",
      Estado: v.estado === "dentro" ? "Dentro" : "Afuera",
    }));
    downloadXLSX(`historial-vehiculos-${dayKey(now)}.xlsx`, { Historial: rows });
  };

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-2.5">
        <p style={{ fontFamily: "var(--font-display)" }} className="font-bold text-sm">
          Historial de vehículos
        </p>
        <button
          onClick={exportar}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
          style={{ background: "var(--surface2)", color: "var(--text)" }}
        >
          <Download size={13} /> Exportar .xlsx
        </button>
      </div>

      <div className="relative mb-2.5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar patente…"
          className="w-full pl-8 pr-3 py-2 rounded-lg outline-none text-xs"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState Icon={Clock3} text="Todavía no hay registros que coincidan." />
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="max-h-72 overflow-y-auto">
            {filtered.map((v, i) => {
              const Icon = TIPOS.find((t) => t.id === v.tipo)?.Icon || Car;
              const confirming = confirmDeleteId === v.id;
              return (
                <div
                  key={v.id}
                  className="px-3 py-2.5"
                  style={{ background: "var(--surface)", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon size={14} style={{ color: "var(--muted)" }} />
                      <div>
                        <p style={{ fontFamily: "var(--font-display)" }} className="text-xs font-semibold tracking-wide">
                          {v.patente}
                        </p>
                        <p style={{ color: "var(--muted)" }} className="text-[10px]">
                          {fmtDateShort(v.horaIngreso)} {fmtTime(v.horaIngreso)}
                          {v.horaSalida ? ` → ${fmtTime(v.horaSalida)}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        {v.estado === "dentro" ? (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "var(--accent2)", color: "#08210F" }}
                          >
                            Dentro
                          </span>
                        ) : (
                          <>
                            <p style={{ fontFamily: "var(--font-display)" }} className="text-xs font-bold">
                              {fmtMoney(v.monto)}
                            </p>
                            {v.medioPago && (
                              <p style={{ color: "var(--muted)" }} className="text-[10px]">{v.medioPago}</p>
                            )}
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(v.id)}
                        className="p-1.5 rounded-lg"
                        style={{ color: "var(--muted)" }}
                        aria-label="Borrar registro"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {confirming && (
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => { onEliminar(v.id); setConfirmDeleteId(null); }}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold"
                        style={{ background: "var(--danger)", color: "#fff" }}
                      >
                        Confirmar borrado
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-3 py-2 rounded-lg text-xs"
                        style={{ background: "var(--surface2)", color: "var(--muted)" }}
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

### Paso 4: Importar `Trash2`

En el import de íconos al tope de `src/components/ReportesTab.jsx`, reemplazar:

```js
import { Car, BarChart3, Search, Clock3, Download } from "lucide-react";
```

por:

```js
import { Car, BarChart3, Search, Clock3, Download, Trash2 } from "lucide-react";
```

### Paso 5: Pasar `onEliminar` desde `App.jsx`

Reemplazar:

```jsx
          {activeTab === "reportes" && (
            <ReportesTab vehicles={vehicles} now={now} />
          )}
```

por:

```jsx
          {activeTab === "reportes" && (
            <ReportesTab vehicles={vehicles} now={now} onEliminar={eliminarVehiculo} />
          )}
```

### Paso 6: Build y prueba manual

Run: `npm run build`
Expected: sin errores.

Run: `npm run dev`, ir a Reportes → Historial:
- Un vehículo con salida ya cobrada muestra el monto y, debajo, el nombre del medio de pago elegido.
- Exportar el historial y el reporte por rango de fechas a `.xlsx` → ambos incluyen la columna "Medio de pago".
- Tocar el ícono de tacho en una fila → aparece "Confirmar borrado"/"Cancelar"; confirmar → la fila desaparece de la lista, de Estado (si estaba dentro) y de los próximos exports.
- Entrar al SQL editor de Supabase y correr `select id, patente:vehiculo_id, deleted_at, deleted_by from visitas where deleted_at is not null;` (o el equivalente contra `visitas`) → la fila borrada sigue ahí, con `deleted_at`/`deleted_by` seteados.

### Paso 7: Commit

```bash
git add src/components/ReportesTab.jsx src/App.jsx
git commit -m "feat: ReportesTab muestra medio de pago, lo exporta y permite borrado logico"
```

---

## Task 9: Verificación manual end-to-end

**Depende de:** Tasks 1-8 completas.

**Files:** ninguno (solo verificación).

### Paso 1: Build limpio

Run: `npm run build`
Expected: sin errores ni warnings nuevos.

### Paso 2: Tests unitarios

Run: `npm test`
Expected: PASS — todos los tests de `format.test.js` y `constants.test.js`.

### Paso 3: Recorrido manual completo

Con `npm run dev` y un usuario admin logueado:

1. **Entrada:** cargar dos ingresos con la misma patente base mientras ambos siguen dentro → el segundo dispara la sugerencia de sufijo; confirmar → quedan dos vehículos distintos dentro.
2. **Salida:** dar salida a uno de los dos, eligiendo un medio de pago → no se puede confirmar sin elegirlo; una vez elegido, se cobra y aparece el toast de confirmación.
3. **Config:** agregar un medio de pago nuevo, desactivar uno existente, guardar tarifas → los cambios se reflejan de inmediato en Salida (medios activos) y persisten al recargar la página.
4. **Reportes:** el vehículo que salió aparece en el historial con su medio de pago; exportar el historial y el reporte por rango → ambos `.xlsx` traen la columna "Medio de pago" completa.
5. **Borrado:** borrar ese registro desde Reportes → desaparece de la app (Estado/Reportes/exports); verificar en el SQL editor de Supabase que la fila de `visitas` sigue existiendo con `deleted_at` y `deleted_by` seteados.
6. **Multi-dispositivo (opcional pero recomendado):** repetir el paso de Config (agregar medio de pago) con la app abierta en dos pestañas/navegadores distintos, confirmar que el cambio se sincroniza sin recargar (realtime).

### Paso 4: Nada para commitear

Este task es solo de verificación — si algo falla, volver al task correspondiente, arreglarlo y commitear ahí.

---

## Self-review (cobertura contra el spec)

- Medios de pago: tabla dedicada + seed (Task 1), RLS/grants sin delete (Task 1), RPC `cerrar_visita` con `medio_pago_id` (Task 1, Task 3), gestión de alta/activo-inactivo en Config (Task 7), selección obligatoria en Salida (Task 6), columna en historial + ambos exports (Task 8).
- Borrado lógico: columnas `deleted_at`/`deleted_by` + RPC `soft_delete_visita` (Task 1), filtro en `getVehicles` + manejo de realtime (Task 3), acción de borrar con confirmación en Reportes → Historial, para vehículos dentro y afuera (Task 8), verificación de que el registro sigue en la base (Task 8 paso 6, Task 9 paso 3.5).
- Colisión de patente: helper puro con tests (Task 2), UI de sugerencia de sufijo en Entrada (Task 5), alcance explícitamente limitado a colisión "dentro" (documentado en el spec, sin cambios al modelo de `vehiculos`).
- Migración para instalaciones existentes: `supabase/add_medios_pago_borrado_logico.sql` (Task 1), `schema.sql` actualizado para proyectos nuevos (Task 1).
- Sin placeholders: cada paso de código trae el contenido completo a escribir o el snippet exacto de antes/después a reemplazar.
