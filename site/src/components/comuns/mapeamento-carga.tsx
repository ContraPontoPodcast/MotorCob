// Tabela "O que reconhecemos" da carga geral (SQL 74): um campo do MotorCX por linha, a coluna do arquivo (seletor) e
// o estado. Usada no Assistente de implantação (passo 3), em Configurações da carteira › Arquivos e na carga que voltou
// esperando as colunas. Exemplos de dado pessoal sempre mascarados.
import { CAMPOS_CARGA, exemplo, type CampoCarga, type ColunasCarga } from '@/lib/mapeamento-carga';
import { Pilula, campoCls, campoStyle } from '@/components/ds';

type Props = {
	cabecalho: string[];
	colunas: ColunasCarga;
	reconhecido: ColunasCarga;
	onTrocar: (c: ColunasCarga) => void;
	linhas?: string[][];
	somenteLeitura?: boolean;
};

function valorDe(c: ColunasCarga, k: CampoCarga): string[] {
	const v = (c as Record<string, unknown>)[k];
	return Array.isArray(v) ? (v as string[]) : typeof v === 'string' && v ? [v] : [];
}

export function MapeamentoCarga({ cabecalho, colunas, reconhecido, onTrocar, linhas, somenteLeitura }: Props) {
	const idx = (col: string) => cabecalho.indexOf(col);
	const ex = (k: CampoCarga, cols: string[]) => {
		const l = (linhas ?? []).find(r => cols.some(c => (r[idx(c)] ?? '').trim()));
		return l ? cols.map(c => exemplo(k, l[idx(c)])).filter(Boolean)[0] ?? '' : '';
	};
	function trocar(k: CampoCarga, v: string | string[]) {
		const novo: ColunasCarga = { ...colunas };
		const rec = novo as Record<string, unknown>;
		if (Array.isArray(v)) { if (v.length) rec[k] = v; else delete rec[k]; }
		else if (v) rec[k] = v; else delete rec[k];
		onTrocar(novo);
	}
	const ocupadas = (exceto: CampoCarga) => new Set(CAMPOS_CARGA.filter(c => c.key !== exceto).flatMap(c => valorDe(colunas, c.key)));

	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-0 text-[13.5px]">
				<thead>
					<tr className="text-left text-[12px] text-[var(--base-texto-3)]">
						<th className="pb-2 pr-2 font-medium">O MotorCX precisa de</th>
						<th className="pb-2 pr-2 font-medium">Coluna do seu arquivo</th>
						<th className="hidden pb-2 pr-2 font-medium sm:table-cell">Exemplo</th>
						<th className="pb-2 font-medium"><span className="sr-only">Situação</span></th>
					</tr>
				</thead>
				<tbody>
					{CAMPOS_CARGA.map(c => {
						const atual = valorDe(colunas, c.key);
						const rec = valorDe(reconhecido, c.key);
						const apontou = atual.length > 0 && atual.join('|') !== rec.join('|');
						const livres = cabecalho.filter(h => h && !ocupadas(c.key).has(h));
						const obrig = !!c.falta && c.key !== 'emails';
						const semValor = !atual.length;
						const falta = semValor && obrig && !(c.key === 'id_cliente' && valorDe(colunas, 'cpf').length) && !(c.key === 'dias_atraso' && valorDe(colunas, 'vencimento').length) && !(c.key === 'telefones' && valorDe(colunas, 'emails').length);
						return (
							<tr key={c.key} className="border-t border-[var(--base-separator)] align-middle" data-campo={c.key}>
								<td className="py-2 pr-2">
									<span className="font-medium text-[var(--base-texto)]">{c.nome}</span>
									{c.ajuda && <small className="block text-[11.5px] text-[var(--base-texto-3)]">{c.ajuda}</small>}
								</td>
								<td className="py-2 pr-2">
									{somenteLeitura ? <span className="font-mono text-[12.5px]">{atual.join(', ') || '—'}</span>
										: c.multi ? (
											<div className="flex flex-wrap gap-1.5">
												{atual.map(col => (
													<span key={col} className="inline-flex items-center gap-1 rounded-full bg-[var(--base-fill)] px-2 py-0.5 font-mono text-[12px]">
														{col}
														<button type="button" aria-label={`Tirar ${col} de ${c.nome}`} onClick={() => trocar(c.key, atual.filter(x => x !== col))} className="text-[var(--base-texto-3)] hover:text-[var(--base-texto)]">×</button>
													</span>
												))}
												<select aria-label={`Adicionar coluna em ${c.nome}`} value="" onChange={e => e.target.value && trocar(c.key, [...atual, e.target.value])} className={`${campoCls} h-8`} style={campoStyle}>
													<option value="">{atual.length ? '+ outra coluna' : 'Escolha a coluna…'}</option>
													{livres.filter(h => !atual.includes(h)).map(h => <option key={h} value={h}>{h}</option>)}
												</select>
											</div>
										) : (
											<select aria-label={`Coluna de ${c.nome}`} value={atual[0] ?? ''} onChange={e => trocar(c.key, e.target.value)} className={`${campoCls} h-8 w-full sm:w-auto`} style={falta ? { borderColor: 'var(--estado-erro)' } : campoStyle}>
												<option value="">{obrig ? 'Escolha a coluna…' : 'Não tem'}</option>
												{livres.map(h => <option key={h} value={h}>{h}</option>)}
											</select>
										)}
								</td>
								<td className="hidden py-2 pr-2 font-mono text-[12px] text-[var(--base-texto-2)] sm:table-cell">{atual.length ? ex(c.key, atual) : ''}</td>
								<td className="py-2 text-right">
									{falta ? <Pilula tom="erro">falta apontar</Pilula>
										: semValor ? <Pilula tom="neutro">{c.key === 'cpf' ? 'só para agrupar' : 'não tem'}</Pilula>
											: apontou ? <Pilula tom="ok">✓ você apontou</Pilula>
												: <Pilula tom="ok">✓ {c.multi && atual.length > 1 ? `${atual.length} colunas` : 'achamos'}</Pilula>}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
