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
