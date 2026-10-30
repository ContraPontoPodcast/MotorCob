import { Link, useSearchParams } from 'react-router';
import { EmpresaShell } from './empresa-shell';
import { PessoasLista } from './pessoas-lista';
import { PerfisMatrix } from './perfis-matrix';

export function PessoasPerfisPage() {
  const [params] = useSearchParams();
  const aba = params.get('aba') === 'perfis' ? 'perfis' : 'pessoas';

  return (
    <EmpresaShell>
      <div className="no-scrollbar mb-5 flex items-center gap-1 overflow-x-auto rounded-[12px] bg-[#F5F5F7] p-1">
        <Link
          to="/empresa/pessoas?aba=pessoas"
          className={`shrink-0 rounded-[9px] px-3 py-1.5 text-[15px] font-medium transition-colors ${aba === 'pessoas' ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}
        >
          Pessoas
        </Link>
        <Link
          to="/empresa/pessoas?aba=perfis"
          className={`shrink-0 rounded-[9px] px-3 py-1.5 text-[15px] font-medium transition-colors ${aba === 'perfis' ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}
        >
          Perfis
        </Link>
      </div>
      {aba === 'perfis' ? <PerfisMatrix /> : <PessoasLista />}
    </EmpresaShell>
  );
}
