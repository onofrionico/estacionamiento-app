# Impresión de tickets — diseño

Fecha: 2026-08-31

## Alcance

Agregar impresión de tickets térmicos (80mm) al registrar el ingreso y/o el
egreso de un vehículo. La impresión de cada evento (ingreso, egreso) es
configurable de forma independiente desde Config, con impresión automática al
ocurrir la acción, más reimpresión manual disponible inmediatamente después
de la acción y desde el listado de Estado (para tickets de ingreso). El
ticket incluye datos del negocio (nombre, dirección, teléfono, logo) y un
número de ticket secuencial.

## Fuera de alcance

- Impresión directa vía ESC/POS (Web Bluetooth/USB). Se usa el diálogo de
  impresión nativo del navegador (`window.print()`) contra una impresora
  térmica ya instalada como impresora de Windows.
- Selector de 4 modos de impresión como un único campo — se resuelve con dos
  toggles independientes (ingreso / egreso), que en conjunto cubren las 4
  combinaciones.
- Reimpresión de comprobantes de egreso históricos desde Reportes/Estado (solo
  aplica a ingreso, ya que Estado solo lista vehículos actualmente dentro).
- Separar por rol el acceso a la config de impresión (queda dentro de la
  pestaña Config existente, ya restringida a admin).

## Base de datos (Supabase)

Nuevo archivo `supabase/add_tickets.sql`, idempotente, para correr en
proyectos existentes. `supabase/schema.sql` se actualiza también para que un
proyecto nuevo nazca con este esquema.

```sql
alter table config add column if not exists nombre text not null default 'Mi Estacionamiento';
alter table config add column if not exists direccion text;
alter table config add column if not exists telefono text;
alter table config add column if not exists logo_url text;
alter table config add column if not exists imprimir_ingreso boolean not null default false;
alter table config add column if not exists imprimir_egreso boolean not null default false;

alter table visitas add column if not exists numero_ticket int generated always as identity;
alter table visitas add constraint visitas_numero_ticket_unique unique (numero_ticket);

insert into storage.buckets (id, name, public) values ('logos', 'logos', true)
  on conflict (id) do nothing;

drop policy if exists "authenticated write logos" on storage.objects;
create policy "authenticated write logos" on storage.objects for all
  using (bucket_id = 'logos' and auth.role() = 'authenticated')
  with check (bucket_id = 'logos' and auth.role() = 'authenticated');

drop policy if exists "public read logos" on storage.objects;
create policy "public read logos" on storage.objects for select using (bucket_id = 'logos');
```

Notas:
- `numero_ticket` es generado por la base (`generated always as identity`),
  nunca se envía desde el cliente al insertar una visita.
- El bucket `logos` es público de lectura (necesario para que
  `<img src>` funcione sin firmar URLs); solo usuarios autenticados pueden
  escribir.
- El campo `nombre` de `config` ya existía en `DEFAULT_CONFIG`/`ConfigTab` en
  el código pero nunca se persistía en la tabla `config` real (bug
  preexistente: `configFromRows` no lo leía y `setConfig` no lo escribía).
  Esta spec lo corrige como parte del trabajo, ya que el ticket lo necesita.

## Cambios en `src/constants.js`

`DEFAULT_CONFIG` gana:

```js
direccion: "",
telefono: "",
logoUrl: "",
imprimirIngreso: false,
imprimirEgreso: false,
```

(`nombre` ya existe, sin cambios en su valor por defecto.)

## Cambios en `src/storage.js`

- `configFromRows(configRow, tarifaRows)`: agrega al objeto devuelto
  `nombre: configRow.nombre`, `direccion: configRow.direccion`,
  `telefono: configRow.telefono`, `logoUrl: configRow.logo_url`,
  `imprimirIngreso: configRow.imprimir_ingreso`,
  `imprimirEgreso: configRow.imprimir_egreso`.
- `setConfig(config)`: el upsert a `config` incluye
  `nombre: config.nombre`, `direccion: config.direccion || null`,
  `telefono: config.telefono || null`, `logo_url: config.logoUrl || null`,
  `imprimir_ingreso: !!config.imprimirIngreso`,
  `imprimir_egreso: !!config.imprimirEgreso`.
- `flattenVehicle(visita, vehiculo, egreso)`: agrega
  `numeroTicket: visita.numero_ticket`.
- `insertVehicle(vehicle)`: el insert a `visitas` deja de fijar cualquier
  columna de numeración (no la fija hoy, no cambia ese punto) y agrega
  `.select().single()` para leer `numero_ticket` generado por la base; la
  función devuelve `{ ...vehicle, numeroTicket: data.numero_ticket }` en vez
  de `vehicle` a secas.
- Nuevo método `uploadLogo(file)`:
  ```js
  async uploadLogo(file) {
    const ext = file.name.split(".").pop();
    const path = `logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
    if (error) throw error;
    return supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
  }
  ```

## Nuevo componente `src/components/Ticket.jsx`

Componente de presentación puro:

```jsx
export default function Ticket({ config, job })
// job: null | { tipo: "ingreso" | "egreso", vehicle }
```

- Si `job` es `null`, renderiza un contenedor vacío (nada que imprimir).
- Header: `<img>` con `config.logoUrl` si existe, `config.nombre`,
  `config.direccion` y `config.telefono` si existen.
- Línea divisoria y título: `"INGRESO"` o `"COMPROBANTE DE SALIDA"` según
  `job.tipo`.
- `N° Ticket: {job.vehicle.numeroTicket}`, patente, tipo de vehículo
  (label de `TIPOS`), hora de ingreso (`fmtTime`/fecha completa).
- Si `job.tipo === "egreso"`: además hora de salida, duración (`fmtDur`),
  tramo (`tramoLabel`) y monto (`fmtMoney`).
- Pie: fecha/hora de impresión (`new Date()` al render).
- Estilos: clases utilitarias simples, texto negro sobre blanco fijo (no usa
  las CSS vars del tema oscuro/claro de la app), ancho pensado para 80mm.

## CSS de impresión (`src/index.css`)

```css
@media screen {
  #ticket-print { display: none; }
}
@media print {
  body * { visibility: hidden; }
  #ticket-print, #ticket-print * { visibility: visible; }
  #ticket-print { position: absolute; top: 0; left: 0; width: 80mm; }
}
```

## Cambios en `src/App.jsx`

- Nuevo estado: `const [printJob, setPrintJob] = useState(null)`.
- Nueva función:
  ```js
  const imprimir = (tipo, vehicle) => {
    setPrintJob({ tipo, vehicle });
    requestAnimationFrame(() => window.print());
  };
  ```
- `registrarIngreso`: tras `await storage.insertVehicle(vehicle)` exitoso, si
  `config.imprimirIngreso`, llama `imprimir("ingreso", vehicleConTicket)`
  (usa el valor devuelto por `insertVehicle`, que ahora incluye
  `numeroTicket`).
- `registrarSalida`: tras `await storage.updateVehicle(id, patch)` exitoso,
  si `config.imprimirEgreso`, llama `imprimir("egreso", { ...v, ...patch })`.
- Se renderiza siempre `<div id="ticket-print"><Ticket config={config}
  job={printJob} /></div>` como hijo directo del contenedor raíz de la app
  (fuera del `<main>`, para que el CSS `body * { visibility: hidden }` de
  impresión no dependa de su posición en el árbol salvo por el id).
- Se pasa a los tabs: `onReimprimir={imprimir}` a `EntradaTab`, `SalidaTab` y
  `EstadoTab`.

## Cambios de UI por tab

### `EntradaTab.jsx`
- Nuevo estado local `ultimoRegistro` (el vehículo recién creado, con
  `numeroTicket`). Se setea al terminar `onRegistrar` exitosamente (requiere
  que `onRegistrar`/`registrarIngreso` devuelva el vehículo o que el padre
  pase el dato de otra forma — más simple: `EntradaTab` recibe también
  `ultimoRegistro` como prop controlada desde `App.jsx`, seteada en
  `registrarIngreso` tras el insert).
- Debajo del form, si hay `ultimoRegistro`, botón "Reimprimir ticket" que
  llama `onReimprimir("ingreso", ultimoRegistro)`.
- Se limpia (vuelve a `null`) cuando el usuario empieza a tipear una nueva
  patente.

### `SalidaTab.jsx`
- Nuevo estado local `ultimoCobro` (vehículo + monto, seteado al confirmar el
  cobro, ya que en ese momento la card va a desaparecer de `vehiculosDentro`).
- Tras confirmar, muestra temporalmente (mismo lugar donde estaba la card, o
  un bloque arriba de la lista) un resumen con botón "Reimprimir
  comprobante" que llama `onReimprimir("egreso", ultimoCobro)`.
- Se descarta al cambiar la búsqueda o tras un tiempo/replace por nueva
  acción (no hace falta persistencia; es una conveniencia inmediata).

### `EstadoTab.jsx`
- Cada fila de `vehiculosDentro` gana un botón/ícono de impresora (ej.
  `Printer` de `lucide-react`) que llama `onReimprimir("ingreso", v)`. `v` ya
  trae `numeroTicket` porque viene de `storage.getVehicles()` /
  `flattenVehicle`.

### `ConfigTab.jsx`
Dos secciones nuevas (entre "Nombre/Capacidad" y "Tarifas", o al final —
posición exacta se decide en implementación siguiendo el estilo visual
existente):

**"Datos del negocio"**
- Input dirección (`local.direccion`).
- Input teléfono (`local.telefono`).
- `<input type="file" accept="image/*">`: al seleccionar archivo, llama
  `await storage.uploadLogo(file)`, guarda la URL en `local.logoUrl`, muestra
  preview (`<img>`) del logo actual/nuevo.

**"Impresión de tickets"**
- Checkbox/switch "Imprimir automáticamente al ingreso" → `local.imprimirIngreso`.
- Checkbox/switch "Imprimir automáticamente al egreso" → `local.imprimirEgreso`.

Ambas secciones se guardan con el mismo botón "Guardar cambios" existente
(`onSave(local)`), sin necesidad de un guardado separado.

## Testing

- Se agregan tests unitarios para cualquier lógica de formateo nueva no
  trivial que surja al construir el contenido del ticket (por ejemplo, un
  helper de fecha/hora completa si `lib/format.js` no tiene ya uno
  adecuado). Si toda la lógica de armado del ticket es JSX directo sin
  cálculos nuevos, no se agregan tests nuevos de unidad para `Ticket.jsx`
  (es presentación pura).
- Verificación manual: abrir la app en el navegador, activar ambos toggles
  de impresión en Config, registrar un ingreso y una salida, confirmar que
  se dispara el diálogo de impresión del navegador y que la vista previa del
  ticket muestra los datos correctos (logo, nombre, dirección, teléfono, N°
  de ticket, patente, horarios, monto). Confirmar también el botón de
  reimprimir en Entrada, Salida y Estado.
- No es posible automatizar la verificación contra una impresora térmica
  física real desde este entorno; la verificación se limita al
  comportamiento del navegador (apertura de `window.print()` y contenido del
  DOM impreso).
