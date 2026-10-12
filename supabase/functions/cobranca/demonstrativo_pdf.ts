// Desenho do demonstrativo em PDF (A4) com pdf-lib. Recebe as seções prontas de demonstrativo.ts.
// Fontes padrão do PDF (Helvetica): acentos do português funcionam; caracteres fora do WinAnsi viram equivalentes.
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import type { Secoes } from "./demonstrativo.ts";

const A4: [number, number] = [595.28, 841.89];
const M = 42;                                  // margem
const TINTA = rgb(0.114, 0.114, 0.122), CINZA = rgb(0.37, 0.37, 0.4), LINHA = rgb(0.855, 0.855, 0.875);
const SUAVE = rgb(0.957, 0.957, 0.965), OURO = rgb(0.788, 0.639, 0.353);

/** Troca o que a fonte padrão não desenha (fora do WinAnsi) por um equivalente. */
export function limpar(t: string): string {
  return String(t ?? "").replace(/[−‐‑]/g, "-").replace(/[   ]/g, " ")
    .replace(/[^\x20-\x7e¡-ÿ–—‘’“”•…€‹›]/gu, "?");
}

export async function gerarPdf(s: Secoes): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Demonstrativo da fatura ${s.numero} - MotorCX`);
  doc.setAuthor("MotorCX");
  doc.setLanguage("pt-BR");
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = A4[0] - 2 * M;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;

  const largura = (t: string, fonte: PDFFont, tam: number) => fonte.widthOfTextAtSize(limpar(t), tam);
  const texto = (t: string, x: number, yy: number, tam = 9, fonte = f, cor = TINTA) =>
    page.drawText(limpar(t), { x, y: yy, size: tam, font: fonte, color: cor });
  const direita = (t: string, xDir: number, yy: number, tam = 9, fonte = f, cor = TINTA) =>
    texto(t, xDir - largura(t, fonte, tam), yy, tam, fonte, cor);
  const quebrar = (t: string, max: number, tam: number, fonte = f): string[] => {
    const linhas: string[] = [];
    let atual = "";
    for (const p of limpar(t).split(" ")) {
      const tenta = atual ? `${atual} ${p}` : p;
      if (largura(tenta, fonte, tam) > max && atual) { linhas.push(atual); atual = p; } else atual = tenta;
    }
    if (atual) linhas.push(atual);
    return linhas.length ? linhas : [""];
  };
  const precisa = (h: number) => {
    if (y - h < M + 24) { page = doc.addPage(A4); y = A4[1] - M; cabecalhoContinua(); }
  };
  const traco = (yy: number, cor = LINHA, esp = 0.6) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: M + L, y: yy }, thickness: esp, color: cor });
  const titulo = (t: string) => { precisa(30); y -= 16; texto(t.toUpperCase(), M, y, 8, b, CINZA); y -= 8; };
  function cabecalhoContinua() {
    texto(`Demonstrativo nº ${s.numero} · ciclo ${s.ciclo}`, M, y - 10, 9, b);
    direita("MotorCX", M + L, y - 10, 9, b, CINZA);
    y -= 26;
  }

  /** Tabela simples: colunas com largura (fração de L) e alinhamento; quebra de página repete o cabeçalho. */
  function tabela(cab: string[], larg: number[], alin: ("e" | "d")[], linhas: { cel: string[]; detalhe?: string; forte?: boolean; grupo?: string }[]) {
    const xs: number[] = []; let acc = M;
    for (const w of larg) { xs.push(acc); acc += w * L; }
    const semCab = cab.every((c) => !c);
    const desenhaCab = () => {
      if (semCab) { traco(y); return; }
      precisa(20);
      cab.forEach((c, i) => alin[i] === "d" ? direita(c.toUpperCase(), xs[i] + larg[i] * L, y - 9, 7, b, CINZA) : texto(c.toUpperCase(), xs[i], y - 9, 7, b, CINZA));
      y -= 14; traco(y);
    };
    desenhaCab();
    for (const ln of linhas) {
      if (ln.grupo) {
        precisa(22); y -= 15; texto(ln.grupo.toUpperCase(), M, y, 7.5, b, CINZA); y -= 4; traco(y, TINTA, 0.8); continue;
      }
      const larga = ln.cel.length > 2 && ln.cel.slice(1, -1).every((c) => !c);   // linha só com descrição e valor
      const cel0 = quebrar(ln.cel[0], (larga ? L * (1 - larg[larg.length - 1]) : larg[0] * L) - 6, 9, ln.forte ? b : f);
      const det = ln.detalhe ? quebrar(ln.detalhe, L * (1 - larg[larg.length - 1]) - 6, 7.5) : [];
      const h = 6 + cel0.length * 11 + det.length * 9.5 + 4;
      if (y - h < M + 24) { page = doc.addPage(A4); y = A4[1] - M; cabecalhoContinua(); desenhaCab(); }
      let yy = y - 13;
      cel0.forEach((l, k) => texto(l, xs[0], yy - k * 11, 9, ln.forte ? b : f));
      ln.cel.slice(1).forEach((c, i) => {
        const j = i + 1;
        if (alin[j] === "d") direita(c, xs[j] + larg[j] * L, yy, 9, ln.forte ? b : f);
        else quebrar(c, larg[j] * L - 6, 8.5).slice(0, 2).forEach((l, k) => texto(l, xs[j], yy - k * 10, 8.5, f, ln.forte ? TINTA : CINZA));
      });
      yy -= cel0.length * 11;
      det.forEach((l, k) => texto(l, xs[0], yy - k * 9.5 + 1, 7.5, f, CINZA));
      y -= h; traco(y);
    }
  }

  // ---------------------------------------------------------------- cabeçalho
  page.drawCircle({ x: M + 9, y: y - 9, size: 9, borderColor: rgb(0.165, 0.184, 0.224), borderWidth: 3 });
  page.drawCircle({ x: M + 9, y: y - 9, size: 3, color: OURO });
  texto("MotorCX", M + 24, y - 14, 16, b);
  direita("Demonstrativo da fatura", M + L, y - 6, 9, f, CINZA);
  direita(`nº ${s.numero}`, M + L, y - 22, 16, b);
  if (s.emitida) direita(`Emitida em ${s.emitida}`, M + L, y - 34, 8.5, f, CINZA);
  y -= 50;

  // ---------------------------------------------------------------- prestador e cliente
  const bloco = (x: number, w: number, rotulo: string, linhas: string[]) => {
    const ls = linhas.flatMap((l, i) => quebrar(l, w - 20, i === 0 ? 9.5 : 8.5, i === 0 ? b : f).map((t) => [t, i] as const));
    return { h: 22 + ls.length * 11 + 8, desenha: (topo: number, h: number) => {
      page.drawRectangle({ x, y: topo - h, width: w, height: h, color: SUAVE });
      texto(rotulo.toUpperCase(), x + 10, topo - 14, 7, b, CINZA);
      ls.forEach(([t, i], k) => texto(t, x + 10, topo - 28 - k * 11, i === 0 ? 9.5 : 8.5, i === 0 ? b : f, i === 0 ? TINTA : CINZA));
    } };
  };
  const meia = (L - 12) / 2;
  const p1 = bloco(M, meia, "Prestador", s.prestador), p2 = bloco(M + meia + 12, meia, "Cliente", s.cliente);
  const hb = Math.max(p1.h, p2.h);
  p1.desenha(y, hb); p2.desenha(y, hb);
  y -= hb + 12;

  // ---------------------------------------------------------------- destaque
  page.drawRectangle({ x: M, y: y - 62, width: L, height: 62, color: SUAVE });
  texto("Total do ciclo", M + 14, y - 18, 8, f, CINZA);
  texto(s.total, M + 14, y - 44, 22, b);
  const pares: [string, string][] = [["Ciclo de uso", s.ciclo], ["Vencimento", s.vencimento], ["Frentes", s.frentes]];
  pares.forEach(([k, v], i) => { texto(k, M + L * 0.55, y - 18 - i * 14, 8.5, f, CINZA); direita(v, M + L - 14, y - 18 - i * 14, 8.5, b); });
  y -= 74;

  // ---------------------------------------------------------------- resumo
  titulo("Resumo");
  tabela(["", ""], [0.75, 0.25], ["e", "d"], [...s.resumo.map(([a, v]) => ({ cel: [a, v] })), { cel: ["Total", s.total], forte: true }]);

  // ---------------------------------------------------------------- itens
  titulo("O que está sendo cobrado");
  const linhas: { cel: string[]; detalhe?: string; forte?: boolean; grupo?: string }[] = [];
  for (const g of s.grupos) {
    linhas.push({ cel: [], grupo: g.titulo });
    for (const l of g.linhas) linhas.push({ cel: [l.item, l.como, l.quantidade, l.preco, l.valor], detalhe: l.detalhe });
  }
  if (s.ajustes.length) {
    linhas.push({ cel: [], grupo: "Ajustes" });
    for (const [a, v] of s.ajustes) linhas.push({ cel: [a, "", "", "", v] });
  }
  linhas.push({ cel: ["Total", "", "", "", s.total], forte: true });
  tabela(["Item", "Como é cobrado", "Quantidade", "Preço", "Valor"], [0.25, 0.3, 0.16, 0.13, 0.16], ["e", "e", "d", "d", "d"], linhas);
  precisa(30); y -= 14;
  quebrar("Este é o demonstrativo do que foi usado e cobrado. O boleto vem em um PDF separado; Pix e cartão ficam na plataforma, em Empresa › Faturamento.", L, 8)
    .forEach((l) => { texto(l, M, y, 8, f, CINZA); y -= 10; });

  // ---------------------------------------------------------------- uso
  if (s.carteiras.length) {
    titulo("Uso por carteira");
    tabela(["Carteira", "Frente", "Contratos avaliados", "Clientes na jornada", "Dias com rotina"], [0.3, 0.16, 0.2, 0.18, 0.16],
           ["e", "e", "d", "d", "d"], s.carteiras.map((c) => ({ cel: c })));
  }
  if (s.canais.length) {
    titulo("Mensageria por canal");
    tabela(["Canal", "Disparadas", "Entregues", "Não entregues", "Respostas"], [0.28, 0.18, 0.18, 0.18, 0.18],
           ["e", "d", "d", "d", "d"], s.canais.map((c) => ({ cel: c })));
  }
  if (s.origens.linhas.length) {
    titulo("Mensageria por origem");
    const n = s.origens.cabecalho.length;
    const larg = [0.4, ...Array(n - 1).fill(0.6 / (n - 1))];
    tabela(s.origens.cabecalho, larg, ["e", ...Array(n - 1).fill("d")], s.origens.linhas.map((c) => ({ cel: c })));
  }

  // ---------------------------------------------------------------- rodapé de todas as páginas
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    page = p;
    page.drawLine({ start: { x: M, y: M + 6 }, end: { x: M + L, y: M + 6 }, thickness: 0.5, color: LINHA });
    texto("Nota fiscal de serviço: emitida após o pagamento e enviada por e-mail.", M, M - 6, 7.5, f, CINZA);
    direita(`Página ${i + 1} de ${paginas.length}`, M + L, M - 6, 7.5, f, CINZA);
  });
  return await doc.save();
}
