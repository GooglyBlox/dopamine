import { Migration } from '../migration';

export class Migration12 extends Migration {
    public id: number = 12;
    public name: string = 'Migration12';

    public up(): void {
        this.sql('ALTER TABLE Track ADD COLUMN ReplayGainTrackGain REAL;');
        this.sql('ALTER TABLE Track ADD COLUMN ReplayGainTrackPeak REAL;');
        this.sql('ALTER TABLE Track ADD COLUMN ReplayGainAlbumGain REAL;');
        this.sql('ALTER TABLE Track ADD COLUMN ReplayGainAlbumPeak REAL;');
    }
}
