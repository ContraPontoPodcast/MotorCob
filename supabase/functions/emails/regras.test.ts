// node --experimental-strip-types --test supabase/functions/emails/regras.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assinar, conferirAssinatura, enviar, hashEmail, linksSair, pagina, remetente, textoPlano } from "../_compartilhado/email.ts";
import { assuntoDoAviso, emailAviso, exemplo, type LinhaFila, motivoDoAviso, opcional, validarPedido, validarSair } from "./regras.ts";

const linha = (x: Partial<LinhaFila> = {}): LinhaFila => ({ aviso_id: 1, empresa_id: 7, empresa_nome: "Alfa <Recuperação>",
  assunto: "faturas", assunto_nome: "Faturas, bloqueio e acordo", obrigatorio: true, remetente: "financeiro", tipo: "erro",
  titulo: "Acesso bloqueado por fatura vencida", texto: "Os envios estão parados & a fila também.", link: "/empresa/faturamento",
  destino: "ana@alfa.exemplo", usuario_id: null, contato_id: 3, ...x });

test("modelo único: marca em texto, frente, título, motivo e rodapé da empresa, tudo escapado", () => {
  const h = pagina({ frente: "Faturas", titulo: "Título <x>", corpo: "<p>corpo</p>", motivo: "Porque sim & não",
    rodape: { razao_social: "MotorCX Tecnologia Ltda", cnpj: "12.345.678/0001-90", endereco: "Rua Exemplo, 100", dominio: "motorcob.online" } });
  assert.match(h, /<span style="font-weight:700;font-size:16px">MotorCX<\/span>/);
  assert.match(h, /FATURAS|Faturas/);
  assert.match(h, /Título &lt;x&gt;/);
  assert.match(h, /Porque sim &amp; não/);
  assert.match(h, /MotorCX Tecnologia Ltda · CNPJ 12\.345\.678\/0001-90 · Rua Exemplo, 100/);
  assert.doesNotMatch(h, /<img/);
  assert.doesNotMatch(h, /Não quero mais/);
  const t = textoPlano(pagina({ frente: "A", titulo: "T", corpo: '<p><a href="https://x/y">Abrir</a></p>', motivo: "m" }));
  assert.match(t, /Abrir: https:\/\/x\/y/);
});

test("remetentes: Secret próprio, legado só do seu tipo e o padrão do domínio", () => {
  const env = (m: Record<string, string>) => (k: string) => m[k];
  assert.equal(remetente("avisos", "motorcob.online", env({})).cabecalho, "MotorCX <avisos@motorcob.online>");
  assert.equal(remetente("relatorios", null, env({ FATURA_EMAIL_DE: "fat@x.com" })).email, "relatorios@motorcob.online");
  assert.equal(remetente("relatorios", null, env({ FATURA_EMAIL_DE: "fat@x.com", RELATORIO_EMAIL_DE: "rel@x.com" })).email, "rel@x.com");
  assert.equal(remetente("financeiro", null, env({ FATURA_EMAIL_DE: "fat@x.com", EMAIL_DE_FINANCEIRO: "fin@x.com" })).email, "fin@x.com");
  assert.equal(remetente("financeiro", null, env({})).nome, "MotorCX Financeiro");
});

test("link de sair assinado: confere só o par certo", async () => {
  const t = await assinar("segredo-de-teste-1234567890", "u1", "exportacoes");
  assert.equal(t.length, 32);
  assert.ok(await conferirAssinatura("segredo-de-teste-1234567890", "u1", "exportacoes", t));
  assert.ok(!(await conferirAssinatura("segredo-de-teste-1234567890", "u1", "atendimento", t)));
  assert.ok(!(await conferirAssinatura("", "u1", "exportacoes", t)));
  const l = await linksSair("s", "https://motorcob.online/", "https://p.supabase.co/functions/v1", "u1", "relatorio:9");
  assert.match(l.pagina, /^https:\/\/motorcob\.online\/email\/sair\?u=u1&a=relatorio%3A9&t=/);
  assert.match(l.umClique, /^https:\/\/p\.supabase\.co\/functions\/v1\/emails\/sair\?/);
  assert.equal(await hashEmail(" Ana@X.com "), await hashEmail("ana@x.com"));
});

test("envio: um destinatário, Reply-To, um clique e o id da mensagem", async () => {
  let corpo: any = null, cab: any = null;
  const f = (async (_u: string, i: any) => { corpo = JSON.parse(i.body); cab = i.headers;
    return new Response(JSON.stringify({ id: "lw-99" }), { status: 201 }); }) as typeof fetch;
  const r = await enviar({ de: "avisos", para: "ana@x.com", assunto: "Envios pausados", html: "<p>x</p>",
    responderPara: "suporte@motorcob.online", umClique: "https://f/emails/sair?u=1" }, f, (k) => ({ EMAIL_SISTEMA_TOKEN: "tk" })[k]);
  assert.equal(r.id, "lw-99");
  assert.equal(cab["x-auth-token"], "tk");
  assert.equal(corpo.to, "ana@x.com");
  assert.equal(corpo.from, "MotorCX <avisos@motorcob.online>");
  assert.equal(corpo.headers["Reply-To"], "suporte@motorcob.online");
  assert.equal(corpo.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  await assert.rejects(enviar({ de: "avisos", para: "a@b.com", assunto: "x", html: "" }, f, () => undefined), /EMAIL_SISTEMA_TOKEN/);
  const recusa = (async () => new Response("quota", { status: 422 })) as typeof fetch;
  await assert.rejects(enviar({ de: "avisos", para: "a@b.com", assunto: "x", html: "" }, recusa, () => "tk"), /422/);
});

test("aviso por e-mail: obrigatório sem link de sair, opcional com", () => {
  const ob = emailAviso(linha(), "https://motorcob.online", null, null);
  assert.equal(ob.assunto, "Acesso bloqueado por fatura vencida · Alfa <Recuperação>");
  assert.match(ob.html, /Os envios estão parados &amp; a fila também\./);
  assert.match(ob.html, /href="https:\/\/motorcob\.online\/empresa\/faturamento"/);
  assert.match(ob.html, /Aviso obrigatório \(Faturas, bloqueio e acordo\): vai para os Admins e os contatos que recebem faturas da Alfa &lt;Recuperação&gt;/);
  assert.doesNotMatch(ob.html, /Não quero mais/);
  const op = linha({ assunto: "exportacoes", assunto_nome: "Exportações e listas prontas", obrigatorio: false, usuario_id: "u1",
    tipo: "pronto", contato_id: null, titulo: "Arquivo pronto: Funil" });
  assert.ok(opcional(op));
  assert.ok(!opcional(linha()));
  const h = emailAviso(op, "https://motorcob.online", null, "https://motorcob.online/email/sair?u=u1").html;
  assert.match(h, /ligou &quot;Exportações e listas prontas&quot; por e-mail/);
  assert.match(h, /Não quero mais estes e-mails/);
  assert.equal(assuntoDoAviso(op), "Arquivo pronto: Funil");
  assert.equal(motivoDoAviso(linha({ assunto: "suporte", assunto_nome: "Chamados de suporte", usuario_id: null })),
               "E-mail da equipe MotorCX: Chamados de suporte.");
  assert.match(emailAviso(linha({ assunto: "suporte", link: "/console/chamados?id=4" }), "https://m", null, null).html, /Abrir no Console/);
});

test("pedidos: ações, link de sair e tipos de teste", () => {
  assert.deepEqual(validarPedido({ acao: "avisos" }), { acao: "avisos" });
  assert.equal(validarPedido({ acao: "x" }).erro, "ação desconhecida");
  assert.equal(validarPedido(null).erro, "pedido inválido");
  const u = "0b9d6a1e-1c1f-4c9a-9a54-2a0c5d6f7e81";
  assert.equal(validarSair(u, "exportacoes", "A".repeat(32)).acao, "sair");
  assert.equal(validarSair(u, "relatorio:12", "A".repeat(32)).acao, "sair");
  assert.equal(validarSair("x", "exportacoes", "A".repeat(32)).erro, "link inválido");
  assert.equal(validarSair(u, "drop table", "A".repeat(32)).erro, "link inválido");
  assert.equal(validarPedido({ acao: "teste", tipo: "fatura" }).tipo, "fatura");
  assert.match(validarPedido({ acao: "teste", tipo: "outro" }).erro!, /tipo de teste/);
  for (const t of ["aviso_obrigatorio", "aviso_opcional", "relatorio", "fatura"] as const) {
    const e = exemplo(t, "https://motorcob.online", null);
    assert.match(e.assunto + e.html, /exemplo|Exemplo|Arquivo pronto|Envios pausados/);
    assert.doesNotMatch(e.html, /CPF/);
  }
});
