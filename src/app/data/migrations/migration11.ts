import { Migration } from '../migration';

export class Migration11 extends Migration {
    public id: number = 11;
    public name: string = 'Migration11';

    public up(): void {
        this.sql(`ALTER TABLE MbArtist ADD COLUMN MbName TEXT;`);
        this.sql(`ALTER TABLE MbArtist ADD COLUMN MbDisambiguation TEXT;`);
        this.sql(`ALTER TABLE MbArtist ADD COLUMN MbType TEXT;`);
        this.sql(`ALTER TABLE MbArtist ADD COLUMN MbCountry TEXT;`);
    }
}
