# Estacionamiento App

Aplicación web mobile-first para la gestión de un estacionamiento: registro de
entradas y salidas, cálculo automático de tarifas por tramo, estado de
ocupación en tiempo real, y reportes (diario / semanal / quincenal / mensual)
exportables a Excel.

## Requisitos

- Node.js 18+

## Desarrollo local

```bash
npm install
npm run dev
```

Abrí la URL que muestra la terminal (por defecto `http://localhost:5173`).
Para probarla como la usaría un empleado desde el celular, abrí esa misma URL
desde el navegador del teléfono estando en la misma red Wi-Fi (Vite te va a
mostrar también una URL de tipo `http://192.168.x.x:5173`).

## Build de producción

```bash
npm run build
npm run preview   # para previsualizar el build localmente
```

El resultado queda en `dist/`, listo para hostear en cualquier servicio de
archivos estáticos (Vercel, Netlify, GitHub Pages, etc.).

## ⚠️ Estado actual del almacenamiento de datos

Por ahora los datos (autos registrados, configuración de tarifas) se guardan
en el `localStorage` del navegador — ver `src/storage.js`. Esto significa:

- Los datos **no se sincronizan** entre distintos dispositivos. Si dos
  empleados usan la app desde celulares distintos, cada uno tiene su propia
  copia.
- Si se borra el caché del navegador, se pierden los datos.

Es un punto de partida válido para seguir probando, pero **antes de usarla en
producción con varios empleados** conviene reemplazar `src/storage.js` por un
backend real (Supabase, Firebase, o una API propia) que centralice los datos.
El resto de la app (`src/App.jsx`) no necesita cambios para eso: solo
reimplementar `storage.get` / `storage.set` / `storage.delete`.

## Estructura

```
src/
  App.jsx       # toda la lógica y UI de la aplicación
  storage.js    # capa de persistencia (hoy: localStorage)
  main.jsx      # punto de entrada de React
  index.css     # Tailwind
```

## Configuración

Capacidad total, tarifas (media hora, hora, media estadía, estadía completa,
semanal, mensual) y umbrales de tramo se configuran desde la pestaña
**Config** dentro de la app — no hace falta tocar código.
