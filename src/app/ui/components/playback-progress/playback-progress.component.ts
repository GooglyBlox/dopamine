import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, ViewEncapsulation } from '@angular/core';
import { MatMenuTrigger } from '@angular/material/menu';
import { Subscription } from 'rxjs';
import { Logger } from '../../../common/logger';
import { MathExtensions } from '../../../common/math-extensions';
import { NativeElementProxy } from '../../../common/native-element-proxy';
import { PlaybackProgress } from '../../../services/playback/playback-progress';
import { PlaybackService } from '../../../services/playback/playback.service';
import { LoopMode } from '../../../services/playback/loop-mode';

@Component({
    selector: 'app-playback-progress',
    host: { style: 'display: block' },
    templateUrl: './playback-progress.component.html',
    styleUrls: ['./playback-progress.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class PlaybackProgressComponent implements OnInit, OnDestroy, AfterViewInit {
    private subscription: Subscription = new Subscription();

    @ViewChild('progressTrack')
    public progressTrack: ElementRef;
    
    @ViewChild('loopPointsMenuAnchor', { read: MatMenuTrigger })
    public loopPointsMenuTrigger: MatMenuTrigger;
    
    private progressMargin: number = 6;

    public constructor(
        public playbackService: PlaybackService,
        private mathExtensions: MathExtensions,
        private nativeElementProxy: NativeElementProxy,
        private logger: Logger,
    ) {}

    public showProgressThumb: boolean = false;
    public isProgressThumbDown: boolean = false;

    public progressBarPosition: number = 0;
    public progressThumbPosition: number = 0;

    public isProgressDragged: boolean = false;
    public isProgressContainerDown: boolean = false;

    // Loop points properties
    public loopStartPosition: number = 0;
    public loopEndPosition: number = 0;
    public loopStartTime: number = 0;
    public loopEndTime: number = 0;
    public contextMenuPosition = { x: 0, y: 0 };
    private lastRightClickPosition: number = 0;

    public ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    public get showLoopPoints(): boolean {
        return this.playbackService.loopMode === LoopMode.One && this.playbackService.loopPoints.isEnabled;
    }

    public ngOnInit(): void {
        this.subscription.add(
            this.playbackService.progressChanged$.subscribe((playbackProgress: PlaybackProgress) => {
                if (!this.isProgressThumbDown && !this.isProgressContainerDown) {
                    this.applyPlaybackProgress(playbackProgress);
                }
            }),
        );
    }

    public ngAfterViewInit(): void {
        // HACK: avoids a ExpressionChangedAfterItHasBeenCheckedError in DEV mode.
        setTimeout(() => {
            this.applyPlaybackProgress(this.playbackService.progress);
        }, 0);
    }

    public progressThumbMouseDown(): void {
        this.isProgressThumbDown = true;
    }

    public progressContainerMouseEnter(): void {
        this.showProgressThumb = true;
    }

    public progressContainerMouseLeave(): void {
        if (!this.isProgressThumbDown) {
            this.showProgressThumb = false;
        }
    }

    public progressContainerMouseDown(e: MouseEvent): void {
        this.isProgressContainerDown = true;

        if (!this.playbackService.isPlaying) {
            return;
        }

        this.applyMouseProgress(e.pageX);
    }

    @HostListener('document:mouseup')
    public onMouseUp(): void {
        this.isProgressThumbDown = false;
        this.showProgressThumb = false;

        if (!this.playbackService.isPlaying) {
            return;
        }

        if (this.isProgressDragged || this.isProgressContainerDown) {
            this.isProgressDragged = false;
            this.isProgressContainerDown = false;
            try {
                const progressTrackWidth: number = this.nativeElementProxy.getElementWidth(this.progressTrack);
                this.playbackService.skipByFractionOfTotalSeconds(this.progressBarPosition / progressTrackWidth);
            } catch (e: unknown) {
                this.logger.error(e, 'Could not skip by fraction of total seconds', 'PlaybackProgressComponent', 'onMouseUp');
            }
        }
    }

    @HostListener('document:mousemove', ['$event'])
    public onMouseMove(e: MouseEvent): void {
        if (!this.playbackService.isPlaying) {
            return;
        }

        if (this.isProgressThumbDown) {
            this.isProgressDragged = true;
            this.applyMouseProgress(e.pageX);
        }
    }

    private applyPlaybackProgress(playbackProgress: PlaybackProgress): void {
        try {
            const progressTrackWidth: number = this.nativeElementProxy.getElementWidth(this.progressTrack);

            if (playbackProgress.totalSeconds <= 0) {
                this.progressBarPosition = 0;
                this.progressThumbPosition = 0;

                return;
            }

            this.progressBarPosition = (playbackProgress.progressSeconds / playbackProgress.totalSeconds) * progressTrackWidth;
            this.progressThumbPosition = this.mathExtensions.clamp(
                this.progressBarPosition - this.progressMargin,
                0,
                progressTrackWidth - 2 * this.progressMargin,
            );

            // Update loop point positions
            this.updateLoopPointPositions(progressTrackWidth, playbackProgress.totalSeconds);
        } catch (e: unknown) {
            this.logger.error(e, 'Could not apply playback progress', 'PlaybackProgressComponent', 'applyPlaybackProgress');
        }
    }

    private applyMouseProgress(mouseXPosition: number): void {
        try {
            const progressTrackWidth: number = this.nativeElementProxy.getElementWidth(this.progressTrack);

            this.progressBarPosition = this.mathExtensions.clamp(mouseXPosition, 0, progressTrackWidth);
            this.progressThumbPosition = this.mathExtensions.clamp(
                this.progressBarPosition - this.progressMargin,
                0,
                progressTrackWidth - 2 * this.progressMargin,
            );
        } catch (e: unknown) {
            this.logger.error(e, 'Could not apply mouse progress', 'PlaybackProgressComponent', 'applyMouseProgress');
        }
    }

    private updateLoopPointPositions(progressTrackWidth: number, totalSeconds: number): void {
        if (this.showLoopPoints && totalSeconds > 0) {
            const loopPoints = this.playbackService.loopPoints;
            this.loopStartTime = loopPoints.startSeconds;
            this.loopEndTime = loopPoints.endSeconds;
            this.loopStartPosition = (loopPoints.startSeconds / totalSeconds) * progressTrackWidth;
            this.loopEndPosition = (loopPoints.endSeconds / totalSeconds) * progressTrackWidth;
        }
    }

    public onProgressRightClick(event: MouseEvent): void {
        event.preventDefault();
        if (!this.playbackService.isPlaying) {
            return;
        }

        try {
            const progressTrackWidth: number = this.nativeElementProxy.getElementWidth(this.progressTrack);
            const trackElement = this.progressTrack.nativeElement as HTMLElement;
            const trackRect = trackElement.getBoundingClientRect();
            this.lastRightClickPosition = event.clientX - trackRect.left;
            
            this.contextMenuPosition = { x: event.clientX, y: event.clientY };
            this.loopPointsMenuTrigger.openMenu();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not handle right click', 'PlaybackProgressComponent', 'onProgressRightClick');
        }
    }

    public setLoopStartHere(): void {
        try {
            const progressTrackWidth: number = this.nativeElementProxy.getElementWidth(this.progressTrack);
            const totalSeconds = this.playbackService.progress.totalSeconds;
            const clickedSeconds = (this.lastRightClickPosition / progressTrackWidth) * totalSeconds;
            
            this.playbackService.setLoopPoints(clickedSeconds, this.playbackService.loopPoints.endSeconds);
        } catch (e: unknown) {
            this.logger.error(e, 'Could not set loop start', 'PlaybackProgressComponent', 'setLoopStartHere');
        }
    }

    public setLoopEndHere(): void {
        try {
            const progressTrackWidth: number = this.nativeElementProxy.getElementWidth(this.progressTrack);
            const totalSeconds = this.playbackService.progress.totalSeconds;
            const clickedSeconds = (this.lastRightClickPosition / progressTrackWidth) * totalSeconds;
            
            this.playbackService.setLoopPoints(this.playbackService.loopPoints.startSeconds, clickedSeconds);
        } catch (e: unknown) {
            this.logger.error(e, 'Could not set loop end', 'PlaybackProgressComponent', 'setLoopEndHere');
        }
    }

    public clearLoopPoints(): void {
        this.playbackService.clearLoopPoints();
    }
}
