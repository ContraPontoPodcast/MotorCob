import type { Config } from '@react-router/dev/config';

// Site estático (Netlify): modo SPA. O index.html é pré-renderizado no build e o
// resto roda no navegador. Saída em build/client.
export default {
	appDirectory: 'src',
	buildDirectory: 'build',
	ssr: false,
} satisfies Config;
