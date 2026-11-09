// Tabela "O que reconhecemos" da carga geral (SQL 74): um campo do MotorCX por linha, a coluna do arquivo (seletor) e
// o estado. Usada no Assistente de implantação (passo 3), em Configurações da carteira › Arquivos e na carga que voltou
// esperando as colunas. Exemplos de dado pessoal sempre mascarados.
import { Lock } from 'lucide-react';
import { CAMPOS_CARGA, CAMPOS_VOZ, exemplo, type CampoCarga, type CampoVoz, type ColunasCarga } from '@/lib/mapeamento-carga';
import { Pilula, campoCls, campoStyle } from '@/components/ds';

type Props = {
	cabecalho: string[];
	colunas: ColunasCarga;
	reconhecido: ColunasCarga;
	onTrocar: (c: ColunasCarga) => void;
	linhas?: string[][];
	somenteLeitura?: boolean;
};

function valorDe(c: ColunasCarga, k: CampoCarga | CampoVoz): string[] {
	const v = (c as Record<string, unknown>)[k];
	return Array.isArray(v) ? (v as string[]) : typeof v === 'string' && v ? [v] : [];
}

export function MapeamentoCarga({ cabecalho, colunas, reconhecido, onTrocar, linhas, somenteLeitura }: Props) {
	const idx = (col: string) => cabecalho.indexOf(col);
	const ex = (k: CampoCarga, cols: string[]) => {
		const l = (linhas ?? []).find(r => cols.some(c => (r[idx(c)] ?? '').trim()));
		return l ? cols.map(c => exemplo(k, l[idx(c)])).filter(Boolean)[0] ?? '' : '';
	};
	function trocar(k: CampoCarga | CampoVoz, v: string | string[]) {
		const novo: ColunasCarga = { ...colunas };
		const rec = novo as Record<string, unknown>;
		if (Array.isArray(v)) { if (v.length) rec[k] = v; else delete rec[k]; }
		else if (v) rec[k] = v; else delete rec[k];
		onTrocar(novo);
	}
	// colunas já usadas por outro campo (o documento de validação pode repetir o CPF: "usar o CPF/CNPJ já apontado")
	const ocupadas = (exceto: CampoCarga | CampoVoz) => new Set([
		...CAMPOS_CARGA.filter(c => c.key !== exceto).flatMap(c => valorDe(colunas, c.key)),
		...CAMPOS_VOZ.filter(c => c.key !== exceto && !(c.key === 'documento_validacao' && colunas.documento_validacao === colunas.cpf)).flatMap(c => valorDe(colunas, c.key)),
	]);

	return (
		<div className="space-y-4">
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
		<ParaAgenteVoz cabecalho={cabecalho} colunas={colunas} trocar={trocar} livres={k => cabecalho.filter(h => h && !ocupadas(k).has(h))} somenteLeitura={somenteLeitura} />
		</div>
	);
}

/** Grupo "Para o agente de voz" (SQL 88): opcional; os valores nunca aparecem (nem de exemplo) e só viram código. */
function ParaAgenteVoz({ cabecalho, colunas, trocar, livres, somenteLeitura }: {
	cabecalho: string[]; colunas: ColunasCarga; trocar: (k: CampoVoz, v: string) => void; livres: (k: CampoVoz) => string[]; somenteLeitura?: boolean;
}) {
	if (!cabecalho.length && !colunas.nascimento && !colunas.documento_validacao) return null;
	return (
		<section aria-labelledby="t-voz" className="rounded-xl px-3 py-3" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>
			<h3 id="t-voz" className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[var(--base-texto)]">Para o agente de voz <Pilula tom="neutro">opcional</Pilula></h3>
			<p className="mt-1.5 flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[12.5px] text-[var(--base-texto)]" style={{ backgroundColor: 'color-mix(in srgb, var(--area-voz) 9%, var(--base-cartao))' }}>
				<Lock size={13} className="mt-[2px] shrink-0 text-[var(--area-voz)]" aria-hidden />
				<span><b className="font-semibold">Dados de validação nunca ficam guardados nem aparecem em tela.</b> Na leitura da carga, o MotorCX transforma cada valor num código (com a chave da empresa) e descarta o valor. Essas colunas também nunca viram atributo, segmento ou persona.</span>
			</p>
			<h4 className="mt-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--base-texto-3)]">Confirmar identidade</h4>
			<ul className="mt-1 divide-y" style={{ borderColor: 'var(--base-separator)' }}>
				{CAMPOS_VOZ.map(c => {
					const atual = colunas[c.key] ?? '';
					const cpf = colunas.cpf;
					const opcoes = livres(c.key).filter(h => h !== cpf);
					return (
						<li key={c.key} data-campo={c.key} className="grid gap-x-4 gap-y-1.5 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)_minmax(0,1fr)]" style={{ borderColor: 'var(--base-separator)' }}>
							<span className="min-w-0">
								<b className="block text-[13.5px] font-medium text-[var(--base-texto)]">{c.nome}</b>
								<small className="block text-[11.5px] text-[var(--base-texto-3)]">{c.ajuda}</small>
							</span>
							{somenteLeitura ? <span className="font-mono text-[12.5px]">{atual ? (atual === cpf && c.key === 'documento_validacao' ? `Usar ${atual} (já apontado)` : atual) : '—'}</span> : (
								<select aria-label={`Coluna de ${c.nome}`} value={atual} onChange={e => trocar(c.key, e.target.value)} className={`${campoCls} h-9 w-full`} style={campoStyle}>
									<option value="">— não vem no arquivo —</option>
									{c.key === 'documento_validacao' && cpf && <option value={cpf}>Usar {cpf} (já apontado)</option>}
									{opcoes.map(h => <option key={h} value={h}>{h}</option>)}
								</select>
							)}
							<small className="min-w-0 text-[12px] text-[var(--base-texto-2)]">{atual ? <><Pilula tom="info">vira código</Pilula> {c.formato}</> : 'Não vem no arquivo.'}</small>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
