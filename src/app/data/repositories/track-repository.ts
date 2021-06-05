import { Injectable } from '@angular/core';
import { AlbumData } from '../album-data';
import { ClauseCreator } from '../clause-creator';
import { DatabaseFactory } from '../database-factory';
import { Track } from '../entities/track';
import { QueryParts } from '../query-parts';
import { BaseTrackRepository } from './base-track-repository';

@Injectable()
export class TrackRepository implements BaseTrackRepository {
    constructor(private databaseFactory: DatabaseFactory) {}

    public getNumberOfTracksThatNeedIndexing(): number {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(
            `SELECT COUNT(*) AS numberOfTracks
             FROM Track
             WHERE NeedsIndexing=?;`
        );

        const result: any = statement.get(1);

        return result.numberOfTracks;
    }

    public getNumberOfTracks(): number {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare('SELECT COUNT(*) AS numberOfTracks FROM Track;');

        const result: any = statement.get();

        return result.numberOfTracks;
    }

    public getMaximumDateFileModified(): number {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare('SELECT MAX(DateFileModified) AS maximumDateFileModified FROM Track;');

        const result: any = statement.get();

        return result.maximumDateFileModified;
    }

    public getNumberOfTracksThatDoNotBelongFolders(): number {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(`SELECT COUNT(*) AS numberOfTracks
        FROM Track WHERE TrackID IN (
            SELECT TrackID
            FROM FolderTrack
            WHERE FolderID NOT IN (SELECT FolderID FROM Folder));`);

        const result: any = statement.get();

        return result.numberOfTracks;
    }

    public deleteTracksThatDoNotBelongFolders(): number {
        const database: any = this.databaseFactory.create();
        const statement: any = database.prepare(
            `DELETE FROM Track WHERE TrackID IN (
                SELECT TrackID
                FROM FolderTrack
                WHERE FolderID NOT IN (SELECT FolderID FROM Folder));`
        );

        const info = statement.run();

        return info.changes;
    }

    public deleteTrack(trackId: number): void {
        const database: any = this.databaseFactory.create();
        database.prepare('DELETE FROM Track WHERE TrackID = ?;').run(trackId);
    }

    public getAllTracks(): Track[] {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(QueryParts.selectTracksQueryPart(true));

        const tracks: Track[] = statement.all();

        return tracks;
    }

    public getAlbumTracks(albumKeys: string[]): Track[] {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(
            `${QueryParts.selectTracksQueryPart(true)} AND ${ClauseCreator.createInClause('t.AlbumKey', albumKeys)}`
        );

        const tracks: Track[] = statement.all();

        return tracks;
    }

    public updateTrack(track: Track): void {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(
            `UPDATE Track
                SET Artists=@artists,
                Genres=@genres,
                AlbumTitle=@albumTitle,
                AlbumArtists=@albumArtists,
                AlbumKey=@albumKey,
                Path=@path,
                SafePath=@path,
                FileName=@fileName,
                MimeType=@mimeType,
                FileSize=@fileSize,
                BitRate=@bitRate,
                SampleRate=@sampleRate,
                TrackTitle=@trackTitle,
                TrackNumber=@trackNumber,
                TrackCount=@trackCount,
                DiscNumber=@discNumber,
                DiscCount=@discCount,
                Duration=@duration,
                Year=@year,
                HasLyrics=@hasLyrics,
                DateAdded=@dateAdded,
                DateFileCreated=@dateFileCreated,
                DateLastSynced=@dateLastSynced,
                DateFileModified=@dateFileModified,
                NeedsIndexing=@needsIndexing,
                NeedsAlbumArtworkIndexing=@needsAlbumArtworkIndexing,
                IndexingSuccess=@indexingSuccess,
                IndexingFailureReason=@indexingFailureReason,
                Rating=@rating,
                Love=@love,
                PlayCount=@playCount,
                SkipCount=@skipCount,
                DateLastPlayed=@dateLastPlayed
                WHERE TrackID=@trackId;`
        );

        statement.run({
            trackId: track.trackId,
            artists: track.artists,
            genres: track.genres,
            albumTitle: track.albumTitle,
            albumArtists: track.albumArtists,
            albumKey: track.albumKey,
            path: track.path,
            safePath: track.path,
            fileName: track.fileName,
            mimeType: track.mimeType,
            fileSize: track.fileSize,
            bitRate: track.bitRate,
            sampleRate: track.sampleRate,
            trackTitle: track.trackTitle,
            trackNumber: track.trackNumber,
            trackCount: track.trackCount,
            discNumber: track.discNumber,
            discCount: track.discCount,
            duration: track.duration,
            year: track.year,
            hasLyrics: track.hasLyrics,
            dateAdded: track.dateAdded,
            dateFileCreated: track.dateFileCreated,
            dateLastSynced: track.dateLastSynced,
            dateFileModified: track.dateFileModified,
            needsIndexing: track.needsIndexing,
            needsAlbumArtworkIndexing: track.needsAlbumArtworkIndexing,
            indexingSuccess: track.indexingSuccess,
            indexingFailureReason: track.indexingFailureReason,
            rating: track.rating,
            love: track.love,
            playCount: track.playCount,
            skipCount: track.skipCount,
            dateLastPlayed: track.dateLastPlayed,
        });
    }

    public addTrack(track: Track): void {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(
            `INSERT INTO Track(
                    Artists,
                    Genres,
                    AlbumTitle,
                    AlbumArtists,
                    AlbumKey,
                    Path,
                    SafePath,
                    FileName,
                    MimeType,
                    FileSize,
                    BitRate,
                    SampleRate,
                    TrackTitle,
                    TrackNumber,
                    TrackCount,
                    DiscNumber,
                    DiscCount,
                    Duration,
                    Year,
                    HasLyrics,
                    DateAdded,
                    DateFileCreated,
                    DateLastSynced,
                    DateFileModified,
                    NeedsIndexing,
                    NeedsAlbumArtworkIndexing,
                    IndexingSuccess,
                    IndexingFailureReason,
                    Rating,
                    Love,
                    PlayCount,
                    SkipCount,
                    DateLastPlayed
                ) VALUES (
                    @artists,
                    @genres,
                    @albumTitle,
                    @albumArtists,
                    @albumKey,
                    @path,
                    @safePath,
                    @fileName,
                    @mimeType,
                    @fileSize,
                    @bitRate,
                    @sampleRate,
                    @trackTitle,
                    @trackNumber,
                    @trackCount,
                    @discNumber,
                    @discCount,
                    @duration,
                    @year,
                    @hasLyrics,
                    @dateAdded,
                    @dateFileCreated,
                    @dateLastSynced,
                    @dateFileModified,
                    @needsIndexing,
                    @needsAlbumArtworkIndexing,
                    @indexingSuccess,
                    @indexingFailureReason,
                    @rating,
                    @love,
                    @playCount,
                    @skipCount,
                    @dateLastPlayed
                );`
        );

        statement.run({
            artists: track.artists,
            genres: track.genres,
            albumTitle: track.albumTitle,
            albumArtists: track.albumArtists,
            albumKey: track.albumKey,
            path: track.path,
            safePath: track.path,
            fileName: track.fileName,
            mimeType: track.mimeType,
            fileSize: track.fileSize,
            bitRate: track.bitRate,
            sampleRate: track.sampleRate,
            trackTitle: track.trackTitle,
            trackNumber: track.trackNumber,
            trackCount: track.trackCount,
            discNumber: track.discNumber,
            discCount: track.discCount,
            duration: track.duration,
            year: track.year,
            hasLyrics: track.hasLyrics,
            dateAdded: track.dateAdded,
            dateFileCreated: track.dateFileCreated,
            dateLastSynced: track.dateLastSynced,
            dateFileModified: track.dateFileModified,
            needsIndexing: track.needsIndexing,
            needsAlbumArtworkIndexing: track.needsAlbumArtworkIndexing,
            indexingSuccess: track.indexingSuccess,
            indexingFailureReason: track.indexingFailureReason,
            rating: track.rating,
            love: track.love,
            playCount: track.playCount,
            skipCount: track.skipCount,
            dateLastPlayed: track.dateLastPlayed,
        });
    }

    public getTrackByPath(path: string): Track {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(`${QueryParts.selectTracksQueryPart(false)} WHERE t.Path=?;`);

        const track: Track = statement.get(path);

        return track;
    }

    public getAlbumDataThatNeedsIndexing(): AlbumData[] {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(
            `${QueryParts.selectAlbumDataQueryPart(false)}
                WHERE AlbumKey IS NOT NULL AND AlbumKey <> ''
                AND (AlbumKey NOT IN (SELECT AlbumKey FROM AlbumArtwork) OR NeedsAlbumArtworkIndexing=1)
                GROUP BY AlbumKey;`
        );

        const albumData: AlbumData[] = statement.all();

        return albumData;
    }

    public getAllAlbumData(): AlbumData[] {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(`${QueryParts.selectAlbumDataQueryPart(true)} GROUP BY AlbumKey;`);

        const albumData: AlbumData[] = statement.all();

        return albumData;
    }

    public getLastModifiedTrackForAlbumKeyAsync(albumKey: string): Track {
        const database: any = this.databaseFactory.create();

        const statement = database.prepare(`${QueryParts.selectTracksQueryPart(false)} WHERE t.AlbumKey=?;`);

        const track: Track = statement.get(albumKey);

        return track;
    }

    public disableNeedsAlbumArtworkIndexingAsync(albumKey: string): void {
        const database: any = this.databaseFactory.create();
        const statement: any = database.prepare(`UPDATE Track SET NeedsAlbumArtworkIndexing=0 WHERE AlbumKey=?;`);

        statement.run(albumKey);
    }

    public enableNeedsAlbumArtworkIndexingForAllTracks(onlyWhenHasNoCover: boolean): void {
        const database: any = this.databaseFactory.create();
        let statement: any;

        if (onlyWhenHasNoCover) {
            statement = database.prepare(
                `UPDATE Track SET NeedsAlbumArtworkIndexing=1 WHERE AlbumKey NOT IN (SELECT AlbumKey FROM AlbumArtwork);`
            );
        } else {
            statement = database.prepare(`UPDATE Track SET NeedsAlbumArtworkIndexing=1;`);
        }

        statement.run();
    }
}
