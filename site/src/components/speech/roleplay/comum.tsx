// Peças comuns do Roleplay: selo "Privacidade e LGPD no treino", dificuldade em pontos, a origem do cenário e o selo do
// cenário gerado de padrões agregados.
import { Aviso, Pilula, SeloRegras, type Regra } from '@/components/ds';
import { DIFICULDADE, type CenarioRP } from '@/lib/roleplay';

export const REGRAS_LGPD_TREINO: Regra[] = [
	{ titulo: 'Cliente simulado é ficção', texto: 'Nome com “(fictícia)” ou “(fictício)”, saldo sorteado na faixa, produto e credor de exemplo. Nenhuma frase, nome, CPF, telefone ou valor de cliente real.' },
	{ titulo: 'O treino não é gravação de cliente', texto: 'O áudio do operador não é guardado. A transcrição do treino fica 90 dias, separada, e nunca aparece em Gravações, Busca ou Alertas.' },
	{ titulo: 'Nota de treino separada', texto: 'Não entra na monitoria das ligações reais nem em Speech › Operadores.' },
	{ titulo: 'Operador sem login', texto: 'Cadastro só com apelido, equipe e, se quiser, o ID do discador. Sem CPF, e-mail ou telefone. O acesso é pelo link pessoal de treino, que abre só os treinos dele e expira.' },
	{ titulo: 'Quem vê', texto: 'A Qualidade e o Admin veem a empresa toda; o operador vê só os próprios treinos pelo link.' },
];

export function SeloLgpdTreino() {
	return <SeloRegras rotulo="Privacidade e LGPD no treino" titulo="Privacidade e LGPD no treino" regras={REGRAS_LGPD_TREINO} />;
}

export function Dificuldade({ n }: { n: number }) {
	const v = Math.max(1, Math.min(5, Math.round(n)));
	return (
		<span role="img" aria-label={`Dificuldade ${v} de 5: ${DIFICULDADE[v].toLowerCase()}`} title={`Dificuldade ${v} de 5`} className="inline-flex items-center gap-0.5 align-middle">
			{[1, 2, 3, 4, 5].map(i => <i key={i} className="inline-block h-1.5 w-3 rounded-full" style={{ backgroundColor: i <= v ? 'var(--destaque)' : 'var(--base-borda)' }} />)}
		</span>
	);
}

export function PilulasCenario({ c }: { c: Pick<CenarioRP, 'empresa_id' | 'origem' | 'situacao'> }) {
	return (
		<span className="inline-flex flex-wrap gap-1">
			<Pilula tom={c.empresa_id == null ? 'neutro' : 'destaque'}>{c.empresa_id == null ? 'Padrão MotorCX' : 'Da empresa'}</Pilula>
			{c.origem === 'insights' && <Pilula tom="info">Gerado de padrões agregados</Pilula>}
			{c.situacao === 'rascunho' && <Pilula tom="atencao">Rascunho</Pilula>}
		</span>
	);
}

const MOT: Record<string, string> = { motivo: 'motivo', objecao: 'objeção', item: 'item do checklist' };
/** "Cenário gerado de padrões agregados" (SQL 122): o selo, de onde veio (só códigos e porcentagens) e o lembrete de
 *  revisar antes de publicar. `rotulo` traduz o código para a tela (motivo, objeção, item). */
export function SeloInsights({ c, rotulo, recemGerado }: { c: Pick<CenarioRP, 'insights' | 'situacao'>; rotulo: (tipo: string, codigo: string) => string; recemGerado?: boolean }) {
	const ins = c.insights ?? {};
	const base = typeof ins.base === 'number' ? ins.base : null;
	const partes = Object.entries(ins).filter(([k]) => k.includes(':')).map(([k, v]) => {
		const [tipo, cod] = k.split(':');
		return `${MOT[tipo] ?? tipo} “${rotulo(tipo, cod)}”: ${Math.round(Number(v) * 100)}%`;
	});
	return (
		<Aviso tom={recemGerado ? 'ok' : 'info'} titulo={recemGerado ? 'Rascunho gerado de padrões agregados.' : 'Cenário gerado de padrões agregados.'}>
			{base != null ? `Feito a partir de ${base.toLocaleString('pt-BR')} ligações analisadas${typeof ins.de === 'string' && typeof ins.ate === 'string' ? ` (${ins.de.split('-').reverse().join('/')} a ${ins.ate.split('-').reverse().join('/')})` : ''}` : 'Feito a partir dos padrões das ligações'}
			{partes.length ? `: ${partes.join(' · ')}.` : '.'} Só códigos e porcentagens de grupos com 30 ou mais ligações; nenhum trecho, nome ou valor de cliente.
			{c.situacao !== 'publicado' && ' Revise o texto, a ficha e os itens em foco antes de publicar: a geração só sugere.'}
		</Aviso>
	);
}
