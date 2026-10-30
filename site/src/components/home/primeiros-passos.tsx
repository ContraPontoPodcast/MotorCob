import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { supabase, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { CANAL_STORAGE_KEY } from '@/lib/mensageria-produtos';

type Passo = {
  ordem: number;
  passo: string;
  grupo: 'conta' | 'empresa' | 'cobranca' | 'jornada' | 'mensageria';
  titulo: string;
  feito: boolean;
  pulado: boolean;
  da_equipe: boolean;
};

const GRUPO_LABEL: Record<string, string> = {
  conta: 'Sua conta',
  empresa: 'Empresa',
  cobranca: 'Cobrança',
  jornada: 'Jornada do Cliente',
  mensageria: 'Mensageria',
};
const GRUPO_ORDEM = ['conta', 'empresa', 'cobranca', 'jornada', 'mensageria'];

/** Descrição e ação de cada passo. `to` é a rota do botão. */
const PASSO_INFO: Record<string, { descricao: string; acao?: string; to?: string }> = {
  conta: { descricao: 'Feito no convite.' },
  fatura: { descricao: 'Em Empresa › Contatos, marque Recebe faturas.', acao: 'Abrir contatos', to: '/empresa/contatos' },
  equipe: { descricao: 'Quem vai planejar, operar e acompanhar.', acao: 'Convidar membro', to: '/empresa/pessoas?aba=pessoas' },
  carga: { descricao: 'A carteira com os clientes e as dívidas, por arquivo ou pela API.', acao: 'Enviar carga', to: '/envios' },
  lista: { descricao: 'Sai às 6h da manhã seguinte à primeira carga.' },
  token: { descricao: 'Para o seu sistema mandar a carga sozinho.', acao: 'Criar token', to: '/empresa/integracoes' },
  carga_jornada: { descricao: 'Os clientes entram já em uma etapa da jornada.', acao: 'Enviar carga', to: '/jornada/cargas' },
  template: { descricao: 'O texto da mensagem, com variáveis como {{nome}}.' },
  recarga: { descricao: 'No pré-pago, cada envio desconta do saldo.', acao: 'Recarregar', to: '/empresa/faturamento' },
  teste: { descricao: 'Nada sai para os seus clientes.' },
  pedir: { descricao: 'Depois do teste, o Suporte confere e liga em até 1 hora.' },
  real: { descricao: 'Você recebe o aviso no sino quando estiver ligado.' },
};

function canalAtual(): string {
  try { const v = localStorage.getItem(CANAL_STORAGE_KEY); return v || 'sms'; } catch { return 'sms'; }
}

export function PrimeirosPassos() {
  const { empresa, perfil } = useMotorAuth();
  const [passos, setPassos] = useState<Passo[]>([]);
  const [oculto, setOculto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase || !empresa) { setPassos([]); setLoading(false); return; }
    let active = true;
    (async () => {
      // Lê o flag ocultar_primeiros_passos do perfil.
      const { data: pf } = await supabase.from('perfis').select('ocultar_primeiros_passos').eq('id', perfil?.id ?? '').maybeSingle();
      if (!active) return;
      setOculto(!!(pf as Row | null)?.ocultar_primeiros_passos);
      const { data, error } = await supabase.rpc('primeiros_passos', { empresa: empresa.id });
      if (!active) return;
      if (error) { setPassos([]); setLoading(false); return; }
      setPassos(((data ?? []) as Passo[]).sort((a, b) => a.ordem - b.ordem));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [empresa?.id, perfil?.id]);

  const todosFeitos = passos.length > 0 && passos.every(p => p.feito || p.pulado);
  const mostrar = !loading && !oculto && passos.length > 0 && !todosFeitos;

  // Primeiro passo não feito (não pulado).
  const proximoIdx = useMemo(() => passos.findIndex(p => !p.feito && !p.pulado), [passos]);
  const testeFeito = useMemo(() => passos.some(p => p.passo === 'teste' && p.feito), [passos]);

  const grupos = useMemo(() => {
    const map: Record<string, Passo[]> = {};
    passos.forEach(p => { (map[p.grupo] ??= []).push(p); });
    return GRUPO_ORDEM.filter(g => map[g]).map(g => ({ grupo: g, itens: map[g] }));
  }, [passos]);

  const contratado = grupos.map(g => GRUPO_LABEL[g.grupo]).join(' · ');

  async function ocultar() {
    if (!supabase || !perfil) return;
    setBusy(true);
    await supabase.rpc('ocultar_primeiros_passos', { valor: true });
    setBusy(false);
    setOculto(true);
  }

  async function pularEquipe() {
    if (!supabase || !empresa) return;
    setBusy(true);
    await supabase.rpc('pular_primeiro_passo', { empresa_id: empresa.id, passo: 'equipe' });
    setBusy(false);
    // Recarrega os passos.
    const { data } = await supabase.rpc('primeiros_passos', { empresa: empresa.id });
    setPassos(((data ?? []) as Passo[]).sort((a, b) => a.ordem - b.ordem));
  }

  if (!mostrar) return null;

  const feitos = passos.filter(p => p.feito || p.pulado).length;
  const total = passos.length;
  const pct = total > 0 ? Math.round((feitos / total) * 100) : 0;

  return (
    <section className="mb-6 rounded-2xl border border-[#E5E5EA] bg-white p-6 sm:p-8" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
      <div className="mb-1 flex items-center gap-2">
        <span className="mc-area-tag">Primeiros passos</span>
      </div>
      <h2 className="text-[20px] font-semibold text-[#1D1D1F]">Primeiros passos da {empresa?.nome ?? 'empresa'}</h2>
      {contratado && <p className="mt-1 text-[14px] text-[#6E6E73]">Contratado: {contratado}</p>}

      {/* Barra de progresso */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[13px]">
          <span className="font-medium text-[#1D1D1F]">{feitos} de {total} prontos</span>
          <span className="tnum text-[#8E8E93]">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#F5F5F7]">
          <div className="h-full rounded-full bg-[#34C759] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Passos agrupados */}
      <div className="mt-6 space-y-5">
        {grupos.map(g => (
          <div key={g.grupo}>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">{GRUPO_LABEL[g.grupo]}</p>
            <div className="space-y-1">
              {g.itens.map((p, idx) => {
                const info = PASSO_INFO[p.passo] ?? { descricao: p.titulo };
                const globalIdx = passos.indexOf(p);
                const isProximo = globalIdx === proximoIdx;
                const feito = p.feito || p.pulado;
                // Ação e destino por passo.
                let acao = info.acao;
                let to = info.to;
                if (p.passo === 'template') { acao = 'Criar template'; to = `/mensageria/${canalAtual()}/templates`; }
                if (p.passo === 'teste') { acao = 'Nova campanha'; to = `/mensageria/${canalAtual()}/campanhas/nova`; }
                if (p.passo === 'pedir') { acao = 'Pedir envio real'; to = `/mensageria/${canalAtual()}`; }
                return (
                  <div key={p.passo} className={`flex items-start gap-3 rounded-xl px-4 py-3 ${isProximo ? 'bg-[#F5F5F7]' : ''}`}>
                    {/* Círculo */}
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
                      feito ? 'bg-[#34C759] text-white' : p.da_equipe ? 'border-2 border-dashed border-[#D2D2D7]' : 'border-2 border-[#D2D2D7]'
                    }`}>
                      {feito && <Check size={12} />}
                    </span>
                    {/* Texto */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[14px] font-medium ${feito ? 'text-[#8E8E93] line-through' : 'text-[#1D1D1F]'}`}>{p.titulo}</span>
                        {isProximo && <span className="rounded-full bg-[#1D1D1F] px-2 py-0.5 text-[10px] font-semibold text-white">Próximo</span>}
                      </div>
                      <p className="mt-0.5 text-[13px] text-[#6E6E73]">{info.descricao}</p>
                    </div>
                    {/* Ação */}
                    <div className="flex shrink-0 items-center gap-2">
                      {p.passo === 'lista' && !feito && <span className="rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-medium text-[#8E8E93]">Depois da carga</span>}
                      {p.passo === 'pedir' && !feito && !testeFeito && <span className="rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-medium text-[#8E8E93]">Depois do teste</span>}
                      {p.passo === 'real' && !feito && <span className="rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-medium text-[#8E8E93]">Depois do pedido</span>}
                      {p.passo === 'conta' && !feito && <span className="rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-medium text-[#8E8E93]">No convite</span>}
                      {acao && to && !feito && (
                        <Link to={to} className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium ${
                          isProximo ? 'bg-[#1D1D1F] text-white hover:opacity-85' : 'border border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7]'
                        }`}>{acao}</Link>
                      )}
                      {p.passo === 'equipe' && !feito && perfil?.papel === 'admin' && (
                        <button onClick={() => void pularEquipe()} disabled={busy} className="text-[12px] font-medium text-[#8E8E93] hover:text-[#1D1D1F] hover:underline">Pular</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Rodapé */}
      <div className="mt-6 border-t border-[#F0F0F2] pt-4">
        <button onClick={() => void ocultar()} disabled={busy} className="text-[13px] font-medium text-[#8E8E93] hover:text-[#1D1D1F] hover:underline">Ocultar primeiros passos</button>
      </div>
    </section>
  );
}
