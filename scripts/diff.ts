#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import type { Manifest, Resource, Scriptlet } from './manifest.ts';

interface AsarNode {
	files?: Record<string, AsarNode>;
	offset?: string;
	size?: number;
	integrity?: { hash?: string };
}

interface Archive {
	manifest: Manifest;
	hashOf: (filePath: string) => string;
}

const readArchive = (p: string): Archive => {
	const buf = readFileSync(p);
	// Chromium Pickle framing: [4][header pickle size][payload size][JSON length][JSON]
	const headerSize = buf.readUInt32LE(4);
	const header: AsarNode = JSON.parse(buf.toString('utf8', 16, 16 + buf.readUInt32LE(12)));
	const lookup = (filePath: string): AsarNode => {
		let node: AsarNode | undefined = header;
		for (const part of filePath.split('/')) {
			node = node?.files?.[part];
		}
		if (node?.offset === undefined) {
			throw new Error(`${p}: ${filePath} not found`);
		}
		return node;
	};
	const { offset, size = 0 } = lookup('manifest.v1.json');
	const start = 8 + headerSize + Number(offset);
	const manifest: Manifest = JSON.parse(buf.toString('utf8', start, start + size));
	const hashOf = (filePath: string): string => {
		const hash = lookup(filePath).integrity?.hash;
		if (hash === undefined) {
			throw new Error(`${p}: ${filePath} has no integrity hash`);
		}
		return hash;
	};
	return { manifest, hashOf };
};

type Entry = Scriptlet | Resource;

const describe = (prev: Entry, next: Entry): string[] => {
	const before: Record<string, unknown> = { ...prev };
	const after: Record<string, unknown> = { ...next };
	const what: string[] = [];
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (key === 'name' || isDeepStrictEqual(before[key], after[key])) {
			continue;
		}
		if (Array.isArray(before[key]) || Array.isArray(after[key])) {
			what.push(key);
		} else {
			what.push(`${key} ${String(before[key])} → ${String(after[key])}`);
		}
	}
	return what;
};

const section = (title: string, items: string[]): string =>
	items.length > 0 ? `#### ${title}\n\n${items.map((i) => `- ${i}`).join('\n')}\n\n` : '';

const compare = (kind: 'scriptlets' | 'resources', prev: Archive, next: Archive): string => {
	const before = new Map<string, Entry>(prev.manifest[kind].map((r) => [r.name, r]));
	const after = new Map<string, Entry>(next.manifest[kind].map((r) => [r.name, r]));
	const added = [...after.keys()].filter((n) => !before.has(n)).map((n) => `\`${n}\``);
	const removed = [...before.keys()].filter((n) => !after.has(n)).map((n) => `\`${n}\``);
	const changed: string[] = [];
	for (const [name, entry] of after) {
		const old = before.get(name);
		if (!old) {
			continue;
		}
		const what = describe(old, entry);
		if (prev.hashOf(old.path) !== next.hashOf(entry.path)) {
			what.unshift('content');
		}
		if (what.length > 0) {
			changed.push(`\`${name}\` (${what.join(', ')})`);
		}
	}
	if (added.length + removed.length + changed.length === 0) {
		return '';
	}
	return (
		`### ${kind}\n\n` + section('added', added) + section('removed', removed) + section('changed', changed)
	);
};

const [oldPath, newPath] = process.argv.slice(2);
if (oldPath === undefined || newPath === undefined) {
	console.error('usage: diff.ts <old builtins.asar | -> <new builtins.asar>');
	process.exit(2);
}

try {
	const next = readArchive(newPath);
	let out: string;
	if (oldPath === '-' || !existsSync(oldPath)) {
		const { scriptlets, resources } = next.manifest;
		out = `initial extraction, ${scriptlets.length} scriptlets and ${resources.length} resources\n\n`;
	} else {
		const prev = readArchive(oldPath);
		out = compare('scriptlets', prev, next) + compare('resources', prev, next);
	}
	process.stdout.write(out === '' ? 'no changes\n\n' : out);
	process.exitCode = out === '' ? 0 : 1;
} catch (err) {
	console.error(err);
	process.exitCode = 2;
}
