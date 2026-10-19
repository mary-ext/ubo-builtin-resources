# ubo-builtin-scriptlets

uBlock Origin's builtin scriptlets, extracted into a JSON file and published as a GitHub release.

same idea as Brave's [crx-packager](https://github.com/brave/brave-core-crx-packager): import uBO's
`src/js/resources/scriptlets.js` in Node, read `builtinScriptlets`, and stringify each function. unlike
Brave, this tracks [gorhill/uBlock](https://github.com/gorhill/uBlock) master directly and keeps uBO's
`world`, `requiresTrust` and `priority` metadata.

## downloading

the latest files are always at:

- `https://github.com/mary-ext/ubo-builtin-scriptlets/releases/latest/download/scriptlets.json`
- `https://github.com/mary-ext/ubo-builtin-scriptlets/releases/latest/download/manifest.json`

fetch `manifest.json` first and compare its `sha256` with what you have; only download
`scriptlets.json` when it differs.

## format

`scriptlets.json` is an array, in uBO's order:

```jsonc
{
	"name": "trusted-set-attr.js",          // canonical name, `.js` = injectable, `.fn` = helper
	"aliases": [],                          // other names filters may use
	"dependencies": ["safe-self.fn", "set-attr.fn"], // canonical names of helpers to inject alongside
	"world": "ISOLATED",                    // "MAIN" (default) or "ISOLATED"
	"requiresTrust": true,                  // only usable from trusted filter lists
	"priority": 100,                        // only present when uBO sets it
	"code": "function trustedSetAttr(...) { ... }"
}
```

`manifest.json`:

```jsonc
{
	"source": "https://github.com/gorhill/uBlock",
	"commit": "<uBO commit sha>",
	"commitDate": "<ISO date>",
	"generatedAt": "<ISO date>",
	"count": 153,
	"sha256": "<sha256 of scriptlets.json>"
}
```

## how it updates

[`.github/workflows/update.yml`](.github/workflows/update.yml) runs hourly:

1. shallow-clones gorhill/uBlock master
2. runs `scripts/extract.mjs`, which also checks names are unique, aliases don't collide, and every
   dependency exists, failing the job otherwise
3. compares the output's sha256 with the latest release, and publishes a new release only when it
   changed, with a summary of added, removed and changed scriptlets as the notes

you can also run it by hand from the Actions tab, optionally against a different branch or tag.

## running locally

```sh
npm run fetch-ubo
npm run extract
```
