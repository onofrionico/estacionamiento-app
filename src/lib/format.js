import * as XLSX from "xlsx";

export const fmtMoney = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n || 0);

export const fmtDur = (mins) => {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return `${h} h ${r > 0 ? r + " min" : ""}`.trim();
};

export const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

export const fmtDateShort = (ts) =>
  new Date(ts).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

export const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false, // evita "a. m./p. m."
  });

/**
 * Calcula el monto a cobrar dado un tiempo de estadía en minutos.
 * `umbrales.toleranciaMin` (default 0) da minutos de gracia antes de pasar
 * al tramo/bloque siguiente — no aplica a los primeros 30 minutos, que se
 * cobran a tarifa "media hora" desde el minuto 1.
 */
export function calcularMonto(minutos, rates, umbrales) {
  const { mediaHora, hora, mediaEstadia, estadiaCompleta, semanal, mensual } = rates;
  const mediaEstadiaMin = umbrales.mediaEstadiaHoras * 60;
  const estadiaCompletaMin = umbrales.estadiaCompletaHoras * 60;
  const toleranciaMin = Math.max(0, umbrales.toleranciaMin ?? 0);

  if (minutos <= 30) return mediaHora;

  const t = minutos - toleranciaMin;

  if (t <= 30) return mediaHora;
  if (t <= 60) return hora;

  if (t <= mediaEstadiaMin) {
    const bloques = Math.ceil((t - 60) / 30);
    return Math.min(hora + bloques * mediaHora, mediaEstadia);
  }

  if (t <= estadiaCompletaMin) {
    const bloques = Math.ceil((t - mediaEstadiaMin) / 60);
    return Math.min(mediaEstadia + bloques * hora, estadiaCompleta);
  }

  const dias = Math.ceil(t / (24 * 60));
  if (dias < 7) return Math.min(dias * estadiaCompleta, semanal);

  const semanas = Math.ceil(dias / 7);
  if (dias < 30) return Math.min(semanas * semanal, mensual);

  const meses = Math.ceil(dias / 30);
  return meses * mensual;
}

export function tramoLabel(minutos, umbrales) {
  const mediaEstadiaMin = umbrales.mediaEstadiaHoras * 60;
  const estadiaCompletaMin = umbrales.estadiaCompletaHoras * 60;
  const toleranciaMin = Math.max(0, umbrales.toleranciaMin ?? 0);

  if (minutos <= 30) return "Media hora";

  const t = minutos - toleranciaMin;

  if (t <= 30) return "Media hora";
  if (t <= 60) return "Hora";
  if (t <= mediaEstadiaMin) return "Media estadía";
  if (t <= estadiaCompletaMin) return "Estadía completa";
  const dias = Math.ceil(t / (24 * 60));
  if (dias < 7) return `Estadía por día (${dias}d)`;
  if (dias < 30) return `Tarifa semanal`;
  return `Tarifa mensual`;
}

/** Genera y descarga un archivo .xlsx con una o más hojas. sheets = { NombreHoja: [ {col: val, ...}, ... ] } */
export function downloadXLSX(filename, sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "Sin datos": "" }]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

export const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
export const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

/** Convierte un nombre en un id de tabla: minusculas, sin acentos, solo [a-z0-9-]. */
export function slugify(nombre) {
  return nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
