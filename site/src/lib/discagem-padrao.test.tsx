// Padrões da Discagem (decisão do dono, 08/11/2026; Despacho Anatel 100/2026, vigência 12/11/2026):
// corte de curtas ligado em 80% com aviso em 70%, horários por UF ligados com a prévia, falha técnica sempre curta.
// A carteira que gravou a escolha mantém; a que não gravou fica com o padrão novo. npm test (scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { AVISO_SEM_HORARIOS, REGRA_CURTAS, SUGESTOES, computeDiff, effectiveDiscagem, resumoHorarios } from '@/lib/discagem';
import { ChamadasCurtas } from '@/components/discagem/chamadas-curtas';
import { Horarios } from '@/components/discagem/horarios';

const regua = JSON.parse(readFileSync(join(process.cwd(), '..', 'regras', 'regua.json'), 'utf8')).discagem;   // cwd = site/
const props = { update: () => undefined, reverter: () => undefined, canEdit: true, exec: null };

test('o padrão do site é o do motor (regras/regua.json › discagem)', () => {
	const { falha_conta: _f, ...cc } = regua.chamadas_curtas;
	void _f;
	assert.deepEqual(SUGESTOES.chamadas_curtas, cc);
	assert.deepEqual(SUGESTOES.horarios, regua.horarios);
	assert.equal(SUGESTOES.chamadas_curtas!.corte_ativo, true);
	assert.equal(SUGESTOES.chamadas_curtas!.aviso, 0.7);
	assert.equal(SUGESTOES.horarios!.ativo, true);
});

test('sem nada gravado: padrão novo e nada a gravar', () => {
	const d = effectiveDiscagem(null);
	assert.equal(d.chamadas_curtas!.corte_ativo, true);
	assert.equal(d.horarios!.ativo, true);
	assert.deepEqual(computeDiff(d), {});
});

test('quem gravou corte desligado e horário desligado mantém (e o diff guarda a escolha)', () => {
	const d = effectiveDiscagem({ chamadas_curtas: { corte_ativo: false }, horarios: { ativo: false } });
	assert.equal(d.chamadas_curtas!.corte_ativo, false);
	assert.equal(d.chamadas_curtas!.aviso, 0.7);                     // o resto segue o padrão
	assert.equal(d.horarios!.ativo, false);
	assert.deepEqual(computeDiff(d), { chamadas_curtas: { corte_ativo: false }, horarios: { ativo: false } });
});

test('mexer só no aviso grava só o aviso (o corte segue o padrão) e falha_conta nunca vai', () => {
	const d = effectiveDiscagem({ chamadas_curtas: { falha_conta: false } });
	assert.equal('falha_conta' in d.chamadas_curtas!, false);
	assert.deepEqual(computeDiff({ ...d, chamadas_curtas: { ...d.chamadas_curtas!, aviso: 0.6 } }), { chamadas_curtas: { aviso: 0.6 } });
});

test('resumo do cartão de horários pede o jurídico', () => {
	assert.equal(resumoHorarios({ ativo: true, tabela: null }), 'Ligado · pela prévia MotorCX (confirme com o seu jurídico)');
	const t = { hora: 'local' as const, ufs: { SP: { seg_sex: ['09:00', '18:00'] as [string, string], sabado: null }, AC: { seg_sex: ['09:00', '17:00'] as [string, string], sabado: null } }, ddds: {} };
	assert.equal(resumoHorarios({ ativo: true, tabela: t }), 'Ligado · tabela da empresa em 2 UFs · resto pela prévia (confirme com o seu jurídico)');
});

test('telas: regra nova das curtas e faixa vermelha ao desligar os horários', () => {
	const curtas = renderToStaticMarkup(<ChamadasCurtas draft={effectiveDiscagem(null)} {...props} />);
	assert.ok(curtas.includes(REGRA_CURTAS));
	assert.ok(curtas.includes('Despacho Decisório Anatel nº 100/2026'));
	assert.ok(curtas.includes('Ligado (recomendado)'));
	const ligado = renderToStaticMarkup(<Horarios draft={effectiveDiscagem(null)} {...props} />);
	assert.ok(ligado.includes('confirme com o seu jurídico'));
	assert.ok(!ligado.includes(AVISO_SEM_HORARIOS));
	const desligado = renderToStaticMarkup(<Horarios draft={effectiveDiscagem({ horarios: { ativo: false } })} {...props} />);
	assert.ok(desligado.includes(AVISO_SEM_HORARIOS));
	assert.ok(desligado.includes('No Acre isso é 6h da manhã.'));
});
