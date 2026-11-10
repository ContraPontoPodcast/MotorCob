// Agente Voz/CX › Telefonia (SQL 105): situação do tronco para o cliente, sem segredo
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { situacaoTroncoCliente } from './telefonia';

test('SQL 105: situação do tronco para o cliente (senha, IPs esperando, teste)', () => {
	assert.match(situacaoTroncoCliente({ ativo: false }).txt, /^Inativo · a equipe MotorCX ativa/);
	assert.equal(situacaoTroncoCliente({ ativo: true, autenticacao: 'senha', segredo_no_cofre: false }).txt, 'Falta guardar a senha');
	assert.equal(situacaoTroncoCliente({ ativo: true, autenticacao: 'ip', ips_pendentes: ['200.1.1.1/32'] }).txt, 'IPs esperando a equipe MotorCX');
	assert.equal(situacaoTroncoCliente({ ativo: true, autenticacao: 'senha', segredo_no_cofre: true, ips_pendentes: [], teste_ok: true }).tom, 'ok');
	assert.equal(situacaoTroncoCliente({ ativo: true, autenticacao: 'ip', ips_pendentes: [], teste_ok: false }).tom, 'erro');
	assert.equal(situacaoTroncoCliente({ ativo: true, autenticacao: 'ip', ips_pendentes: [] }).txt, 'Esperando o teste');
});
