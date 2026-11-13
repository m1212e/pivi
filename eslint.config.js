import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Regenerated from the GraphQL schema (see src/api/handlers/register.ts).
	{ ignores: ['src/lib/api/rumbleClient/**'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			'require-await': 'error'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	// The app boundary. sdk/ is the whole contract between pivi and its apps, so
	// it may import nothing of the host's; apps get only sdk/ (their image builds
	// contain nothing else, see apps/youtube/Dockerfile).
	{
		files: ['sdk/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							// A regex, since a leading `#` is a comment in `group`'s gitignore syntax.
							regex: '^(#lib|#api|#sdk|\\$lib|\\$app)/|^\\.\\./',
							message: 'sdk/ is the app contract and must not depend on host code.'
						}
					]
				}
			]
		}
	},
	{
		files: ['apps/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							regex: '^(#lib|#api|#sdk|\\$lib|\\$app)/|/src/',
							message: 'Apps may only use the SDK, by relative import of ../../sdk.'
						}
					]
				}
			]
		}
	}
);
