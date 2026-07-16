// Meta Pages — a keemakr marketplace connector (Graph API, OAuth2).
//
// Provider slug is 'meta-graph' (core ships a first-party 'meta'/'facebook';
// built-ins always shadow marketplace keys, so this connector claims its own).
// Page operations use PAGE access tokens fetched via /me/accounts per call —
// the stored user token is the root credential, page tokens are derived and
// never persisted. Dev-mode Meta apps work against pages the developer owns.

import { defineProvider, OperationError, type OperationContext } from '@keemakr/operator-sdk';
import { z } from 'zod';

const GRAPH = 'https://graph.facebook.com/v21.0';

async function graph<T>(ctx: OperationContext, path: string, token: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await ctx.fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number };
  };
  if (body.error) {
    const code = body.error.code;
    if (code === 190) throw new OperationError('Meta rejected the token', 401, 'auth_revoked');
    if (code === 4 || code === 32) throw new OperationError('Meta rate limit', 429, 'rate_limited');
    throw new OperationError(body.error.message ?? 'Meta error', 502, 'provider_unavailable');
  }
  if (!res.ok) throw new OperationError(`Meta answered ${res.status}`, 502, 'provider_unavailable');
  return body;
}

async function graphPost<T>(
  ctx: OperationContext,
  path: string,
  token: string,
  form: Record<string, string>,
): Promise<T> {
  const res = await ctx.fetch(`${GRAPH}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, access_token: token }),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (body.error) throw new OperationError(body.error.message ?? 'Meta error', 502, 'connector_error');
  return body;
}

// Page ops need the PAGE token — derived per call, never stored.
async function pageToken(
  ctx: OperationContext,
  userToken: string,
  pageId: string,
): Promise<string> {
  const { data } = await graph<{ data: { id: string; access_token: string }[] }>(
    ctx,
    '/me/accounts?fields=id,access_token',
    userToken,
  );
  const page = data.find((p) => p.id === pageId);
  if (!page) throw new OperationError(`page ${pageId} is not managed by this account`, 404, 'connector_error');
  return page.access_token;
}

export const provider = defineProvider({
  provider: 'meta-graph',
  displayName: 'Meta Pages',
  authKind: 'oauth2',
  category: 'social',
  publisher: 'blue-ledger-media',
  allowedDomains: ['graph.facebook.com', 'www.facebook.com'],
  scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],

  buildAuthUrl({ state, callbackUrl }, ctx) {
    const appId = ctx?.config?.META_APP_ID;
    if (!appId) throw new Error('META_APP_ID is not configured');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'pages_show_list,pages_read_engagement,pages_manage_posts',
      state,
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
  },

  async exchangeCode({ code, callbackUrl }, ctx) {
    if (!ctx?.fetch) throw new Error('lifecycle context missing fetch');
    const params = new URLSearchParams({
      client_id: ctx.config?.META_APP_ID ?? '',
      client_secret: ctx.config?.META_APP_SECRET ?? '',
      redirect_uri: callbackUrl,
      code,
    });
    const res = await ctx.fetch(`${GRAPH}/oauth/access_token?${params}`);
    if (!res.ok) throw new Error(`Meta code exchange failed (${res.status})`);
    const t = (await res.json()) as { access_token: string; expires_in?: number };
    return {
      accessToken: t.access_token,
      refreshToken: null, // Meta long-lived tokens re-mint via the exchange, not a refresh grant
      expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
    };
  },

  async test(cred, ctx) {
    if (!ctx) return { ok: false, detail: 'no execution context' };
    try {
      await graph(ctx, '/me?fields=id,name', cred.accessToken);
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },

  operations: {
    // → [{ id, name, category, followers }]
    'pages.get': {
      description: 'Pages the connected account manages',
      access: 'read',
      idempotent: true,
      inputSchema: z.object({}),
      async call(cred, _args, ctx) {
        const { data } = await graph<{ data: Record<string, unknown>[] }>(
          ctx!,
          '/me/accounts?fields=id,name,category,followers_count',
          cred.accessToken,
        );
        return data.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          followers: p.followers_count ?? 0,
        }));
      },
    },
    // → [{ id, message, created_time, permalink }]
    'page-posts.list': {
      description: 'Recent posts on a managed page',
      access: 'read',
      idempotent: true,
      inputSchema: z.object({
        pageId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      async call(cred, args, ctx) {
        const token = await pageToken(ctx!, cred.accessToken, String(args.pageId));
        const { data } = await graph<{ data: Record<string, unknown>[] }>(
          ctx!,
          `/${args.pageId}/posts?fields=id,message,created_time,permalink_url&limit=${args.limit}`,
          token,
        );
        return data.map((p) => ({
          id: p.id,
          message: p.message ?? null,
          created_time: p.created_time,
          permalink: p.permalink_url ?? null,
        }));
      },
    },
    // → { id } — the created post
    'page-posts.create': {
      description: 'Publish a post to a managed page',
      access: 'write',
      idempotent: false,
      inputSchema: z.object({
        pageId: z.string().min(1),
        message: z.string().min(1).max(5000),
      }),
      async call(cred, args, ctx) {
        const token = await pageToken(ctx!, cred.accessToken, String(args.pageId));
        const post = await graphPost<{ id: string }>(ctx!, `/${args.pageId}/feed`, token, {
          message: String(args.message),
        });
        return { id: post.id };
      },
    },
  },
});
