import { useEffect, useRef, useState } from 'react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import type { ModeloEmail } from '@/lib/mensageria';

export function ModeloEmailEditor() {
	const { empresa, permissoes } = useMotorAuth();
	const canEdit = permissoes.includes('editar_canais');
	const [modelo, setModelo] = useState<ModeloEmail | null>(null);
	const [nome, setNome] = useState('');
	const [assunto, setAssunto] = useState('');
	const [texto, setTexto] = useState('');
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [sucesso, setSucesso] = useState('');
	const textoRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!supabase || !empresa) return;
		let active = true;
		(async () => {
			const { data } = await supabase.from('mensageria_modelos_email').select('*').eq('empresa_id', empresa.id).maybeSingle();
			if (!active) return;
			const m = (data as Row | null) as ModeloEmail | null;
			setModelo(m);
			setNome(m?.nome_remetente ?? '');
			setAssunto(m?.assunto ?? '');
			setTexto(m?.texto ?? '');
			setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	function inserirVariavel() {
		const el = textoRef.current;
		const variavel = '{empresa}';
		if (!el) { setTexto((t) => t + variavel); return; }
		const start = el.selectionStart ?? texto.length;
		const end = el.selectionEnd ?? texto.length;
		const next = texto.slice(0, start) + variavel + texto.slice(end);
		setTexto(next);
		requestAnimationFrame(() => {
			el.focus();
			const pos = start + variavel.length;
			el.setSelectionRange(pos, pos);
		});
	}

	async function salvar() {
		if (!supabase || !empresa) return;
		const erros: string[] = [];
		if (nome.trim().length < 2 || nome.trim().length > 60) erros.push('Nome do remetente deve ter entre 2 e 60 caracteres.');
		if (assunto.trim().length < 3 || assunto.trim().length > 120) erros.push('Assunto deve ter entre 3 e 120 caracteres.');
		if (texto.trim().length < 10 || texto.trim().length > 5000) erros.push('Texto deve ter entre 10 e 5.000 caracteres.');
		if (erros.length) { setError(erros.join(' ')); return; }
		setBusy(true); setError(''); setSucesso('');
		const { error } = await supabase.from('mensageria_modelos_email').upsert({
			empresa_id: empresa.id,
			nome_remetente: nome.trim(),
			assunto: assunto.trim(),
			texto: texto.trim(),
		}, { onConflict: 'empresa_id' });
		setBusy(false);
		if (error) { setError(friendlyError(error)); return; }
		setSucesso('Modelo de e-mail salvo com sucesso.');
	}

	if (loading) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;

	const previaTexto = texto.replace(/\{empresa\}/g, empresa?.nome ?? '{empresa}');

	return (
		<div className="space-y-4">
			{!canEdit && (
				<div className="rounded-xl bg-[#F5F5F7] px-4 py-3 text-[14px] text-[#6E6E73]">Você está vendo o modelo em modo leitura. Para editar, peça ao Admin da sua empresa.</div>
			)}
			{error && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
			{sucesso && <div className="rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">{sucesso}</div>}

			<div className="grid gap-5 lg:grid-cols-2">
				{/* Formulário */}
				<div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<div className="space-y-4">
						<div>
							<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Nome do remetente *</label>
							<input value={nome} disabled={!canEdit} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Empresa de Cobrança" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93] focus-visible:ring-2 focus-visible:ring-[#0071E5]/40 disabled:bg-[#F5F5F7]" />
							<p className="mt-1 text-[12px] text-[#8E8E93]">2 a 60 caracteres.</p>
						</div>
						<div>
							<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Assunto *</label>
							<input value={assunto} disabled={!canEdit} onChange={(e) => setAssunto(e.target.value)} maxLength={120} placeholder="Atualização do seu contrato" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93] focus-visible:ring-2 focus-visible:ring-[#0071E5]/40 disabled:bg-[#F5F5F7]" />
							<p className="mt-1 text-[12px] text-[#8E8E93]">3 a 120 caracteres.</p>
						</div>
						<div>
							<div className="mb-1.5 flex items-center justify-between">
								<label className="text-[13px] font-semibold text-[#1D1D1F]">Texto *</label>
								<button onClick={inserirVariavel} disabled={!canEdit} className="rounded-full border border-[#D2D2D7] px-3 py-1 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">Inserir {'{empresa}'}</button>
							</div>
							<textarea ref={textoRef} value={texto} disabled={!canEdit} onChange={(e) => setTexto(e.target.value)} maxLength={5000} rows={10} placeholder="Prezado(a) cliente, o seu contrato com {empresa}..." className="w-full rounded-lg border border-[#D2D2D7] p-3 text-[14px] leading-relaxed text-[#1D1D1F] outline-none placeholder:text-[#8E8E93] focus-visible:ring-2 focus-visible:ring-[#0071E5]/40 disabled:bg-[#F5F5F7]" />
							<p className="mt-1 text-[12px] text-[#8E8E93]">10 a 5.000 caracteres. Variável permitida: {'{empresa}'}. Nunca use nome, CPF ou valor do cliente.</p>
						</div>
						{canEdit && (
							<div className="flex justify-end">
								<button onClick={salvar} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Salvando...' : 'Salvar modelo'}</button>
							</div>
						)}
					</div>
				</div>

				{/* Prévia */}
				<div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<p className="mb-3 text-[13px] font-semibold text-[#6E6E73]">Prévia</p>
					<div className="overflow-hidden rounded-xl border border-[#E5E5EA]">
						<div className="border-b border-[#E5E5EA] bg-[#F5F5F7] px-4 py-3">
							<p className="text-[12px] text-[#8E8E93]">De: <span className="text-[#1D1D1F]">{nome || '—'}</span></p>
							<p className="mt-0.5 text-[12px] text-[#8E8E93]">Assunto: <span className="text-[#1D1D1F]">{assunto || '—'}</span></p>
						</div>
						<div className="px-4 py-4">
							<p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#1D1D1F]">{previaTexto || 'A prévia do texto aparece aqui.'}</p>
						</div>
						<div className="border-t border-[#E5E5EA] bg-[#F5F5F7] px-4 py-3">
							<p className="text-[12px] text-[#6E6E73]">Para não receber mais estes e-mails, clique aqui.</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
