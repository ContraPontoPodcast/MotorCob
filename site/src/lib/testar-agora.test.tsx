// "Testar agora" do Agente de voz (SQL 116; PR 9 do plano; npm test): o resultado em lista ✓ / ! / ✕ e a frase final
// de cada caso, a paridade com o banco (limite, colunas que o site pode ler, passos aceitos) e o que a gaveta mostra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { COLUNAS, LIMITE_DIA, fraseFinal, itensTeste, usadosHoje, type TesteAgora } from './testar-agora';
import { ResultadoTeste } from '@/components/canais/testar-agora';

const SQL = readFileSync('../supabase/migrations/20270306000001_voz_testar_agora.sql', 'utf8');
const VM = readFileSync('../voz/orquestrador/testar_agora.py', 'utf8');

const T = (situacao: TesteAgora['situacao'], passos: TesteAgora['passos'] = null, extra: Partial<TesteAgora> = {}): TesteAgora => ({
	id: 1, credor_id: 7, numero_id: 3, mascara: '(11) 9••••-••41', situacao, motivo: null, desfecho: null, passos,
	pedido_em: '2026-11-10T13:00:00Z', pego_em: null, concluido_em: null, ...extra,
});
const fim = (t: TesteAgora) => fraseFinal(itensTeste(t)).texto;

test('paridade com o banco: limite, colunas do site e passos aceitos', () => {
	assert.match(SQL, new RegExp(`testes_agora_voz_limite\\(\\) returns int\\s+language sql immutable parallel safe as \\$\\$ select ${LIMITE_DIA} \\$\\$`));
	const grant = /grant select \(([^)]*)\)\s+on public\.voz_testes_agora to authenticated/.exec(SQL)![1].split(',').map(x => x.trim());
	for (const c of COLUNAS.split(',')) assert.ok(grant.includes(c), c);
	assert.ok(!grant.includes('hash'), 'o site nunca lê o hash');
	for (const k of ['tocou', 'atendeu', 'agente', 'gravada', 'aviso_gravacao', 'identidade_confirmada', 'transferiu', 'segundos', 'toque_s', 'sip']) {
		assert.ok(SQL.includes(`'${k}'`), `SQL aceita ${k}`);
		assert.ok(VM.includes(`"${k}"`), `VM manda ${k}`);
	}
});

test('cada caso: a lista e a frase final', () => {
	assert.equal(fim(T('pedido')), 'Testando…');
	assert.equal(fim(T('ligando')), 'Testando…');
	assert.equal(fim(T('recusado', null, { motivo: 'fora do horário de hoje para o número' })), 'O teste encontrou um problema');
	assert.equal(fim(T('expirado')), 'O teste encontrou um problema');
	assert.equal(fim(T('concluido', { tocou: false, sip: 403 })), 'O teste encontrou um problema');
	assert.match(itensTeste(T('concluido', { tocou: false, sip: 403 })).at(-1)!.texto!, /SIP 403/);
	assert.equal(fim(T('concluido', { tocou: true, atendeu: false })), 'Funciona, com um ponto de atenção');
	assert.equal(fim(T('concluido', { tocou: true, atendeu: true }, { desfecho: 'caixa_postal' })), 'Funciona, com um ponto de atenção');
	assert.equal(fim(T('concluido', { tocou: true, atendeu: true, agente: false })), 'O teste encontrou um problema');
	const ok = T('concluido', { tocou: true, atendeu: true, agente: true, gravada: true, aviso_gravacao: true, identidade_confirmada: false, segundos: 42 });
	assert.equal(fim(ok), 'Tudo certo');
	assert.ok(itensTeste(ok).some(i => i.titulo === 'Identidade antes da dívida' && /não falou do credor nem da dívida/.test(i.texto!)));
	assert.equal(fim(T('concluido', { tocou: true, atendeu: true, agente: true, gravada: true, aviso_gravacao: false })), 'Funciona, com um ponto de atenção');
});

test('limite do dia: o cancelado não conta', () => {
	const hoje = new Date('2026-11-10T13:00:00Z').toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
	assert.equal(usadosHoje([T('concluido'), T('cancelado'), T('recusado'), T('concluido', null, { pedido_em: '2026-11-09T13:00:00Z' })], hoje), 2);
});

test('o resultado mostra a máscara, nunca o número, e a frase final', () => {
	const h = renderToStaticMarkup(<ResultadoTeste teste={T('concluido', { tocou: true, atendeu: true, agente: true, gravada: true, aviso_gravacao: true, identidade_confirmada: true, segundos: 30 })} />);
	for (const t of ['Pedido aceito', '(11) 9••••-••41', 'O celular tocou', 'Atendeu e o agente falou', 'Aviso de gravação na abertura', 'Tudo certo']) assert.ok(h.includes(t), t);
	assert.ok(!/\d{8,}/.test(h), 'nada de número inteiro');
});
