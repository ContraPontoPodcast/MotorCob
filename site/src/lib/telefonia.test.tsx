// Telefonia editável (SQL 113 e 114): formulário do tronco (seção E), payload, número de teste (nunca inteiro na
// tela), passos do teste da rota (seção F), ficha técnica (D1) e checklist até Real (C11).
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codigosTxt, motivoPausa, tomSaude, checklistReal, digitosNumeroTeste, fichaTecnica, formDoTronco, instrucaoTeste, linhasTeste, mascaraNumeroTeste, payloadTronco, sugerirReferencia, validarTronco } from '@/lib/telefonia';

const base = () => ({ ...formDoTronco(null), operadora: 'Operadora Alfa', referencia: 'alfa-sp-1', ips: '200.190.1.10', host: 'sip.alfa.example', bina: '(11) 3003-0000', canais: '15', declaro: true });

test('tronco novo válido e o que cada passo recusa', () => {
	assert.deepEqual(validarTronco(base(), true).erros, {});
	const r = validarTronco({ ...base(), declaro: false, ips: '', host: '10.0.0.5', porta: '80', cps: '900', tech_prefix: '12a', toque_max_s: '90' }, true);
	assert.deepEqual(Object.keys(r.erros).sort(), ['cps', 'declaro', 'host', 'ips', 'porta', 'tech_prefix', 'toque_max_s']);
	assert.equal(r.passo.host, 2);
	assert.equal(r.passo.ips, 1);
	assert.equal(validarTronco({ ...base(), host: '35.198.40.10' }, true).erros.host, 'Esse é um IP do próprio MotorCX.');
	assert.ok(validarTronco({ ...base(), autenticacao: 'senha', usuario: '' }, true).erros.usuario);
	assert.ok(validarTronco({ ...base(), formato_discagem: 'tech_0_csp_ddd_numero' }, true).erros.csp);
	// editando: a declaração só volta a ser pedida se a bina mudou
	assert.deepEqual(validarTronco({ ...base(), declaro: false }, false, '1130030000').erros, {});
	assert.ok(validarTronco({ ...base(), declaro: false, bina: '1130031111' }, false, '1130030000').erros.declaro);
});

test('payload do salvar_tronco_voz: sem senha, bina só dígitos, DDD da bina e declaração só quando marcada', () => {
	const p = payloadTronco(base());
	assert.equal(p.bina, '1130030000');
	assert.equal(p.ddd_origem, '11');
	assert.equal(p.declaro, true);
	assert.equal('senha' in p, false);
	assert.equal(p.usuario, '');
	assert.equal('declaro' in payloadTronco({ ...base(), declaro: false }), false);
	assert.equal(sugerirReferencia('Operadora Ágil SP'), 'operadora-agil-sp-1');
});

test('número de teste: sem o 55, só com DDD, e a máscara com 2 dígitos', () => {
	assert.equal(digitosNumeroTeste('+55 (11) 98765-0041'), '11987650041');
	assert.equal(digitosNumeroTeste('98765-0041'), null);
	assert.equal(mascaraNumeroTeste('11987650041'), '(11) 9••••-••41');
	assert.equal(mascaraNumeroTeste('1130030041'), '(11) ••••-••41');
});

test('passos do teste e instrução ao vivo', () => {
	const l = linhasTeste([{ passo: 0, resultado: 'ok', mensagem: 'Dados conferidos.' }]);
	assert.equal(l.length, 10);
	assert.equal(l[0].resultado, 'ok');
	assert.equal(l[1].mensagem, 'não testado');
	assert.equal(l.filter(x => x.obrigatorio).map(x => x.n).join(','), '0,2,3,4,5,6,8,9');
	assert.match(instrucaoTeste([{ passo: 5, resultado: 'rodando' }], 'rodando') ?? '', /código/);
	assert.match(instrucaoTeste([{ passo: 9, resultado: 'rodando' }], 'rodando') ?? '', /desligar/);
	assert.equal(instrucaoTeste([], 'passou'), null);
});

test('ficha técnica e checklist até Real', () => {
	const f = fichaTecnica({ bina: '1130030000', canais: 15, cps: 10, autenticacao: 'ip' });
	assert.match(f, /UDP 10000–20000/);
	assert.match(f, /RFC 4733/);
	assert.match(f, /STIR-SHAKEN\) na bina 1130030000/);
	const c = checklistReal({ troncos: [{ teste_ok: true, declaracao_em: 'x' }], numeros: [{ confirmado_em: null }], transferenciaTestada: false, avisoGravacao: true });
	assert.deepEqual(c.map(x => x.ok), [true, false, false, true, true]);
});

test('disjuntor e saúde do tronco (SQL 115)', () => {
	assert.match(motivoPausa('disjuntor', 503), /saiu sozinho.*SIP 503|SIP 503.*saiu sozinho/);
	assert.match(motivoPausa('suspeita_sem_credito', 480), /sem crédito/);
	assert.equal(tomSaude(null), 'neutro');
	assert.equal(tomSaude({ tentativas: 100, atendidas: 40, pct_atendidas: 40, falhas_tecnicas: 35, pct_falhas: 35, duracao_media_s: 60, codigos: [] }), 'erro');
	assert.equal(tomSaude({ tentativas: 100, atendidas: 80, pct_atendidas: 80, falhas_tecnicas: 2, pct_falhas: 2, duracao_media_s: 60, codigos: [] }), 'ok');
	assert.equal(codigosTxt([{ codigo: 503, qtd: 12 }, { codigo: 403, qtd: 3 }]), '503 ×12 · 403 ×3');
	assert.equal(codigosTxt([]), '—');
});
