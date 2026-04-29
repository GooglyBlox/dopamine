import { Migration } from '../migration';

export class Migration10 extends Migration {
    public id: number = 10;
    public name: string = 'Migration10';

    public up(): void {
        this.sql(`CREATE TABLE IF NOT EXISTS MbArtist (
                      MbArtistID INTEGER PRIMARY KEY AUTOINCREMENT,
                      Name TEXT NOT NULL,
                      NameKey TEXT NOT NULL UNIQUE,
                      Mbid TEXT,
                      ResolutionStatus INTEGER NOT NULL DEFAULT 0,
                      LastResolvedAt INTEGER NOT NULL DEFAULT 0,
                      LastSyncedAt INTEGER NOT NULL DEFAULT 0,
                      SyncStatus INTEGER NOT NULL DEFAULT 0,
                      SyncError TEXT
                  );`);

        this.sql(`CREATE INDEX IF NOT EXISTS IX_MbArtist_Mbid ON MbArtist(Mbid);`);

        this.sql(`CREATE TABLE IF NOT EXISTS FollowedArtist (
                      NameKey TEXT PRIMARY KEY,
                      Name TEXT NOT NULL,
                      IsFollowed INTEGER NOT NULL DEFAULT 1,
                      DateUpdated INTEGER NOT NULL DEFAULT 0
                  );`);

        this.sql(`CREATE TABLE IF NOT EXISTS ReleaseGroup (
                      Mbid TEXT PRIMARY KEY,
                      ArtistMbid TEXT NOT NULL,
                      ArtistName TEXT NOT NULL,
                      Title TEXT NOT NULL,
                      PrimaryType TEXT,
                      SecondaryTypes TEXT,
                      FirstReleaseDate TEXT,
                      ReleaseDateValue INTEGER NOT NULL DEFAULT 0,
                      HasCoverArt INTEGER NOT NULL DEFAULT 0,
                      CoverArtCheckedAt INTEGER NOT NULL DEFAULT 0,
                      LocalCoverPath TEXT,
                      LastSyncedAt INTEGER NOT NULL DEFAULT 0,
                      Hidden INTEGER NOT NULL DEFAULT 0
                  );`);

        this.sql(`CREATE INDEX IF NOT EXISTS IX_ReleaseGroup_ArtistMbid ON ReleaseGroup(ArtistMbid);`);
        this.sql(`CREATE INDEX IF NOT EXISTS IX_ReleaseGroup_ReleaseDateValue ON ReleaseGroup(ReleaseDateValue);`);
    }
}
