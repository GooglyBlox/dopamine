/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable no-constant-condition */
import { Injectable } from '@angular/core';
import fetch from 'node-fetch';
import { Logger } from '../../logger';
import { MbArtistCandidate, MbReleaseGroup } from './musicbrainz-types';
import { RateLimitedQueue } from './rate-limited-queue';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'Dopamine/3.0.5 ( https://github.com/digimezzo/dopamine )';

@Injectable({ providedIn: 'root' })
export class MusicBrainzApi {
    public constructor(
        private queue: RateLimitedQueue,
        private logger: Logger,
    ) {}

    public async findArtistCandidatesByName(name: string, limit: number = 25): Promise<MbArtistCandidate[]> {
        const trimmed = name.trim();
        if (trimmed.length === 0) {
            return [];
        }

        const query = encodeURIComponent(`artist:"${trimmed.replace(/"/g, '\\"')}"`);
        const url = `${MB_BASE}/artist?query=${query}&limit=${limit}&fmt=json`;

        const data = await this.queue.enqueue(() => this.getJson(url));
        if (data == undefined) {
            return [];
        }

        const artists: any[] = data.artists ?? [];
        return artists
            .filter((a) => typeof a?.id === 'string')
            .map((a) => this.toCandidate(a))
            .sort((a, b) => b.score - a.score);
    }

    private toCandidate(a: any): MbArtistCandidate {
        const lifeSpan = a['life-span'] ?? {};
        const beginRaw: string | undefined = typeof lifeSpan.begin === 'string' ? lifeSpan.begin : undefined;
        const endRaw: string | undefined = typeof lifeSpan.end === 'string' ? lifeSpan.end : undefined;
        return {
            mbid: a.id,
            name: typeof a.name === 'string' ? a.name : '',
            sortName: typeof a['sort-name'] === 'string' ? a['sort-name'] : undefined,
            type: typeof a.type === 'string' ? a.type : undefined,
            country: typeof a.country === 'string' ? a.country : undefined,
            disambiguation: typeof a.disambiguation === 'string' && a.disambiguation.length > 0 ? a.disambiguation : undefined,
            beginYear: beginRaw != undefined ? beginRaw.substring(0, 4) : undefined,
            endYear: endRaw != undefined ? endRaw.substring(0, 4) : undefined,
            score: typeof a.score === 'number' ? a.score : 0,
        };
    }

    public async getReleaseGroupsForArtist(mbid: string): Promise<MbReleaseGroup[]> {
        const allGroups: MbReleaseGroup[] = [];
        let offset = 0;
        const pageSize = 100;
        let total = -1;

        while (true) {
            const url = `${MB_BASE}/release-group?artist=${encodeURIComponent(mbid)}&type=album|ep|single&limit=${pageSize}&offset=${offset}&fmt=json`;
            const data = await this.queue.enqueue(() => this.getJson(url));
            if (data == undefined) {
                break;
            }

            if (total < 0 && typeof data['release-group-count'] === 'number') {
                total = data['release-group-count'];
            }

            const items: any[] = data['release-groups'] ?? [];
            for (const item of items) {
                if (typeof item?.id !== 'string') {
                    continue;
                }
                const caa = item['cover-art-archive'] ?? {};
                allGroups.push({
                    id: item.id,
                    title: typeof item.title === 'string' ? item.title : '',
                    primaryType: typeof item['primary-type'] === 'string' ? item['primary-type'] : undefined,
                    secondaryTypes: Array.isArray(item['secondary-types']) ? item['secondary-types'] : [],
                    firstReleaseDate: typeof item['first-release-date'] === 'string' ? item['first-release-date'] : undefined,
                    hasCoverArt: caa.artwork === true && caa.front === true,
                });
            }

            offset += items.length;
            if (items.length < pageSize) {
                break;
            }
            if (total >= 0 && offset >= total) {
                break;
            }
        }

        return allGroups;
    }

    private async getJson(url: string): Promise<any> {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'application/json',
                },
            });

            if (response.status === 503 || response.status === 429) {
                this.logger.warn(`MusicBrainz rate-limited (${response.status}). Backing off.`, 'MusicBrainzApi', 'getJson');
                await new Promise((resolve) => setTimeout(resolve, 5000));
                return undefined;
            }

            if (response.status === 404) {
                return undefined;
            }

            if (!response.ok) {
                this.logger.warn(`MusicBrainz request failed: ${response.status} ${response.statusText}`, 'MusicBrainzApi', 'getJson');
                return undefined;
            }

            return await response.json();
        } catch (e) {
            this.logger.error(e, `MusicBrainz request failed for ${url}`, 'MusicBrainzApi', 'getJson');
            return undefined;
        }
    }
}
