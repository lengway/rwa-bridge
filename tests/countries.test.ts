import assert from "node:assert/strict";
import test from "node:test";
import { countries } from "../lib/countries";

test("onboarding provides all 249 ISO country/territory choices without duplicate codes", () => {
  assert.equal(countries.length, 249);
  assert.equal(new Set(countries.map(([code]) => code)).size, 249);
  for (const code of ["KZ", "JP", "BR", "ZA", "PS", "UA", "US"]) assert.ok(countries.some(([value]) => value === code));
});
