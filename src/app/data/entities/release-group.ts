export class ReleaseGroup {
    public mbid: string = '';
    public artistMbid: string = '';
    public artistName: string = '';
    public title: string = '';
    public primaryType: string | undefined;
    public secondaryTypes: string | undefined;
    public firstReleaseDate: string | undefined;
    public releaseDateValue: number = 0;
    public hasCoverArt: number = 0;
    public coverArtCheckedAt: number = 0;
    public localCoverPath: string | undefined;
    public lastSyncedAt: number = 0;
    public hidden: number = 0;
}
