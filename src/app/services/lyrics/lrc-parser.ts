export interface ParsedLrc {
    plainText: string;
    textLines: string[];
    startTimeStamps: number[];
}

export class LrcParser {
    private static readonly timestampRegex: RegExp = /\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]/g;

    public static parse(rawLines: string[]): ParsedLrc {
        const textLines: string[] = [];
        const startTimeStamps: number[] = [];
        let plainText: string = '';

        for (const line of rawLines) {
            const timestamps: number[] = LrcParser.parseTimestamps(line);

            if (timestamps.length === 0) {
                continue;
            }

            const textContent: string = line.replace(LrcParser.timestampRegex, '');

            for (const ts of timestamps) {
                textLines.push(textContent);
                startTimeStamps.push(ts);
            }

            if (textContent.trim().length > 0) {
                if (plainText.length > 0) {
                    plainText += '\n';
                }

                plainText += textContent;
            }
        }

        const ordered: { line: string; ts: number }[] = textLines
            .map((line, i) => ({ line, ts: startTimeStamps[i] }))
            .sort((a, b) => a.ts - b.ts);

        return {
            plainText,
            textLines: ordered.map((o) => o.line),
            startTimeStamps: ordered.map((o) => o.ts),
        };
    }

    public static parseString(text: string): ParsedLrc {
        return LrcParser.parse(text.split(/\r?\n/));
    }

    private static parseTimestamps(line: string): number[] {
        const timestamps: number[] = [];
        let match: RegExpExecArray | null;

        LrcParser.timestampRegex.lastIndex = 0;

        while ((match = LrcParser.timestampRegex.exec(line)) !== null) {
            const minutes: number = parseInt(match[1], 10);
            const seconds: number = parseInt(match[2], 10);
            const fraction: string = match[3];
            const fractionalSeconds: number = parseInt(fraction, 10) / Math.pow(10, fraction.length);

            timestamps.push(minutes * 60 + seconds + fractionalSeconds);
        }

        return timestamps;
    }
}
