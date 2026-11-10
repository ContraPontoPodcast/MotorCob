// Discagem com os padrões novos na tela (PR 8 do plano Canais/Agente Voz/CX; npm test): a tabela D2 aplicada no
// rascunho passa na validação do motor (as chaves de discagem_regras), a posição do número D3, os medidores de hoje
// por linha e no total com a regra da VM, e "abandono conta" travado em sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
	RENITENCIA_RECOMENDADA, aplicarPosicaoRecomendada, aplicarRenitenciaRecomendada, foraDoRecomendado, hojeNaCarteira,
	posicaoNoRecomendado, resumoPosicao,
} from './discagem-recomendado';
import { efetivo, modoDaCarteira } from './renitencia';
import { computeDiff, effectiveDiscagem } from './discagem';
import { CurtasHojeVista, empresaParada } from '@/components/discagem/curtas-hoje';
import { RenitenciaRecomendada } from '@/components/discagem/renitencia/recomendados';
import { PosicaoNumero } from '@/components/discagem/posicao-numero';
import type { RitmoHoje } from './ritmo';

const CURTAS_PY = readFileSync('../voz/orquestrador/curtas.py', 'utf8');
const SQL107 = readFileSync('../supabase/migrations/20270222000001_voz_ritmo_config.sql', 'utf8');
const REGRAS = JSON.parse(/discagem_regras\(\)[\s\S]*?select '(\{.*?\})'::jsonb/.exec(SQL107)![1]) as { _chaves: string[]; por_situacao: { chaves: string[] }; por_sinalizacao: { chaves: string[] } };

test('D2: a carteira no padrão MotorCX não está na tabela recomendada', () => {
	const fora = foraDoRecomendado({});
	for (const s of ['Ocupado', 'Não atende', 'Caixa postal', 'Recusa', 'Promessa']) assert.ok(fora.includes(s), s);
	assert.match(hojeNaCarteira({}, 'recusa'), /desligado/);
});

test('D2: aplicar deixa a carteira igual à tabela, só com chaves que o banco valida, e é idempotente', () => {
	const d = aplicarRenitenciaRecomendada({});
	assert.deepEqual(foraDoRecomendado(d), []);
	assert.deepEqual(aplicarRenitenciaRecomendada(d), d);
	for (const k of Object.keys(d)) assert.ok(REGRAS._chaves.includes(k), k);
	for (const k of Object.keys(d.por_situacao ?? {})) assert.ok(REGRAS.por_situacao.chaves.includes(k), k);
	for (const k of Object.keys(d.por_sinalizacao ?? {})) assert.ok(REGRAS.por_sinalizacao.chaves.includes(k), k);
	const e = efetivo(d);
	assert.equal(e.tnum, 2);
	assert.equal(e.ren.ocupado.intervalo_minutos, 15);
	assert.equal(e.ren.nao_atendida.intervalo_minutos, 120);
	assert.equal(e.ren.caixa_postal.max_dia, 1);
	assert.equal(e.sinal!.caixa_postal.rediscar.ativo, false);
	assert.equal(e.sinal!.ocupado.depois.acao, 'proximo_telefone');
	assert.equal(e.sinal!.indisponivel.rediscar.depois_min, 60);
	assert.ok(e.naOn && e.recusa && e.promessa);
	// o que sai para salvar_discagem mantém a tabela (2 por número fica gravado: a regra nova subiria para 3)
	const diff = computeDiff(effectiveDiscagem(d as Record<string, unknown>));
	assert.equal(diff.tentativas_numero_dia, 2);
	assert.deepEqual((diff.descanso_recusa as { ativo: boolean }).ativo, true);
	// preserva o que a carteira já tinha (ritmo, horários)
	const outra = aplicarRenitenciaRecomendada({ descanso_recusa: { ativo: false, dias: 15 }, retorno_agendado: { max_dias: 5 } });
	assert.deepEqual(outra.descanso_recusa, { ativo: true, dias: 15 });
	assert.deepEqual(outra.retorno_agendado, { max_dias: 5 });
	assert.equal(RENITENCIA_RECOMENDADA.length, 10);
});

test('D3: posição do número, 2 telefones por dia horizontal', () => {
	assert.ok(!posicaoNoRecomendado({}));
	assert.match(resumoPosicao({}), /1 telefone de voz por cliente/);
	const d = aplicarPosicaoRecomendada({});
	assert.ok(posicaoNoRecomendado(d));
	const { m } = modoDaCarteira(d);
	assert.equal(m.modo, 'horizontal');
	assert.deepEqual(m.spins.regras.map(r => r.telefone), ['t1', 't2']);
	assert.equal(resumoPosicao(d), 'Horizontal · 2 telefones por cliente no dia · Certificado primeiro');
	const html = renderToStaticMarkup(<PosicaoNumero draft={{}} setDraft={() => {}} canEdit onEditar={() => {}} />);
	assert.match(html, /Usar o recomendado/);
	assert.match(html, /Nunca troque a bina/);
	assert.ok(!renderToStaticMarkup(<PosicaoNumero draft={d} setDraft={() => {}} canEdit onEditar={() => {}} />).includes('Usar o recomendado'));
});

test('D2: o cartão mostra a tabela e só oferece o botão a quem edita', () => {
	const ed = renderToStaticMarkup(<RenitenciaRecomendada draft={{}} setDraft={() => {}} canEdit />);
	for (const t of ['Padrões recomendados', 'Ocupado', '15 min', '7 dias sem voz', 'Usar os padrões recomendados']) assert.ok(ed.includes(t), t);
	assert.ok(!renderToStaticMarkup(<RenitenciaRecomendada draft={{}} setDraft={() => {}} canEdit={false} />).includes('Usar os padrões'));
	assert.match(renderToStaticMarkup(<RenitenciaRecomendada draft={aplicarRenitenciaRecomendada({})} setDraft={() => {}} canEdit />), /Esta carteira já segue/);
});

const H = (troncos: { tronco_id: number; bina: string | null; discadas: number; curtas: number }[], total = { discadas: 5900, curtas: 4484 }): RitmoHoje => ({
	totais: { ...total, atendidas_pessoa: 100, abandonos: 1, transf_sem_operador: 0, atendimento_pct: 10, abandono_pct: 1, transf_sem_operador_pct: 0, curtas_pct: Math.round(1000 * total.curtas / total.discadas) / 10 },
	ultima: { janela: '2026-11-10T13:00:00-03:00', modo: 'power', razao: 1.6, estado: 'reduzido', conversas: 3, reservas: 1, linhas: 6 },
	janelas: [],
	por_tronco: troncos.map(t => ({ ...t, atendidas_pessoa: 10, abandonos: 0, abandono_pct: 0, curtas_pct: Math.round(1000 * t.curtas / t.discadas) / 10 })),
	abandono_30d: null,
});

test('curtas de hoje: por linha (a regra da VM) e no total da empresa', () => {
	for (const n of ['LINHA_PARA, EMPRESA_PARA = 800, 8000', 'AVISO, CORTE = 0.70, 0.80']) assert.ok(CURTAS_PY.includes(n), n);
	assert.ok(empresaParada({ discadas: 8000, curtas: 6400 }, false));
	assert.ok(!empresaParada({ discadas: 8000, curtas: 6400 }, true));
	const h = renderToStaticMarkup(<MemoryRouter><CurtasHojeVista liberado={false} h={H([
		{ tronco_id: 1, bina: '(11) 3•••-••00', discadas: 640, curtas: 500 },
		{ tronco_id: 2, bina: '(11) 3•••-••80', discadas: 800, curtas: 648 },
		...[3, 4, 5, 6, 7].map(i => ({ tronco_id: i, bina: null, discadas: 100, curtas: 50 })),
	])} /></MemoryRouter>);
	for (const t of ['Por linha (bina)', 'Linha (11) 3•••-••80', '800 ligações hoje (limite 1.000)', 'Linha parada hoje', 'Ritmo reduzido', 'Total da empresa', '5.900 ligações hoje (limite 10.000)', '+ 2 outras linhas'])
		assert.ok(h.includes(t), t);
	assert.ok(!h.includes('A empresa parou de ligar hoje'));
	const vazio = renderToStaticMarkup(<MemoryRouter><CurtasHojeVista liberado={false} h={null} /></MemoryRouter>);
	assert.match(vazio, /Sem ligações do discador MotorCX hoje/);
	const parou = renderToStaticMarkup(<MemoryRouter><CurtasHojeVista liberado={false} h={H([], { discadas: 8200, curtas: 6600 })} /></MemoryRouter>);
	assert.match(parou, /A empresa parou de ligar hoje/);
});

test('abandono conta fica travado em sim: o próximo salvamento tira o "não" salvo', () => {
	const d = effectiveDiscagem({ chamadas_curtas: { abandono_conta: false, aviso: 0.65 } });
	assert.equal(d.chamadas_curtas!.abandono_conta, true);
	const diff = computeDiff(d) as { chamadas_curtas?: Record<string, unknown> };
	assert.deepEqual(diff.chamadas_curtas, { aviso: 0.65 });
});
