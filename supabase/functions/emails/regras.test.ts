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
  const t2 = textoPlano("<p>a &amp;lt;script&amp;gt; &lt;b&gt; <<script>script>x</p>");
  assert.doesNotMatch(t2, /</);
  assert.match(t2, /a &lt;script&gt; ‹b›/);
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

/** Servidor SMTP falso: responde na ordem e guarda o que recebeu. */
function smtpFalso(respostas: string[]) {
  const recebido: string[] = [];
  let fechou = false;
  const abrir = async (host: string, porta: number) => {
    recebido.push(`#${host}:${porta}`);
    return { ler: async () => respostas.shift() ?? "421 acabou", escrever: async (t: string) => { recebido.push(t); },
      fechar: () => { fechou = true; } };
  };
  return { abrir, recebido, fechou: () => fechou };
}
const OK = ["220 smtp.hostinger.com", "250-smtp.hostinger.com\n250 AUTH PLAIN LOGIN", "235 ok", "250 ok", "250 ok", "354 vai",
  "250 ok fila", "221 tchau"];
const corpoDe = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));

test("envio pela caixa da Hostinger: login, um destinatário, Reply-To, um clique, só texto + HTML e o Message-ID", async () => {
  const s = smtpFalso([...OK]);
  const env = (k: string) => ({ EMAIL_SMTP_USUARIO: "sistema@motorcob.online", EMAIL_SMTP_SENHA: "senha-teste" })[k];
  const r = await enviar({ de: "relatorios", para: "ana@x.com", assunto: "Relatório da semana · Recuperação",
    html: "<p>Olá &amp; <a href=\"https://x/y\">Abrir</a></p>", responderPara: "suporte@motorcob.online",
    umClique: "https://f/emails/sair?u=1" }, s.abrir, env);
  assert.match(r.id, /^[0-9a-f-]{36}@motorcob\.online$/);
  assert.equal(s.recebido[0], "#smtp.hostinger.com:465");
  assert.equal(s.recebido[1], "EHLO motorcob.online\r\n");
  assert.equal(atob(s.recebido[2].slice(11).trim()), "\0sistema@motorcob.online\0senha-teste");
  assert.equal(s.recebido[3], "MAIL FROM:<sistema@motorcob.online>\r\n");
  assert.equal(s.recebido[4], "RCPT TO:<ana@x.com>\r\n");
  const msg = s.recebido[6];
  assert.match(msg, /^From: =\?UTF-8\?B\?[^?]+\?= <relatorios@motorcob\.online>\r\n/);
  assert.match(msg, /\r\nTo: <ana@x\.com>\r\n/);
  assert.match(msg, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(msg, new RegExp(`\\r\\nMessage-ID: <${r.id}>\\r\\n`));
  assert.match(msg, /\r\nReply-To: <suporte@motorcob\.online>\r\n/);
  assert.match(msg, /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
  assert.match(msg, /\r\n\.\r\n$/);
  const partes = [...msg.matchAll(/Content-Type: (text\/\w+); charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)];
  assert.deepEqual(partes.map((p) => p[1]), ["text/plain", "text/html"]);
  assert.equal(corpoDe(partes[0][2]), "Olá & Abrir: https://x/y");
  assert.match(corpoDe(partes[1][2]), /<a href="https:\/\/x\/y">/);
  assert.ok(msg.split("\r\n").slice(0, -2).every((l) => l.length <= 998 && !l.startsWith(".")));
  assert.equal(s.recebido[7], "QUIT\r\n");
  assert.ok(s.fechou());
});

test("envio: caixa própria por tipo, host e porta dos Secrets, recusas e cabeçalho forjado", async () => {
  const s = smtpFalso([...OK]);
  const env = (m: Record<string, string>) => (k: string) => m[k];
  const base = { EMAIL_SMTP_USUARIO: "sistema@motorcob.online", EMAIL_SMTP_SENHA: "a" };
  await enviar({ de: "financeiro", para: "b@c.com", assunto: "Fatura", html: "<p>x</p>" }, s.abrir,
    env({ ...base, EMAIL_SMTP_USUARIO_FINANCEIRO: "financeiro@motorcob.online", EMAIL_SMTP_SENHA_FINANCEIRO: "b",
      EMAIL_SMTP_HOST: "smtp.exemplo.com", EMAIL_SMTP_PORTA: "2465" }));
  assert.equal(s.recebido[0], "#smtp.exemplo.com:2465");
  assert.equal(atob(s.recebido[2].slice(11).trim()), "\0financeiro@motorcob.online\0b");
  await assert.rejects(enviar({ de: "avisos", para: "a@b.com", assunto: "x", html: "" }, s.abrir, () => undefined),
    /EMAIL_SMTP_USUARIO e EMAIL_SMTP_SENHA/);
  const senha = smtpFalso(["220 oi", "250 ok", "535 5.7.8 Authentication failed"]);
  await assert.rejects(enviar({ de: "avisos", para: "a@b.com", assunto: "x", html: "" }, senha.abrir, env(base)),
    (e: Error) => /login.*535/.test(e.message) && !e.message.includes("YQ"));
  assert.ok(senha.fechou());
  const rcpt = smtpFalso(["220 oi", "250 ok", "235 ok", "250 ok", "550 no such user"]);
  await assert.rejects(enviar({ de: "avisos", para: "a@b.com", assunto: "x", html: "" }, rcpt.abrir, env(base)), /destinatário \(550\)/);
  for (const para of ["a@b.com\r\nBcc: x@y.com", "sem-arroba", "a@b.com>, <c@d.com"]) {
    await assert.rejects(enviar({ de: "avisos", para, assunto: "x", html: "" }, smtpFalso([...OK]).abrir, env(base)), /inválido/);
  }
  const quebra = smtpFalso([...OK]);
  await enviar({ de: "avisos", para: "a@b.com", assunto: "Linha 1\r\nBcc: x@y.com", html: "" }, quebra.abrir, env(base));
  assert.doesNotMatch(quebra.recebido[6], /\r\nBcc:/);
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
