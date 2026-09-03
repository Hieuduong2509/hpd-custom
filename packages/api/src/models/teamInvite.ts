import mongoose, { Schema } from 'mongoose';
import ms from 'ms';

interface ITeamInvite {
  createdAt: Date;
  email: string;
  name?: string;
  teamId: string;
  token: string;
  updatedAt: Date;
  role: 'owner' | 'dev';
  // When set, whoever accepts this invite is added as a member of this
  // TeamApiKey once their User doc exists (see POST /team/setup/:token) —
  // this is how a dev ends up scoped to exactly one service's key instead
  // of the team's shared default key.
  apiKeyId?: mongoose.Types.ObjectId;
}

const TeamInviteSchema = new Schema(
  {
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    name: String,
    email: {
      type: String,
      required: true,
    },
    token: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['owner', 'dev'],
      default: 'dev',
    },
    apiKeyId: {
      type: Schema.Types.ObjectId,
      ref: 'TeamApiKey',
    },
  },
  {
    timestamps: true,
  },
);

TeamInviteSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ms('30d') / 1000 },
);

TeamInviteSchema.index({ teamId: 1, email: 1 }, { unique: true });

export default mongoose.model<ITeamInvite>('TeamInvite', TeamInviteSchema);
