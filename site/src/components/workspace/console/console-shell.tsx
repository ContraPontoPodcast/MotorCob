import { type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { useConsolePerms, PAPEL_LABEL } from './console-perms';

function dateExtensa() {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  } catch { return ''; }
}

export function ConsoleShell({ children, naoResolvidos }: { children: ReactNode; naoResolvidos?: number }) {
  const { perfil } = useMotorAuth();
  const { eu } = useConsolePerms();
  if (!perfil?.equipe) return <Navigate to="/workspace" replace />;

  const funcao = eu?.funcao ?? (perfil.papel === 'admin' ? 'master' : 'atendimento');
  const isMaster = funcao === 'master';
  const roleLabel = PAPEL_LABEL[funcao] ?? funcao;
  const alcanceCarteira = eu?.alcance === 'carteira' || (!isMaster && eu && eu.alcance !== 'todas');
  const carteiraN = eu?.carteira ?? 0;

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-[clamp(16px,3vw,40px)]">
      <div className="mb-4">
        <p className="text-[14px] text-[#6E6E73]">
          {roleLabel}
          {alcanceCarteira && <span className="ml-2">· Só a carteira · {carteiraN} {carteiraN === 1 ? 'empresa' : 'empresas'}</span>}
          {naoResolvidos != null && naoResolvidos > 0 && <span className="ml-2 rounded-full bg-[#FF3B30] px-1.5 py-0.5 text-[10px] font-bold text-white tnum">{naoResolvidos}</span>}
          <span className="ml-2">· {dateExtensa()}</span>
        </p>
      </div>
      {children}
    </div>
  );
}

export const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';
