// SQL 85 · aviso (não bloqueio) nos editores de mensagem escrita: o texto conta a quem pegar o telefone que há dívida.
// O texto é do cliente: o Salvar continua livre. Regra em @/lib/identidade-mensagem (a mesma do motor e do banco).
import { Aviso } from '@/components/ds';
import { AVISO_IDENTIDADE, trechosDivida } from '@/lib/identidade-mensagem';

export function AvisoIdentidade({ texto, empresa }: { texto: string; empresa?: string | null }) {
	const trechos = trechosDivida(texto, empresa);
	if (!trechos.length) return null;
	return (
		<div className="mt-1.5 font-normal" data-aviso="identidade">
			<Aviso tom="atencao" titulo="Revela a dívida?">
				{AVISO_IDENTIDADE} <span className="text-[var(--base-texto-2)]">Encontrado: {trechos.slice(0, 5).join(', ')}.</span>
			</Aviso>
		</div>
	);
}
