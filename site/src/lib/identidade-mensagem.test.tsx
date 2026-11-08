// SQL 85 (npm test): mensagens escritas sem a dívida antes da identidade. Os mesmos casos do motor e do banco; os textos
// padrão do MotorCX (SMS do Assistente de implantação, modelo de importação do playbook e exemplos dos editores) passam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PADROES_MENSAGEM, mensagemRevelaDivida, trechosDivida } from './identidade-mensagem';
import { FRASES_PADRAO_SMS } from './implantacao';
import { MODELO_CSV } from './frases';

const raiz = join(process.cwd(), '..');      // npm test roda em site/
const CASOS = JSON.parse(readFileSync(join(raiz, 'tests', 'dados', 'mensagem_identidade_casos.json'), 'utf8')).casos as { texto: string; empresa?: string; revela: boolean }[];

test('os casos de tests/dados/mensagem_identidade_casos.json (os mesmos do motor e do banco)', () => {
	for (const c of CASOS) assert.equal(mensagemRevelaDivida(c.texto, c.empresa), c.revela, `${c.texto} → ${trechosDivida(c.texto, c.empresa).join(', ')}`);
});

test('padrões iguais aos do banco (SQL 85)', () => {
	const sql = readFileSync(join(raiz, 'supabase', 'migrations', '20270121000001_mensagem_identidade.sql'), 'utf8');
	for (const [nome, re] of Object.entries(PADROES_MENSAGEM)) {
		const m = sql.match(new RegExp(`\\n    ${nome} constant text := '(.*?)';\\n`));
		assert.ok(m, nome);
		assert.equal(m[1], re.source.replaceAll('\\b', '\\y'), nome);
	}
});

test('SMS padrão do Assistente de implantação: neutro, com link, cabe em 160 mesmo com nome longo', () => {
	for (const empresa of ['Assessoria de Cobrança Horizonte Ltda', 'Alfa']) {
		for (const f of FRASES_PADRAO_SMS) {
			const t = f.texto(empresa);
			assert.equal(mensagemRevelaDivida(t, empresa), false, `${f.estagio}: ${trechosDivida(t, empresa).join(', ')}`);
			assert.ok(t.length <= 160, `${f.estagio}: ${t.length}`);
			assert.match(t, /\{link\}/);
		}
	}
});

test('modelo de importação do playbook: exemplos neutros e com nome', () => {
	const linhas = MODELO_CSV.trim().split('\n').slice(1).map(l => l.split(';'));
	assert.ok(linhas.length >= 2);
	for (const [canal, , nome, , texto] of linhas) {
		assert.ok(nome?.trim(), `${canal}: sem nome`);
		assert.equal(mensagemRevelaDivida(texto ?? ''), false, texto);
	}
});

test('exemplos (placeholder) dos editores de mensagem escrita são neutros', () => {
	const arquivos = ['components/canais/frases.tsx', 'components/jornada/mensagens.tsx', 'components/mensageria/modelo-email.tsx',
		'components/mensageria/config-atendimento.tsx', 'components/estrategias/mensagem-dia-editor.tsx', 'components/mensageria/templates.tsx'];
	let vistos = 0;
	for (const a of arquivos) {
		const fonte = readFileSync(join(process.cwd(), 'src', a), 'utf8');
		for (const m of fonte.matchAll(/placeholder=(?:\{[^}]*?'([^']*)'\s*\}|"([^"]*)")/g)) {
			const t = m[1] ?? m[2] ?? '';
			if (!/^(Ex\.|Olá|Escreva|Prévia)/.test(t) && !/mensagem|Olá/i.test(t)) continue;
			vistos++;
			assert.equal(mensagemRevelaDivida(t), false, `${a}: ${t}`);
		}
	}
	assert.ok(vistos >= 5, `poucos exemplos lidos: ${vistos}`);
});
