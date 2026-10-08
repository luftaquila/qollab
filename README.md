# Qollab

Self-hosted collaborative Quarto editor with a live PDF preview. Vue 3, Milkdown CrepeBuilder, Yjs, PostgreSQL and an isolated Quarto renderer. English and Korean UI, selected from browser language preferences.

## Run

Docker Engine and Compose v2:

```sh
cp .env.example .env
cat docs/versions.env >> .env
# Set separate random POSTGRES_PASSWORD, RENDERER_TOKEN and ADMIN_TOKEN values.
docker compose pull
docker compose up -d
```

Open `http://localhost:3000`. The default port binds to loopback. Configure a Google web OAuth client and `APPROVED_EMAILS` in `.env` to sign in. The callback URI is `${PUBLIC_ORIGIN}/api/auth/callback`. There is no password login. `ANONYMOUS_ACCESS=true` (off by default) lets anyone who can reach the server work as one shared guest account without signing in; use it only on trusted local networks ([details](docs/operations.md#로그인-없는-접근)).

For access from another device, set `BIND_ADDRESS=0.0.0.0` and set `PUBLIC_ORIGIN` to the address used by that device, then run `docker compose up -d app`. See [network access](docs/operations.md#다른-기기에서-접속) for LAN and HTTPS configuration.

For rootless Podman, enable the user engine socket, set `ENGINE_SOCKET`, and use both Compose files:

```sh
podman compose -f compose.yaml -f compose.podman.yaml up -d
```

See [operations](docs/operations.md) for socket permissions, HTTPS, limits and backup/restore. [Verification](docs/verification.md) lists tested image digests and evidence.

## Included

- Shared Markdown editing, Korean IME, remote cursors and personal undo/redo.
- Workspace with an activity rail (files, outline, document settings, history, members), resizable PDF preview that follows the editor's position (can be turned off), right-click menus, light and dark themes.
- Formatting toolbar for underline, text color, lists, links, images, tables, code and math that never edits YAML front matter by accident; one image dialog uploads or reuses project images.
- Document settings for paper, margins, date, fonts (including a separate Hangul font), spacing, numbering, contents, link colors, caption labels and LaTeX preamble, per document or project-wide in `_quarto.yml`, each showing the value that applies when left empty, with free YAML editing.
- XeLaTeX by default or LuaLaTeX per document or project, with project `.tex` templates and `.sty` packages, so existing LaTeX documents (kotex/luatexko) render the same.
- Writing help for Markdown, math, Quarto and common LaTeX commands; Korean and English interface following the browser or chosen in the account menu.
- Folders: create, rename, delete and drag files between them; links are rewritten.
- Labels on headings, figures or any span of text, LaTeX `\label`/`\ref` kept as chips (typed `\ref{…}` becomes one), raw LaTeX blocks such as tables inside list items, and references that jump to their target in the editor and link inside the PDF.
- Right-click menus for each editor element, refresh-safe URLs and build errors summarized from the log.
- Preserved YAML and unsupported Quarto syntax in editable raw blocks; exclusive recovery editing for uncertain boundaries.
- Google OIDC, expiring invitations, Owner/Editor/Viewer roles and ownership transfer.
- PNG/JPEG upload, paste and drop; figure properties, replacement and asset reuse.
- Project files, relative links, checkpoints, source diff, complete project restore and ZIP import/export.
- Automatic PDF builds that stop outdated runs when editing continues, last successful preview, cancellation and isolated disposable job containers.
- Consistent backup/restore of source, images, permissions, collaborative state and history.

Commenting, suggestions, full offline editing, simultaneous Visual/Source editing, executable user code and advanced page layout are outside 0.1.0. Google sign-in with a real account requires deployment credentials; automated OIDC tests use a signed local provider.

## Development

Node.js 24.15.0, PostgreSQL 17 and Git:

```sh
npm ci
cp .env.example .env
# Set DATABASE_URL to a local PostgreSQL database.
npm run dev
npm run dev:web
```

Development UI: `http://localhost:5173`; set `PUBLIC_ORIGIN=http://localhost:5173` for requests through Vite. The server is on port 3000. No authentication bypass is enabled.

```sh
npm run check
TEST_DATABASE_URL=postgres://user:password@localhost/qollab_test npm test
npm run build
E2E_DATABASE_URL=postgres://user:password@localhost/qollab_e2e npm run test:e2e
node scripts/check-deps.mjs
node scripts/bundle-report.mjs
```

Test databases must be dedicated to Qollab tests. The suite creates users, sessions and projects and clears its fixture tables. Browser tests use a separate fixture process; it is excluded from production images.

- [Detailed design](DESIGN.md)
- [API contract](docs/api.md)
- [Operations](docs/operations.md)
- [Verification and limitations](docs/verification.md)

## License

MIT. Dependencies retain their own licenses. Container images include Quarto, Pandoc, TeX Live and fonts under their respective licenses; installed package versions are recorded in `/opt/qollab/packages.txt` in the renderer image.
