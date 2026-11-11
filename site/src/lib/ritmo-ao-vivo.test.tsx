// Ligações › faixa ao vivo do ritmo e a linha "Ligações hoje" da Visão geral (Power e Preditivo, V7b; npm test):
// renderizadas sem banco com o que ritmo_voz_hoje devolve; a linha parada pelas curtas (a mesma regra da VM) e o botão
// de liberação só para o Admin; a transferência sem operador aparece separada do abandono.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { FaixaRitmoVista, linhaParada } from '@/components/voz/faixa-ritmo';
import { LigacoesHoje } from '@/components/agente-voz/visao-geral';
import type { RitmoHoje } from './ritmo';

const SQL109 = readFileSync('../supabase/migrations/20270224000001_voz_curtas_freio.sql', 'utf8');
const CURTAS_PY = readFileSync('../voz/orquestrador/curtas.py', 'utf8');

const H = (estado: 'normal' | 'parado' | 'reduzido', tronco = { discadas: 820, curtas: 700 }): RitmoHoje => ({
	totais: { discadas: 1200, atendidas_pessoa: 150, abandonos: 1, transf_sem_operador: 3, curtas: 900, atendimento_pct: 12.5, abandono_pct: 0.7, transf_sem_operador_pct: 2, curtas_pct: 75 },
	ultima: { janela: '2026-11-10T13:00:00-03:00', modo: 'preditivo', razao: 1.6, razao_config: null, estado, conversas: 22, reservas: 4, linhas: 61 },
	janelas: [{ inicio: '2026-11-10T13:00:00-03:00', discadas: 300, atendidas_pessoa: 40, abandonos: 0, curtas: 220, razao: 1.6, atendimento_pct: 13.3, abandono_pct: 0, curtas_pct: 73.3 }],
	por_tronco: [{ tronco_id: 1, bina: '11 3•••-••00', ...tronco, atendidas_pessoa: 80, abandonos: 1, abandono_pct: 1.3, curtas_pct: Math.round(1000 * tronco.curtas / tronco.discadas) / 10 }],
	abandono_30d: { atendidas_pessoa: 3000, abandonos: 20, transf_sem_operador: 40, abandono_pct: 0.7 },
});

test('faixa: a regra da linha parada é a da VM (800/950 com 80%)', () => {
	for (const n of ['LINHA_PARA, EMPRESA_PARA = 800, 8000', 'LINHA_LIBERADA, EMPRESA_LIBERADA = 950, 9500', 'AVISO, CORTE = 0.70, 0.80']) assert.ok(CURTAS_PY.includes(n), n);
	assert.ok(SQL109.includes('function public.liberar_curtas_voz(empresa bigint, motivo text)'));
	assert.ok(linhaParada({ discadas: 800, curtas: 640 }, false));
	assert.ok(!linhaParada({ discadas: 800, curtas: 639 }, false));
	assert.ok(!linhaParada({ discadas: 900, curtas: 800 }, true));
	assert.ok(linhaParada({ discadas: 950, curtas: 800 }, true));
});

test('faixa: modo, robôs, abandono separado da transferência sem operador, estado e o dia', () => {
	const h = renderToStaticMarkup(<MemoryRouter><FaixaRitmoVista h={H('reduzido', { discadas: 300, curtas: 230 })} liberado={false} podeLiberar onLiberar={() => {}} metaPct={1} /></MemoryRouter>);
	for (const t of ['Preditivo · 1,6', '22 conversando', '4 reservados · 61 linhas no ar', 'meta 1,0% · teto 3%', 'Transferência sem operador (separada do abandono)', 'Ritmo reduzido', 'O dia por meia hora', 'Por linha (bina)', '11 3•••-••00'])
		assert.ok(h.includes(t), t);
	assert.ok(!h.includes('Liberar até 950'), 'sem linha parada, sem botão');
});

test('faixa: linha parada mostra a liberação só para o Admin, e liberado avisa', () => {
	const adm = renderToStaticMarkup(<MemoryRouter><FaixaRitmoVista h={H('parado')} liberado={false} podeLiberar onLiberar={() => {}} /></MemoryRouter>);
	assert.match(adm, /Liberar até 950\/linha e 9\.500\/total hoje/);
	assert.match(adm, /Nunca trocamos a bina/);
	assert.match(adm, /Parada hoje/);
	const ope = renderToStaticMarkup(<MemoryRouter><FaixaRitmoVista h={H('parado')} liberado={false} podeLiberar={false} onLiberar={() => {}} /></MemoryRouter>);
	assert.ok(!ope.includes('Liberar até 950'));
	const lib = renderToStaticMarkup(<MemoryRouter><FaixaRitmoVista h={H('parado')} liberado podeLiberar onLiberar={() => {}} /></MemoryRouter>);
	assert.match(lib, /Liberado hoje pelo Admin/);
	assert.ok(!lib.includes('Liberar até 950/linha'));
});

test('Visão geral: "Ligações hoje" com modo, abandono e curtas; com freio, "Com problema"', () => {
	const h = renderToStaticMarkup(<MemoryRouter><LigacoesHoje h={H('parado')} /></MemoryRouter>);
	assert.match(h, /Preditivo · abandono 0,7% · curtas 75,0%/);
	assert.match(h, /Com problema: linha parada hoje/);
	assert.equal(renderToStaticMarkup(<MemoryRouter><LigacoesHoje h={null} /></MemoryRouter>), '');
});
