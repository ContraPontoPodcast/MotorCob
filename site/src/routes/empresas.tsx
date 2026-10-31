import { redirect } from 'react-router';
// A lista de empresas da equipe é o Console › Empresas.
export function clientLoader() { return redirect('/console'); }
export default function EmpresasRedirect() { return null; }
