# kee-conn-meta

Meta Pages for keemakr agents — list managed Facebook Pages, read their posts,
publish new ones, via the Graph API. OAuth2; app credentials live in the
platform vault as `META_APP_ID` / `META_APP_SECRET`. Provider slug is
`meta-graph` (core's first-party `meta`/`facebook` slugs stay theirs).

| Operation | Access | Returns |
| --- | --- | --- |
| `pages.get` | read | `[{ id, name, category, followers }]` |
| `page-posts.list` | read | `[{ id, message, created_time, permalink }]` |
| `page-posts.create` | write | `{ id }` |

Page tokens are derived per call from `/me/accounts` and never stored. A
dev-mode Meta app works against pages the developer owns — enough for keemakr's
proof rig; app review unlocks arbitrary tenants.

## Get the package

- **Marketplace** — already published: tenants connect it from **Settings → Connections** in their keemakr app.
- **Release zip** — every release on this repo attaches the exact `meta-graph.zip` the marketplace validated (five gates: typecheck, network scan, compiled artifact, conformance, version diff).
- **Rebuild it** — `npx kee-connector pack` regenerates the zip from source (allowlisted files only).

## Develop

```bash
npm install
npx kee-connector lint       # entry.json vs the platform schema
npx kee-connector certify    # the SAME conformance suite the publish gate runs

# live calls against the real API, under the production egress fence:
mkdir -p .kee && echo '{ "accessToken": "<a real credential>" }' > .kee/fixtures.json
npx kee-connector dev test
```

## Build your own connector

Start from the template — [fsztpartners/kee-connector-template](https://github.com/fsztpartners/kee-connector-template) —
or run the `/create-kee-connector` skill. The full walkthrough is Chapter IV of the
keemakr onboarding tutorial. Like every keemakr connector, this package runs **inside
the platform**: tenants' credentials are encrypted per tenant and injected per call;
nothing here is a service and nothing reads env.
