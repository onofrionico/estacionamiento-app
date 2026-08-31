# Tolerancia de cobro y monto único en salida — Design

**Contexto:** en producción (`master`) se reportaron cobros que suben de tramo/bloque de tarifa apenas unos minutos después de cruzar un umbral (ej. un vehículo con 2h48m de estadía ya cobrado casi al tope de "media estadía"). La causa es que [`calcularMonto`](../../../src/lib/format.js) usa `Math.ceil` para contar bloques de 30/60 minutos: apenas se excede un múltiplo del bloque, se cobra el bloque entero siguiente, sin margen.

Además, al revisar el cálculo de horarios se encontró que el monto que ve el cajero en la lista de "Registrar salida" y el monto que efectivamente se cobra al confirmar se calculan **dos veces, con dos relojes distintos** ([SalidaTab.jsx](../../../src/components/SalidaTab.jsx) usa `now`, que se actualiza cada 30s; [App.jsx](../../../src/App.jsx) recalcula con `Date.now()` fresco recién al confirmar), pudiendo desincronizarse justo cuando la estadía está por cruzar un umbral.

**Objetivo:** dar 15 minutos de tolerancia configurables antes de cobrar el tramo/bloque siguiente, y eliminar la duplicación de cálculo de monto entre la vista previa y el cobro real.

## 1. Tolerancia de tramo/bloque

Se agrega `toleranciaMin` (default `15`) a `config.umbrales`, junto a `mediaEstadiaHoras` y `estadiaCompletaHoras`.

Regla: los primeros 30 minutos (tarifa "media hora") se cobran sin tolerancia — no hay tramo anterior del cual "sobrar" tiempo. Para cualquier minuto por encima de eso, se resta la tolerancia antes de evaluar en qué tramo/bloque cae:

```
t = minutos - toleranciaMin   // solo aplica para minutos > 30
```

`t` reemplaza a `minutos` en toda la lógica de tramos y bloques de [`calcularMonto`](../../../src/lib/format.js) (umbral de 60 min, bloques de 30 min dentro de "media estadía", bloques de 60 min dentro de "estadía completa", y los tramos de días/semanas/meses). Ejemplo con tolerancia=15: "media hora" se cobra hasta el minuto 45 (30+15); recién de ahí pasa a "hora".

`tramoLabel` aplica la misma resta, para que la etiqueta que se muestra en la UI (ej. "Media estadía") sea siempre consistente con el precio calculado — hoy no lo es, ya que usa `minutos` sin tolerancia.

### Config y persistencia

- `DEFAULT_CONFIG.umbrales` en [constants.js](../../../src/constants.js) suma `toleranciaMin: 15`.
- `ConfigTab.jsx` suma un campo "Tolerancia (min)" en la sección "Umbrales de tramo", junto a los dos campos existentes.
- Tabla `config` en Supabase suma columna `umbral_tolerancia_min int not null default 15`. Se agrega vía migración SQL nueva (no se toca `supabase/schema.sql` de instalación limpia sin también sumar ahí la columna).
- `storage.js`: `configFromRows` lee `configRow.umbral_tolerancia_min`; `setConfig` la escribe. Como `getConfig` usa `select("*")` y `mergeConfig` (en `App.jsx`) ya rellena defaults para umbrales ausentes, el código nuevo no rompe si por algún motivo se lee antes de correr la migración — pero **la migración SQL debe aplicarse antes de deployar el código**, porque `setConfig` sí va a intentar escribir la columna nueva.

## 2. Monto único entre vista previa y cobro

`SalidaTab.jsx` calcula `monto` para mostrarlo en la lista, y `App.jsx#registrarSalida` lo vuelve a calcular de forma independiente al confirmar. Se unifica: `SalidaTab` calcula el monto una sola vez (con el mismo `now` que ya usa para mostrarlo) y se lo pasa a `onSalida(id, monto)`; `registrarSalida` en `App.jsx` deja de recalcular y usa el valor recibido. Así el monto que el cajero confirma es exactamente el que se cobra, sin fórmula duplicada.

No se toca el resto del flujo de horarios (`fmtDur`, `fmtTime`, `dayKey`, `startOfDay`): están basados en epoch ms / `timestamptz`, sin problemas de timezone.

## Fuera de alcance

- La pequeña discontinuidad de `tramoLabel`/`calcularMonto` cuando `estadiaCompletaHoras` no es múltiplo de 24 (caso borde, no reportado, no se toca).
- Cualquier cambio a las tarifas o umbrales existentes (`mediaEstadiaHoras`, `estadiaCompletaHoras`) — solo se agrega la tolerancia.

## Rama

Nueva rama de feature desde `develop` (ej. `fix/tolerancia-cobro`), siguiendo el flujo `develop → staging → master` del proyecto.
