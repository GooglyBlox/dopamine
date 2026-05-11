import { LrcLibApi, LrcLibHit } from '../../common/api/lyrics/lrc-lib.api';

export interface LrcLibQuery {
    artist: string;
    title: string;
    album: string;
    durationSeconds: number;
}

export interface LrcLibMatch {
    hit: LrcLibHit;
    strategy: 'get_exact' | 'get_exact_stripped_feat' | 'search_exact';
}

export class LrcLibMatcher {
    private static readonly featRegex: RegExp = /\s*[\(\[]\s*(?:feat|ft)\.?\s.*?[\)\]]/gi;
    private static readonly combiningMarksRegex: RegExp = /[̀-ͯ]/g;

    public constructor(
        private api: LrcLibApi,
        private durationToleranceSeconds: number = 2,
    ) {}

    public async findMatchAsync(query: LrcLibQuery): Promise<LrcLibMatch | undefined> {
        if (!query.artist || !query.title || query.durationSeconds <= 0) {
            return undefined;
        }

        const exactHit: LrcLibHit | undefined = await this.api.getExactAsync(
            query.artist,
            query.title,
            query.album,
            query.durationSeconds,
        );

        if (exactHit !== undefined) {
            return { hit: exactHit, strategy: 'get_exact' };
        }

        const strippedTitle: string = LrcLibMatcher.stripFeat(query.title);

        if (strippedTitle && strippedTitle !== query.title) {
            const strippedHit: LrcLibHit | undefined = await this.api.getExactAsync(
                query.artist,
                strippedTitle,
                query.album,
                query.durationSeconds,
            );

            if (strippedHit !== undefined) {
                return { hit: strippedHit, strategy: 'get_exact_stripped_feat' };
            }
        }

        const candidates: LrcLibHit[] = [];
        const queriedTitles: Set<string> = new Set<string>();

        for (const candidateTitle of [query.title, strippedTitle]) {
            if (!candidateTitle || queriedTitles.has(candidateTitle)) {
                continue;
            }

            queriedTitles.add(candidateTitle);
            const searchHits: LrcLibHit[] = await this.api.searchAsync(query.artist, candidateTitle);
            candidates.push(...searchHits);
        }

        if (candidates.length === 0) {
            return undefined;
        }

        const wantedArtist: string = LrcLibMatcher.normalize(query.artist);
        const wantedTitles: Set<string> = new Set<string>(
            [LrcLibMatcher.normalize(query.title), LrcLibMatcher.normalize(strippedTitle)].filter((s) => s.length > 0),
        );

        const matches: LrcLibHit[] = candidates.filter(
            (c) =>
                LrcLibMatcher.normalize(c.artist) === wantedArtist &&
                wantedTitles.has(LrcLibMatcher.normalize(c.title)) &&
                Math.abs(c.durationSeconds - query.durationSeconds) <= this.durationToleranceSeconds,
        );

        if (matches.length === 0) {
            return undefined;
        }

        matches.sort((a, b) => {
            const aSynced: number = a.synced != undefined ? 0 : 1;
            const bSynced: number = b.synced != undefined ? 0 : 1;
            if (aSynced !== bSynced) return aSynced - bSynced;
            return Math.abs(a.durationSeconds - query.durationSeconds) - Math.abs(b.durationSeconds - query.durationSeconds);
        });

        return { hit: matches[0], strategy: 'search_exact' };
    }

    public static stripFeat(name: string): string {
        return name.replace(LrcLibMatcher.featRegex, '').trim();
    }

    public static normalize(text: string): string {
        let normalized: string = text.toLowerCase().trim();
        normalized = normalized.normalize('NFKD').replace(LrcLibMatcher.combiningMarksRegex, '');
        normalized = normalized.replace(/[^a-z0-9 ]+/g, ' ');
        return normalized.replace(/\s+/g, ' ').trim();
    }
}
