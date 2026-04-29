/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-require-imports */
import { Injectable } from '@angular/core';
import { FileAccessBase } from '../../common/io/file-access.base';
import { DesktopBase } from '../../common/io/desktop.base';
import { Logger } from '../../common/logger';
import { CoverArtArchiveApi } from '../../common/api/musicbrainz/cover-art-archive.api';

@Injectable({ providedIn: 'root' })
export class ReleaseCoverCache {
    private cacheDir: string = '';

    public constructor(
        private fileAccess: FileAccessBase,
        private desktop: DesktopBase,
        private coverArtArchiveApi: CoverArtArchiveApi,
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
    ): Promise<{ localPath?: string; transientError: boolean; notFound: boolean }> {
        const localPath = this.localPathFor(releaseGroupMbid);
        if (this.fileAccess.pathExists(localPath)) {
            return { localPath: localPath, transientError: false, notFound: false };
        }

        const result = await this.coverArtArchiveApi.fetchFrontImage(releaseGroupMbid, 500);
        if (result.found && result.buffer != undefined) {
            try {
                const fs: typeof import('fs-extra') = require('fs-extra');
                await fs.writeFile(localPath, result.buffer);
                return { localPath: localPath, transientError: false, notFound: false };
            } catch (e) {
                this.logger.error(e, 'Could not write release cover to disk', 'ReleaseCoverCache', 'ensureCoverAsync');
                return { localPath: undefined, transientError: true, notFound: false };
            }
        }

        return { localPath: undefined, transientError: result.transientError, notFound: !result.transientError };
    }
}
