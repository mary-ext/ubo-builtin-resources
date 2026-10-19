#!/usr/bin/env node
// Prints a markdown summary of what changed between two scriptlets.json files.
// Used for release notes and the job summary.
//
// usage: node scripts/diff.mjs <old scriptlets.json | -> <new scriptlets.json>

import { existsSync, readFileSync } from 'node:fs';

const [oldPath, newPath] = process.argv.slice(2);
if (!newPath) {
	console.error('usage: diff.mjs <old|-> <new>');
	process.exit(2);
}

const load = (p) => {
	if (!p || p === '-' || !existsSync(p)) {
		return new Map();
	}
	const list = JSON.parse(readFileSync(p, 'utf8'));
	return new Map(list.map((r) => [r.name, r]));
};

const before = load(oldPath);
const after = load(newPath);

const added = [...after.keys()].filter((n) => !before.has(n));
const removed = [...before.keys()].filter((n) => !after.has(n));
const changed = [];

for (const [name, next] of after) {
	const prev = before.get(name);
	if (!prev) {
		continue;
	}
	const what = [];
	if (prev.code !== next.code) what.push('code');
	if (JSON.stringify(prev.aliases) !== JSON.stringify(next.aliases)) what.push('aliases');
	if (JSON.stringify(prev.dependencies) !== JSON.stringify(next.dependencies)) what.push('dependencies');
	if (prev.world !== next.world) what.push(`world ${prev.world} → ${next.world}`);
	if (prev.requiresTrust !== next.requiresTrust) what.push(`requiresTrust ${prev.requiresTrust} → ${next.requiresTrust}`);
	if (prev.priority !== next.priority) what.push(`priority ${prev.priority} → ${next.priority}`);
	if (what.length > 0) {
		changed.push(`\`${name}\` (${what.join(', ')})`);
	}
}

const section = (title, items) => (items.length > 0 ? `### ${title}\n\n${items.map((i) => `- ${i}`).join('\n')}\n\n` : '');

let out = '';
if (before.size === 0) {
	out += `initial extraction, ${after.size} scriptlets\n\n`;
} else if (added.length + removed.length + changed.length === 0) {
	out += 'no scriptlet changes\n\n';
} else {
	out += section('added', added.map((n) => `\`${n}\``));
	out += section('removed', removed.map((n) => `\`${n}\``));
	out += section('changed', changed);
}

process.stdout.write(out);
