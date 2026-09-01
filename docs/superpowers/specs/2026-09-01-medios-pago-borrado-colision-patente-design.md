# Medios de pago, borrado lógico de registros y colisión de patente — Design

**Fecha:** 2026-09-01
**Estado:** Aprobado para pasar a plan de implementación

## Contexto

Tres ajustes pedidos sobre la app de estacionamiento (React + Supabase, ver `supabase/schema.sql` para el esquema actual):

1. Registrar el **medio de pago** con el que se cobra cada salida (no se cobra desde la app — es solo para llevar el dato).
2. Poder **borrar registros** individuales del historial, pero sin perder rastro: el borrado debe verse en la base de datos aunque desaparezca de la app (borrado lógico, no físico).
3. Evitar que dos vehículos físicos distintos "choquen" cuando el operador carga la misma patente (hoy suele cargar solo números, sin letras) mientras ambos están dentro al mismo tiempo.

Los tres tocan el mismo camino de datos (`visitas`/`egresos`/`vehiculos` en Supabase, `storage.js`, `App.jsx` y los tabs de Entrada/Salida/Reportes/Config), así que se diseñan y planifican juntos, pero son independientes entre sí a nivel de implementación.

## 1. Medios de pago

### Modelo de datos

Nueva tabla, mismo patrón que `tipos_vehiculo`:

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

`egresos` suma una columna nullable (a nivel DB) referenciando esta tabla:

```sql
alter table egresos add column medio_pago_id text references medios_pago (id);
```

Nullable en DB porque los egresos históricos ya existentes no van a tener este dato — la obligatoriedad se aplica en la UI (no se puede confirmar un cobro nuevo sin elegir medio de pago), no como constraint de base.

No se borran medios de pago: se desactivan (`activo = false`) para no romper la referencia desde egresos viejos, igual que las tarifas nunca se pisan (append-only). Un medio desactivado deja de listarse como opción al cobrar, pero sigue existiendo para mostrar el nombre en historial/reportes viejos.

RLS: mismo patrón que `tipos_vehiculo`/`tarifas_por_tipo` — `select` para todos los autenticados, `insert`/`update` para gestionar altas y activar/desactivar desde Config (sin `delete`). Se agrega a la publicación de realtime igual que `tarifas_por_tipo`, para que un cambio de medios de pago se sincronice entre dispositivos sin recargar.

### Backend (`storage.js`)

- `getMediosPago()`: `select * from medios_pago order by nombre`.
- `upsertMedioPago(medio)`: `upsert({ id, nombre, activo })`. El `id` se genera en el cliente con un slug del nombre (minúsculas, sin espacios/acentos); si ya existe otro medio con ese slug, se le agrega un sufijo numérico (`transferencia-2`) antes de guardar — mismo tipo de resolución de colisión que ya se usa conceptualmente para patentes, pero acá es interno y no requiere confirmación del usuario porque no es una operación frecuente.
- `flattenVehicle` agrega `medioPagoId` (id) y `medioPago` (nombre, resuelto desde el `egreso` cuando existe) al objeto plano de vehículo.
- `getVehicles()` hace el join adicional contra `medios_pago` (vía los `egresos` ya traídos) para resolver el nombre.
- `updateVehicle(id, patch)` — `patch` ahora incluye `medioPagoId`; se pasa como parámetro nuevo a la RPC `cerrar_visita`.

### RPC `cerrar_visita`

Gana un parámetro:

```sql
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
  ...
```

(resto de la función sin cambios). Se actualiza el `grant execute` con la nueva firma.

### UI

**Config** (`ConfigTab`, admin-only): nueva sección "Medios de pago" junto a la de tarifas — lista de medios con nombre y un toggle activo/inactivo, más un campo para agregar uno nuevo.

**Salida** (`SalidaTab`): en el paso de confirmación que ya existe (el que muestra "Confirmar cobro"/"Cancelar" al tocar "Dar salida"), se agregan chips seleccionables con los medios de pago activos. El botón "Confirmar cobro" queda deshabilitado hasta que se elija uno. `onSalida(id, monto, medioPagoId)` gana el tercer parámetro.

**Reportes** (`ReportesTab`/`HistorialSection`): cada fila del historial de un vehículo que ya salió muestra el medio de pago junto al monto. Las dos exportaciones a `.xlsx` (el reporte por rango de fechas y el historial completo) suman la columna "Medio de pago" a las filas de egresos.

## 2. Borrado lógico de registros

### Modelo de datos

`visitas` suma dos columnas:

```sql
alter table visitas add column deleted_at timestamptz;
alter table visitas add column deleted_by uuid references public.profiles (id);
```

`deleted_at is null` = registro activo (visible en la app). Nunca se hace `delete` real sobre `visitas` desde la app para este flujo — el dato queda en la base para auditoría (consultable directo en Supabase), pero la app lo filtra siempre.

### RPC `soft_delete_visita`

Mismo patrón atómico que `cerrar_visita`, para que el `deleted_by` se resuelva del lado del servidor (`auth.uid()`) y no dependa de que el cliente mande el id del usuario actual:

```sql
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

No se toca `egresos` — si la visita tenía un egreso asociado, sigue existiendo en la base (por integridad/auditoría), simplemente deja de ser alcanzable desde la app porque `getVehicles()` ya no trae la visita.

### Backend (`storage.js`)

- `getVehicles()`: agrega `.is("deleted_at", null)` al query de `visitas`.
- `deleteVehicle(id)`: `supabase.rpc("soft_delete_visita", { p_visita_id: id })`.
- `subscribeToChanges`: el handler de eventos de `visitas` ya distingue `eventType === "DELETE"` para sacar el vehículo del estado local. Se agrega el mismo tratamiento cuando el evento es un `UPDATE` con `payload.new.deleted_at` no nulo — se trata como baja (se saca del estado) en vez de refrescarlo con `getVehicleById` (que igual lo devolvería, porque un lookup por id no filtra `deleted_at`).

### UI

**Reportes → Historial** (única pantalla con esta acción, ya es admin-only vía `TABS_POR_ROL`): cada fila suma un ícono de borrar. Al tocarlo se muestra una confirmación inline (mismo patrón visual que "Dar salida" → "Confirmar cobro"/"Cancelar"). Confirmado, se llama `onEliminar(id)`, que en `App.jsx` hace un update optimista (saca el vehículo de `vehicles` en el estado) y llama a `storage.deleteVehicle(id)`; si falla, se restaura como ya hacen `registrarIngreso`/`registrarSalida` ante error.

Aplica tanto a vehículos "dentro" (carga por error) como a los que ya salieron, según lo pedido.

## 3. Colisión de patente

Alcance mínimo (decisión explícita): esto **no** cambia el modelo de identidad de `vehiculos` (`patente` sigue siendo su primary key). Si el operador carga la patente completa, como corresponde, no hay colisión real posible. El ajuste solo cubre el caso en que dos vehículos distintos están **dentro al mismo tiempo** con el mismo valor cargado — que es el único caso que la unique constraint (`visitas_vehiculo_dentro_uk`) ya detecta hoy, solo que hoy se resuelve con un bloqueo seco.

### UI (`EntradaTab`)

`EntradaTab` recibe una nueva prop `vehiculosDentro` (ya vive en `App.jsx`, solo hay que pasarla). Al tocar "Registrar ingreso":

1. Si la patente tipeada no coincide con ningún `vehiculosDentro`, se llama a `onRegistrar(patente, tipo)` como hoy.
2. Si coincide, en vez de dejar que `App.jsx` la rechace con el toast genérico, se muestra un paso de confirmación inline (mismo patrón que "Dar salida"): *"Ya hay un vehículo con patente **234** registrado. ¿Es otro vehículo?"* con un botón **"Registrar como 234-B"** y "Cancelar".
3. El sufijo se calcula probando `-B`, `-C`, `-D`... (helper puro, ej. `suggestPatenteSuffix(base, vehiculosDentro)` en `src/lib/format.js`) hasta encontrar uno que no esté entre los `vehiculosDentro`.
4. Si confirma, se llama `onRegistrar(`${patente}-${letra}`, tipo)`.

El chequeo de duplicados que ya existe en `registrarIngreso` (`App.jsx`) se mantiene tal cual, como red de seguridad ante una carrera entre dos dispositivos cargando al mismo tiempo (seguiría mostrando el toast de error en ese caso puntual, que es aceptable porque es una carrera de milisegundos, no el flujo normal).

Una vez que el vehículo original sale (`estado = 'afuera'`), el número base vuelve a estar libre para un ingreso nuevo sin sufijo — la fila `vehiculos` para `234-B` queda como una identidad separada de ahí en adelante.

### Fuera de alcance

Que dos vehículos distintos reutilicen la misma patente corta en momentos **no solapados** (nunca estuvieron dentro a la vez) va a seguir compartiendo la misma fila `vehiculos` — es una limitación conocida de no cargar la patente completa, no resoluble sin ese dato. No se rediseña el modelo de identidad de `vehiculos` en este trabajo.

## Migración

Un solo archivo SQL nuevo (`supabase/add_medios_pago_borrado_logico.sql`), a correr una vez en el SQL editor de Supabase para instalaciones existentes, con: creación de `medios_pago` + seed, `alter table egresos add column medio_pago_id`, `alter table visitas add column deleted_at/deleted_by`, reemplazo de `cerrar_visita`, creación de `soft_delete_visita`, grants/RLS de `medios_pago`, y el `alter publication supabase_realtime add table medios_pago`. `supabase/schema.sql` (el script para proyectos nuevos) se actualiza in-place para incluir todo esto desde el vamos, siguiendo la convención ya usada por `add_umbral_tolerancia_min.sql`.

## Verificación

No hay test framework instalado (mismo estado que el plan de refactor anterior). Verificación: `npm run build` sin errores + recorrido manual en `npm run dev`:
- Cobrar una salida sin elegir medio de pago → botón deshabilitado; eligiendo uno → se guarda y aparece en historial/export.
- Agregar y desactivar un medio de pago desde Config → dejar de aparecer como opción en Salida, pero seguir mostrándose en historial viejo.
- Borrar un registro desde Reportes → desaparece de la app; confirmar en el SQL editor de Supabase que la fila sigue existiendo con `deleted_at`/`deleted_by` seteados.
- Cargar dos veces la misma patente mientras el primero sigue dentro → aparece la sugerencia de sufijo; confirmar registra `234-B`; dar salida al original y volver a cargar `234` sin sufijo → entra normal.
