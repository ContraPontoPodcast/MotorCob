// Erro de Edge Function → frase da função na tela (Pessoas › Convidar pessoa mostrava só a mensagem genérica: o 409
// "e-mail já cadastrado" ficava em error.context, um Response que ninguém lia).
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { erroDaFuncao, exigirFuncao, frase, lerErroDaFuncao } from '@/lib/funcoes';

const GENERICA = 'Não foi possível concluir a operação. Tente novamente ou fale com o administrador.';
const resposta = (corpo: unknown, status: number) =>
	new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

test('409 da admin-usuarios: mostra a frase da função, não a genérica', async () => {
	const erro = new FunctionsHttpError(resposta({ erro: 'e-mail já cadastrado' }, 409));
	assert.equal(await erroDaFuncao(erro, null), 'E-mail já cadastrado.');
	const lido = await lerErroDaFuncao(new FunctionsHttpError(resposta({ erro: 'e-mail já cadastrado' }, 409)));
	assert.deepEqual(lido, { status: 409, mensagem: 'e-mail já cadastrado' });
});

test('aceita { error } e { message }, junta { erros } e não estraga a frase que já tem ponto', async () => {
	assert.equal(await erroDaFuncao(new FunctionsHttpError(resposta({ error: 'limite atingido' }, 429))), 'Limite atingido.');
	assert.equal(await erroDaFuncao(new FunctionsHttpError(resposta({ message: 'campo inválido' }, 400))), 'Campo inválido.');
	assert.match(String(await erroDaFuncao(new FunctionsHttpError(resposta({ code: 'NOT_FOUND', message: 'Requested function was not found' }, 404)))),
		/não está publicado/);
	assert.equal(await erroDaFuncao(new FunctionsHttpError(resposta({ erro: 'fluxo inválido', erros: ['N1 sem saída', 'N2'] }, 400))),
		'Fluxo inválido: N1 sem saída, N2.');
	assert.equal(await erroDaFuncao(new FunctionsHttpError(resposta({ erro: 'Tudo certo?' }, 400))), 'Tudo certo?');
	assert.equal(frase('a fatura voltou'), 'A fatura voltou.');
});

test('o corpo pode ser lido de novo (clone) e corpo sem JSON cai na genérica ou no padrão', async () => {
	const r = resposta({ erro: 'sem permissão' }, 403);
	const erro = new FunctionsHttpError(r);
	assert.equal(await erroDaFuncao(erro), 'Sem permissão.');
	assert.equal(await erroDaFuncao(erro), 'Sem permissão.');
	assert.deepEqual(await r.json(), { erro: 'sem permissão' });   // quem chama ainda lê o corpo
	assert.equal(await erroDaFuncao(new FunctionsHttpError(resposta('<html>502</html>', 502))), GENERICA);
	assert.equal(await erroDaFuncao(new FunctionsHttpError(resposta('', 500)), null, 'Tente de novo.'), 'Tente de novo.');
	// erro com mais de 300 caracteres não vai para a tela
	assert.equal(await erroDaFuncao(new FunctionsHttpError(resposta({ erro: 'x'.repeat(400) }, 500))), GENERICA);
});

test('2xx com { erro } é erro; 2xx sem erro é sucesso', async () => {
	assert.equal(await erroDaFuncao(null, { erro: 'e-mail já cadastrado' }), 'E-mail já cadastrado.');
	assert.equal(await erroDaFuncao(null, { error: 'recusado' }), 'Recusado.');
	assert.equal(await erroDaFuncao(null, { ok: true, usuario_id: '00000000-0000-4000-8000-000000000001' }), null);
	assert.equal(await erroDaFuncao(null, { message: 'informativo' }), null);   // message no 2xx não é erro
	assert.equal(await erroDaFuncao(null, null), null);
	assert.deepEqual(await exigirFuncao({ data: { url: 'x' }, error: null }), { url: 'x' });
	await assert.rejects(exigirFuncao({ data: null, error: new FunctionsHttpError(resposta({ erro: 'fatura não encontrada' }, 404)) }),
		/Fatura não encontrada\./);
});

test('sem resposta (rede) → aviso de conexão', async () => {
	assert.match(String(await erroDaFuncao(new FunctionsFetchError(new TypeError('Failed to fetch')))), /falar com o servidor/);
});

test('toda chamada supabase.functions.invoke do site lê o erro com erroDaFuncao/lerErroDaFuncao', () => {
	const raiz = join(process.cwd(), 'src');
	const achar = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(d =>
		d.isDirectory() ? achar(join(dir, d.name)) : /\.tsx?$/.test(d.name) && !d.name.includes('.test.') ? [join(dir, d.name)] : []);
	const faltam: string[] = [];
	for (const arq of achar(raiz)) {
		const linhas = readFileSync(arq, 'utf8').split('\n');
		linhas.forEach((l, i) => {
			if (!/\bfunctions\.invoke\(/.test(l) || /^\s*(\/\/|\*)/.test(l)) return;
			const perto = linhas.slice(i, i + 6).join('\n');
			if (!/\b(erroDaFuncao|lerErroDaFuncao|exigirFuncao)\(/.test(perto)) faltam.push(`${arq.slice(raiz.length + 1)}:${i + 1}`);
		});
	}
	assert.deepEqual(faltam, []);
});
