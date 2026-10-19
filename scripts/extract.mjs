#!/usr/bin/env node
// Extracts uBlock Origin's builtin scriptlets into a JSON file, the same way
// Brave's crx-packager does (import scriptlets.js, stringify each fn), but
// keeping uBO's `world`, `requiresTrust` and `priority` metadata.
//
// usage: node scripts/extract.mjs --ubo <uBlock checkout> --out <dir>

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const { values: args } = parseArgs({
	options: {
		ubo: { type: 'string', default: '.ubo' },
		out: { type: 'string', default: 'dist' },
	},
});

const uboRoot = path.resolve(args.ubo);
const scriptletsPath = path.join(uboRoot, 'src/js/resources/scriptlets.js');

if (!existsSync(scriptletsPath)) {
	throw new Error(`${scriptletsPath} not found, did uBO move its scriptlets?`);
}

const { builtinScriptlets } = await import(pathToFileURL(scriptletsPath).href);

if (!Array.isArray(builtinScriptlets) || builtinScriptlets.length === 0) {
	throw new Error(`builtinScriptlets export is missing or empty`);
}

// sanity checks, so a broken upstream state fails the job instead of shipping
const errors = [];
const names = new Set();
const aliases = new Map();

for (const s of builtinScriptlets) {
	if (typeof s.name !== 'string' || s.name === '') {
		errors.push(`scriptlet without a name: ${JSON.stringify(s)}`);
		continue;
	}
	if (typeof s.fn !== 'function') {
		errors.push(`${s.name}: fn is not a function`);
	}
	if (names.has(s.name)) {
		errors.push(`${s.name}: duplicate name`);
	}
	names.add(s.name);
}

for (const s of builtinScriptlets) {
	for (const dep of s.dependencies ?? []) {
		if (typeof dep !== 'string') {
			errors.push(`${s.name}: unresolved dependency ${String(dep)}`);
		} else if (!names.has(dep)) {
			errors.push(`${s.name}: missing dependency ${dep}`);
		}
	}
	for (const alias of s.aliases ?? []) {
		if (names.has(alias) || aliases.has(alias)) {
			errors.push(`${s.name}: alias ${alias} collides with ${aliases.get(alias) ?? alias}`);
		}
		aliases.set(alias, s.name);
	}
}

if (errors.length > 0) {
	throw new Error(`invalid scriptlets:\n  ${errors.join('\n  ')}`);
}

const resources = builtinScriptlets.map((s) => {
	const resource = {
		name: s.name,
		aliases: s.aliases ?? [],
		dependencies: s.dependencies ?? [],
		world: s.world ?? 'MAIN',
		requiresTrust: s.requiresTrust === true,
	};
	if (s.priority !== undefined) {
		resource.priority = s.priority;
	}
	// the function's source, exactly what uBO itself stringifies at injection time
	resource.code = s.fn.toString();
	return resource;
});

const json = JSON.stringify(resources);
const sha256 = createHash('sha256').update(json).digest('hex');

const git = (...argv) => execFileSync('git', ['-C', uboRoot, ...argv], { encoding: 'utf8' }).trim();
let commit = null;
let commitDate = null;
try {
	commit = git('rev-parse', 'HEAD');
	commitDate = git('show', '-s', '--format=%cI', 'HEAD');
} catch {
	// not a git checkout, leave it null
}

const manifest = {
	source: 'https://github.com/gorhill/uBlock',
	commit,
	commitDate,
	generatedAt: new Date().toISOString(),
	count: resources.length,
	sha256,
};

await mkdir(args.out, { recursive: true });
await writeFile(path.join(args.out, 'scriptlets.json'), json);
await writeFile(path.join(args.out, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');

console.log(`extracted ${resources.length} scriptlets from ${commit ?? uboRoot}`);
console.log(`sha256 ${sha256}`);
