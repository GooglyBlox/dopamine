/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { Injectable } from '@angular/core';
import fetch from 'node-fetch';
import { Logger } from '../../logger';

const CAA_BASE = 'https://coverartarchive.org';
const USER_AGENT = 'Dopamine/3.0.5 ( https://github.com/digimezzo/dopamine )';

export interface CoverArtFetchResult {
    found: boolean;
    transientError: boolean;
    buffer?: Buffer;
}

@Injectable({ providedIn: 'root' })
export class CoverArtArchiveApi {
    public constructor(private logger: Logger) {}

    public buildFrontUrl(releaseGroupMbid: string, size: 250 | 500 | 1200 = 500): string {
        return `${CAA_BASE}/release-group/${releaseGroupMbid}/front-${size}`;
    }

    public async fetchFrontImage(releaseGroupMbid: string, size: 250 | 500 | 1200 = 500): Promise<CoverArtFetchResult> {
        const url = this.buildFrontUrl(releaseGroupMbid, size);
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': USER_AGENT,
                },
                redirect: 'follow',
            });

            if (response.status === 404) {
                return { found: false, transientError: false };
            }

            if (!response.ok) {
                this.logger.warn(
                    `CoverArtArchive request failed: ${response.status} ${response.statusText}`,
                    'CoverArtArchiveApi',
                    'fetchFrontImage',
                );
                return { found: false, transientError: true };
            }

            const arrayBuffer = await response.arrayBuffer();
            return { found: true, transientError: false, buffer: Buffer.from(arrayBuffer) };
        } catch (e) {
            this.logger.error(e, `CoverArtArchive request failed for ${url}`, 'CoverArtArchiveApi', 'fetchFrontImage');
            return { found: false, transientError: true };
        }
    }
}
