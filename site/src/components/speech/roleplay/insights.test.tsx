// Cenário a partir dos padrões das ligações (Roleplay, SQL 122), renderizado de verdade (react-dom/server), sem banco:
// a escolha do padrão (só grupos com 30+, em linguagem da monitoria, nunca o código), o aviso "só padrões agregados",
// base insuficiente, "Gerar rascunho" só com uma escolha, o selo "Cenário gerado de padrões agregados" no editor (com
// "revise antes de publicar") e o atalho "Novo a partir dos padrões" na biblioteca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { PadroesView, type PadroesRP } from './insights';
import { SeloInsights, PilulasCenario } from './comum';
import { rotuloPadrao } from './cenarios';
import { MolduraRP } from './moldura';
import { ROTA_RP_NOVO_INSIGHTS, trilhaRP } from '@/lib/roleplay';

const em = (n: ReactNode, rota = '/speech-analytics/roleplay/cenarios/novo?de=insights') => renderToStaticMarkup(<MemoryRouter initialEntries={[rota]}>{n}</MemoryRouter>);
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const INTERNOS = /contestacao|valor_alto|\bck_[a-z]|insights|treino_[a-z]|SQL \d|cluster|LLM/;
const ITENS = { ck_cpc: { texto: 'Confirmou a identidade antes de falar valor', gravidade: 'bloqueante' } };
const P: PadroesRP = {
	de: '2026-10-11', ate: '2026-11-09', base: 412, minimo: 30, suficiente: true,
	motivos: [{ codigo: 'contestacao', conversas: 72, pct: 0.175, acordo_pct: 0.083 }],
	objecoes: [{ codigo: 'valor_alto', conversas: 120, pct: 0.291, acordo_pct: 0.1 }],
	itens: [{ item: 'ck_cpc', avaliadas: 40, sim_pct: 0.5 }],
};

test('padrões: só agregados, em linguagem da monitoria, com a porcentagem e a taxa de acordo', () => {
	const h = em(<PadroesView p={P} itens={ITENS} gerando={false} onGerar={() => {}} />);
	assert.match(h, /Só padrões agregados\./);
	assert.match(h, /sobre 412 ligações analisadas/);
	assert.match(h, /nenhum trecho, nome, CPF, telefone ou valor de cliente vai para o cenário nem para o modelo/);
	assert.match(h, /Contesta a dívida/);
	assert.match(h, /18% das ligações · 8% com acordo/);
	assert.match(h, /Valor alto/);
	assert.match(h, /Confirmou a identidade antes de falar valor/);
	assert.match(h, /50% de “sim” em 40 avaliações/);
	assert.match(h, /type="radio" name="motivo" value="[^"]*"? ?checked=""|name="motivo" checked=""/);
	assert.match(h, /Gerar rascunho<\/button>/);
	assert.match(h, /a geração só sugere/);
	assert.doesNotMatch(texto(h), INTERNOS);
});

test('padrões: base abaixo de 30 e nenhum grupo suficiente', () => {
	const pouco = em(<PadroesView p={{ ...P, base: 12, suficiente: false, motivos: [], objecoes: [] }} itens={ITENS} gerando={false} onGerar={() => {}} />);
	assert.match(pouco, /Ainda não há ligações suficientes no período/);
	assert.match(pouco, /pelo menos 30 ligações analisadas \(12 no período\)/);
	assert.doesNotMatch(pouco, /Gerar rascunho/);
	const nada = em(<PadroesView p={{ ...P, motivos: [], objecoes: [], itens: [] }} itens={ITENS} gerando={false} onGerar={() => {}} />);
	assert.match(nada, /Nenhum padrão com ligações suficientes/);
	assert.match(nada, /<button[^>]*disabled=""[^>]*>Gerar rascunho/);
});

test('selo no editor: gerado de padrões agregados, de onde veio e revise antes de publicar', () => {
	const ins = { base: 412, de: '2026-10-11', ate: '2026-11-09', 'motivo:contestacao': 0.175, 'item:ck_cpc': 0.5 };
	const h = em(<SeloInsights c={{ insights: ins, situacao: 'rascunho' }} rotulo={(t, k) => rotuloPadrao(t, k, ITENS)} recemGerado />);
	assert.match(h, /Rascunho gerado de padrões agregados\./);
	assert.match(h, /412 ligações analisadas \(11\/10\/2026 a 09\/11\/2026\)/);
	assert.match(h, /motivo “Contesta a dívida”: 18%/);
	assert.match(h, /item do checklist “Confirmou a identidade antes de falar valor”: 50%/);
	assert.match(h, /Revise o texto, a ficha e os itens em foco antes de publicar/);
	const pub = em(<SeloInsights c={{ insights: ins, situacao: 'publicado' }} rotulo={(t, k) => rotuloPadrao(t, k, ITENS)} />);
	assert.match(pub, /Cenário gerado de padrões agregados\./);
	assert.doesNotMatch(pub, /Revise o texto/);
	assert.doesNotMatch(texto(h), INTERNOS);
	assert.match(em(<PilulasCenario c={{ empresa_id: 9, origem: 'insights', situacao: 'rascunho' }} />), /Gerado de padrões agregados/);
	assert.equal(rotuloPadrao('objecao', 'valor_alto', ITENS), 'Valor alto');
	assert.equal(rotuloPadrao('motivo', 'codigo_novo', ITENS), 'Outro motivo');
});

test('rota: "Novo a partir dos padrões" é o novo cenário com ?de=insights, na seção Cenários', () => {
	assert.equal(ROTA_RP_NOVO_INSIGHTS, '/speech-analytics/roleplay/cenarios/novo?de=insights');
	assert.deepEqual(trilhaRP('/speech-analytics/roleplay/cenarios/novo', 'Novo a partir dos padrões').map(i => i.rotulo),
		['Speech Analytics', 'Roleplay', 'Cenários', 'Novo a partir dos padrões']);
	const h = em(<MolduraRP titulo="Novo a partir dos padrões das ligações" detalhe="Novo a partir dos padrões"><p /></MolduraRP>);
	assert.match(h, /aria-label="Voltar para Cenários"/);
});
