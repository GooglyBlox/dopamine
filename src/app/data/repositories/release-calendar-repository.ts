/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@angular/core';
import { DatabaseFactory } from '../database-factory';
import { ClauseCreator } from '../clause-creator';
import { FollowedArtist } from '../entities/followed-artist';
import { MbArtist, MbArtistResolutionStatus, MbArtistSyncStatus } from '../entities/mb-artist';
import { ReleaseGroup } from '../entities/release-group';
import { ReleaseCalendarRepositoryBase } from './release-calendar-repository.base';

@Injectable()
export class ReleaseCalendarRepository implements ReleaseCalendarRepositoryBase {
    public constructor(private databaseFactory: DatabaseFactory) {}

    public upsertMbArtist(name: string, nameKey: string): MbArtist {
        const database: any = this.databaseFactory.create();
        database
            .prepare(
                `INSERT INTO MbArtist (Name, NameKey, ResolutionStatus, LastResolvedAt, LastSyncedAt, SyncStatus)
                 VALUES (@name, @nameKey, ${MbArtistResolutionStatus.unresolved}, 0, 0, ${MbArtistSyncStatus.idle})
                 ON CONFLICT(NameKey) DO UPDATE SET Name = excluded.Name`,
            )
            .run({ name: name, nameKey: nameKey });

        const row = database.prepare(`SELECT * FROM MbArtist WHERE NameKey = ?`).get(nameKey);
        return this.rowToMbArtist(row);
    }

    public getMbArtistByNameKey(nameKey: string): MbArtist | undefined {
        const database: any = this.databaseFactory.create();
        const row = database.prepare(`SELECT * FROM MbArtist WHERE NameKey = ?`).get(nameKey);
        return row != undefined ? this.rowToMbArtist(row) : undefined;
    }

    public getMbArtistByMbid(mbid: string): MbArtist | undefined {
        const database: any = this.databaseFactory.create();
        const row = database.prepare(`SELECT * FROM MbArtist WHERE Mbid = ?`).get(mbid);
        return row != undefined ? this.rowToMbArtist(row) : undefined;
    }

    public getAllMbArtists(): MbArtist[] {
        const database: any = this.databaseFactory.create();
        const rows = database.prepare(`SELECT * FROM MbArtist`).all();
        return rows.map((r: any) => this.rowToMbArtist(r));
    }

    public getResolvedMbArtists(): MbArtist[] {
        const database: any = this.databaseFactory.create();
        const rows = database
            .prepare(`SELECT * FROM MbArtist WHERE ResolutionStatus = ${MbArtistResolutionStatus.resolved} AND Mbid IS NOT NULL`)
            .all();
        return rows.map((r: any) => this.rowToMbArtist(r));
    }

    public getUnresolvedMbArtists(): MbArtist[] {
        const database: any = this.databaseFactory.create();
        const rows = database
            .prepare(`SELECT * FROM MbArtist WHERE ResolutionStatus = ${MbArtistResolutionStatus.unresolved}`)
            .all();
        return rows.map((r: any) => this.rowToMbArtist(r));
    }

    public setMbArtistResolution(nameKey: string, mbid: string | undefined, status: number, when: number): void {
        const database: any = this.databaseFactory.create();
        database
            .prepare(
                `UPDATE MbArtist SET Mbid = @mbid, ResolutionStatus = @status, LastResolvedAt = @when WHERE NameKey = @nameKey`,
            )
            .run({ mbid: mbid ?? null, status: status, when: when, nameKey: nameKey });
    }

    public setMbArtistResolutionWithInfo(
        nameKey: string,
        mbid: string,
        info: { mbName?: string; mbDisambiguation?: string; mbType?: string; mbCountry?: string },
        when: number,
    ): void {
        const database: any = this.databaseFactory.create();
        database
            .prepare(
                `UPDATE MbArtist SET Mbid = @mbid, ResolutionStatus = ${MbArtistResolutionStatus.resolved}, LastResolvedAt = @when,
                    MbName = @mbName, MbDisambiguation = @mbDisambiguation, MbType = @mbType, MbCountry = @mbCountry WHERE NameKey = @nameKey`,
            )
            .run({
                mbid: mbid,
                when: when,
                mbName: info.mbName ?? null,
                mbDisambiguation: info.mbDisambiguation ?? null,
                mbType: info.mbType ?? null,
                mbCountry: info.mbCountry ?? null,
                nameKey: nameKey,
            });
    }

    public resetMbArtistSyncForRebind(nameKey: string): void {
        const database: any = this.databaseFactory.create();
        database
            .prepare(`UPDATE MbArtist SET LastSyncedAt = 0, SyncStatus = ${MbArtistSyncStatus.idle}, SyncError = NULL WHERE NameKey = @nameKey`)
            .run({ nameKey: nameKey });
    }

    public setMbArtistSyncStatus(nameKey: string, status: number, when: number, error: string | undefined): void {
        const database: any = this.databaseFactory.create();
        database
            .prepare(
                `UPDATE MbArtist SET SyncStatus = @status, LastSyncedAt = @when, SyncError = @error WHERE NameKey = @nameKey`,
            )
            .run({ status: status, when: when, error: error ?? null, nameKey: nameKey });
    }

    public setFollowed(name: string, nameKey: string, isFollowed: boolean, when: number): void {
        const database: any = this.databaseFactory.create();
        database
            .prepare(
                `INSERT INTO FollowedArtist (NameKey, Name, IsFollowed, DateUpdated)
                 VALUES (@nameKey, @name, @isFollowed, @when)
                 ON CONFLICT(NameKey) DO UPDATE SET Name = excluded.Name, IsFollowed = excluded.IsFollowed, DateUpdated = excluded.DateUpdated`,
            )
            .run({ nameKey: nameKey, name: name, isFollowed: isFollowed ? 1 : 0, when: when });
    }

    public getFollowOverride(nameKey: string): FollowedArtist | undefined {
        const database: any = this.databaseFactory.create();
        const row = database.prepare(`SELECT * FROM FollowedArtist WHERE NameKey = ?`).get(nameKey);
        return row != undefined ? this.rowToFollowed(row) : undefined;
    }

    public getAllFollowOverrides(): FollowedArtist[] {
        const database: any = this.databaseFactory.create();
        const rows = database.prepare(`SELECT * FROM FollowedArtist`).all();
        return rows.map((r: any) => this.rowToFollowed(r));
    }

    public upsertReleaseGroup(rg: ReleaseGroup): void {
        const database: any = this.databaseFactory.create();
        database
            .prepare(
                `INSERT INTO ReleaseGroup (
                    Mbid, ArtistMbid, ArtistName, Title, PrimaryType, SecondaryTypes,
                    FirstReleaseDate, ReleaseDateValue, HasCoverArt, CoverArtCheckedAt,
                    LocalCoverPath, LastSyncedAt, Hidden
                 ) VALUES (
                    @mbid, @artistMbid, @artistName, @title, @primaryType, @secondaryTypes,
                    @firstReleaseDate, @releaseDateValue, @hasCoverArt, @coverArtCheckedAt,
                    @localCoverPath, @lastSyncedAt, @hidden
                 )
                 ON CONFLICT(Mbid) DO UPDATE SET
                    ArtistMbid = excluded.ArtistMbid,
                    ArtistName = excluded.ArtistName,
                    Title = excluded.Title,
                    PrimaryType = excluded.PrimaryType,
                    SecondaryTypes = excluded.SecondaryTypes,
                    FirstReleaseDate = excluded.FirstReleaseDate,
                    ReleaseDateValue = excluded.ReleaseDateValue,
                    LastSyncedAt = excluded.LastSyncedAt`,
            )
            .run({
                mbid: rg.mbid,
                artistMbid: rg.artistMbid,
                artistName: rg.artistName,
                title: rg.title,
                primaryType: rg.primaryType ?? null,
                secondaryTypes: rg.secondaryTypes ?? null,
                firstReleaseDate: rg.firstReleaseDate ?? null,
                releaseDateValue: rg.releaseDateValue,
                hasCoverArt: rg.hasCoverArt,
                coverArtCheckedAt: rg.coverArtCheckedAt,
                localCoverPath: rg.localCoverPath ?? null,
                lastSyncedAt: rg.lastSyncedAt,
                hidden: rg.hidden,
            });
    }

    public getReleaseGroupsForArtist(artistMbid: string): ReleaseGroup[] {
        const database: any = this.databaseFactory.create();
        const rows = database.prepare(`SELECT * FROM ReleaseGroup WHERE ArtistMbid = ?`).all(artistMbid);
        return rows.map((r: any) => this.rowToReleaseGroup(r));
    }

    public getReleaseGroupsForArtists(artistMbids: string[]): ReleaseGroup[] {
        if (artistMbids.length === 0) {
            return [];
        }
        const database: any = this.databaseFactory.create();
        const clause = ClauseCreator.createTextInClause('ArtistMbid', artistMbids);
        const rows = database
            .prepare(`SELECT * FROM ReleaseGroup WHERE ${clause} AND Hidden = 0 ORDER BY ReleaseDateValue DESC`)
            .all();
        return rows.map((r: any) => this.rowToReleaseGroup(r));
    }

    public setReleaseGroupCoverArt(mbid: string, hasCoverArt: number, localPath: string | undefined, checkedAt: number): void {
        const database: any = this.databaseFactory.create();
        database
            .prepare(
                `UPDATE ReleaseGroup SET HasCoverArt = @hasCoverArt, LocalCoverPath = @localPath, CoverArtCheckedAt = @checkedAt WHERE Mbid = @mbid`,
            )
            .run({ hasCoverArt: hasCoverArt, localPath: localPath ?? null, checkedAt: checkedAt, mbid: mbid });
    }

    public setReleaseGroupHidden(mbid: string, hidden: boolean): void {
        const database: any = this.databaseFactory.create();
        database.prepare(`UPDATE ReleaseGroup SET Hidden = ? WHERE Mbid = ?`).run(hidden ? 1 : 0, mbid);
    }

    public deleteReleaseGroupsForArtist(artistMbid: string): void {
        const database: any = this.databaseFactory.create();
        database.prepare(`DELETE FROM ReleaseGroup WHERE ArtistMbid = ?`).run(artistMbid);
    }

    private rowToMbArtist(row: any): MbArtist {
        const a = new MbArtist();
        a.mbArtistId = row.MbArtistID;
        a.name = row.Name;
        a.nameKey = row.NameKey;
        a.mbid = row.Mbid ?? undefined;
        a.resolutionStatus = row.ResolutionStatus ?? 0;
        a.lastResolvedAt = row.LastResolvedAt ?? 0;
        a.lastSyncedAt = row.LastSyncedAt ?? 0;
        a.syncStatus = row.SyncStatus ?? 0;
        a.syncError = row.SyncError ?? undefined;
        a.mbName = row.MbName ?? undefined;
        a.mbDisambiguation = row.MbDisambiguation ?? undefined;
        a.mbType = row.MbType ?? undefined;
        a.mbCountry = row.MbCountry ?? undefined;
        return a;
    }

    private rowToFollowed(row: any): FollowedArtist {
        const f = new FollowedArtist();
        f.nameKey = row.NameKey;
        f.name = row.Name;
        f.isFollowed = row.IsFollowed ?? 0;
        f.dateUpdated = row.DateUpdated ?? 0;
        return f;
    }

    private rowToReleaseGroup(row: any): ReleaseGroup {
        const rg = new ReleaseGroup();
        rg.mbid = row.Mbid;
        rg.artistMbid = row.ArtistMbid;
        rg.artistName = row.ArtistName;
        rg.title = row.Title;
        rg.primaryType = row.PrimaryType ?? undefined;
        rg.secondaryTypes = row.SecondaryTypes ?? undefined;
        rg.firstReleaseDate = row.FirstReleaseDate ?? undefined;
        rg.releaseDateValue = row.ReleaseDateValue ?? 0;
        rg.hasCoverArt = row.HasCoverArt ?? 0;
        rg.coverArtCheckedAt = row.CoverArtCheckedAt ?? 0;
        rg.localCoverPath = row.LocalCoverPath ?? undefined;
        rg.lastSyncedAt = row.LastSyncedAt ?? 0;
        rg.hidden = row.Hidden ?? 0;
        return rg;
    }
}
