import { Db, MongoClient } from 'mongodb';

module.exports = {
  async up(db: Db, _client: MongoClient) {
    const usersCollection = db.collection('users');
    const teamsCollection = db.collection('teams');

    // Find the first team created
    const firstTeam = await teamsCollection.findOne({}, { sort: { createdAt: 1 } });
    
    if (firstTeam) {
      // Find the first user in the first team
      const firstUser = await usersCollection.findOne(
        { team: firstTeam._id },
        { sort: { createdAt: 1 } }
      );

      if (firstUser) {
        // Set the first user as super_admin
        await usersCollection.updateOne(
          { _id: firstUser._id },
          { $set: { role: 'super_admin' } }
        );
      }
    }

    // Set all other users who don't have a valid new role to 'dev'
    await usersCollection.updateMany(
      { role: { $nin: ['super_admin', 'mentor', 'dev'] } },
      { $set: { role: 'dev' } }
    );

    // If there are existing team invites, set their role to 'dev'
    const invitesCollection = db.collection('teaminvites');
    if (invitesCollection) {
      await invitesCollection.updateMany(
        { role: { $nin: ['mentor', 'dev'] } },
        { $set: { role: 'dev' } }
      );
    }
  },

  async down(db: Db, _client: MongoClient) {
    const usersCollection = db.collection('users');
    await usersCollection.updateMany({}, { $unset: { role: '' } });
    
    const invitesCollection = db.collection('teaminvites');
    if (invitesCollection) {
      await invitesCollection.updateMany({}, { $unset: { role: '' } });
    }
  },
};
