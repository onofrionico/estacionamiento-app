import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "./constants";

describe("DEFAULT_CONFIG.umbrales", () => {
  it("tiene toleranciaMin por defecto en 15", () => {
    expect(DEFAULT_CONFIG.umbrales.toleranciaMin).toBe(15);
  });
});
