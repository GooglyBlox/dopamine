import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { ProductInformation } from '../../application/product-information';

export interface LrcLibRecord {
    id: number;
    name?: string;
    trackName?: string;
    artistName?: string;
    albumName?: string;
    duration?: number;
    instrumental?: boolean;
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
}

export class LrcLibHit {
    public constructor(
        public id: number,
        public artist: string,
        public title: string,
        public album: string,
        public durationSeconds: number,
        public synced: string | undefined,
        public plain: string | undefined,
        public instrumental: boolean,
    ) {}

    public get hasUsableLyrics(): boolean {
        return !this.instrumental && (!!this.synced || !!this.plain);
    }

    public static fromRecord(record: LrcLibRecord): LrcLibHit {
        return new LrcLibHit(
            record.id ?? 0,
            record.artistName ?? '',
            record.trackName ?? record.name ?? '',
            record.albumName ?? '',
            Number(record.duration ?? 0),
            record.syncedLyrics != undefined && record.syncedLyrics !== '' ? record.syncedLyrics : undefined,
            record.plainLyrics != undefined && record.plainLyrics !== '' ? record.plainLyrics : undefined,
            !!record.instrumental,
        );
    }
}

@Injectable()
export class LrcLibApi {
    private static readonly baseUrl: string = 'https://lrclib.net/api';

    public constructor(private httpClient: HttpClient) {}

    public get sourceName(): string {
        return 'LRCLIB';
    }

    private get userAgent(): string {
        return `${ProductInformation.applicationName}/${ProductInformation.applicationVersion} ( https://github.com/digimezzo/dopamine )`;
    }

    public async getExactAsync(
        artist: string,
        title: string,
        album: string,
        durationSeconds: number,
    ): Promise<LrcLibHit | undefined> {
        const params: HttpParams = new HttpParams()
            .set('artist_name', artist)
            .set('track_name', title)
            .set('album_name', album)
            .set('duration', String(Math.round(durationSeconds)));

        try {
            const response: LrcLibRecord | undefined = await this.httpClient
                .get<LrcLibRecord>(`${LrcLibApi.baseUrl}/get`, {
                    params,
                    headers: { 'User-Agent': this.userAgent },
                })
                .toPromise();

            if (response == undefined) {
                return undefined;
            }

            return LrcLibHit.fromRecord(response);
        } catch (e: unknown) {
            if (e instanceof HttpErrorResponse && e.status === 404) {
                return undefined;
            }
            throw e;
        }
    }

    public async searchAsync(artist: string, title: string): Promise<LrcLibHit[]> {
        const params: HttpParams = new HttpParams().set('track_name', title).set('artist_name', artist);

        try {
            const response: LrcLibRecord[] | undefined = await this.httpClient
                .get<LrcLibRecord[]>(`${LrcLibApi.baseUrl}/search`, {
                    params,
                    headers: { 'User-Agent': this.userAgent },
                })
                .toPromise();

            if (!Array.isArray(response)) {
                return [];
            }

            return response.map((r) => LrcLibHit.fromRecord(r));
        } catch (e: unknown) {
            if (e instanceof HttpErrorResponse && e.status === 404) {
                return [];
            }
            throw e;
        }
    }
}
