// "Avisar o Admin" (Onda 3, SQL 55): quem não pode abrir uma tela, ou quer uma área fora do plano, avisa os Admins
// da empresa pelo sino e por e-mail. O Admin decide; o sistema só avisa. No máximo um aviso por dia por alvo.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, type Row } from '@/lib/supabase';

type Estado = 'carregando' | 'indisponivel' | 'antes' | 'confirmando' | 'enviando' | 'avisado';

const hora = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * Estado do pedido: lê se já houve pedido hoje (pedido_admin_hoje) e quantos Admins ativos a empresa tem
 * (pessoas_empresa). Sem o SQL 55 no banco, ou para a equipe MotorCX, fica 'indisponivel' e a tela segue como antes.
 */
export function usePedidoAdmin(tipo: 'permissao' | 'area', alvo: string | undefined, tela?: string) {
	const { perfil, empresa } = useMotorAuth();
	const [estado, setEstado] = useState<Estado>('carregando');
	const [avisadoEm, setAvisadoEm] = useState<string | null>(null);
	const [admins, setAdmins] = useState<number | null>(null);
	const [nota, setNota] = useState('');
	const [erro, setErro] = useState('');

	useEffect(() => {
		if (!supabase || !alvo || !perfil || perfil.equipe || !empresa) { setEstado('indisponivel'); return; }
		let active = true;
		setEstado('carregando');
		(async () => {
			const [hoje, pessoas] = await Promise.all([
				supabase!.rpc('pedido_admin_hoje', { alvo }),
				supabase!.rpc('pessoas_empresa', { empresa: Number(empresa.id) }),
			]);
			if (!active) return;
			if (hoje.error) { setEstado('indisponivel'); return; }
			const n = ((pessoas.data ?? []) as Row[]).filter(r => r.papel === 'admin' && r.situacao !== 'inativo' && r.id !== perfil.id).length;
			setAdmins(pessoas.error ? null : n);
			if (hoje.data) { setAvisadoEm(String(hoje.data)); setEstado('avisado'); }
			else setEstado('antes');
		})().catch(() => { if (active) setEstado('indisponivel'); });
		return () => { active = false; };
	}, [alvo, perfil?.id, perfil?.equipe, empresa?.id]);

	async function enviar() {
		if (!supabase || !alvo) return;
		setEstado('enviando'); setErro('');
		const { data, error } = await supabase.rpc('avisar_admin', { tipo, alvo, nota: nota.trim() || null, tela: tela ?? null });
		if (error) { setErro('Não foi possível avisar agora. Tente de novo em instantes.'); setEstado('confirmando'); return; }
		const r = (Array.isArray(data) ? data[0] : data) as Row | null;
		const n = Number(r?.avisados ?? 0);
		if (n === 0) { setAdmins(0); setEstado('antes'); return; }
		setAvisadoEm(String(r?.avisado_em ?? new Date().toISOString()));
		setEstado('avisado');
	}

	return {
		estado, admins, nota, setNota, erro, enviar, empresaNome: empresa?.nome ?? '',
		horario: avisadoEm ? hora(avisadoEm) : '',
		disponivel: estado !== 'indisponivel' && estado !== 'carregando',
		abrir: () => { if (estado === 'antes' && admins !== 0) setEstado('confirmando'); },
		cancelar: () => { setEstado('antes'); setErro(''); },
	};
}

export type PedidoAdmin = ReturnType<typeof usePedidoAdmin>;

const btnPrim = 'inline-flex h-10 items-center rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:cursor-default disabled:opacity-50';
const btnPeq = 'inline-flex h-[30px] items-center rounded-full px-3 text-[12.5px] font-semibold';

/** Botão principal: "Pedir acesso ao Admin" / "Avisar o Admin"; depois do pedido, "Admin avisado hoje às 14:32". */
export function BotaoPedido({ p, rotulo }: { p: PedidoAdmin; rotulo: string }) {
	if (p.estado === 'avisado') return <button type="button" disabled className={btnPrim}>Admin avisado hoje às {p.horario}</button>;
	return (
		<button type="button" onClick={p.abrir} disabled={p.estado !== 'antes' || p.admins === 0} className={btnPrim}>{rotulo}</button>
	);
}

/** Bloco abaixo dos botões: confirmação com a nota opcional, "Avisamos o Admin" ou "sem Admin ativo". */
export function BlocoPedido({ p, oque }: { p: PedidoAdmin; oque: string }) {
	if (p.admins === 0 && p.estado === 'antes') {
		return (
			<div className="mx-auto mt-6 max-w-[460px] rounded-[14px] border border-[#E5E5EA] p-4 text-left">
				<div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] text-[#1D1D1F]" style={{ backgroundColor: 'var(--estado-atencao-fundo)' }}>
					<span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold" style={{ backgroundColor: 'var(--estado-atencao)', color: 'var(--base-cartao)' }}>!</span>
					<span><b>Sua empresa está sem Admin ativo.</b> Abra um chamado no Suporte para indicarmos um novo Admin.</span>
				</div>
				<Link to={`/suporte/novo?assunto=${encodeURIComponent('Empresa sem Admin ativo')}`} className={`${btnPeq} mt-2.5 bg-[#1D1D1F] text-white`}>Abrir chamado</Link>
			</div>
		);
	}
	if (p.estado === 'confirmando' || p.estado === 'enviando') {
		const n = p.admins ?? 0;
		const quem = n === 1 ? `O Admin${p.empresaNome ? ` da ${p.empresaNome}` : ''} recebe` : `Os ${n > 1 ? `${n} ` : ''}Admins${p.empresaNome ? ` da ${p.empresaNome}` : ''} recebem`;
		return (
			<div className="mx-auto mt-6 max-w-[460px] rounded-[14px] border border-[#E5E5EA] p-4 text-left">
				<h3 className="mb-1 text-[14.5px] font-semibold text-[#1D1D1F]">Pedir ao Admin</h3>
				<p className="mb-2.5 text-[12.5px] text-[#6E6E73]">{quem} um aviso no sino e por e-mail com o seu nome, o seu perfil e {oque}. Quem decide se libera é o Admin.</p>
				<label htmlFor="pedido-nota" className="mb-1 block text-[12px] text-[#6E6E73]">Por que você precisa? (opcional)</label>
				<textarea id="pedido-nota" autoFocus maxLength={200} value={p.nota} onChange={e => p.setNota(e.target.value)} placeholder="Ex.: acompanho o resultado toda semana."
					className="min-h-[64px] w-full resize-y rounded-[10px] border border-[#D2D2D7] bg-white px-2.5 py-2 text-[13px] text-[#1D1D1F] outline-none focus:border-[#1D1D1F]" />
				<div className="text-right text-[11px] text-[#8E8E93] tnum" aria-live="polite">{p.nota.length}/200</div>
				{p.erro && <p className="mt-1 text-[12.5px]" style={{ color: 'var(--estado-erro-texto)' }}>{p.erro}</p>}
				<div className="mt-2 flex gap-2">
					<button type="button" onClick={() => void p.enviar()} disabled={p.estado === 'enviando'} className={`${btnPeq} bg-[#1D1D1F] text-white disabled:opacity-50`}>{p.estado === 'enviando' ? 'Avisando...' : 'Avisar o Admin'}</button>
					<button type="button" onClick={p.cancelar} disabled={p.estado === 'enviando'} className={`${btnPeq} border border-[#D2D2D7] text-[#1D1D1F]`}>Cancelar</button>
				</div>
			</div>
		);
	}
	if (p.estado === 'avisado') {
		return (
			<div className="mx-auto mt-6 max-w-[460px] text-left">
				<div role="status" className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] text-[#1D1D1F]" style={{ backgroundColor: 'var(--estado-pronto-fundo)' }}>
					<span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold" style={{ backgroundColor: 'var(--estado-pronto)', color: 'var(--base-cartao)' }}>✓</span>
					<span><b>Avisamos o Admin às {p.horario}.</b> Quando ele liberar, esta tela abre normalmente. Dá para pedir de novo amanhã, se precisar.</span>
				</div>
			</div>
		);
	}
	return null;
}
