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

Open `http://localhost:3000`. The default port binds to loopback. Configure a Google web OAuth client and `APPROVED_EMAILS` in `.env` to sign in. The callback URI is `${PUBLIC_ORIGIN}/api/auth/callback`. There is no password or development login in production images.

For access from another device, set `BIND_ADDRESS=0.0.0.0` and set `PUBLIC_ORIGIN` to the address used by that device, then run `docker compose up -d app`. See [network access](docs/operations.md#다른-기기에서-접속) for LAN and HTTPS configuration.

For rootless Podman, enable the user engine socket, set `ENGINE_SOCKET`, and use both Compose files:

```sh
podman compose -f compose.yaml -f compose.podman.yaml up -d
```

See [operations](docs/operations.md) for socket permissions, HTTPS, limits and backup/restore. [Verification](docs/verification.md) lists tested image digests and evidence.

## Included

- Shared Markdown editing, Korean IME, remote cursors and personal undo/redo.
- Fixed formatting bar, lists, links, images, tables, code and math.
- Preserved YAML and unsupported Quarto syntax in editable raw blocks; exclusive recovery editing for uncertain boundaries.
- Google OIDC, expiring invitations, Owner/Editor/Viewer roles and ownership transfer.
- PNG/JPEG upload, paste and drop; figure properties, replacement and asset reuse.
- Project files, relative links, checkpoints, source diff, complete project restore and ZIP import/export.
- Automatic PDF builds, last successful preview, cancellation and isolated disposable job containers.
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
