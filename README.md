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

El code-splitting por tab (`ReportesTab`, `SalidaTab`, etc.) mantiene esos
chunks livianos, pero el chunk principal (`index-*.js`) pesa ~663 kB (~204 kB
gzip) porque incluye `@supabase/supabase-js` como import síncrono (vía
`src/supabaseClient.js` → `src/storage.js` → `App.jsx`). Sin esa librería el
chunk principal rondaría los ~442 kB que dejó el code-splitting; el resto es
el costo del cliente de Supabase.

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

   > **Nota de seguridad:** la policy es `using (true) with check (true)`, o
   > sea que cualquiera que tenga la anon key (que viaja en el bundle del
   > cliente, es pública por diseño) puede leer, escribir y borrar cualquier
   > fila de `kv_store` sin autenticarse. Es aceptable para un equipo chico
   > y de confianza usando la app internamente, pero antes de exponerla a
   > más gente conviene restringir la policy (por ejemplo, scoping por
   > usuario autenticado con Supabase Auth).
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

> **Limitación conocida (concurrencia):** la app lee y escribe todo el blob
> de datos como un único JSON, sin suscripción realtime ni resolución de
> conflictos. Si dos empleados editan desde dispositivos distintos casi al
> mismo tiempo, gana el último `write` y se pierden los cambios del otro
> (last-write-wins). Queda pendiente para un trabajo futuro.

## Deploy (Render)

El repo incluye `render.yaml` (Blueprint) en la raíz, listo para que Render
levante el sitio como static site.

1. **Si el repo todavía no está en GitHub, subilo primero** (paso manual,
   previo a esto).
2. En [Render](https://dashboard.render.com) ir a **New → Blueprint** y
   conectar el repositorio de GitHub. Render detecta `render.yaml`
   automáticamente y configura el build (`npm install && npm run build`) y el
   publish path (`dist`) solo.
3. **Completar las variables de entorno** en el dashboard de Render
   (Environment del servicio): `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`,
   con los mismos valores que usás en `.env` local. En `render.yaml` están
   declaradas como `sync: false`, es decir que no viajan en el archivo — hay
   que cargarlas a mano en el dashboard la primera vez.
4. Cada push a la rama conectada (por ejemplo `main`) dispara un deploy
   automático en Render. No hace falta configurar GitHub Actions ni ningún
   otro paso de CI/CD.

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
