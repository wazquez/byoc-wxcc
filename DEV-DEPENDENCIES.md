# Understanding the dependencies in `package.json`

A short, TypeScript-newcomer-friendly explanation of every package this project
pulls in and why. A few of these are TypeScript-specific in ways that trip up
everyone at first — start with the concept in the next section.

## `dependencies` vs `devDependencies`

- **`dependencies`** — packages the app needs *while it's actually running* in
  production. For us: `express` (the web server) and `dotenv` (loads `.env`).
- **`devDependencies`** — tools needed only *while developing/building* on your
  machine or in CI: compilers, test runners, linters. They are **not shipped** to
  production. That's why the Dockerfile installs everything to compile, then
  re-installs with `npm ci --omit=dev` for the final image — smaller, and fewer
  things that can break at runtime.

The split is just a hint about *when* each package is needed.

## Runtime dependencies

**`express`** — the HTTP web framework. Handles routes (like `GET /healthz`) and,
later, the inbound/outbound webhook endpoints.

**`dotenv`** — reads a local `.env` file into `process.env` so config/secrets
aren't hardcoded. See `.env.example` for the names it expects.

## The core TypeScript tools

**`typescript`** — the compiler itself (the `tsc` command). It does two jobs:
(1) **type-checks** your code (catches "you passed a string where a number was
expected" before you run anything), and (2) **transpiles** `.ts` → plain `.js`
that Node can run, since Node can't run `.ts` directly. Used by `npm run build`
and `npm run typecheck`.

**`tsx`** — a "run TypeScript instantly" tool for **development only**. Normally
you'd compile (`tsc`) then run the `.js`. `tsx` skips that: `tsx watch
src/server.ts` runs your `.ts` directly *and* auto-restarts when you save a file.
Fast feedback loop. In production we don't use it — we run the already-compiled
`dist/server.js` with plain `node`.

## The `@types/*` packages — the TS-specific gotcha

This is the concept worth internalizing. TypeScript needs to know the **types**
(shapes) of every library you use — what functions exist, what arguments they
take. Libraries written *in* TypeScript ship those descriptions themselves. But
many popular libraries are written in plain JavaScript and don't include them.
For those, the community publishes a separate **"type definitions only"** package
under the `@types/` scope.

So `@types/X` is not the library — it's a companion package containing just the
type descriptions for `X`, so TypeScript understands it.

- **`@types/node`** — types for Node.js built-ins (`process.env`, `Buffer`,
  `crypto`, etc.). Almost every TS backend project needs this.
- **`@types/express`** — types for Express (Express 4 is plain JS, so its types
  live separately).
- **`@types/supertest`** — types for the `supertest` test helper.

They're dev-only because types vanish entirely once compiled to JavaScript — they
exist purely to help you while writing code.

> Handy tell: if you `import` a library and TS complains *"Could not find a
> declaration file for module 'X'"*, the fix is usually `npm i -D @types/X`.

## Linting (catching mistakes & style)

**`eslint`** — the linter. It scans your code for likely bugs and questionable
patterns (unused variables, `==` vs `===`, etc.) — separate from type-checking.
Run via `npm run lint`.

**`typescript-eslint`** — the bridge that teaches ESLint to *understand*
TypeScript. Plain ESLint only knows JavaScript; this adds TS-aware rules and
parsing. Our `eslint.config.js` pulls in its recommended rules.

## Testing

**`vitest`** — the test runner (executes our `tests/*.test.ts` files, gives
pass/fail). It understands TypeScript out of the box, so tests don't need a
separate compile step. Run via `npm test`.

**`supertest`** — a helper for testing HTTP servers: it lets a test fire a fake
request at the Express app (e.g. `GET /healthz`) and assert on the response,
*without* opening a real network port. That's exactly what `tests/health.test.ts`
does.

## Quick mental model

| Package | Job | Dev-only because… |
| --- | --- | --- |
| `typescript` | compile + type-check | prod runs the compiled JS |
| `tsx` | run/watch `.ts` in dev | prod runs plain `node dist/…` |
| `@types/node`, `@types/express`, `@types/supertest` | type info for JS libs | types disappear after compile |
| `eslint`, `typescript-eslint` | find mistakes/style | not needed at runtime |
| `vitest`, `supertest` | run tests | tests don't ship to prod |
