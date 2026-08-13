import { Migration } from '../migration';

export class Migration16 extends Migration {
    public id: number = 16;
    public name: string = 'Migration16';

    public up(): void {
        this.sql('ALTER TABLE ArtistArtwork ADD COLUMN IsManuallySet INTEGER DEFAULT 0;');
    }
}
