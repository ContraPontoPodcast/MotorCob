// deno test: o demonstrativo de exemplo vira um PDF de 2 páginas, com os textos e sem caractere perdido.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { montar } from "./demonstrativo.ts";
import { gerarPdf, limpar } from "./demonstrativo_pdf.ts";
import { EXEMPLO } from "./demonstrativo_exemplo.ts";

Deno.test("PDF do demonstrativo", async () => {
  const bytes = await gerarPdf(montar(EXEMPLO));
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assertEquals(doc.getPageCount(), 2);
  assertEquals(doc.getTitle(), "Demonstrativo da fatura 1042 - MotorCX");
});

Deno.test("muitos itens quebram em mais páginas", async () => {
  const itens = Array.from({ length: 60 }, (_, i) => ({ ...EXEMPLO.itens[3], ordem: i, valor: 1 }));
  const doc = await PDFDocument.load(await gerarPdf(montar({ ...EXEMPLO, itens })));
  assert(doc.getPageCount() >= 3);
});

Deno.test("caracteres fora da fonte padrão viram equivalentes", () => {
  assertEquals(limpar("− R$ 1,00 · ação › 😀"), "- R$ 1,00 · ação › ?");
});
