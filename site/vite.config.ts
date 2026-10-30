import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	server: {
		port: 3000,
		fs: {
			strict: true,
			allow: [__dirname],
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
		extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
	},
	plugins: [reactRouter()],
});
