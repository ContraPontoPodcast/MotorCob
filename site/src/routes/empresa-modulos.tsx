import { redirect } from 'react-router';
// Módulos e integrações da empresa ficam em Empresa › Integrações.
export function clientLoader() { return redirect('/empresa/integracoes'); }
export default function EmpresaModulosRedirect() { return null; }
