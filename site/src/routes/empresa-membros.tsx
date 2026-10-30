import { redirect } from 'react-router';
export function clientLoader() { return redirect('/empresa/pessoas?aba=pessoas'); }
export default function EmpresaMembrosRedirect() { return null; }
