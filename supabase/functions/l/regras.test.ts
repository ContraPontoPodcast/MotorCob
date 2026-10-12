// node --experimental-strip-types --test supabase/functions/l/regras.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { codigoDoCaminho, destinoSeguro, dispositivo } from "./regras.ts";

test("código no caminho", () => {
  assert.equal(codigoDoCaminho("/Ab12Cd34"), "Ab12Cd34");
  assert.equal(codigoDoCaminho("/functions/v1/l/Ab12Cd34/"), "Ab12Cd34");
  assert.equal(codigoDoCaminho("/l/Ab12"), null);
  assert.equal(codigoDoCaminho("/l/Ab12Cd34'--"), null);
  assert.equal(codigoDoCaminho("/"), null);
});

test("quem abriu o link", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  assert.equal(dispositivo("GET", iphone), "celular");
  assert.equal(dispositivo("GET", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"), "computador");
  assert.equal(dispositivo("GET", "WhatsApp/2.23.20.0 A"), "robo");
  assert.equal(dispositivo("GET", "facebookexternalhit/1.1"), "robo");
  assert.equal(dispositivo("HEAD", iphone), "robo");
  assert.equal(dispositivo("GET", null), "robo");
});

test("só redireciona para http e https", () => {
  assert.equal(destinoSeguro("https://pague.exemplo.com/b?c=1"), "https://pague.exemplo.com/b?c=1");
  assert.equal(destinoSeguro("javascript:alert(1)"), null);
  assert.equal(destinoSeguro("data:text/html,x"), null);
  assert.equal(destinoSeguro(null), null);
});
