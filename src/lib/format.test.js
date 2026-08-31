import { describe, it, expect } from "vitest";
import { calcularMonto } from "./format";

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
    expect(calcularMonto(31, rates, umbralesNegativos)).toBe(2500);
  });
});
