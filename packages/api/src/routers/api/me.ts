import type { MeApiResponse } from '@hyperdx/common-utils/dist/types';
import express from 'express';

import { AI_API_KEY, ANTHROPIC_API_KEY, USAGE_STATS_ENABLED } from '@/config';
import { getTeam } from '@/controllers/team';
import { Api404Error } from '@/utils/errors';
import { sendJson } from '@/utils/serialization';

const router = express.Router();

router.get('/', async (req, res: express.Response<MeApiResponse>, next) => {
  try {
    if (req.user == null) {
      throw new Api404Error('Request without user found');
    }

    const {
      _id: id,
      accessKey,
      createdAt,
      email,
      name,
      team: teamId,
    } = req.user;

    const team = await getTeam(teamId);
    if (team == null) {
      throw new Api404Error(`Team not found for user ${id}`);
    }

    // Same admin/owner-only policy as GET /team — don't hand the shared
    // default ingestion key to a 'dev' just because it's nested under `team`
    // here.
    const role = req.user.role;
    const plainTeam =
      typeof (team as any).toObject === 'function'
        ? (team as any).toObject()
        : team;
    const teamForResponse =
      role === 'admin' || role === 'owner'
        ? team
        : ({ ...plainTeam, apiKey: undefined } as typeof team);

    return sendJson(res, {
      accessKey,
      createdAt,
      email,
      id,
      name,
      role: req.user.role || 'admin',
      allowedServices: req.user.allowedServices || [],
      team: teamForResponse,
      usageStatsEnabled: USAGE_STATS_ENABLED,
      aiAssistantEnabled: !!(AI_API_KEY || ANTHROPIC_API_KEY),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
