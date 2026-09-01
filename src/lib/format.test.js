import { describe, it, expect } from "vitest";
import { calcularMonto, tramoLabel, fmtDateTime } from "./format";

const rates = {
  mediaHora: 1500,
  hora: 2500,
  mediaEstadia: 8000,
  estadiaCompleta: 14000,
  semanal: 70000,
  mensual: 220000,
};

const umbrales = {
  mediaEstadiaHoras: 6,
  estadiaCompletaHoras: 24,
  toleranciaMin: 15,
};

describe("calcularMonto con tolerancia", () => {
  it("cobra media hora en los primeros 30 minutos, sin tolerancia", () => {
    expect(calcularMonto(30, rates, umbrales)).toBe(1500);
  });

  it("sigue cobrando media hora hasta 30+tolerancia minutos", () => {
    expect(calcularMonto(31, rates, umbrales)).toBe(1500);
    expect(calcularMonto(45, rates, umbrales)).toBe(1500);
  });

  it("pasa a tarifa hora recien despues de 30+tolerancia minutos", () => {
    expect(calcularMonto(46, rates, umbrales)).toBe(2500);
    expect(calcularMonto(60, rates, umbrales)).toBe(2500);
  });

  it("sigue cobrando hora hasta 60+tolerancia minutos", () => {
    expect(calcularMonto(75, rates, umbrales)).toBe(2500);
  });

  it("cobra el primer bloque de media hora recien despues de 60+tolerancia", () => {
    expect(calcularMonto(76, rates, umbrales)).toBe(2500 + 1500); // hora + 1 bloque
    expect(calcularMonto(105, rates, umbrales)).toBe(2500 + 1500); // 60+30+15, todavia bloque 1
  });

  it("cobra el segundo bloque recien despues del bloque 1 + tolerancia", () => {
    expect(calcularMonto(106, rates, umbrales)).toBe(2500 + 2 * 1500);
  });

  it("sin toleranciaMin en umbrales, se comporta como antes (sin gracia)", () => {
    const umbralesSinTolerancia = { mediaEstadiaHoras: 6, estadiaCompletaHoras: 24 };
    expect(calcularMonto(31, rates, umbralesSinTolerancia)).toBe(2500);
    expect(calcularMonto(61, rates, umbralesSinTolerancia)).toBe(2500 + 1500);
  });

  it("un toleranciaMin negativo se trata como 0 (no adelanta los tramos)", () => {
    const umbralesNegativos = { mediaEstadiaHoras: 6, estadiaCompletaHoras: 24, toleranciaMin: -10 };
    expect(calcularMonto(90, rates, umbralesNegativos)).toBe(4000);
  });
});

describe("tramoLabel con tolerancia", () => {
  it("muestra 'Media hora' hasta 30+tolerancia minutos", () => {
    expect(tramoLabel(30, umbrales)).toBe("Media hora");
    expect(tramoLabel(45, umbrales)).toBe("Media hora"); // pre-fix daria "Hora"
  });

  it("muestra 'Hora' hasta 60+tolerancia minutos", () => {
    expect(tramoLabel(75, umbrales)).toBe("Hora"); // pre-fix daria "Media estadía" (75 > 60)
  });

  it("es consistente con calcularMonto en el limite de un bloque de Media estadía", () => {
    expect(tramoLabel(105, umbrales)).toBe("Media estadía");
  });

  it("cruza a 'Estadía completa' recien despues de mediaEstadiaMin+tolerancia", () => {
    // mediaEstadiaMin = 6*60 = 360. Con tolerancia=15: se mantiene "Media estadía" hasta 375.
    expect(tramoLabel(375, umbrales)).toBe("Media estadía"); // pre-fix daria "Estadía completa" (375 > 360)
    expect(tramoLabel(376, umbrales)).toBe("Estadía completa");
  });

  it("sin toleranciaMin en umbrales, se comporta como antes (sin gracia)", () => {
    const umbralesSinTolerancia = { mediaEstadiaHoras: 6, estadiaCompletaHoras: 24 };
    expect(tramoLabel(31, umbralesSinTolerancia)).toBe("Hora");
  });

  it("un toleranciaMin negativo se trata como 0 (no adelanta los tramos)", () => {
    const umbralesNegativos = { mediaEstadiaHoras: 6, estadiaCompletaHoras: 24, toleranciaMin: -10 };
    // Con clamp: t = 55 - 0 = 55 -> "Hora". Sin clamp: t = 55 - (-10) = 65 -> "Media estadía".
    expect(tramoLabel(55, umbralesNegativos)).toBe("Hora");
  });
});

describe("fmtDateTime", () => {
  it("incluye la fecha en formato dd/mm/aaaa y la hora en formato hh:mm", () => {
    const ts = new Date(2026, 7, 31, 14, 5, 0).getTime(); // 31/ago/2026 14:05 (mes 0-indexed)
    const out = fmtDateTime(ts);
    expect(out).toContain("31/08/2026");
    expect(out).toContain("14:05");
  });
});
