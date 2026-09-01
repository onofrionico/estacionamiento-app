# Desglose de recaudación por medio de pago en Reportes — Design

**Fecha:** 2026-09-01
**Estado:** Aprobado para pasar a plan de implementación

## Contexto

Ya existe el registro de medio de pago por cobro (feature "medios de pago", mergeada en `develop` vía [#8](https://github.com/onofrionico/estacionamiento-app/pull/8)): cada `egreso` guarda `medio_pago_id`, y `storage.getVehicles()` devuelve cada vehículo con `medioPago` (nombre) resuelto. Lo que falta es mostrar, en la pestaña Reportes, cuánto se recaudó por cada medio de pago — hoy el usuario solo puede ver el total recaudado (tarjetas de corte) sin desglose.

## Alcance

Un desglose por medio de pago en `ReportesTab.jsx`, atado al mismo selector de período que ya existe para el gráfico "Ingresos y egresos" (`Hoy | Semana | Quincena | Mes`), presentado como una lista con montos (no gráfico).

## Cálculo

Nueva función pura `montosPorMedioPago(vehicles, fromTs)` en `ReportesTab.jsx`, junto a `computeCortes`/`movimientosPorHora`/`movimientosPorDia`:

- Filtra vehículos con `estado === "afuera"` y `horaSalida >= fromTs` (mismo criterio que ya usa `computeCortes`).
- Agrupa por `v.medioPago` (el nombre ya resuelto que devuelve `storage.getVehicles()`); los egresos sin medio de pago cargado (datos previos a la migración) van a un grupo `"Sin especificar"`.
- Suma `monto` por grupo.
- Devuelve un array ordenado de mayor a menor monto: `[{ nombre, monto }, ...]`.

El `fromTs` para cada opción del selector reutiliza los mismos umbrales que ya calcula `computeCortes` para sus 4 tarjetas de corte (hoy → inicio del día; semana → `now - 7d`; quincena → `now - 15d`; mes → `now - 30d`), así el total del desglose siempre coincide con la tarjeta de corte equivalente cuando el período seleccionado coincide con una de ellas.

## UI

Una tarjeta nueva (mismo estilo visual que `CorteCard`/`ChartCard`: `rounded-xl`, fondo `var(--surface)`, borde `var(--border)`), ubicada **debajo del selector de período** (`Hoy/Semana/Quincena/Mes`) y **antes** del `ChartCard` de "Ingresos y egresos". Contenido:

- Título pequeño acorde al período elegido (ej. "Recaudación por medio de pago — Hoy").
- Una fila por medio de pago: nombre a la izquierda, monto formateado (`fmtMoney`) a la derecha, ordenadas de mayor a menor.
- Fila de total al pie, separada con un borde superior.
- Si no hay recaudación en el período (todas las filas vacías), no se muestra la tarjeta — mismo criterio que ya usan otras secciones de esta pantalla para evitar tarjetas vacías (ver `EmptyState` en Historial, aunque acá directamente se omite en vez de mostrar un estado vacío, porque es una tarjeta secundaria/compacta, no una sección principal).

## Fuera de alcance

- No se modifica el export a `.xlsx` (ya incluye la columna "Medio de pago" por fila, agregada en la feature anterior) ni las tarjetas de corte fijas (Hoy/7d/15d/30d).
- No se agrega gráfico visual (torta/barras) — se descartó en la conversación a favor de la lista simple.
