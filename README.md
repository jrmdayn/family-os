# Family OS

A household admin app you talk to through an LLM. Tell Claude "Maria 4h on Friday" or ask "What do I need to wire to whom?", and Family OS keeps the books.

Built on the CAFE stack: **C**loudflare, **A**lchemy (with Alchemy Domain), **F**oldkit and **E**ffect v4.

- How it is built: [`docs/`](docs/src/content/docs/index.mdx) (run `pnpm docs:dev`)
- Roadmap: [`docs/src/content/docs/roadmap.md`](docs/src/content/docs/roadmap.md)
- Conventions for contributors and coding agents: [`AGENTS.md`](AGENTS.md)

## Getting started

Requires Corepack (bundled with Node). pnpm fetches Node 24 itself.

```sh
corepack enable
pnpm install
pnpm repos:sync   # reference sources for Alchemy, Effect and Foldkit
pnpm check
```
