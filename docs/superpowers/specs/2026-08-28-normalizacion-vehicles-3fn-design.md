# Normalización 3FN de `vehicles` — Design

**Contexto:** hoy toda la información de un vehículo (identidad, tipo, ingreso, salida, monto cobrado, estado) vive en una sola tabla `vehicles` (ver [supabase/schema.sql](../../../supabase/schema.sql)), con `hora_salida` y `monto` nullable mientras el vehículo está "dentro", y `tipo` como texto libre sin validar contra un catálogo. `config.rates` guarda las tarifas por tipo como un blob `jsonb`, y `config.umbrales` igual.

**Objetivo:** llevar el modelo a 3FN, sin columnas nullable en el flujo normal, con más detalle (historial por patente, catálogo de tipos, historial de tarifas), preservando el comportamiento actual de la UI.

## Modelo de datos

```mermaid
erDiagram
    tipos_vehiculo ||--o{ vehiculos : "tipo"
    tipos_vehiculo ||--o{ tarifas_por_tipo : "tiene"
    vehiculos ||--o{ visitas : "protagoniza"
    visitas ||--o| egresos : "cierra con"

    tipos_vehiculo {
        text id PK
        text nombre
    }
    vehiculos {
        text patente PK
        text tipo_id FK
        timestamptz created_at
    }
    visitas {
        text id PK
        text vehiculo_id FK
        timestamptz hora_ingreso
        text estado
        timestamptz created_at
    }
    egresos {
        text visita_id PK_FK
        timestamptz hora_salida
        numeric monto
        timestamptz created_at
    }
    tarifas_por_tipo {
        text tipo_id PK_FK
        text concepto PK
        timestamptz vigente_desde PK
        numeric monto
    }
    config {
        int id PK
        int total_espacios
        int umbral_media_estadia_horas
        int umbral_estadia_completa_horas
    }
```

### Tablas

- **`tipos_vehiculo`**: catálogo (`auto`, `moto`, `camioneta`). Reemplaza el texto libre `vehicles.tipo`.
- **`vehiculos`**: identidad del auto, separada de cada estadía. `patente` como primary key (clave natural, ya es única). `tipo_id` FK not null. Sin datos adicionales por ahora (nombre/teléfono del dueño, marca/modelo quedan fuera de alcance — se puede agregar después sin romper el modelo).
- **`visitas`**: una fila por estadía (ingreso). `vehiculo_id` FK not null, `hora_ingreso` not null, `estado` not null (`'dentro'` / `'afuera'`). Índice único parcial `visitas (vehiculo_id) where estado = 'dentro'` — bloquea que la misma patente entre dos veces sin salir.
- **`egresos`**: fila opcional 1:1 con `visitas`, solo existe si el vehículo salió. `visita_id` es PK y FK a `visitas`. `hora_salida` y `monto` **not null** — al no existir la fila hasta que hay salida real, no hace falta nullable.
- **`tarifas_por_tipo`**: append-only. Cada guardado desde Config inserta filas nuevas con `vigente_desde = now()`, nunca actualiza ni borra. La tarifa vigente para un `(tipo_id, concepto)` es la de mayor `vigente_desde <= now()`. Da historial completo de cambios de tarifas sin columnas nullable (no hace falta `vigente_hasta`: se infiere por el siguiente registro en el tiempo).
- **`config`**: pierde `rates` (ahora en `tarifas_por_tipo`) y `umbrales` (jsonb) se abre en dos columnas `int not null`: `umbral_media_estadia_horas`, `umbral_estadia_completa_horas`.

### Por qué esta forma

- Elimina los nulls de `hora_salida`/`monto` moviéndolos a una tabla hija que solo existe cuando corresponde, en vez de nullable en la fila principal.
- `tipo` como FK da integridad referencial real (hoy cualquier string pasa).
- Separar `vehiculos` de `visitas` habilita historial por patente sin repetir `tipo` en cada visita.
- `estado` se mantiene en `visitas` (NOT NULL) en vez de derivarlo de la existencia de `egresos`, para poder usar un índice único parcial simple y rápido contra duplicados, en vez de necesitar un trigger o función. Se sincroniza con `egresos` en la misma operación de salida (una función/RPC en Postgres hace insert en `egresos` + update de `estado` en una transacción).
- Tarifas append-only da historial completo sin nulls y sin tablas de auditoría separadas.

## Capa de aplicación

`storage.js` sigue devolviendo a la UI el mismo objeto aplanado que ya consumen `App.jsx` / `ReportesTab.jsx` / `SalidaTab.jsx` / `EstadoTab.jsx` / `EntradaTab.jsx` / `ConfigTab.jsx`:

- Vehículos: `{ id, patente, tipo, horaIngreso, horaSalida, monto, estado }` — armado con un join `visitas` + `vehiculos` + `egresos` (left join, `egresos` puede no existir).
- Config: `{ totalEspacios, rates: { auto: {...}, moto: {...}, camioneta: {...} }, umbrales: {...} }` — armado con `config` + la vista de tarifas vigentes (`distinct on (tipo_id, concepto) ... order by vigente_desde desc`).

**Los componentes de UI no cambian** — solo `storage.js` (más queries, inserts en varias tablas) y el esquema SQL / script de migración.

Costo real de este diseño: Supabase Realtime notifica por tabla base, no por vista, así que `storage.js` pasa de suscribirse a 2 tablas (`vehicles`, `config`) a 5 (`vehiculos`, `visitas`, `egresos`, `tarifas_por_tipo`, `config`) y mergea los eventos en el estado aplanado del cliente. Más lógica, pero contenida en un solo archivo.

## Migración de datos reales

El proyecto Supabase real del usuario ya tiene datos en `vehicles`/`config` (esquema actual, no el `kv_store` viejo). El script de migración nuevo:

1. Crea las tablas nuevas (`tipos_vehiculo`, `vehiculos`, `visitas`, `egresos`, `tarifas_por_tipo`) y el `config` con las columnas nuevas.
2. Siembra `tipos_vehiculo` con `auto`/`moto`/`camioneta`.
3. `vehiculos`: `select distinct patente, tipo` de `vehicles` (con el `tipo` de la fila más reciente por patente, para consistencia).
4. `visitas`+`egresos`: cada fila de `vehicles` → una `visita` (`id`, `vehiculo_id = patente`, `hora_ingreso`, `estado`) y, si tenía `hora_salida`/`monto`, una fila en `egresos`.
5. `tarifas_por_tipo`: de `config.rates` (jsonb por tipo) → una fila por `(tipo, concepto)` con `vigente_desde = now()`.
6. `config`: `total_espacios` de la fila existente, `umbral_media_estadia_horas`/`umbral_estadia_completa_horas` de `config.umbrales`.
7. Verificación de conteos antes de dropear `vehicles`/`config` viejas (a mano, como ya es el patrón en este repo — ver `supabase/migrate_kv_to_relational.sql`).

## Fuera de alcance (confirmado con el usuario)

- Datos adicionales en `vehiculos` (dueño, marca/modelo/color) — no se agregan ahora.
- UI para ver el historial de tarifas — el esquema lo soporta, pero no se construye pantalla nueva en esta iteración.
- RLS granular por rol (ya era una limitación conocida antes de este cambio, documentada en el README) — no se toca.
