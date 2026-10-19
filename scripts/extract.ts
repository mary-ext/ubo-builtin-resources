#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import * as v from 'valibot';

import type { Manifest, Resource, Scriptlet } from './manifest.ts';

const { values: args } = parseArgs({
	options: {
		ubo: { type: 'string', default: '.ubo' },
		out: { type: 'string', default: 'dist' },
	},
});

const uboRoot = path.resolve(args.ubo);
const outDir = path.resolve(args.out);
const scriptletsPath = path.join(uboRoot, 'src/js/resources/scriptlets.js');
const redirectResourcesPath = path.join(uboRoot, 'src/js/redirect-resources.js');
const warDir = path.join(uboRoot, 'src/web_accessible_resources');

for (const p of [scriptletsPath, redirectResourcesPath, warDir]) {
	if (!existsSync(p)) {
		throw new Error(`${p} not found`);
	}
}

const SAFE_NAME = /^[\w.-]+$/;

// strict objects reject unknown properties to catch upstream format changes
const UpstreamScriptlet = v.strictObject({
	name: v.pipe(
		v.string(),
		v.regex(SAFE_NAME),
		v.regex(/\.(?:js|fn)$/, 'expected a .js scriptlet or .fn helper name'),
	),
	fn: v.pipe(
		v.function(),
		v.check(
			(fn) => /^[A-Za-z_$][\w$]*$/.test(fn.name),
			(issue) => `expected a function named with a valid identifier, got ${JSON.stringify(issue.input.name)}`,
		),
	),
	aliases: v.optional(v.array(v.string()), []),
	dependencies: v.optional(v.array(v.string()), []),
	world: v.optional(v.picklist(['MAIN', 'ISOLATED']), 'MAIN'),
	requiresTrust: v.optional(v.boolean(), false),
	priority: v.optional(v.number()),
});

const UpstreamResource = v.strictObject({
	alias: v.optional(
		v.pipe(
			v.union([v.string(), v.array(v.string())]),
			v.transform((alias) => (typeof alias === 'string' ? [alias] : alias)),
		),
		[],
	),
	data: v.optional(v.string()),
	// only set on click2load.html, which is skipped
	params: v.optional(v.array(v.string())),
	requiresTrust: v.optional(v.boolean(), false),
});

const importModule = async <TSchema extends v.GenericSchema>(
	file: string,
	schema: TSchema,
): Promise<v.InferOutput<TSchema>> => {
	const result = v.safeParse(schema, await import(pathToFileURL(file).href));
	if (!result.success) {
		throw new Error(`unexpected exports in ${file}:\n${v.summarize(result.issues)}`);
	}
	return result.output;
};

const [{ builtinScriptlets }, { default: redirectResources }] = await Promise.all([
	importModule(
		scriptletsPath,
		v.object({ builtinScriptlets: v.pipe(v.array(UpstreamScriptlet), v.nonEmpty()) }),
	),
	importModule(
		redirectResourcesPath,
		v.object({
			default: v.pipe(v.map(v.pipe(v.string(), v.regex(SAFE_NAME)), UpstreamResource), v.minSize(1)),
		}),
	),
]);

// copy of uBO's extToMimeMap (redirect-engine.js), which is not exported
const extToMime = new Map([
	['css', 'text/css'],
	['gif', 'image/gif'],
	['html', 'text/html'],
	['js', 'text/javascript'],
	['json', 'application/json'],
	['mp3', 'audio/mp3'],
	['mp4', 'video/mp4'],
	['png', 'image/png'],
	['txt', 'text/plain'],
	['xml', 'text/xml'],
]);

const SKIPPED_RESOURCES = new Set(['click2load.html']);

const errors: string[] = [];

/** output path → file contents */
const sources = new Map<string, string>();
/** output path → source path */
const copies = new Map<string, string>();
const scriptlets: Scriptlet[] = [];
const resources: Resource[] = [];

for (const s of builtinScriptlets) {
	const suffix = s.name.slice(-2);
	const entry: Scriptlet = {
		name: s.name,
		path: `scriptlets/${s.name.slice(0, -3)}-${suffix}.js`,
		injectable: suffix === 'js',
		functionName: s.fn.name,
		aliases: s.aliases,
		dependencies: s.dependencies,
		world: s.world,
		requiresTrust: s.requiresTrust,
		priority: s.priority,
	};
	sources.set(entry.path, s.fn.toString());
	scriptlets.push(entry);
}

for (const [name, details] of redirectResources) {
	if (SKIPPED_RESOURCES.has(name)) {
		continue;
	}
	if (details.params !== undefined) {
		errors.push(`${name}: unknown property params`);
		continue;
	}
	const ext = path.extname(name).slice(1);
	const mime = ext === '' ? null : extToMime.get(ext);
	if (mime === undefined) {
		errors.push(`${name}: unknown extension .${ext}`);
		continue;
	}
	const inline = details.data !== undefined;
	const entry: Resource = {
		name,
		path: `resources/${name}`,
		injectable: inline && name.endsWith('.js'),
		mime,
		aliases: details.alias,
		inline,
		requiresTrust: details.requiresTrust,
	};
	copies.set(entry.path, path.join(warDir, name));
	resources.push(entry);
}

// uBO keeps scriptlets and resources in one namespace, aliases included
const names = new Map<string, string>();
for (const r of [...scriptlets, ...resources]) {
	for (const n of [r.name, ...r.aliases]) {
		if (names.has(n)) {
			errors.push(`${r.name}: ${n} collides with ${names.get(n)}`);
		}
		names.set(n, r.name);
	}
}

const functionNames = new Map<string, string>();
const scriptletNames = new Set(scriptlets.map((s) => s.name));
for (const s of scriptlets) {
	if (functionNames.has(s.functionName)) {
		errors.push(
			`${s.name}: function name ${s.functionName} collides with ${functionNames.get(s.functionName)}`,
		);
	}
	functionNames.set(s.functionName, s.name);
	for (const dep of s.dependencies) {
		if (!scriptletNames.has(dep)) {
			errors.push(`${s.name}: missing dependency ${dep}`);
		}
	}
}

if (errors.length > 0) {
	throw new Error(`invalid builtins:\n  ${errors.join('\n  ')}`);
}

const git = (...argv: string[]): string =>
	execFileSync('git', ['-C', uboRoot, ...argv], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	}).trim();

let commit: string | null = null;
let commitDate: string | null = null;
let tag: string | null = null;
try {
	commit = git('rev-parse', 'HEAD');
	commitDate = git('show', '-s', '--format=%cI', 'HEAD');
} catch {
	// commit metadata is optional for checkouts without .git
}
try {
	tag = git('describe', '--tags', '--exact-match', 'HEAD');
} catch {
	// HEAD is not a tagged commit
}

const manifest: Manifest = {
	source: 'https://github.com/gorhill/uBlock',
	tag,
	commit,
	commitDate,
	generatedAt: new Date().toISOString(),
	scriptlets,
	resources,
};

await mkdir(outDir, { recursive: true });
await Promise.all(
	['manifest.v1.json', 'scriptlets', 'resources'].map((p) =>
		rm(path.join(outDir, p), { recursive: true, force: true }),
	),
);
await Promise.all([mkdir(path.join(outDir, 'scriptlets')), mkdir(path.join(outDir, 'resources'))]);
await Promise.all([
	...Array.from(sources, ([p, content]) => writeFile(path.join(outDir, p), content)),
	...Array.from(copies, ([p, src]) => copyFile(src, path.join(outDir, p))),
	writeFile(path.join(outDir, 'manifest.v1.json'), JSON.stringify(manifest, null, '\t') + '\n'),
]);

console.log(
	`extracted ${scriptlets.length} scriptlets and ${resources.length} resources from ${tag ?? commit ?? uboRoot}`,
);
