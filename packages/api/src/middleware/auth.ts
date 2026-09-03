import { Connection } from '@hyperdx/common-utils/dist/types';
import type { NextFunction, Request, Response } from 'express';
import type { Types } from 'mongoose';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import { findUserByAccessKey } from '@/controllers/user';
import Team from '@/models/team';
import TeamApiKey from '@/models/teamApiKey';
import type { UserDocument } from '@/models/user';
import {
  getStaticFeatureFlags,
  setBusinessContext,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';

declare global {
  // Express type augmentation requires `namespace` + interface merging; there is
  // no non-namespace / non-empty-interface equivalent for extending these types.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends UserDocument {}
    interface Request {
      _hdx_connection?: Connection;
      _hdx_team_api_key?: string;
      _hdx_user_role?: string;
      _hdx_allowed_services?: string[];
      // Ingestion keys (TeamApiKey.key) this user is a member of — used to
      // scope ClickHouse row-policy filtering by service for non-admin
      // users (see routers/api/clickhouseProxy.ts). Empty for admin (who
      // bypasses the policy) and for users not assigned to any key.
      _hdx_allowed_api_keys?: string[];
    }
  }
}

declare module 'express-session' {
  interface Session {
    messages: string[]; // Set by passport
    passport: { user: string }; // Set by passport
  }
}


// Which TeamApiKey values (ingestion keys) `role` is scoped to see, for
// ClickHouse row-policy filtering (see routers/api/clickhouseProxy.ts and
// docker/otel-collector/schema/seed/00009_tenant_isolation_policies.sql).
// 'admin' bypasses the policy entirely so is never restricted — computing
// their key list would just be wasted work. Any other role (owner, dev) is
// scoped to exactly the keys they're a member of, which may be an empty
// list (meaning: assigned to none, so the policy should show them nothing).
async function computeAllowedApiKeys(
  role: string,
  teamId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<string[]> {
  if (role === 'admin' || !teamId || !userId) {
    return [];
  }
  const keys = await TeamApiKey.find(
    { team: teamId, members: userId, revokedAt: null },
    'key',
  );
  return keys.map(k => k.key);
}

export function redirectToDashboard(req: Request, res: Response) {
  // Use 303 See Other so browsers always follow the redirect with GET, even
  // when the original request was a POST (e.g. /login/password). Without an
  // explicit status, Express sends 302 and some browsers/proxies preserve the
  // POST method, which produces a 405 on Next.js pages that only accept GET.
  // The destination is the app root so client-side routing in LandingPage
  // decides where to send the user (/search if logged in, /login otherwise).
  // This avoids hard-coding /search here, which fails when the post-login
  // host differs from the configured FRONTEND_URL (e.g. Vercel previews).
  if (req?.user?.team) {
    return res.redirect(303, `${config.FRONTEND_REDIRECT_BASE}/`);
  } else {
    logger.error(
      { userId: req?.user?._id },
      'Password login for user failed, user or team not found',
    );
    res.redirect(303, `${config.FRONTEND_REDIRECT_BASE}/login?err=unknown`);
  }
}

export function handleAuthError(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  logger.debug({ authErr: serializeError(err) }, 'Auth error');
  if (res.headersSent) {
    return next(err);
  }

  // Get the latest auth error message
  const lastMessage = req.session.messages?.at(-1);
  logger.debug(`Auth error last message: ${lastMessage}`);

  const returnErr =
    lastMessage === 'Password or username is incorrect'
      ? 'authFail'
      : lastMessage ===
          'Authentication method password is not allowed by your team admin.'
        ? 'passwordAuthNotAllowed'
        : 'unknown';

  // 303 forces GET on the redirected request even when the original request
  // was a POST (e.g. /login/password failure path).
  res.redirect(303, `${config.FRONTEND_REDIRECT_BASE}/login?err=${returnErr}`);
}

export function getAccessKeyFromRequest(req: Request): string | undefined {
  return req.headers.authorization?.split('Bearer ')[1];
}

export async function validateUserAccessKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const key = getAccessKeyFromRequest(req);
    if (!key) {
      return res.sendStatus(401);
    }

    const user = await findUserByAccessKey(key);
    if (!user) {
      return res.sendStatus(401);
    }

    req.user = user;
    const team = await Team.findById(user.team);
    if (team) {
      req._hdx_team_api_key = team.apiKey;
    }
    req._hdx_user_role = user.role || 'admin';
    req._hdx_allowed_services = user.allowedServices || [];
    req._hdx_allowed_api_keys = await computeAllowedApiKeys(
      req._hdx_user_role,
      user.team,
      user._id,
    );

    // Attribute access-key authenticated requests (external API v2 + MCP HTTP)
    // with team/user context so their traces are searchable during incidents.
    setBusinessContext({
      teamId: user.team?.toString(),
      userId: user._id?.toString(),
      email: user.email,
      ...getStaticFeatureFlags(),
    });

    next();
  } catch (err) {
    next(err);
  }
}

export async function isUserAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (config.IS_LOCAL_APP_MODE) {
      // If local app mode is enabled, skip authentication
      logger.warn('Skipping authentication in local app mode');
      req.user = {
        // @ts-expect-error local app mode uses a synthetic string id, not an ObjectId
        _id: '_local_user_',
        email: 'local-user@hyperdx.io',
        // @ts-expect-error local app mode uses a synthetic string team, not an ObjectId
        team: '_local_team_',
      };
      req._hdx_team_api_key = '_local_team_';
      req._hdx_user_role = 'admin';
      req._hdx_allowed_services = [];
      setBusinessContext({
        teamId: '_local_team_',
        userId: '_local_user_',
        'hyperdx.local_mode': true,
        ...getStaticFeatureFlags(),
      });
      return next();
    }

    if (req.isAuthenticated()) {
      const user = req.user as UserDocument;
      const team = await Team.findById(user.team);
      if (team) {
        req._hdx_team_api_key = team.apiKey;
      }
      req._hdx_user_role = user.role || 'admin';
      req._hdx_allowed_services = user.allowedServices || [];
      req._hdx_allowed_api_keys = await computeAllowedApiKeys(
        req._hdx_user_role,
        user.team,
        user._id,
      );

      // Attach incident-remediation context to the trace and active span.
      setBusinessContext({
        teamId: req.user?.team?.toString(),
        userId: req.user?._id?.toString(),
        email: req.user?.email,
        ...getStaticFeatureFlags(),
      });

      return next();
    }
    res.sendStatus(401);
  } catch (err) {
    next(err);
  }
}

export function getNonNullUserWithTeam(req: Request) {
  const user = req.user;

  if (!user) {
    throw new Error('User is not authenticated');
  }

  if (!user.team) {
    throw new Error(`User ${user._id} is not associated with a team`);
  }

  return { teamId: user.team, userId: user._id, email: user.email };
}
