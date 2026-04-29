export enum MbArtistResolutionStatus {
    unresolved = 0,
    resolved = 1,
    notFound = 2,
    failed = 3,
}

export enum MbArtistSyncStatus {
    idle = 0,
    syncing = 1,
    synced = 2,
    failed = 3,
}

export class MbArtist {
    public mbArtistId: number = 0;
    public name: string = '';
    public nameKey: string = '';
    public mbid: string | undefined;
    public resolutionStatus: number = MbArtistResolutionStatus.unresolved;
    public lastResolvedAt: number = 0;
    public lastSyncedAt: number = 0;
    public syncStatus: number = MbArtistSyncStatus.idle;
    public syncError: string | undefined;
    public mbName: string | undefined;
    public mbDisambiguation: string | undefined;
    public mbType: string | undefined;
    public mbCountry: string | undefined;
}
