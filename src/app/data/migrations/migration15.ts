import { Migration } from '../migration';

export class Migration15 extends Migration {
    public id: number = 15;
    public name: string = 'Migration15';

    public up(): void {
        this.sql(`CREATE TABLE ArtistArtwork (
                            ArtistArtworkID	    INTEGER,
                            Artist	            TEXT,
                            ArtworkID	        TEXT,
                            PRIMARY KEY(ArtistArtworkID));`);

        this.sql('ALTER TABLE Track ADD ArtistsKey TEXT;');
    }
}
