import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { ReleaseCalendarRepositoryBase } from '../../data/repositories/release-calendar-repository.base';
import { Logger } from '../../common/logger';
import { ReleaseNameKey } from './release-name-key';

export interface FollowedArtistEntry {
    name: string;
    nameKey: string;
}

@Injectable({ providedIn: 'root' })
export class FollowedArtistsService {
    private followsChanged: Subject<void> = new Subject<void>();
    public followsChanged$: Observable<void> = this.followsChanged.asObservable();

    public constructor(
        private repository: ReleaseCalendarRepositoryBase,
        private logger: Logger,
    ) {}

    public getFollowedArtists(): FollowedArtistEntry[] {
        return this.repository
            .getAllFollowOverrides()
            .filter((f) => f.isFollowed === 1)
            .map((f) => ({ name: f.name, nameKey: f.nameKey }));
    }

    public isFollowed(name: string): boolean {
        const key = ReleaseNameKey.fromArtistName(name);
        const override = this.repository.getFollowOverride(key);
        return override != undefined && override.isFollowed === 1;
    }

    public follow(name: string): void {
        const key = ReleaseNameKey.fromArtistName(name);
        if (key.length === 0) {
            return;
        }
        this.repository.setFollowed(name, key, true, Date.now());
        this.logger.info(`Followed artist '${name}'`, 'FollowedArtistsService', 'follow');
        this.followsChanged.next();
    }

    public unfollow(name: string): void {
        const key = ReleaseNameKey.fromArtistName(name);
        if (key.length === 0) {
            return;
        }
        this.repository.setFollowed(name, key, false, Date.now());
        this.logger.info(`Unfollowed artist '${name}'`, 'FollowedArtistsService', 'unfollow');
        this.followsChanged.next();
    }

    public toggle(name: string): boolean {
        if (this.isFollowed(name)) {
            this.unfollow(name);
            return false;
        }
        this.follow(name);
        return true;
    }

    public notifyChanged(): void {
        this.followsChanged.next();
    }
}
