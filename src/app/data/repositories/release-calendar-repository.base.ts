import { BlacklistedArtist } from '../entities/blacklisted-artist';
import { FollowedArtist } from '../entities/followed-artist';
import { MbArtist } from '../entities/mb-artist';
import { ReleaseGroup } from '../entities/release-group';

export abstract class ReleaseCalendarRepositoryBase {
    public abstract upsertMbArtist(name: string, nameKey: string): MbArtist;
    public abstract getMbArtistByNameKey(nameKey: string): MbArtist | undefined;
    public abstract getMbArtistByMbid(mbid: string): MbArtist | undefined;
    public abstract getAllMbArtists(): MbArtist[];
    public abstract getResolvedMbArtists(): MbArtist[];
    public abstract getUnresolvedMbArtists(): MbArtist[];
    public abstract setMbArtistResolution(nameKey: string, mbid: string | undefined, status: number, when: number): void;
    public abstract setMbArtistResolutionWithInfo(
        nameKey: string,
        mbid: string,
        info: { mbName?: string; mbDisambiguation?: string; mbType?: string; mbCountry?: string },
        when: number,
    ): void;
    public abstract resetMbArtistSyncForRebind(nameKey: string): void;
    public abstract setMbArtistSyncStatus(nameKey: string, status: number, when: number, error: string | undefined): void;

    public abstract setFollowed(name: string, nameKey: string, isFollowed: boolean, when: number): void;
    public abstract getFollowOverride(nameKey: string): FollowedArtist | undefined;
    public abstract getAllFollowOverrides(): FollowedArtist[];

    public abstract setArtistBlacklisted(name: string, nameKey: string, isBlacklisted: boolean, when: number): void;
    public abstract getArtistBlacklistOverride(nameKey: string): BlacklistedArtist | undefined;
    public abstract getAllArtistBlacklistOverrides(): BlacklistedArtist[];

    public abstract upsertReleaseGroup(rg: ReleaseGroup): void;
    public abstract getReleaseGroupsForArtist(artistMbid: string): ReleaseGroup[];
    public abstract getReleaseGroupsForArtists(artistMbids: string[]): ReleaseGroup[];
    public abstract setReleaseGroupCoverArt(mbid: string, hasCoverArt: number, localPath: string | undefined, checkedAt: number): void;
    public abstract setReleaseGroupHidden(mbid: string, hidden: boolean): void;
    public abstract deleteReleaseGroupsForArtist(artistMbid: string): void;
}
