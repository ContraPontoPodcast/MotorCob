// O Assistente MotorCX (supabase/functions/assistente/conhecimento.ts) precisa conhecer cada tela do menu e cada atalho
// da busca ⌘K: tela nova ou nome novo entra na base no mesmo PR (a regra do topo do arquivo, agora conferida).
// npm test (site/scripts/testar-componentes.mjs) roda com o diretório do site como cwd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ABAS } from '@/lib/abas';
import { ATALHOS } from '@/components/workspace/workspace-command-palette';

const base = readFileSync(join(process.cwd(), '..', 'supabase', 'functions', 'assistente', 'conhecimento.ts'), 'utf-8').toLowerCase();

test('todo item de menu (lib/abas.ts) aparece na base do Assistente', () => {
	const faltam: string[] = [];
	for (const area of Object.values(ABAS)) {
		for (const g of area?.grupos ?? []) {
			for (const a of g.abas) if (!base.includes(a.nome.toLowerCase())) faltam.push(`${area?.area} › ${a.nome}`);
			if (g.rotulo && !base.includes(g.rotulo.toLowerCase())) faltam.push(`${area?.area} › grupo ${g.rotulo}`);
		}
	}
	assert.deepEqual(faltam, [], `faltam na base do Assistente: ${faltam.join('; ')}`);
});

test('todo atalho da busca ⌘K aparece na base do Assistente (pelo nome da tela)', () => {
	const tela = (l: string) => l.replace(/^(abrir a |abrir )/i, '').toLowerCase();
	const faltam = ATALHOS.filter(a => !base.includes(tela(a.label))).map(a => a.label);
	assert.deepEqual(faltam, [], `faltam na base do Assistente: ${faltam.join('; ')}`);
});

test('a base fala das telas novas da implantação e da voz', () => {
	for (const t of ['regras de discagem', 'assistente de implantação', 'mapeamento de colunas', 'cpf ativo', 'lista para baixar', 'pedido em texto', 'editor', 'testar']) {
		assert.ok(base.includes(t), t);
	}
	assert.ok(!base.includes('operação (saúde, empresas, atendimento)'), 'descrição antiga do Console');
});
