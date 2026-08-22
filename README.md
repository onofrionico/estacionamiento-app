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

## Backend (Supabase)

Los datos (autos registrados, configuración de tarifas) se guardan en
Supabase — ver `src/storage.js` y `src/supabaseClient.js` — así que se
sincronizan entre todos los dispositivos que usen la app (todos leen y
escriben la misma fila en la tabla `kv_store`).

Para levantar tu propio backend:

1. **Crear un proyecto** en [supabase.com](https://supabase.com) (tier free
   alcanza).
2. **Correr el SQL** de `supabase/schema.sql` en el SQL editor del proyecto
   (Supabase → SQL Editor → pegar el contenido del archivo → Run). Crea la
   tabla `kv_store` con Row Level Security habilitado y una policy permisiva
   de lectura/escritura.
3. **Copiar las credenciales**: `.env.example` a `.env`

   ```bash
   cp .env.example .env
   ```

   y completar las dos variables con los valores de Settings → API del
   proyecto Supabase:

   ```
   VITE_SUPABASE_URL=<Project URL>
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```

4. **Correr la app**:

   ```bash
   npm run dev
   ```

`.env` está en `.gitignore` — las claves nunca se suben al repo.

## Estructura

```
src/
  App.jsx       # toda la lógica y UI de la aplicación
  storage.js    # capa de persistencia (hoy: Supabase, tabla kv_store)
  supabaseClient.js # cliente de Supabase (usa VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
  main.jsx      # punto de entrada de React
  index.css     # Tailwind
```

## Configuración

Capacidad total, tarifas (media hora, hora, media estadía, estadía completa,
semanal, mensual) y umbrales de tramo se configuran desde la pestaña
**Config** dentro de la app — no hace falta tocar código.
