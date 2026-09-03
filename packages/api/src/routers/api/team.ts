import type {
  RotateApiKeyApiResponse,
  TeamApiResponse,
  TeamInvitationsApiResponse,
  TeamMembersApiResponse,
  TeamTagsApiResponse,
  UpdateClickHouseSettingsApiResponse,
} from '@hyperdx/common-utils/dist/types';
import { TeamClickHouseSettingsUpdateSchema } from '@hyperdx/common-utils/dist/types';
import crypto from 'crypto';
import express from 'express';
import pick from 'lodash/pick';
import mongoose from 'mongoose';
import { z } from 'zod';
import { processRequest, validateRequest } from 'zod-express-middleware';

import {
  createAdditionalTeam,
  createTeamApiKey,
  getTags,
  getTeam,
  getTeamInviteUrl,
  listTeamApiKeys,
  revokeTeamApiKey,
  rotateTeamApiKey,
  setTeamApiKeyMembers,
  setTeamName,
  updateTeamClickhouseSettings,
} from '@/controllers/team';
import {
  deleteTeamMember,
  findUserByEmail,
  findUsersByTeam,
} from '@/controllers/user';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { requireRole } from '@/middleware/roles';
import TeamApiKey from '@/models/teamApiKey';
import TeamInvite from '@/models/teamInvite';
import { sendJson } from '@/utils/serialization';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

type TeamApiExpRes = express.Response<TeamApiResponse>;
router.get('/', async (req, res: TeamApiExpRes, next) => {
  try {
    const teamId = req.user?.team;
    const userId = req.user?._id;

    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    if (userId == null) {
      throw new Error(`User has no id`);
    }

    const fields = [
      '_id',
      'allowedAuthMethods',
      'apiKey',
      'name',
      'createdAt',
      'isMetricsSeriesTableEnabled',
    ] as const;
    const team = await getTeam(teamId, fields);
    if (team == null) {
      throw new Error(`Team ${teamId} not found for user ${userId}`);
    }

    // The shared default ingestion key is admin/owner-only — a 'dev' should
    // only ever see the key(s) of the specific service(s) they were added
    // to (GET /team/api-keys), not the whole team's fallback key.
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'owner') {
      // team is a lean plain object in IS_LOCAL_APP_MODE (LOCAL_APP_TEAM),
      // not a Mongoose document — guard rather than assume .toObject exists.
      const plainTeam =
        typeof (team as any).toObject === 'function'
          ? (team as any).toObject()
          : team;
      sendJson(res, { ...plainTeam, apiKey: undefined } as any);
      return;
    }

    sendJson(res, team);
  } catch (e) {
    next(e);
  }
});

type RotateApiKeyExpRes = express.Response<RotateApiKeyApiResponse>;
router.patch(
  '/apiKey',
  requireRole('admin', 'owner'),
  async (req, res: RotateApiKeyExpRes, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    const team = await rotateTeamApiKey(teamId);
    if (team?.apiKey == null) {
      throw new Error(`Failed to rotate API key for team ${teamId}`);
    }
    res.json({ newApiKey: team.apiKey });
  } catch (e) {
    next(e);
  }
});

router.patch(
  '/name',
  requireRole('admin', 'owner'),
  validateRequest({
    body: z.object({
      name: z.string().min(1).max(100),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        throw new Error(`User ${req.user?._id} not associated with a team`);
      }
      const { name } = req.body;
      const team = await setTeamName(teamId, name);
      res.json({ name: team?.name });
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/clickhouse-settings',
  requireRole('admin'),
  processRequest({
    body: TeamClickHouseSettingsUpdateSchema,
  }),
  async (
    req,
    res: express.Response<UpdateClickHouseSettingsApiResponse>,
    next,
  ) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        throw new Error(`User ${req.user?._id} not associated with a team`);
      }

      if (Object.keys(req.body).length === 0) {
        return res.json({});
      }

      const team = await updateTeamClickhouseSettings(teamId, req.body);

      res.json(pick(team, Object.keys(req.body)));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/invitation',
  requireRole('admin', 'owner'),
  validateRequest({
    body: z.object({
      email: z.string().email(),
      name: z.string().optional(),
      role: z.enum(['owner', 'dev']).optional(),
      // Which service/key this invitee should be scoped to once they
      // accept — see POST /team/setup/:token. Optional: an owner invite, or
      // a dev not tied to any one service yet, can omit this.
      apiKeyId: objectIdSchema.optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { email: toEmail, name, role, apiKeyId } = req.body;
      const teamId = req.user?.team;
      const fromEmail = req.user?.email;

      if (teamId == null) {
        throw new Error(`User ${req.user?._id} not associated with a team`);
      }

      if (fromEmail == null) {
        throw new Error(`User ${req.user?._id} doesnt have email`);
      }

      if (apiKeyId != null) {
        const apiKey = await TeamApiKey.findOne({
          _id: apiKeyId,
          team: teamId,
          revokedAt: null,
        });
        if (apiKey == null) {
          return res
            .status(400)
            .json({ message: 'That API key does not belong to your team' });
        }
      }

      const toUser = await findUserByEmail(toEmail);
      if (toUser) {
        return res.status(400).json({
          message:
            'User already exists. Please contact HyperDX team for support',
        });
      }

      // Normalize email to lowercase for consistency
      const normalizedEmail = toEmail.toLowerCase();

      // Check for existing invitation with normalized email
      let teamInvite = await TeamInvite.findOne({
        teamId,
        email: normalizedEmail,
      });

      if (!teamInvite) {
        teamInvite = await new TeamInvite({
          teamId,
          name,
          email: normalizedEmail,
          role: role || 'dev',
          apiKeyId,
          token: crypto.randomBytes(32).toString('hex'),
        }).save();
      }

      res.json({
        url: getTeamInviteUrl(teamInvite.token),
      });
    } catch (e) {
      next(e);
    }
  },
);

type TeamInviteExpressRes = express.Response<TeamInvitationsApiResponse>;
router.get(
  '/invitations',
  requireRole('admin', 'owner'),
  async (req, res: TeamInviteExpressRes, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    const teamInvites = await TeamInvite.find(
      { teamId },
      {
        createdAt: 1,
        email: 1,
        name: 1,
        token: 1,
      },
    );
    res.json({
      data: teamInvites.map(ti => ({
        _id: ti._id.toString(),
        createdAt: ti.createdAt.toISOString(),
        email: ti.email,
        name: ti.name,
        url: getTeamInviteUrl(ti.token),
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.delete(
  '/invitation/:id',
  requireRole('admin', 'owner'),
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const id = req.params.id;
      // Throws rather than reading `req.user?.team` directly. BSON drops an
      // undefined value from the filter entirely, so a teamless caller would
      // turn the scoped delete below back into the unscoped one this guard
      // exists to prevent — any authenticated user revoking any team's
      // pending invitation given its id.
      const { teamId } = getNonNullUserWithTeam(req);

      const deleted = await TeamInvite.findOneAndDelete({ _id: id, teamId });
      if (deleted == null) {
        return res.sendStatus(404);
      }

      return res.json({ message: 'TeamInvite deleted' });
    } catch (e) {
      next(e);
    }
  },
);

type TeamMembersExpRes = express.Response<TeamMembersApiResponse>;
router.get('/members', async (req, res: TeamMembersExpRes, next) => {
  try {
    const teamId = req.user?.team;
    const userId = req.user?._id;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    if (userId == null) {
      throw new Error(`User has no id`);
    }
    const teamUsers = await findUsersByTeam(teamId);
    res.json({
      data: teamUsers.map(user => ({
        ...pick(user.toJSON({ virtuals: true }), [
          '_id',
          'email',
          'name',
          'hasPasswordAuth',
          'role',
          'allowedServices',
        ]),
        isCurrentUser: user._id.equals(userId),
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.patch(
  '/member/:id',
  requireRole('admin', 'owner'),
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: z.object({
      role: z.enum(['admin', 'owner', 'dev']).optional(),
      allowedServices: z.array(z.string()).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const memberId = req.params.id;
      const { teamId } = getNonNullUserWithTeam(req);
      const { role, allowedServices } = req.body;

      const User = mongoose.model('User');
      const updatedUser = await User.findOneAndUpdate(
        { _id: memberId, team: teamId },
        { $set: { ...(role && { role }), ...(allowedServices && { allowedServices }) } },
        { new: true }
      );

      if (!updatedUser) {
        return res.status(404).json({ error: 'Member not found' });
      }

      res.json({
        success: true,
        data: pick(updatedUser.toJSON({ virtuals: true }), [
          '_id',
          'email',
          'name',
          'role',
          'allowedServices',
        ]),
      });
    } catch (e) {
      next(e);
    }
  }
);

router.delete(
  '/member/:id',
  requireRole('admin', 'owner'),
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const userIdToDelete = req.params.id;
      const teamId = req.user?.team;
      if (teamId == null) {
        throw new Error(`User ${req.user?._id} not associated with a team`);
      }

      const userIdRequestingDelete = req.user?._id;
      if (!userIdRequestingDelete) {
        throw new Error(`Requesting user has no id`);
      }

      await deleteTeamMember(teamId, userIdToDelete, userIdRequestingDelete);

      res.json({ message: 'User deleted' });
    } catch (e) {
      next(e);
    }
  },
);

type TeamTagsExpRes = express.Response<TeamTagsApiResponse>;
router.get('/tags', async (req, res: TeamTagsExpRes, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    const tags = await getTags(teamId);
    return res.json({ data: tags });
  } catch (e) {
    next(e);
  }
});

// Additional named ingestion API keys, alongside the team's original single
// `apiKey` (unaffected — still exposed at GET /team and rotated via
// PATCH /team/apiKey, and only to admin/owner — see the GET / handler
// above). All keys under a team grant the same team-scoped ingestion
// access, so `members` is a *visibility* scope, not a security boundary:
// admin/owner see and manage every key in the team; a 'dev' only ever sees
// the key(s) they were added to (usually via the apiKeyId picked at invite
// time — see POST /invitation and /team/setup/:token), never the team's
// other services' keys or the shared default key.
router.get('/api-keys', async (req, res, next) => {
  try {
    const { teamId, userId } = getNonNullUserWithTeam(req);
    const role = req.user?.role;
    const isAdminOrOwner = role === 'admin' || role === 'owner';
    const apiKeys = await listTeamApiKeys(
      teamId,
      isAdminOrOwner ? undefined : (userId as mongoose.Types.ObjectId),
    );
    res.json({
      data: apiKeys.map(k => ({
        _id: k._id.toString(),
        name: k.name,
        key: k.key,
        createdAt: k.createdAt.toISOString(),
        // Only admin/owner get member management in the UI, but there's no
        // harm in a dev seeing who else shares their own key's row.
        members: k.members.map(m => ({
          _id: m._id.toString(),
          email: m.email,
          name: m.name,
        })),
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/api-keys',
  requireRole('admin', 'owner'),
  validateRequest({
    body: z.object({
      name: z.string().min(1).max(100),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const apiKey = await createTeamApiKey(
        teamId,
        req.body.name,
        userId as mongoose.Types.ObjectId,
      );
      res.json({
        data: {
          _id: apiKey._id.toString(),
          name: apiKey.name,
          key: apiKey.key,
          createdAt: apiKey.createdAt.toISOString(),
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/api-keys/:id',
  requireRole('admin', 'owner'),
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const revoked = await revokeTeamApiKey(teamId, req.params.id);
      if (revoked == null) {
        return res.sendStatus(404);
      }
      res.json({ message: 'API key revoked' });
    } catch (e) {
      next(e);
    }
  },
);

// Sets which team members can see a given key (see the GET /api-keys
// comment above for why this is a visibility scope, not a security one).
// Replaces the whole member list rather than add/remove-one, since the UI
// drives this from a multi-select of the team's current members.
router.put(
  '/api-keys/:id/members',
  requireRole('admin', 'owner'),
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: z.object({
      memberIds: z.array(objectIdSchema),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const apiKey = await setTeamApiKeyMembers(
        teamId,
        req.params.id,
        req.body.memberIds,
      );
      if (apiKey == null) {
        return res.sendStatus(404);
      }
      res.json({ message: 'Members updated' });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/admin/teams',
  requireRole('admin'),
  validateRequest({
    body: z.object({
      name: z.string().min(1),
      ownerEmail: z.string().email(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { name, ownerEmail } = req.body;
      const { team, inviteUrl } = await createAdditionalTeam(
        name,
        ownerEmail,
      );
      res.json({ success: true, team, ownerInviteUrl: inviteUrl });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
