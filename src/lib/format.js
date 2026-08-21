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

/** Calcula el monto a cobrar dado un tiempo de estadía en minutos. */
export function calcularMonto(minutos, rates, umbrales) {
  const { mediaHora, hora, mediaEstadia, estadiaCompleta, semanal, mensual } = rates;
  const mediaEstadiaMin = umbrales.mediaEstadiaHoras * 60;
  const estadiaCompletaMin = umbrales.estadiaCompletaHoras * 60;

  if (minutos <= 30) return mediaHora;
  if (minutos <= 60) return hora;

  if (minutos <= mediaEstadiaMin) {
    const bloques = Math.ceil((minutos - 60) / 30);
    return Math.min(hora + bloques * mediaHora, mediaEstadia);
  }

  if (minutos <= estadiaCompletaMin) {
    const bloques = Math.ceil((minutos - mediaEstadiaMin) / 60);
    return Math.min(mediaEstadia + bloques * hora, estadiaCompleta);
  }

  const dias = Math.ceil(minutos / (24 * 60));
  if (dias < 7) return Math.min(dias * estadiaCompleta, semanal);

  const semanas = Math.ceil(dias / 7);
  if (dias < 30) return Math.min(semanas * semanal, mensual);

  const meses = Math.ceil(dias / 30);
  return meses * mensual;
}

export function tramoLabel(minutos, umbrales) {
  const mediaEstadiaMin = umbrales.mediaEstadiaHoras * 60;
  const estadiaCompletaMin = umbrales.estadiaCompletaHoras * 60;
  if (minutos <= 30) return "Media hora";
  if (minutos <= 60) return "Hora";
  if (minutos <= mediaEstadiaMin) return "Media estadía";
  if (minutos <= estadiaCompletaMin) return "Estadía completa";
  const dias = Math.ceil(minutos / (24 * 60));
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
