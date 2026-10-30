import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check, Clock, AlertTriangle } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';

type Pedido = { situacao: string; pedido_em: string; motivo: string | null };

/** Pré-requisitos do envio real (passos de primeiros_passos). */
const PRE_REQ = ['fatura', 'template', 'teste', 'recarga'];
const PRE_REQ_LABEL: Record<string, string> = {
  fatura: 'Contato que recebe faturas',
  template: 'Template de mensagem',
  teste: 'Campanha de teste',
  recarga: 'Saldo / recarga',
};

export function FaixaEnvioReal() {
  const { empresa, permissoes } = useMotorAuth();
  const canAct = permissoes.includes('enviar_mensagens');
  const [modo, setModo] = useState<'simulado' | 'real' | null>(null);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [preReqs, setPreReqs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [confirma, setConfirma] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!supabase || !empresa) { setModo(null); setLoading(false); return; }
    let active = true;
    (async () => {
      // Modo (simulado/real) e último pedido de envio real.
      const [cfg, ped] = await Promise.all([
        supabase.from('mensageria_config').select('modo').eq('empresa_id', empresa.id).maybeSingle(),
        supabase.from('pedidos_envio_real').select('situacao,pedido_em,motivo').eq('empresa_id', empresa.id).order('pedido_em', { ascending: false }).limit(1),
      ]);
      if (!active) return;
      setModo((cfg.data as Row | null)?.modo === 'real' ? 'real' : 'simulado');
      const pedRow = (ped.data ?? []) as Pedido[];
      setPedido(pedRow[0] ?? null);
      // Pré-requisitos via primeiros_passos.
      const { data: pp } = await supabase.rpc('primeiros_passos', { empresa: empresa.id });
      if (!active) return;
      const map: Record<string, boolean> = {};
      ((pp ?? []) as Row[]).forEach(r => { if (PRE_REQ.includes(String(r.passo))) map[String(r.passo)] = !!r.feito; });
      setPreReqs(map);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [empresa?.id]);

  async function pedir() {
    if (!supabase || !empresa) return;
    setBusy(true); setErro('');
    const { error } = await supabase.rpc('pedir_envio_real', { empresa_id: empresa.id });
    setBusy(false);
    if (error) { setErro(String(error.message ?? friendlyError(error))); return; }
    setConfirma(false);
    // Recarrega o pedido.
    const { data } = await supabase.from('pedidos_envio_real').select('situacao,pedido_em,motivo').eq('empresa_id', empresa.id).order('pedido_em', { ascending: false }).limit(1);
    setPedido((data ?? [])[0] as Pedido | null);
  }

  if (loading || !modo) return null;

  const faltaPreReq = PRE_REQ.filter(k => preReqs[k] === false);
  const prontoParaPedir = faltaPreReq.length === 0;
  const pedidoAberto = pedido && pedido.situacao === 'aberto';
  const pedidoRecusado = pedido && pedido.situacao === 'recusado';

  // modo real: faixa verde (some depois de 7 dias, mas mantemos enquanto real).
  if (modo === 'real' && !pedidoAberto && !pedidoRecusado) {
    return (
      <div className="mb-5 flex items-center gap-3 rounded-2xl bg-[#E8F8EC] px-5 py-4" style={{ boxShadow: '0 0 0 1px #34C75933' }}>
        <Check size={18} className="shrink-0 text-[#248A3D]" />
        <p className="flex-1 text-[14px] text-[#248A3D]"><strong>Envio real ligado.</strong> As mensagens saem de verdade e entram na fatura.</p>
      </div>
    );
  }

  // Pedido aberto: faixa neutra.
  if (pedidoAberto) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-[#F5F5F7] px-5 py-4" style={{ boxShadow: '0 0 0 1px #E5E5EA' }}>
        <Clock size={18} className="shrink-0 text-[#8E8E93]" />
        <p className="flex-1 text-[14px] text-[#1D1D1F]">Envio real pedido em {dateTimeBR(pedido!.pedido_em)}. O Suporte responde em até 1 hora; o aviso chega no sino.</p>
        <span className="rounded-full bg-[#FFF3E8] px-2.5 py-1 text-[12px] font-semibold text-[#9a631b]">Com o Suporte</span>
      </div>
    );
  }

  // Pedido recusado: faixa âmbar + pedir de novo.
  if (pedidoRecusado) {
    return (
      <>
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-[#FFF7E8] px-5 py-4" style={{ boxShadow: '0 0 0 1px #FF950033' }}>
          <AlertTriangle size={18} className="shrink-0 text-[#9a631b]" />
          <p className="flex-1 text-[14px] text-[#9a631b]">O Suporte ainda não ligou o envio real{pedido!.motivo ? `: ${pedido!.motivo}` : ''}.</p>
          {canAct && <button onClick={() => setConfirma(true)} className="rounded-full bg-[#1D1D1F] px-4 py-2 text-[13px] font-medium text-white hover:opacity-85">Pedir de novo</button>}
        </div>
        <CartaoOQueMuda />
        <ConfirmaAcao
          aberto={confirma}
          titulo="Pedir envio real"
          texto={`Pedir ao Suporte para ligar o envio real da ${empresa?.nome ?? 'empresa'}? Depois de ligado, as mensagens saem de verdade e entram na fatura.`}
          botao="Pedir envio real"
          onConfirm={() => void pedir()}
          onClose={() => setConfirma(false)}
          loading={busy}
        />
      </>
    );
  }

  // modo simulado: falta pré-requisito OU pronto para pedir.
  return (
    <>
      {prontoParaPedir ? (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-[#E8F8EC] px-5 py-4" style={{ boxShadow: '0 0 0 1px #34C75933' }}>
          <Check size={18} className="shrink-0 text-[#248A3D]" />
          <p className="flex-1 text-[14px] text-[#248A3D]">Tudo pronto para pedir o envio real.</p>
          {canAct
            ? <button onClick={() => setConfirma(true)} className="rounded-full bg-[#1D1D1F] px-4 py-2 text-[13px] font-medium text-white hover:opacity-85">Pedir envio real</button>
            : <span className="text-[13px] text-[#6E6E73]">Só quem pode enviar mensagens pede o envio real</span>}
        </div>
      ) : (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-[#FFF7E8] px-5 py-4" style={{ boxShadow: '0 0 0 1px #FF950033' }}>
          <AlertTriangle size={18} className="shrink-0 text-[#9a631b]" />
          <p className="flex-1 text-[14px] text-[#9a631b]">Simulação: nada sai para os seus clientes. Falta {faltaPreReq.length} passo(s) para pedir o envio real.</p>
          <button disabled className="cursor-not-allowed rounded-full bg-[#1D1D1F]/30 px-4 py-2 text-[13px] font-medium text-white">Pedir envio real</button>
        </div>
      )}

      {/* Cartão "Antes de pedir o envio real" com pré-requisitos */}
      {!prontoParaPedir && (
        <div className="mb-5 rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
          <h3 className="mb-3 text-[15px] font-semibold text-[#1D1D1F]">Antes de pedir o envio real</h3>
          <ul className="space-y-2">
            {PRE_REQ.map(k => {
              const feito = preReqs[k] === true;
              const info = PASSO_INFO_TO[k];
              return (
                <li key={k} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[14px] text-[#1D1D1F]">
                    {feito ? <Check size={15} className="text-[#34C759]" /> : <span className="h-[15px] w-[15px] rounded-full border-2 border-[#D2D2D7]" />}
                    {PRE_REQ_LABEL[k]}
                  </span>
                  {!feito && info?.to && <Link to={info.to} className="text-[13px] font-medium text-[#0A60D0] hover:underline">Fazer agora</Link>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <CartaoOQueMuda />

      {erro && <p className="mb-5 text-[14px] text-[#FF3B30]">{erro}</p>}

      <ConfirmaAcao
        aberto={confirma}
        titulo="Pedir envio real"
        texto={`Pedir ao Suporte para ligar o envio real da ${empresa?.nome ?? 'empresa'}? Depois de ligado, as mensagens saem de verdade e entram na fatura.`}
        botao="Pedir envio real"
        onConfirm={() => void pedir()}
        onClose={() => setConfirma(false)}
        loading={busy}
      />
    </>
  );
}

const PASSO_INFO_TO: Record<string, { to: string }> = {
  fatura: { to: '/empresa/contatos' },
  template: { to: '/mensageria/sms/templates' },
  teste: { to: '/mensageria/sms/campanhas/nova' },
  recarga: { to: '/empresa/faturamento' },
};

function CartaoOQueMuda() {
  return (
    <div className="mb-5 rounded-2xl bg-[#F5F5F7] px-5 py-4">
      <h3 className="text-[14px] font-semibold text-[#1D1D1F]">O que muda no envio real</h3>
      <p className="mt-1 text-[13px] text-[#6E6E73]">O Suporte da MotorCX responde em até 1 hora.</p>
    </div>
  );
}
