import { Db, MongoClient } from 'mongodb';

// Renames the RBAC role values introduced in 20260824155100-add_role_field.ts:
//   'super_admin' -> 'admin'
//   'mentor'      -> 'owner'
//   'dev'         -> 'dev' (unchanged)
//
// A separate migration (not an edit of the original one) because
// 20260824155100-add_role_field.ts may already have run against a real
// database — migrate-mongo tracks completed migrations by filename, so
// editing that file in place would silently skip re-running it anywhere it
// already executed, leaving old string values (`super_admin`/`mentor`) on
// disk while the application code expects the new ones.
module.exports = {
  async up(db: Db, _client: MongoClient) {
    const usersCollection = db.collection('users');
    const invitesCollection = db.collection('teaminvites');

    await usersCollection.updateMany(
      { role: 'super_admin' },
      { $set: { role: 'admin' } },
    );
    await usersCollection.updateMany(
      { role: 'mentor' },
      { $set: { role: 'owner' } },
    );

    await invitesCollection.updateMany(
      { role: 'mentor' },
      { $set: { role: 'owner' } },
    );
  },

  async down(db: Db, _client: MongoClient) {
    const usersCollection = db.collection('users');
    const invitesCollection = db.collection('teaminvites');

    await usersCollection.updateMany(
      { role: 'admin' },
      { $set: { role: 'super_admin' } },
    );
    await usersCollection.updateMany(
      { role: 'owner' },
      { $set: { role: 'mentor' } },
    );

    await invitesCollection.updateMany(
      { role: 'owner' },
      { $set: { role: 'mentor' } },
    );
  },
};
