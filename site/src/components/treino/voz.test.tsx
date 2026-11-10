// Sessão de treino por voz (Roleplay, SQL 119), renderizada de verdade (react-dom/server), sem rede e sem áudio:
// estados da tela (ligando, ao vivo com Mudo e "Encerrar ligação" vermelho fixos no rodapé, mudo, transcrição ao vivo,
// ligação encerrada com "Ver meu resultado", avaliando), teste de microfone (nível, "Estou de fone", microfone
// bloqueado com "Treinar por texto"), o briefing por voz e as regras sem tela (PCM, mensagens da VM, textos do fim,
// aviso dos minutos de voz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { SessaoVozView, TesteMicrofoneView, type FaseVoz } from './voz';
import type { FichaSessao } from './sessao';
import { BriefingView } from './pagina';
import {
	AVISO_FIM, TEXTO_ERRO_MICROFONE, avisoMinutosVoz, dePCM16, erroMicrofone, lerMensagemVoz, nivel, paraPCM16, textoFimVoz, urlVozOk,
} from '@/lib/treino-voz';
import { textoEncerramento } from '@/lib/treino-sessao';
import type { TreinoOperador } from '@/lib/treino-operador';

const nada = () => {};
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const INTERNOS = /bloqueante|ja_pagou|\bck_[a-z]|treino_[a-z]|SQL \d|\[DESLIGA\]|bilhete|WebSocket|Deepgram/;
const FICHA: FichaSessao = { cenario: 'Já pagou', persona: 'Rita (fictícia)', divida: { produto: 'Cartão Exemplo', dias_atraso: 60, alcada: { parcelas: 6 } }, foco: ['Confirmou a identidade'], duracao: 480 };
const TURNOS = [{ quem: 'persona' as const, texto: 'Alô?' }, { quem: 'operador' as const, texto: 'Boa tarde, falo da Assessoria Exemplo.' }];
const view = (fase: FaseVoz, extra: Partial<Parameters<typeof SessaoVozView>[0]> = {}) => renderToStaticMarkup(
	<SessaoVozView ficha={FICHA} turnos={TURNOS} parcial="" fase={fase} segundos={65} limite={480} mudo={false} nivel={0.4} erro="" aviso="" quem="operador"
		resultadoPronto={false} onMudo={nada} onEncerrarLigacao={nada} onVerResultado={nada} onSair={nada} {...extra} />);

test('voz: tela cheia, ficha fictícia, relógio, transcrição ao vivo e controles fixos no rodapé', () => {
	const h = view('ligacao', { parcial: 'pode me confirmar' });
	assert.match(h, /class="fixed inset-0/);
	assert.match(h, /<h1[^>]*>Já pagou<\/h1>/);
	assert.match(h, /Cliente simulada: Rita \(fictícia\) · Treino por voz/);
	assert.match(h, /01:05 \/ 08:00/);
	assert.match(h, /role="log"[^>]*aria-label="Transcrição ao vivo"/);
	assert.match(h, /Boa tarde, falo da Assessoria Exemplo\./);
	assert.match(h, /pode me confirmar…/, 'a fala parcial aparece enquanto o operador fala');
	assert.match(h, /<footer class="sticky bottom-0[^"]*safe-area-inset-bottom/, 'controles fixos no rodapé (celular)');
	assert.match(h, />Ao vivo</);
	assert.match(h, /Mudo<\/button>/);
	assert.match(h, /Encerrar ligação<\/button>/);
	assert.match(h, /O áudio não é guardado/);
	assert.doesNotMatch(texto(h), INTERNOS);
});

test('voz: mudo, ligando, avaliando e ligação encerrada com "Ver meu resultado" no lugar do vermelho', () => {
	const m = view('ligacao', { mudo: true });
	assert.match(m, /Microfone mudo/);
	assert.match(m, /Ativar microfone<\/button>/);
	assert.match(view('conectando', { turnos: [] }), /Ligando para Rita \(fictícia\)…/);
	assert.match(view('avaliando'), /Avaliando a conversa pelo checklist/);
	const e = view('encerrada', { aviso: AVISO_FIM.desligou });
	assert.match(e, /Ver meu resultado/);
	assert.doesNotMatch(e, /Encerrar ligação/);
	assert.match(e, /A ligação foi encerrada pelo outro lado\./);
	assert.match(view('encerrada', { quem: 'qualidade' }), /Ver o resultado/);
	assert.match(view('ligacao', { quem: 'qualidade' }), /conduzido pela Qualidade/);
	assert.match(view('ligacao', { erro: 'O treino por voz está cheio agora.' }), /role="alert"/);
});

test('teste de microfone: nível, "Estou de fone", microfone bloqueado troca para texto a 1 clique', () => {
	const ok = renderToStaticMarkup(<TesteMicrofoneView estado="testando" nivel={0.5} ouviu fone={false} onTestar={nada} onFone={nada} onTexto={nada} />);
	assert.match(ok, /role="meter"[^>]*aria-valuenow="50"/);
	assert.match(ok, /Ouvimos você\. Microfone pronto\./);
	assert.match(ok, /Estou de fone de ouvido/);
	assert.match(ok, /o microfone fica mudo enquanto ela fala/);
	const b = renderToStaticMarkup(<TesteMicrofoneView estado="bloqueado" nivel={0} ouviu={false} fone onTestar={nada} onFone={nada} onTexto={nada} />);
	assert.match(b, /role="alert"/);
	assert.match(b, /bloqueou o microfone/);
	assert.match(b, /Treinar por texto<\/button>/);
	assert.match(renderToStaticMarkup(<TesteMicrofoneView estado="parado" nivel={0} ouviu={false} fone={false} onTestar={nada} onFone={nada} ouvir={async () => ({})} />), /Ouvir a voz/);
});

const T: TreinoOperador = {
	atribuicao: 5, prazo: '2026-11-20', nota_minima: 75, modos: ['voz', 'texto'], tentativas: 2, tentativas_usadas: 0, melhor_nota: null, situacao: 'pendente', sessoes: [],
	cenario: { id: 1, nome: 'Já pagou', persona_nome: 'Rita (fictícia)', perfil: 'ja_pagou', descricao: null, dificuldade: 3, divida: {}, duracao_max_s: 480, modos: ['voz', 'texto'], objetivo_cenario: null, itens_foco: [] },
};

test('briefing por voz: voz é o padrão, teste de microfone antes de "Começar por voz" e aviso dos minutos', () => {
	const h = renderToStaticMarkup(<MemoryRouter><BriefingView t={T} token={'e'.repeat(64)} hoje="2026-11-10" vozDisponivel avisoVoz={avisoMinutosVoz(850, 1000)} /></MemoryRouter>);
	assert.match(h, /type="radio" name="modo" checked=""[^>]*\/>Voz \(padrão\)/);
	assert.match(h, /Testar o microfone/);
	assert.match(h, /Começar por voz<\/button>/);
	assert.match(h, /<button[^>]*disabled=""[^>]*>Começar por voz/, 'só depois do teste de microfone');
	assert.match(h, /Teste o microfone para começar\./);
	assert.match(h, /Restam 150 minutos de voz no treino deste mês/);
	const sem = renderToStaticMarkup(<MemoryRouter><BriefingView t={T} token={'e'.repeat(64)} hoje="2026-11-10" vozDisponivel={false} /></MemoryRouter>);
	assert.match(sem, /minutos de voz do mês acabaram/);
	assert.match(sem, /type="radio" name="modo" checked=""[^>]*\/>Texto/, 'voz esgotada: começa no texto');
});

test('regras: PCM 16 kHz, mensagens da VM, nível e endereço do WebSocket', () => {
	const pcm = paraPCM16(new Float32Array(480).fill(0.5), 48000);
	assert.equal(pcm.byteLength, 320, '480 amostras a 48 kHz = 160 a 16 kHz');
	assert.ok(Math.abs(dePCM16(pcm.buffer)[0] - 0.5) < 0.001);
	assert.equal(paraPCM16(new Float32Array(16).fill(2), 16000).length, 32, 'satura em vez de estourar');
	assert.ok(Math.abs(dePCM16(paraPCM16(new Float32Array(4).fill(2), 16000).buffer)[0] - 1) < 0.001);
	assert.deepEqual(lerMensagemVoz('{"tipo":"fala","quem":"operador","texto":"Oi","t":3}'), { tipo: 'fala', quem: 'operador', texto: 'Oi', t: 3 });
	assert.deepEqual(lerMensagemVoz('{"tipo":"fim","situacao":"avaliada","motivo":"encerrar"}'), { tipo: 'fim', situacao: 'avaliada', motivo: 'encerrar' });
	assert.equal(lerMensagemVoz('{"tipo":"fala","quem":"sistema","texto":"x"}'), null);
	assert.equal(lerMensagemVoz('{"tipo":"fim","situacao":"aprovada"}'), null);
	assert.equal(lerMensagemVoz('não é json'), null);
	assert.equal(lerMensagemVoz('{"tipo":"executar"}'), null);
	assert.equal(nivel(new Float32Array(0)), 0);
	assert.ok(nivel(new Float32Array(10).fill(0.5)) === 1);
	assert.ok(urlVozOk('wss://35-198-40-10.sslip.io:8443/treino/voz'));
	assert.ok(!urlVozOk('ws://35-198-40-10.sslip.io:8443/treino/voz'), 'só wss');
	assert.ok(!urlVozOk('wss://exemplo.com/outra'));
});

test('regras: microfone, fim da ligação e aviso dos minutos de voz (sem "reprovado")', () => {
	assert.equal(erroMicrofone({ name: 'NotAllowedError' }), 'bloqueado');
	assert.equal(erroMicrofone({ name: 'NotFoundError' }), 'sem_microfone');
	assert.equal(erroMicrofone(new TypeError('x')), 'sem_suporte');
	assert.equal(erroMicrofone('?'), 'outro');
	assert.ok(Object.values(TEXTO_ERRO_MICROFONE).every(t => /texto/.test(t)), 'todo erro de microfone oferece o texto');
	assert.equal(textoFimVoz({ situacao: 'avaliada' }), 'Conversa avaliada.');
	assert.match(textoFimVoz({ situacao: 'falhou', motivo: 'rede' }), /conexão caiu.*não contou/);
	assert.match(textoFimVoz({ situacao: 'falhou', motivo: 'microfone' }), /microfone parou.*não contou/);
	assert.match(textoFimVoz({ situacao: 'abandonada', motivo: 'sem_fala' }), /antes de você falar/);
	assert.equal(textoFimVoz({ situacao: 'falhou', erro: 'Os minutos de voz acabaram.' }), 'Os minutos de voz acabaram.');
	assert.equal(textoEncerramento({ situacao: 'falhou', aviso: 'A conexão caiu.' }), 'A conexão caiu.');
	assert.equal(avisoMinutosVoz(100, 1000), null);
	assert.match(avisoMinutosVoz(800, 1000) ?? '', /Restam 200 minutos/);
	assert.match(avisoMinutosVoz(999, 1000) ?? '', /Restam 1 minuto de voz/);
	assert.match(avisoMinutosVoz(1000, 1000) ?? '', /acabaram\. O treino por texto continua/);
	assert.equal(avisoMinutosVoz(null, 1000), null);
	for (const t of [...Object.values(AVISO_FIM), ...Object.values(TEXTO_ERRO_MICROFONE)]) assert.doesNotMatch(t, /reprova/i);
});
