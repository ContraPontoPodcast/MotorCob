// SMTP mínimo para os e-mails do sistema: TLS direto na porta 465 (as Edge Functions bloqueiam 25 e 587), login
// AUTH PLAIN, um destinatário por mensagem e o corpo em multipart (só texto + HTML) em base64. Sem dependência
// externa: a conversa com o servidor recebe o canal de fora, e os testes trocam o canal por um falso.

export interface CanalSmtp {
  ler(): Promise<string>;              // uma resposta inteira do servidor (as de várias linhas vêm juntas)
  escrever(t: string): Promise<void>;
  fechar(): void;
}

export interface MensagemSmtp {
  de: string; deNome: string; para: string; assunto: string; html: string; texto: string;
  responderPara?: string | null; umClique?: string | null; dominio: string;
}

const enc = new TextEncoder();
const semQuebra = (t: string) => !/[\r\n]/.test(t);
export const enderecoValido = (e: string) => /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/.test(e);

function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Corpo em base64 quebrado em linhas de 76 (nenhuma linha começa com ponto, então não precisa de "dot-stuffing"). */
export const base64Linhas = (t: string) => (base64(enc.encode(t)).match(/.{1,76}/g) ?? []).join("\r\n");

/** Texto com acento em cabeçalho (RFC 2047): pedaços de até 45 bytes, sem partir um caractere no meio. */
export function cabecalhoCodificado(t: string): string {
  const s = t.replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const partes: string[] = [];
  let atual = "";
  for (const c of s) {
    if (enc.encode(atual + c).length > 45) { partes.push(atual); atual = ""; }
    atual += c;
  }
  if (atual) partes.push(atual);
  return partes.map((p) => `=?UTF-8?B?${base64(enc.encode(p))}?=`).join("\r\n ");
}

/** A mensagem completa (cabeçalhos + corpo), já com CRLF. Devolve também o Message-ID, que vira o id do envio. */
export function montarMensagem(m: MensagemSmtp, agora = new Date(), aleatorio = () => crypto.randomUUID()) {
  for (const e of [m.de, m.para, m.responderPara ?? "x@x.x"]) {
    if (!enderecoValido(e)) throw new Error("endereço de e-mail inválido");
  }
  if (m.umClique && (!semQuebra(m.umClique) || /[<>]/.test(m.umClique))) throw new Error("link de sair inválido");
  const id = `${aleatorio()}@${m.dominio}`;
  const fronteira = `motorcx-${aleatorio()}`;
  const nome = /^[\x20-\x7e]*$/.test(m.deNome) ? `"${m.deNome.replace(/["\\]/g, "")}"` : cabecalhoCodificado(m.deNome);
  const cab = [
    `From: ${nome} <${m.de}>`,
    `To: <${m.para}>`,
    `Subject: ${cabecalhoCodificado(m.assunto.slice(0, 150))}`,
    `Date: ${agora.toUTCString()}`,
    `Message-ID: <${id}>`,
    "MIME-Version: 1.0",
  ];
  if (m.responderPara) cab.push(`Reply-To: <${m.responderPara}>`);
  if (m.umClique) cab.push(`List-Unsubscribe: <${m.umClique}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  cab.push(`Content-Type: multipart/alternative; boundary="${fronteira}"`);
  const parte = (tipo: string, corpo: string) =>
    `--${fronteira}\r\nContent-Type: ${tipo}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Linhas(corpo)}\r\n`;
  const corpo = parte("text/plain", m.texto) + parte("text/html", m.html) + `--${fronteira}--\r\n`;
  return { id, dados: cab.join("\r\n") + "\r\n\r\n" + corpo };
}

/** A conversa inteira com o servidor. Erro = exceção com o código e o começo da resposta (nunca a senha). */
export async function conversaSmtp(canal: CanalSmtp, o: { usuario: string; senha: string; envelope: string; para: string;
  dados: string; ehlo: string }) {
  const esperar = async (etapa: string, ...codigos: number[]) => {
    const r = await canal.ler();
    const cod = Number(r.slice(0, 3));
    if (!codigos.includes(cod)) throw new Error(`SMTP recusou ${etapa} (${cod || "sem código"}): ${r.slice(4, 140)}`);
    return r;
  };
  const mandar = (t: string) => canal.escrever(t + "\r\n");
  try {
    await esperar("a conexão", 220);
    await mandar(`EHLO ${o.ehlo}`);
    await esperar("o EHLO", 250);
    await mandar(`AUTH PLAIN ${base64(enc.encode(`\0${o.usuario}\0${o.senha}`))}`);
    await esperar("o login (confira EMAIL_SMTP_USUARIO e EMAIL_SMTP_SENHA)", 235);
    await mandar(`MAIL FROM:<${o.envelope}>`);
    await esperar("o remetente", 250);
    await mandar(`RCPT TO:<${o.para}>`);
    await esperar("o destinatário", 250, 251);
    await mandar("DATA");
    await esperar("o início da mensagem", 354);
    await canal.escrever(o.dados + "\r\n.\r\n");
    await esperar("a mensagem", 250);
    await mandar("QUIT").catch(() => {});
  } finally {
    canal.fechar();
  }
}

/** Canal de verdade: TLS direto (porta 465), com prazo para não prender a função. */
export async function abrirSmtp(host: string, porta: number, prazoMs = 20000): Promise<CanalSmtp> {
  const conn = await Deno.connectTls({ hostname: host, port: porta });
  const dec = new TextDecoder();
  let resto = "";
  let fechado = false;
  const timer = setTimeout(() => { fechado = true; try { conn.close(); } catch { /* já fechou */ } }, prazoMs);
  return {
    async ler() {
      while (true) {
        const linhas = resto.split("\r\n");
        for (let i = 0; i < linhas.length - 1; i++) {
          if (/^\d{3}(?: |$)/.test(linhas[i])) {
            resto = linhas.slice(i + 1).join("\r\n");
            return linhas.slice(0, i + 1).join("\n");
          }
        }
        const buf = new Uint8Array(4096);
        const n = fechado ? null : await conn.read(buf).catch(() => null);
        if (n === null) throw new Error("SMTP: a conexão caiu ou passou do prazo");
        resto += dec.decode(buf.subarray(0, n), { stream: true });
      }
    },
    async escrever(t: string) {
      const b = enc.encode(t);
      for (let o = 0; o < b.length;) o += await conn.write(b.subarray(o));
    },
    fechar() {
      clearTimeout(timer);
      if (!fechado) { fechado = true; try { conn.close(); } catch { /* já fechou */ } }
    },
  };
}
