/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-require-imports */
import { Injectable } from '@angular/core';
import fetch from 'node-fetch';
import { FileAccessBase } from '../../common/io/file-access.base';
import { DesktopBase } from '../../common/io/desktop.base';
import { Logger } from '../../common/logger';
import { CoverArtArchiveApi } from '../../common/api/musicbrainz/cover-art-archive.api';
import { LastfmApi } from '../../common/api/lastfm/lastfm.api';
import { LastfmAlbum } from '../../common/api/lastfm/lastfm-album';

const LASTFM_PLACEHOLDER_HASHES = ['2a96cbd8b46e442fc41c2b86b821562f', 'c6f59c1e5e7240a4c0d427abd71f3dbb'];

export interface CoverFetchOutcome {
    localPath?: string;
    transientError: boolean;
    notFound: boolean;
}

@Injectable({ providedIn: 'root' })
export class ReleaseCoverCache {
    private cacheDir: string = '';

    public constructor(
        private fileAccess: FileAccessBase,
        private desktop: DesktopBase,
        private coverArtArchiveApi: CoverArtArchiveApi,
        private lastfmApi: LastfmApi,
        private logger: Logger,
    ) {
        this.cacheDir = this.fileAccess.combinePath([this.desktop.getApplicationDataDirectory(), 'Cache', 'ReleaseCovers']);
        try {
            this.fileAccess.createFullDirectoryPathIfDoesNotExist(this.cacheDir);
        } catch (e) {
            this.logger.error(e, 'Could not create release covers cache directory', 'ReleaseCoverCache', 'ctor');
        }
    }

    public localPathFor(releaseGroupMbid: string): string {
        return this.fileAccess.combinePath([this.cacheDir, `${releaseGroupMbid}.jpg`]);
    }

    public exists(releaseGroupMbid: string): boolean {
        return this.fileAccess.pathExists(this.localPathFor(releaseGroupMbid));
    }

    public async ensureCoverAsync(
        releaseGroupMbid: string,
        artistName?: string,
        albumTitle?: string,
    ): Promise<CoverFetchOutcome> {
        const localPath = this.localPathFor(releaseGroupMbid);
        if (this.fileAccess.pathExists(localPath)) {
            return { localPath: localPath, transientError: false, notFound: false };
        }

        const caa = await this.coverArtArchiveApi.fetchFrontImage(releaseGroupMbid, 500);
        if (caa.found && caa.buffer != undefined) {
            return await this.writeBufferToCache(localPath, caa.buffer);
        }

        const tryFallback = !caa.transientError;
        if (tryFallback && artistName != undefined && artistName.length > 0 && albumTitle != undefined && albumTitle.length > 0) {
            const fallback = await this.tryLastfmAsync(artistName, albumTitle);
            if (fallback != undefined) {
                return await this.writeBufferToCache(localPath, fallback);
            }
        }

        return {
            localPath: undefined,
            transientError: caa.transientError,
            notFound: !caa.transientError,
        };
    }

    public async saveExternalCoverAsync(releaseGroupMbid: string, imageUrl: string): Promise<string | undefined> {
        try {
            const response = await fetch(imageUrl, { method: 'GET' });
            if (!response.ok) {
                return undefined;
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const localPath = this.localPathFor(releaseGroupMbid);
            const fs: typeof import('fs-extra') = require('fs-extra');
            await fs.writeFile(localPath, buffer);
            return localPath;
        } catch (e) {
            this.logger.error(e, `Failed to save external cover from ${imageUrl}`, 'ReleaseCoverCache', 'saveExternalCoverAsync');
            return undefined;
        }
    }

    private async writeBufferToCache(localPath: string, buffer: Buffer): Promise<CoverFetchOutcome> {
        try {
            const fs: typeof import('fs-extra') = require('fs-extra');
            await fs.writeFile(localPath, buffer);
            return { localPath: localPath, transientError: false, notFound: false };
        } catch (e) {
            this.logger.error(e, 'Could not write release cover to disk', 'ReleaseCoverCache', 'writeBufferToCache');
            return { localPath: undefined, transientError: true, notFound: false };
        }
    }

    private async tryLastfmAsync(artistName: string, albumTitle: string): Promise<Buffer | undefined> {
        try {
            const album: LastfmAlbum = await this.lastfmApi.getAlbumInfoAsync(artistName, albumTitle, true, '');
            const url = album.largestImage();
            if (url.length === 0 || this.isLastfmPlaceholder(url)) {
                return undefined;
            }
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) {
                return undefined;
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (e) {
            this.logger.error(
                e,
                `Last.fm cover fallback failed for ${artistName} - ${albumTitle}`,
                'ReleaseCoverCache',
                'tryLastfmAsync',
            );
            return undefined;
        }
    }

    private isLastfmPlaceholder(url: string): boolean {
        return LASTFM_PLACEHOLDER_HASHES.some((hash) => url.includes(hash));
    }
}
