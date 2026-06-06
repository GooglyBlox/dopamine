import { Migration } from '../migration';

export class Migration13 extends Migration {
    public id: number = 13;
    public name: string = 'Migration13';

    public up(): void {
        this.sql('ALTER TABLE AlbumArtwork ADD COLUMN IsManuallySet INTEGER DEFAULT 0;');
    }
}
