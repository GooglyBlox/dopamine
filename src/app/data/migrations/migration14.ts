import { Migration } from '../migration';

export class Migration14 extends Migration {
    public id: number = 14;
    public name: string = 'Migration14';

    public up(): void {
        this.sql(`ALTER TABLE Track ADD COLUMN IsBlacklisted INTEGER NOT NULL DEFAULT 0;`);

        this.sql(`CREATE TABLE IF NOT EXISTS BlacklistedArtist (
                      NameKey TEXT PRIMARY KEY,
                      Name TEXT NOT NULL,
                      IsBlacklisted INTEGER NOT NULL DEFAULT 1,
                      DateUpdated INTEGER NOT NULL DEFAULT 0
                  );`);
    }
}
