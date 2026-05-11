import {
    AfterViewInit,
    ChangeDetectorRef,
    Component,
    ElementRef,
    HostListener,
    Input,
    NgZone,
    OnChanges,
    OnDestroy,
    QueryList,
    SimpleChanges,
    ViewChild,
    ViewChildren,
    ViewEncapsulation,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { LyricsModel } from '../../../../../services/lyrics/lyrics-model';
import { PlaybackService } from '../../../../../services/playback/playback.service';

interface LiveLine {
    text: string;
    startSeconds: number;
    isBlank: boolean;
}

@Component({
    selector: 'app-rich-lyrics',
    host: { style: 'display: block; width: 100%; height: 100%;' },
    templateUrl: './rich-lyrics.component.html',
    styleUrls: ['./rich-lyrics.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class RichLyricsComponent implements OnChanges, OnDestroy, AfterViewInit {
    private static readonly leadInSeconds: number = 0.2;
    private static readonly manualScrollSnapBackMs: number = 4000;
    private static readonly transformTransitionMs: number = 520;

    @Input() public lyrics!: LyricsModel;

    @ViewChild('liveContainer', { static: false }) private container!: ElementRef<HTMLDivElement>;
    @ViewChildren('liveLine') private lineEls!: QueryList<ElementRef<HTMLDivElement>>;

    public lines: LiveLine[] = [];
    public activeIndex: number = -1;

    private subscription: Subscription = new Subscription();
    private rafHandle: number | undefined;
    private viewReady: boolean = false;
    private translateY: number = 0;
    private userScrollOffset: number = 0;
    private isUserScrolling: boolean = false;
    private manualScrollTimer: ReturnType<typeof setTimeout> | undefined;
    private wheelHandler: ((e: WheelEvent) => void) | undefined;

    public constructor(
        private playbackService: PlaybackService,
        private zone: NgZone,
        private cd: ChangeDetectorRef,
    ) {}

    public ngOnChanges(changes: SimpleChanges): void {
        if (changes['lyrics']) {
            this.rebuildLines();
            this.activeIndex = -1;
            this.translateY = 0;
            this.userScrollOffset = 0;
            this.isUserScrolling = false;
            this.cd.detectChanges();
        }
    }

    public ngAfterViewInit(): void {
        this.viewReady = true;
        this.subscription.add(this.lineEls.changes.subscribe(() => this.recenter(false)));
        this.attachWheelHandler();
        this.startLoop();
    }

    public ngOnDestroy(): void {
        this.stopLoop();
        if (this.manualScrollTimer != undefined) {
            clearTimeout(this.manualScrollTimer);
            this.manualScrollTimer = undefined;
        }
        this.detachWheelHandler();
        this.subscription.unsubscribe();
    }

    @HostListener('window:resize')
    public onWindowResize(): void {
        this.recenter(false);
    }

    public lineClasses(index: number): { [klass: string]: boolean } {
        return {
            'live-line': true,
            'live-line--active': index === this.activeIndex,
            'live-line--past': index < this.activeIndex,
            'live-line--future': index > this.activeIndex,
            'live-line--blank': this.lines[index]?.isBlank === true,
        };
    }

    public trackByIndex(index: number): number {
        return index;
    }

    public seekTo(index: number): void {
        const target: LiveLine | undefined = this.lines[index];
        if (target == undefined) return;

        const total: number = this.playbackService.getCurrentProgress().totalSeconds;
        if (total <= 0) return;

        const fraction: number = Math.max(0, Math.min(1, target.startSeconds / total));
        void this.playbackService.skipByFractionOfTotalSecondsAsync(fraction);

        // Resume auto-follow immediately after a click-to-seek.
        this.cancelManualScroll();
    }

    private rebuildLines(): void {
        this.lines = [];

        if (!this.lyrics || !this.lyrics.textLines || !this.lyrics.startTimeStamps) {
            return;
        }

        const textLines: string[] = this.lyrics.textLines;
        const starts: number[] = this.lyrics.startTimeStamps;

        const items: LiveLine[] = [];
        for (let i = 0; i < textLines.length; i++) {
            const text: string = (textLines[i] ?? '').trim();
            const start: number = starts[i] ?? 0;
            items.push({
                text: text.length === 0 ? '♫' : text,
                startSeconds: start,
                isBlank: text.length === 0,
            });
        }

        items.sort((a, b) => a.startSeconds - b.startSeconds);
        this.lines = items;
    }

    private startLoop(): void {
        this.stopLoop();
        this.zone.runOutsideAngular(() => {
            const tick = (): void => {
                this.tick();
                this.rafHandle = requestAnimationFrame(tick);
            };
            this.rafHandle = requestAnimationFrame(tick);
        });
    }

    private stopLoop(): void {
        if (this.rafHandle != undefined) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = undefined;
        }
    }

    private tick(): void {
        if (!this.viewReady || this.lines.length === 0) {
            return;
        }

        const now: number = this.playbackService.getCurrentProgress().progressSeconds + RichLyricsComponent.leadInSeconds;
        const next: number = this.findActiveIndex(now);

        const indexChanged: boolean = next !== this.activeIndex;

        if (indexChanged) {
            this.activeIndex = next;
            this.zone.run(() => this.cd.detectChanges());
        }

        // While the user is scrolling manually, don't fight them.
        if (this.isUserScrolling) {
            return;
        }

        this.recenter(true);
    }

    private findActiveIndex(currentSeconds: number): number {
        let lo: number = 0;
        let hi: number = this.lines.length - 1;
        let result: number = -1;

        while (lo <= hi) {
            const mid: number = (lo + hi) >>> 1;
            if (this.lines[mid].startSeconds <= currentSeconds) {
                result = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        return result;
    }

    private recenter(animated: boolean): void {
        if (!this.viewReady || !this.container || this.activeIndex < 0) {
            return;
        }

        const els: ElementRef<HTMLDivElement>[] | undefined = this.lineEls?.toArray();
        const lineEl: HTMLDivElement | undefined = els?.[this.activeIndex]?.nativeElement;
        if (lineEl == undefined) {
            return;
        }

        const desired: number = -(lineEl.offsetTop + lineEl.offsetHeight / 2);

        if (Math.abs(desired - this.translateY) < 0.5) {
            return;
        }

        this.translateY = desired;
        this.applyTransform(animated);
    }

    private applyTransform(animated: boolean): void {
        if (!this.container) return;
        const list: HTMLElement | null = this.container.nativeElement.querySelector('.live-lyrics__list');
        if (list == null) return;

        const offset: number = this.translateY + this.userScrollOffset;
        list.style.transition = animated
            ? `transform ${RichLyricsComponent.transformTransitionMs}ms cubic-bezier(0.22, 0.61, 0.36, 1)`
            : 'none';
        list.style.transform = `translate3d(0, ${offset}px, 0)`;
    }

    private attachWheelHandler(): void {
        if (!this.container) return;
        this.wheelHandler = (event: WheelEvent): void => {
            event.preventDefault();
            this.handleWheel(event.deltaY);
        };
        this.container.nativeElement.addEventListener('wheel', this.wheelHandler, { passive: false });
    }

    private detachWheelHandler(): void {
        if (this.wheelHandler != undefined && this.container) {
            this.container.nativeElement.removeEventListener('wheel', this.wheelHandler);
            this.wheelHandler = undefined;
        }
    }

    private handleWheel(deltaY: number): void {
        this.zone.runOutsideAngular(() => {
            this.isUserScrolling = true;
            this.userScrollOffset -= deltaY;
            this.applyTransform(false);

            if (this.manualScrollTimer != undefined) {
                clearTimeout(this.manualScrollTimer);
            }

            this.manualScrollTimer = setTimeout(() => this.cancelManualScroll(), RichLyricsComponent.manualScrollSnapBackMs);
        });
    }

    private cancelManualScroll(): void {
        this.isUserScrolling = false;
        this.userScrollOffset = 0;
        if (this.manualScrollTimer != undefined) {
            clearTimeout(this.manualScrollTimer);
            this.manualScrollTimer = undefined;
        }
        this.applyTransform(true);
    }
}
