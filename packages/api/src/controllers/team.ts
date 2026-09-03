import { TeamClickHouseSettingsUpdate } from '@hyperdx/common-utils/dist/types';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import * as config from '@/config';
import type { ObjectId } from '@/models';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import Team, { type ITeam, type TeamDocument } from '@/models/team';
import TeamApiKey from '@/models/teamApiKey';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user';
import { setupTeamDefaults } from '@/setupDefaults';

export function getTeamInviteUrl(token: string) {
  return `${config.FRONTEND_URL}/join-team?token=${token}`;
}

const LOCAL_APP_TEAM_ID = '_local_team_';
export const LOCAL_APP_TEAM = {
  _id: new mongoose.Types.ObjectId(LOCAL_APP_TEAM_ID),
  id: LOCAL_APP_TEAM_ID,
  name: 'Local App Team',
  // Placeholder keys
  hookId: uuidv4(),
  apiKey: uuidv4(),
  collectorAuthenticationEnforced: false,
  isMetricsSeriesTableEnabled: false,
  toJSON() {
    return this;
  },
};

export async function isTeamExisting() {
  if (config.IS_LOCAL_APP_MODE) {
    return true;
  }

  const teamCount = await Team.countDocuments({});
  return teamCount > 0;
}

export async function createTeam({
  name,
  collectorAuthenticationEnforced = true,
}: {
  name: string;
  collectorAuthenticationEnforced?: boolean;
}) {
  if (await isTeamExisting()) {
    throw new Error('Team already exists');
  }

  const team = new Team({ name, collectorAuthenticationEnforced });

  await team.save();

  return team;
}

export function getAllTeams(fields?: string[]) {
  if (config.IS_LOCAL_APP_MODE) {
    return [LOCAL_APP_TEAM];
  }

  return Team.find({}, fields);
}

export function getTeam<const F extends readonly (keyof ITeam)[]>(
  id: string | ObjectId,
  fields: F,
): mongoose.Query<
  mongoose.HydratedDocument<Pick<ITeam, F[number]>> | null,
  any
>;
export function getTeam(
  id: string | ObjectId,
): mongoose.Query<TeamDocument | null, any>;
export function getTeam(id: string | ObjectId, fields?: readonly string[]) {
  if (config.IS_LOCAL_APP_MODE) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return LOCAL_APP_TEAM as any;
  }

  // BUG FIX (was `Team.findOne({}, fields)`): an empty filter ignored `id`
  // entirely and always returned whichever team Mongo happens to return
  // first (effectively the first team ever created) — invisible as long as
  // exactly one team could ever exist, but as soon as a second team exists
  // (via /team/admin/teams) every caller of getTeam() — GET /team, GET /me,
  // setupTeamDefaults, the external API — started serving the FIRST team's
  // name/apiKey/settings to EVERY team's members, admin and dev alike. This
  // is what surfaced as "dev sees the whole system's API key instead of
  // their own team's".
  return Team.findOne({ _id: id }, fields);
}

export function getTeamByApiKey(apiKey: string) {
  if (config.IS_LOCAL_APP_MODE) {
    return LOCAL_APP_TEAM;
  }

  return Team.findOne({ apiKey });
}

export function rotateTeamApiKey(teamId: ObjectId) {
  return Team.findByIdAndUpdate(teamId, { apiKey: uuidv4() }, { new: true });
}

export function setTeamName(teamId: ObjectId, name: string) {
  return Team.findByIdAndUpdate(teamId, { name }, { new: true });
}

export function updateTeamClickhouseSettings(
  teamId: ObjectId,
  settings: TeamClickHouseSettingsUpdate,
) {
  const $set: Record<string, any> = {};
  const $unset: Record<string, any> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (value === null) {
      $unset[key] = '';
    } else if (value !== undefined) {
      $set[key] = value;
    }
  }

  const update: Record<string, any> = {};
  if (Object.keys($set).length > 0) update.$set = $set;
  if (Object.keys($unset).length > 0) update.$unset = $unset;

  return Team.findByIdAndUpdate(teamId, update, { new: true });
}

export async function getTags(teamId: ObjectId) {
  const [dashboardTags, savedSearchTags] = await Promise.all([
    Dashboard.aggregate([
      { $match: { team: teamId } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags' } },
    ]),
    SavedSearch.aggregate([
      { $match: { team: teamId } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags' } },
    ]),
  ]);

  return [
    ...new Set([
      ...dashboardTags.map(t => t._id),
      ...savedSearchTags.map(t => t._id),
    ]),
  ];
}

// Creates a brand new team (its own ingestion apiKey, isolated from every
// other team) and a pending TeamInvite for its first owner.
//
// Deliberately does NOT look up an existing User and reassign them to this
// team: `user.team` is a single ObjectId (a user belongs to exactly one
// team), so silently repointing an existing account would evict them from
// whatever team they already belonged to. Reusing the invite flow means the
// owner accepts explicitly (via POST /team/setup/:token, same as any other
// invite) and only ever gets moved if they don't have a team yet.
export const createAdditionalTeam = async (
  name: string,
  ownerEmail: string,
) => {
  const normalizedEmail = ownerEmail.toLowerCase();

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser?.team) {
    throw new Error(
      `User ${normalizedEmail} already belongs to a team. Invite a different email, or remove them from their current team first.`,
    );
  }

  const team = await Team.create({ name, apiKey: uuidv4() });
  await setupTeamDefaults(team._id.toString());

  const invite = await new TeamInvite({
    teamId: team._id,
    email: normalizedEmail,
    role: 'owner',
    token: crypto.randomBytes(32).toString('hex'),
  }).save();

  return { team, inviteUrl: getTeamInviteUrl(invite.token) };
};


// Admin/owner: pass no memberFilter to list every active key for the team.
// Dev: pass their own userId so they only ever see keys they're a member
// of — never the team's other services' keys.
export function listTeamApiKeys(teamId: ObjectId, memberFilter?: ObjectId) {
  return TeamApiKey.find({
    team: teamId,
    revokedAt: null,
    ...(memberFilter ? { members: memberFilter } : {}),
  })
    .sort({ createdAt: -1 })
    .populate<{ members: { _id: ObjectId; email: string; name?: string }[] }>(
      'members',
      'email name',
    );
}

export async function createTeamApiKey(
  teamId: ObjectId,
  name: string,
  createdBy?: ObjectId,
) {
  const apiKey = await new TeamApiKey({ team: teamId, name, createdBy }).save();
  return apiKey;
}

export async function revokeTeamApiKey(teamId: ObjectId, apiKeyId: string) {
  const apiKey = await TeamApiKey.findOneAndUpdate(
    { _id: apiKeyId, team: teamId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true },
  );
  return apiKey;
}

export async function setTeamApiKeyMembers(
  teamId: ObjectId,
  apiKeyId: string,
  memberIds: string[],
) {
  const apiKey = await TeamApiKey.findOneAndUpdate(
    { _id: apiKeyId, team: teamId, revokedAt: null },
    { $set: { members: memberIds } },
    { new: true },
  );
  return apiKey;
}

// Used at invite-accept time (POST /team/setup/:token) to scope a freshly
// created dev to the service key they were invited under.
export async function addApiKeyMember(apiKeyId: ObjectId, userId: ObjectId) {
  await TeamApiKey.updateOne(
    { _id: apiKeyId },
    { $addToSet: { members: userId } },
  );
}
