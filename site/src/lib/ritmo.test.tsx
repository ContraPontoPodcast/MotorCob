// Ritmo da discagem (Power e Preditivo, V7; npm test): leitura e gravação de credores.discagem › ritmo (só o que difere
// de Power 1,0, faixas do SQL 107), o resumo do "Salvar como vN", as frases de estado, o exemplo da página "Robôs e o
// Preditivo" (canais ≈ robôs × razão) e as telas renderizadas sem banco.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { PADRAO_RITMO, canaisRecomendados, fraseEstado, fraseRitmo, ilustrarRobos, resumoHoje, resumoRitmo, ritmoDe, ritmoSaida } from './ritmo';
import { computeDiff, effectiveDiscagem } from './discagem';
import { rotaPai } from './rota-pai';
import { RitmoCarteira, QualEscolher } from '@/components/discagem/ritmo';
import { ExemploRobos } from '@/components/discagem/robos-preditivo';

const SQL107 = readFileSync('../supabase/migrations/20270222000001_voz_ritmo_config.sql', 'utf8');

test('ritmo: as faixas do site são as do SQL 107', () => {
	assert.ok(SQL107.includes('"ritmo":{"modo":["enum","power","preditivo"],"razao":["real",1.0,3.0],"meta_abandono":["real",0.5,3.0],"razao_max":["real",1.0,3.0]}'));
	assert.ok(SQL107.includes('"ritmo":{"modo":"power","razao":1.0,"meta_abandono":1.0,"razao_max":3.0,"teto_abandono":3.0'));
});

test('ritmo: sem a chave é Power 1,0; inválido fica com o padrão', () => {
	assert.deepEqual(ritmoDe(null), PADRAO_RITMO);
	assert.deepEqual(ritmoDe({ ritmo: { modo: 'preditivo', meta_abandono: 9, razao_max: 2.5 } }), { modo: 'preditivo', razao: 1, meta_abandono: 1, razao_max: 2.5 });
});

test('ritmo: grava só o que difere de Power 1,0, e junto do resto da discagem', () => {
	assert.equal(ritmoSaida(PADRAO_RITMO), null);
	assert.deepEqual(ritmoSaida({ ...PADRAO_RITMO, razao: 1.5 }), { razao: 1.5 });
	assert.deepEqual(ritmoSaida({ ...PADRAO_RITMO, modo: 'preditivo', razao: 2 }), { modo: 'preditivo' });   // razão do Power não vai
	const d = effectiveDiscagem({ tentativas_numero_dia: 3 });
	assert.equal(computeDiff(d).ritmo, undefined);
	assert.deepEqual(computeDiff({ ...d, ritmo: { ...PADRAO_RITMO, modo: 'preditivo', meta_abandono: 0.8 } }).ritmo, { modo: 'preditivo', meta_abandono: 0.8 });
	assert.equal(computeDiff({ ...d, ritmo: PADRAO_RITMO }).ritmo, undefined);   // voltou ao padrão: tira a chave
});

test('ritmo: resumo para o histórico e as frases', () => {
	assert.deepEqual(resumoRitmo(null, { ritmo: { modo: 'preditivo', razao_max: 2 } }),
		['Ritmo › Como o MotorCX disca: Power → Preditivo', 'Ritmo › Razão máxima: 3,0 → 2,0']);
	assert.deepEqual(resumoRitmo({ ritmo: { razao: 1.5 } }, { ritmo: { razao: 2 } }), ['Ritmo › Números por robô livre: 1,5 → 2,0']);
	assert.equal(fraseRitmo(PADRAO_RITMO), 'Power 1,0 · ninguém atende sem robô (progressivo)');
	assert.equal(fraseEstado('normal'), null);
	assert.equal(fraseEstado('parado')?.titulo, 'Linha parada hoje');
	assert.match(fraseEstado('reduzido', 1.6)?.texto ?? '', /1,6 por robô livre/);
	assert.equal(resumoHoje({ ...PADRAO_RITMO, modo: 'preditivo' }, null), 'Preditivo · abandono hoje — (meta 1,0%, teto 3%)');
});

test('robôs e o Preditivo: canais ≈ robôs × razão e o tronco que segura', () => {
	assert.equal(canaisRecomendados(20, 2.6), 52);
	const x = ilustrarRobos(20, 10, 'preditivo');
	assert.equal(x.linhas, 10);
	assert.ok(x.troncoSegura);
	assert.ok(!ilustrarRobos(20, 30, 'power1').troncoSegura);
	const h = renderToStaticMarkup(<MemoryRouter><ExemploRobos robos={20} canais={10} modo="power2" onModo={() => {}} /></MemoryRouter>);
	assert.match(h, /O tronco segura o ritmo/);
	assert.match(h, /canais ≈ robôs × razão/);
	assert.deepEqual(rotaPai('/voz/discagem/robos'), { to: '/voz/discagem', rotulo: 'Discagem' });
});

test('aba Ritmo: os dois modos, a mensagem neutra e os freios', () => {
	const hoje = { totais: { discadas: 1000, atendidas_pessoa: 120, abandonos: 1, transf_sem_operador: 2, curtas: 760, atendimento_pct: 12, abandono_pct: 0.8, transf_sem_operador_pct: 1.7, curtas_pct: 76 },
		ultima: { janela: '2026-11-10T10:00:00-03:00', modo: 'preditivo' as const, razao: 1.6, estado: 'reduzido' as const, conversas: 20, reservas: 2, linhas: 50 }, janelas: [], por_tronco: [], abandono_30d: null };
	const h = renderToStaticMarkup(<MemoryRouter><RitmoCarteira ritmo={{ ...PADRAO_RITMO, modo: 'preditivo' }} onTrocar={() => {}} canEdit hoje={hoje} /></MemoryRouter>);
	for (const t of ['Como o MotorCX disca', 'Power', 'Preditivo', 'Meta de abandono', 'Razão máxima', 'Ritmo reduzido', 'A próxima tentativa segue a Renitência da carteira', 'Teto de abandono: 3%', 'Robôs e o Preditivo'.slice(0, 0) || 'Como os robôs funcionam'])
		assert.ok(h.includes(t), t);
	for (const t of ['mesmo dia', 'abandonos em 7 dias', 'da voz por 3 dias']) assert.ok(!h.includes(t), `abandono sem regra própria: ${t}`);
	assert.ok(!/d[íi]vida/i.test(h.split('Quando alguém atende')[1].split('Freios')[0].replace('sem falar de dívida', '')), 'a mensagem não fala de dívida');
	const so = renderToStaticMarkup(<MemoryRouter><RitmoCarteira ritmo={PADRAO_RITMO} onTrocar={() => {}} canEdit={false} hoje={null} /></MemoryRouter>);
	assert.match(so, /Números por robô livre/);
	assert.match(so, /disabled/);
	assert.match(renderToStaticMarkup(<QualEscolher />), /Quando usar/);
});
