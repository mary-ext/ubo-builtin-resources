export interface Manifest {
	source: 'https://github.com/gorhill/uBlock';
	/** uBO release tag; null if not extracted from a tag */
	tag: string | null;
	/** uBO commit SHA; null if git metadata is unavailable */
	commit: string | null;
	/** ISO 8601 */
	commitDate: string | null;
	/** ISO 8601 */
	generatedAt: string;
	scriptlets: Scriptlet[];
	resources: Resource[];
}

export interface Scriptlet {
	/** canonical name */
	name: string;
	path: string;
	injectable: boolean;
	/** declared function's identifier */
	functionName: string;
	aliases: string[];
	/** canonical scriptlet names */
	dependencies: string[];
	world: 'MAIN' | 'ISOLATED';
	requiresTrust: boolean;
	priority?: number;
}

export interface Resource {
	/** canonical name */
	name: string;
	path: string;
	injectable: boolean;
	/** from the extension; null for `empty`, which takes the request's type */
	mime: string | null;
	aliases: string[];
	/** usable as a data: URI redirect */
	inline: boolean;
	requiresTrust: boolean;
}
