// Agente Voz/CX › Telefonia (SQL 105, 113 e 114): situação do tronco e da rota para o cliente, sem segredo, e a junção
// das views pelo id
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { juntarPorId, situacaoRota, situacaoTroncoCliente } from './telefonia';

test('situação do tronco para o cliente (senha, IPs, teste, em uso, pausado)', () => {
	assert.equal(situacaoTroncoCliente({ ativo: false, autenticacao: 'senha', segredo_no_cofre: false }).txt, 'Falta guardar a senha');
	assert.equal(situacaoTroncoCliente({ ativo: false, autenticacao: 'ip', ips_operadora: [] }).txt, 'Faltam os IPs da operadora');
	assert.equal(situacaoTroncoCliente({ ativo: true, autenticacao: 'ip', ips_operadora: ['200.1.1.1/32'], ips_pendentes: ['200.1.1.1/32'] }).txt, 'IPs esperando a equipe MotorCX');
	assert.equal(situacaoTroncoCliente({ ativo: false, autenticacao: 'ip', ips_operadora: ['x'], ips_pendentes: [] }).txt, 'Falta testar a rota');
	assert.equal(situacaoTroncoCliente({ ativo: false, autenticacao: 'ip', ips_operadora: ['x'], ips_pendentes: [], teste_ok: false }).tom, 'erro');
	assert.match(situacaoTroncoCliente({ ativo: false, autenticacao: 'ip', ips_operadora: ['x'], ips_pendentes: [], teste_ok: true }).txt, /ainda não está em uso/);
	assert.equal(situacaoTroncoCliente({ ativo: true, autenticacao: 'senha', segredo_no_cofre: true, ips_operadora: ['x'], ips_pendentes: [], teste_ok: true }).tom, 'ok');
	assert.equal(situacaoTroncoCliente({ ativo: true, teste_ok: true }, true).txt, 'Rota pausada');
});

test('situação da rota (vigência e pausa) e junção das views', () => {
	assert.equal(situacaoRota({ vigente_desde: '2026-01-01', vigente_ate: '2026-02-01' }, '2026-11-10', false).txt, 'Encerrada');
	assert.equal(situacaoRota({ vigente_desde: '2026-12-01' }, '2026-11-10', false).txt, 'Agendada');
	assert.equal(situacaoRota({ vigente_desde: '2026-01-01' }, '2026-11-10', true).txt, 'Pausada');
	assert.equal(situacaoRota({ vigente_desde: '2026-01-01' }, '2026-11-10', false).tom, 'ok');
	assert.deepEqual(juntarPorId([{ id: 1, a: 1 }, { id: 2, a: 2 }], [{ id: 1, b: 9 }]), [{ id: 1, a: 1, b: 9 }, { id: 2, a: 2 }]);
});
