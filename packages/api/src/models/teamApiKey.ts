import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

type ObjectId = mongoose.Types.ObjectId;

// Additional named ingestion API keys for a team, alongside the team's
// original single `apiKey` field (kept as-is on Team for backwards
// compatibility with existing collector configs). All keys under a team are
// equally valid for that team's ingestion — there's no per-key data
// isolation at the ClickHouse level (see hyperdx-rbac-implementation-plan.md,
// "Chốt mô hình bảo mật"). `members` is purely a *visibility* scope for the
// app UI/API: a 'dev' only sees the keys they're a member of (see
// listTeamApiKeys in controllers/team.ts), so each "service" a dev works on
// gets its own named key and the dev is added as a member of that key —
// they never see the team's other services' keys or the shared default key.
interface ITeamApiKey {
  _id: ObjectId;
  team: ObjectId;
  name: string;
  key: string;
  members: ObjectId[];
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date | null;
}

const TeamApiKeySchema = new Schema<ITeamApiKey>(
  {
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    key: {
      type: String,
      required: true,
      default: function genUUID() {
        return uuidv4();
      },
    },
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

TeamApiKeySchema.index({ team: 1, revokedAt: 1 });
TeamApiKeySchema.index({ key: 1 }, { unique: true });
TeamApiKeySchema.index({ team: 1, members: 1 });

export default mongoose.model<ITeamApiKey>('TeamApiKey', TeamApiKeySchema);
