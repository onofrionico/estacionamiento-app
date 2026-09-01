import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "./constants";

describe("DEFAULT_CONFIG.umbrales", () => {
  it("tiene toleranciaMin por defecto en 15", () => {
    expect(DEFAULT_CONFIG.umbrales.toleranciaMin).toBe(15);
  });
});

describe("DEFAULT_CONFIG.impresión", () => {
  it("tiene la impresión automática desactivada por defecto", () => {
    expect(DEFAULT_CONFIG.imprimirIngreso).toBe(false);
    expect(DEFAULT_CONFIG.imprimirEgreso).toBe(false);
  });

  it("tiene los campos de identidad del negocio como string vacío por defecto", () => {
    expect(DEFAULT_CONFIG.direccion).toBe("");
    expect(DEFAULT_CONFIG.telefono).toBe("");
    expect(DEFAULT_CONFIG.logoUrl).toBe("");
  });
});
