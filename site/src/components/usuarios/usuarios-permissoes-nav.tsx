import { NavLink } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { PERM } from '@/lib/permissoes';

/** Segmentado "Usuários · Permissões" no topo de /usuarios e /permissoes. */
export function UsuariosPermissoesNav() {
	const { permissoes } = useMotorAuth();
	const base = 'flex h-9 items-center px-4 text-[13px] font-medium transition-colors rounded-[7px]';
	const cls = (active: boolean) => active ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73] hover:text-[#1D1D1F]';
	return (
		<nav className="mb-5 inline-flex rounded-[10px] bg-[#F5F5F7] p-1" aria-label="Usuários e permissões">
			{permissoes.includes(PERM.gerenciarUsuarios) && (
				<NavLink to="/usuarios" end className={({ isActive }) => `${base} ${cls(isActive)}`}>Usuários</NavLink>
			)}
			{permissoes.includes(PERM.gerenciarPermissoes) && (
				<NavLink to="/permissoes" end className={({ isActive }) => `${base} ${cls(isActive)}`}>Permissões</NavLink>
			)}
		</nav>
	);
}
