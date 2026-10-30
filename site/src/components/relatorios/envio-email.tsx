import { useEffect, useState } from 'react';
import { Mail, Trash2 } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { PainelEdicao } from '@/components/comuns/painel-edicao';
import { envioDescricao, type ModeloRelatorio, type EnvioRelatorio } from '@/lib/relatorios';

type Props = { modelo: ModeloRelatorio; onClose: () => void; onSaved: () => void };

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const PERIODO_EMAIL = [
	{ id: 'ontem', label: 'Ontem' },
	{ id: 'semana', label: 'Semana passada (segunda a domingo)' },
	{ id: 'mes', label: 'Mês passado' },
];

export function EnvioEmail({ modelo, onClose, onSaved }: Props) {
	const { empresa, perfil } = useMotorAuth();
	const ehSalvo = !!modelo.empresa_id;
	const [envio, setEnvio] = useState<EnvioRelatorio | null>(null);
	const [usuarios, setUsuarios] = useState<Row[]>([]);
	const [frequencia, setFrequencia] = useState<'dia' | 'semana' | 'mes'>('semana');
	const [diaSemana, setDiaSemana] = useState(1);
	const [diaMes, setDiaMes] = useState(1);
	const [hora, setHora] = useState(8);
	const [periodoEmail, setPeriodoEmail] = useState('semana');
	const [destinatarios, setDestinatarios] = useState<string[]>([]);
	const [soParaMim, setSoParaMim] = useState(false);
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [sucesso, setSucesso] = useState('');

	useEffect(() => {
		async function load() {
			if (!supabase || !empresa) return;
			const { data: ev } = await supabase.from('relatorio_envios').select('*').eq('modelo', modelo.id).maybeSingle();
			const e = ev as EnvioRelatorio | null;
			setEnvio(e);
			if (e) { setFrequencia(e.frequencia as 'dia' | 'semana' | 'mes'); setDiaSemana(e.dia_semana ?? 1); setDiaMes(e.dia_mes ?? 1); setHora(e.hora ?? 8); setDestinatarios(e.destinatarios ?? []); setSoParaMim((e.destinatarios ?? []).length === 1 && e.destinatarios[0] === perfil?.id); }
			// Usuários ativos da empresa (sem equipe).
			const { data: us } = await supabase.from('perfis').select('id,nome,email').eq('empresa_id', empresa.id).eq('ativo', true).eq('equipe', false).order('nome');
			setUsuarios((us ?? []) as Row[]);
		}
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [empresa?.id, modelo.id]);

	if (!ehSalvo) {
		return (
			<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={onClose}>
				<div className="w-full max-w-[440px] rounded-2xl bg-white p-6 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
					<Mail className="mx-auto mb-3 text-[#8E8E93]" size={28} />
					<h2 className="text-[17px] font-semibold text-[#1D1D1F]">Salve o relatório para agendar</h2>
					<p className="mt-2 text-[14px] text-[#6E6E73]">O envio por e-mail precisa de um relatório salvo da empresa.</p>
					<button onClick={onClose} className="mt-5 h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85">Entendi</button>
				</div>
			</div>
		);
	}

	async function salvar() {
		if (!supabase || !empresa) return;
		setBusy(true); setErro(''); setSucesso('');
		const dests = soParaMim ? [perfil?.id].filter(Boolean) as string[] : destinatarios;
		if (!soParaMim && dests.length === 0) { setBusy(false); setErro('Escolha ao menos um destinatário.'); return; }
		const { data, error } = await supabase.rpc('salvar_envio_relatorio', {
			modelo: modelo.id, frequencia, destinatarios: dests,
			dia_semana: frequencia === 'semana' ? diaSemana : null,
			dia_mes: frequencia === 'mes' ? diaMes : null, hora,
		});
		setBusy(false);
		if (error) { setErro(friendlyError(error)); return; }
		const prox = (data as Row | null)?.proximo_envio ?? (data as string | null);
		setSucesso(prox ? `Próximo envio: ${dateTimeBR(prox)}.` : 'Envio salvo.');
		onSaved();
	}

	async function parar() {
		if (!supabase) return;
		if (!confirm('Parar o envio por e-mail deste relatório?')) return;
		const { error } = await supabase.rpc('apagar_envio_relatorio', { modelo: modelo.id });
		if (error) { setErro(friendlyError(error)); return; }
		setEnvio(null); setSucesso('Envio parado.'); onSaved();
	}

	const resumo = envio ? (
		<div className="space-y-2">
			<p className="text-[14px] text-[#1D1D1F]"><strong>{envioDescricao(envio)}</strong></p>
			{envio.proximo_envio && <p className="text-[13px] text-[#6E6E73]">Próximo envio: {dateTimeBR(envio.proximo_envio)}</p>}
			<p className="text-[13px] text-[#6E6E73]">Para {soParaMim ? 'você' : `${destinatarios.length} destinatário(s)`}</p>
			{envio.ultimo_erro && <p className="rounded-lg bg-[#FFF3E8] px-3 py-2 text-[12px] text-[#9a631b]">Último erro: {envio.ultimo_erro}</p>}
			<button onClick={parar} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#FF3B30] hover:underline"><Trash2 size={13} /> Parar envio</button>
		</div>
	) : <p className="text-[14px] text-[#6E6E73]">Nenhum envio agendado.</p>;

	const form = (
		<div className="space-y-4">
			<div>
				<p className="mb-2 text-[13px] font-semibold text-[#6E6E73]">Quando enviar</p>
				<div className="flex flex-wrap gap-2">
					{(['dia', 'semana', 'mes'] as const).map(f => <button key={f} onClick={() => setFrequencia(f)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${frequencia === f ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F]'}`}>{f === 'dia' ? 'Todo dia' : f === 'semana' ? 'Toda semana' : 'Todo mês'}</button>)}
				</div>
				{frequencia === 'semana' && <select value={diaSemana} onChange={e => setDiaSemana(Number(e.target.value))} className="mt-2 h-9 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">{DIAS_SEMANA.map((d, i) => <option key={i} value={i}>{d}</option>)}</select>}
				{frequencia === 'mes' && <select value={diaMes} onChange={e => setDiaMes(Number(e.target.value))} className="mt-2 h-9 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">{Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>Dia {d}</option>)}</select>}
				<div className="mt-2 flex items-center gap-2">
					<span className="text-[13px] text-[#6E6E73]">Hora</span>
					<select value={hora} onChange={e => setHora(Number(e.target.value))} className="h-9 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">{Array.from({ length: 15 }, (_, i) => i + 6).map(h => <option key={h} value={h}>{h}h</option>)}</select>
				</div>
			</div>
			<div>
				<p className="mb-2 text-[13px] font-semibold text-[#6E6E73]">Período do e-mail</p>
				<select value={periodoEmail} onChange={e => setPeriodoEmail(e.target.value)} className="h-9 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">{PERIODO_EMAIL.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
			</div>
			<div>
				<label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={soParaMim} onChange={e => setSoParaMim(e.target.checked)} className="accent-[#0A60D0]" /> Só para mim</label>
				{!soParaMim && (
					<div className="mt-2 max-h-[200px] overflow-y-auto rounded-lg border border-[#E5E5EA] p-2">
						{usuarios.slice(0, 20).map(u => <label key={u.id} className="flex items-center gap-2 py-1 text-[14px]"><input type="checkbox" checked={destinatarios.includes(u.id)} onChange={e => setDestinatarios(prev => e.target.checked ? [...prev, u.id] : prev.filter(x => x !== u.id))} className="accent-[#0A60D0]" /> {u.nome}</label>)}
					</div>
				)}
			</div>
			<div className="rounded-xl bg-[#F5F5F7] p-3 text-[12px] text-[#8E8E93]">
				<p className="font-medium text-[#6E6E73]">Prévia do e-mail</p>
				<p className="mt-1">Assunto: {modelo.nome} · {PERIODO_EMAIL.find(p => p.id === periodoEmail)?.label}</p>
				<p>Os números do topo com a variação e “Abrir o relatório na plataforma”.</p>
				<p className="mt-1">O e-mail leva só os números do topo e o link; o arquivo não vai anexado. Quem sai da empresa deixa de receber.</p>
			</div>
		</div>
	);

	const revisao = (
		<div className="space-y-1 text-[14px] text-[#1D1D1F]">
			<p><strong>Quando:</strong> {frequencia === 'dia' ? 'Todo dia' : frequencia === 'semana' ? `Toda ${DIAS_SEMANA[diaSemana]}` : `Todo mês, dia ${diaMes}`} às {hora}h</p>
			<p><strong>Período:</strong> {PERIODO_EMAIL.find(p => p.id === periodoEmail)?.label}</p>
			<p><strong>Para:</strong> {soParaMim ? 'Só para mim' : `${destinatarios.length} destinatário(s)`}</p>
		</div>
	);

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
			<div className="my-auto w-full max-w-[520px]" onClick={e => e.stopPropagation()}>
				<PainelEdicao
					titulo="Enviar por e-mail"
					podeEditar
					motivoBloqueio=""
					resumo={resumo}
					form={form}
					revisao={revisao}
					podeRevisar={soParaMim || destinatarios.length > 0}
					podeSalvar={soParaMim || destinatarios.length > 0}
					salvando={busy}
					erro={erro}
					sucesso={sucesso}
					onSalvar={salvar}
				/>
				<div className="mt-3 text-center"><button onClick={onClose} className="text-[13px] font-medium text-[#0A60D0] hover:underline">Fechar</button></div>
			</div>
		</div>
	);
}
