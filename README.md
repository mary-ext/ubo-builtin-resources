# ubo-builtin-resources

uBlock Origin's builtin scriptlets and redirect resources.

```
https://github.com/mary-ext/ubo-builtin-resources/releases/latest/download/builtins.asar
https://github.com/mary-ext/ubo-builtin-resources/releases/latest/download/builtins.asar.sha256
```

## layout

```
manifest.v1.json
scriptlets/<file>.js   function source
resources/<name>       web-accessible resource
```

Scriptlets come from `src/js/resources/scriptlets.js`.

Resources come from `src/js/redirect-resources.js` and `src/web_accessible_resources/`.
`click2load.html` is excluded because it depends on uBO's extension scripts and stylesheets.

## manifest

```ts
interface Manifest {
	source: 'https://github.com/gorhill/uBlock';
	tag: string | null; // uBO release tag; null if not extracted from a tag
	commit: string | null; // uBO commit SHA; null if git metadata is unavailable
	commitDate: string | null; // ISO 8601
	generatedAt: string; // ISO 8601
	scriptlets: Scriptlet[];
	resources: Resource[];
}

interface Scriptlet {
	name: string; // canonical name
	path: string;
	injectable: boolean;
	functionName: string; // declared function's identifier
	aliases: string[];
	dependencies: string[]; // canonical scriptlet names
	world: 'MAIN' | 'ISOLATED';
	requiresTrust: boolean;
	priority?: number;
}

interface Resource {
	name: string; // canonical name
	path: string;
	injectable: boolean;
	mime: string | null; // from the extension; null for `empty`, which takes the request's type
	aliases: string[];
	inline: boolean; // usable as a data: URI redirect
	requiresTrust: boolean;
}
```
