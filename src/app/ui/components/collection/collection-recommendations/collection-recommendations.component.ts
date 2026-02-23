import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { Subscription } from 'rxjs';
import { RecommendationLane, RecommendationService } from '../../../../services/recommendation/recommendation.service';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { TrackModel } from '../../../../services/track/track-model';
import { CollectionServiceBase } from '../../../../services/collection/collection.service.base';

@Component({
    selector: 'app-collection-recommendations',
    host: { style: 'display: block; width: 100%;' },
    templateUrl: './collection-recommendations.component.html',
    styleUrls: ['./collection-recommendations.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class CollectionRecommendationsComponent implements OnInit, OnDestroy {
    private subscription: Subscription = new Subscription();
    public lanes: RecommendationLane[] = [];
    public isLoading: boolean = true;

    public constructor(
        private recommendationService: RecommendationService,
        private playbackService: PlaybackService,
        private collectionService: CollectionServiceBase,
    ) {}

    public ngOnInit(): void {
        this.loadRecommendations();

        this.subscription.add(
            this.collectionService.collectionChanged$.subscribe(() => {
                this.loadRecommendations();
            }),
        );
    }

    public ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    public refresh(): void {
        this.loadRecommendations();
    }

    public async playLaneAsync(lane: RecommendationLane): Promise<void> {
        if (lane.tracks.length === 0) {
            return;
        }
        await this.playbackService.enqueueAndPlayTracksAsync(lane.tracks);
    }

    public async shuffleLaneAsync(lane: RecommendationLane): Promise<void> {
        if (lane.tracks.length === 0) {
            return;
        }
        const shuffled = [...lane.tracks].sort(() => Math.random() - 0.5);
        await this.playbackService.enqueueAndPlayTracksAsync(shuffled);
    }

    public async playTrackAsync(lane: RecommendationLane, track: TrackModel): Promise<void> {
        await this.playbackService.enqueueAndPlayTracksStartingFromGivenTrackAsync(lane.tracks, track);
    }

    public formatDuration(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    private loadRecommendations(): void {
        this.isLoading = true;
        setTimeout(() => {
            this.lanes = this.recommendationService.generateAllRecommendations();
            this.isLoading = false;
        }, 50);
    }
}
