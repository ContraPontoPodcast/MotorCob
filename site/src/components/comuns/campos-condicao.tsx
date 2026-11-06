// Campos de valor das condições (Segmentos, Personas e Estágios da Orquestração). Guardam o texto que a pessoa
// digita (a vírgula e o ";" não somem no meio da digitação) e entregam o valor já lido:
// - CampoNumero: número em pt-BR ("1.500,50") -> number; texto que não é número segue como texto (o Salvar barra
//   com a mensagem). Mostra como foi entendido ("= 1.500,5") ou o erro.
// - CampoFaixa: "está entre" -> [de, até].
// - CampoLista: "é um destes" -> itens separados por ";".
import { useEffect, useId, useState } from 'react';
import { formatarNumeroBR, lerLista, lerNumeroBR, lerNumeroGravado, textoEdicao, textoLista, type ValorCondicao } from '@/lib/condicoes';

type Base = { disabled?: boolean; className?: string; placeholder?: string; 'aria-label'?: string };

/** Valor salvo (número ou texto antigo) e texto do campo dizem a mesma coisa? */
function mesmoValor(valor: unknown, texto: string): boolean {
	if (typeof valor === 'number') {
		const r = lerNumeroBR(texto);
		return !('erro' in r) && r.valor === valor;
	}
	return String(valor ?? '') === texto || (lerNumeroGravado(valor) !== null && textoEdicao(valor) === texto);
}

export function CampoNumero({ valor, onChange, mostrarLeitura = true, ...props }: Base & { valor: unknown; onChange: (v: number | string) => void; mostrarLeitura?: boolean }) {
	const [texto, setTexto] = useState(() => textoEdicao(valor));
	const idAjuda = useId();
	// Valor trocado por fora (outra condição, desfazer, trocar operador): o campo acompanha.
	useEffect(() => { if (!mesmoValor(valor, texto)) setTexto(textoEdicao(valor)); }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
	const r = texto.trim() ? lerNumeroBR(texto) : null;
	const erro = r && 'erro' in r ? r.erro : null;
	const leitura = r && !('erro' in r) && formatarNumeroBR(r.valor) !== texto.trim() ? formatarNumeroBR(r.valor) : null;
	return (
		<span className="inline-flex min-w-0 flex-1 flex-col">
			<input
				{...props}
				inputMode="decimal"
				value={texto}
				aria-invalid={erro ? true : undefined}
				aria-describedby={erro || (mostrarLeitura && leitura) ? idAjuda : undefined}
				onChange={e => {
					const t = e.target.value;
					setTexto(t);
					const lido = lerNumeroBR(t);
					onChange('erro' in lido ? t : lido.valor);
				}}
			/>
			{erro ? <span id={idAjuda} role="alert" className="mt-0.5 text-[11px] text-[var(--estado-erro,#C62828)]">{erro}</span>
				: mostrarLeitura && leitura ? <span id={idAjuda} className="mt-0.5 text-[11px] text-[var(--base-texto-3,#8E8E93)]">= {leitura}</span> : null}
		</span>
	);
}

export function CampoFaixa({ valor, onChange, disabled, className }: Base & { valor: ValorCondicao; onChange: (v: (number | string)[]) => void }) {
	const arr = Array.isArray(valor) ? valor : [];
	const de = arr[0] ?? '';
	const ate = arr[1] ?? '';
	return (
		<span className="flex min-w-[220px] flex-1 items-start gap-1.5">
			<CampoNumero valor={de} disabled={disabled} className={className} placeholder="de (ex.: 1.500,50)" aria-label="De" onChange={v => onChange([v, ate])} />
			<span className="mt-2 shrink-0 text-xs text-[var(--base-texto-3,#8E8E93)]">e</span>
			<CampoNumero valor={ate} disabled={disabled} className={className} placeholder="até (ex.: 3.000)" aria-label="Até" onChange={v => onChange([de, v])} />
		</span>
	);
}

export function CampoLista({ valor, onChange, placeholder = 'valores separados por ; (ex.: SP; RJ)', ...props }: Base & { valor: ValorCondicao; onChange: (itens: string[]) => void }) {
	const [texto, setTexto] = useState(() => textoLista(valor));
	useEffect(() => {
		const itens = Array.isArray(valor) ? valor.map(String) : lerLista(String(valor ?? ''));
		if (itens.join('\u0000') !== lerLista(texto).join('\u0000')) setTexto(textoLista(valor));
	}, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
	return <input {...props} placeholder={placeholder} value={texto} onChange={e => { setTexto(e.target.value); onChange(lerLista(e.target.value)); }} />;
}
