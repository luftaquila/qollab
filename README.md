# Qollab

Self-hosted collaborative Quarto editor. Vue, Milkdown, Yjs, PostgreSQL and isolated PDF rendering. English and Korean UI; Google sign-in only.

Implementation and verification are in progress. See [DESIGN.md](DESIGN.md).

## Development

Node.js 24 and PostgreSQL 17 are required.

```sh
npm ci
cp .env.example .env
npm run dev
npm run dev:web
```

The production application has no test login. With no Google OIDC configuration it displays an unavailable sign-in screen.

## License

MIT. Dependencies retain their own licenses.
