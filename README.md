# Qollab

Self-hosted collaborative Quarto editor with live web documents and on-demand PDF preview. Vue 3, Milkdown CrepeBuilder, Yjs, VitePress, PostgreSQL and an isolated Pandoc/Typst renderer for Quarto Markdown (`.qmd`). English and Korean UI, selected from browser language preferences.

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

- Immediate collaborative Markdown preview with a **Follow cursor** toggle. Owners can publish a separate VitePress site for each project: chapter pages, native local search, navigation, images and theme are built into that project’s static files. Published sites refresh after saved edits are rebuilt; the exported website ZIP works at the root of an ordinary static host without Qollab or its API. `DOCS_PROJECT=<project UUID>` mounts one published project at `/docs/`; otherwise `/docs/` is 404. Other published projects have separate `/docs/p/<project>/` sites. Publishing deliberately makes the resulting document readable without an editor login.
- Toolbar and Markdown input together: `#` through `######` followed by a space set the absolute heading level; fences followed by Enter start code blocks; plain Markdown paste supports headings, lists, quotes and tables.
- **PDF ↗** beside the web document action captures current text and numbering, including unsaved local edits, then runs Pandoc and Typst WebAssembly in a worker with the original project templates, fonts and images. Clicking opens the result tab immediately, with a compact loading card until the native browser PDF viewer is ready. Progress also appears as a floating notice in the editor without shifting its layout. The last successful PDF is reused immediately while its document, templates, settings and image identities are unchanged in the open workspace; cache hits do not download the project or run the compiler again. First use downloads the engines and fonts.
- **Document settings → Number display** is collapsed below document information. Heading/list levels accept free formats (`제{n}조`, `{n}항`, `({n})`, `{1}.{n}`), numeral styles and custom symbols. Heading titles, references, continuous counters across chapters, figure captions, bullet markers and named template counters are configurable too. Overrides default to off; literal source-prefix rules start empty. The same resolved counters and references feed the web, browser PDF and server renderer without rewriting Markdown. Automatic PDF formatting works with the default template. A custom layout can explicitly use the `document-format` template interface and select **Template integration** to keep its own typography and layout; no template function names or document codes are inferred. See the [formatting contract](docs/api.md#문서-표시와-typst-템플릿).
- **History** groups consecutive edits by the same authenticated actor to the same file (90-second idle boundary, up to five minutes). Each entry shows changed text and opens a before/after view with the changed characters highlighted. Atomic change records remain intact; existing records are indexed into the same grouped view. Intervening edits by another person start a new entry. Anonymous names can be set in the account menu, and sessions remain distinct even when their names match.
- Number settings survive checkpoints, backups and ZIP import/export. Legacy review metadata is retained for archive compatibility; review, adoption timing and comparison-sheet import features have been removed.
- Workspace with an activity rail (files, outline, labels, document settings, history, members; outline and labels can be searched), resizable web preview with cursor following that can be turned off, right-click menus, light and dark themes.
- Formatting toolbar for underline, text color, lists, links, images, tables, code and math that never edits YAML front matter by accident; one image dialog uploads or reuses project images.
- Document settings for paper, margins, date, fonts (including a separate Hangul font), spacing, numbering, contents, link colors, caption labels and Typst preamble, per document or project-wide in `_quarto.yml`, each showing the value that applies when left empty, with free YAML editing.
- PDFs made by Pandoc and Typst, without Quarto: cross references, numbered equations, callouts, two columns and page breaks of the Quarto syntax are supported; other Quarto-only blocks and shortcodes are reported in the build log. The default style can be replaced per project with `.typ` template partials. The LaTeX inline commands the editor writes (`\textcolor`, `\ul`, `\label`/`\ref`, `\newpage`, `\char`) are translated; LaTeX-only settings and raw LaTeX blocks are left out with a warning in the build log.
- Writing help for Markdown, math, Quarto and Typst layout commands; Korean and English interface following the browser or chosen in the account menu.
- Folders: create, rename, delete and drag files between them; links are rewritten.
- Labels on headings, figures or any span of text, LaTeX `\label`/`\ref` kept as chips (typed `\ref{…}` becomes one), raw Typst or LaTeX blocks inside list items, and references that jump to their target in the editor and link inside the PDF.
- Right-click menus for each editor element, refresh-safe URLs and build errors summarized from the log.
- Preserved YAML and unsupported Quarto syntax in editable raw blocks; exclusive recovery editing for uncertain boundaries.
- Google OIDC, expiring invitations, Owner/Editor/Viewer roles and ownership transfer.
- PNG/JPEG upload, paste and drop; figure properties, replacement and asset reuse.
- Project files, relative links, checkpoints, source diff, complete project restore and ZIP import/export.
- Legacy renderer APIs remain for existing integrations, with automatic jobs disabled unless `autoBuild: true` was explicitly configured. The editor uses the single browser PDF action.
- Consistent backup/restore of source, images, permissions, collaborative state and history.

Commenting, suggestions, full offline editing, simultaneous Visual/Source editing, executable user code and advanced page layout are outside 0.1.0. Google sign-in with a real account requires deployment credentials; automated OIDC tests use a signed local provider.

Web documents use Markdown headings, lists, tables, images, math and links. A non-executing compatibility reader extracts text and tables from existing raw Typst blocks while discarding print-only sizes, spacing, alignment and page breaks. It does not execute arbitrary Typst; those programs are handled by the actual PDF compiler. Web pages use the document structure rather than PDF pagination. Browser PDF generation preserves the original template and fonts; the separate server renderer retains its own build settings.

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

MIT. Dependencies retain their own licenses. Container images include Pandoc, Typst, Quarto's arrow-light highlighting theme and fonts under their respective licenses; installed package versions are recorded in `/opt/qollab/packages.txt` in the renderer image.
