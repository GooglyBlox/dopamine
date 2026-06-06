import { Injectable } from '@angular/core';

@Injectable()
export class EmbeddedLyricsWriter {
    public write(filePath: string, lyrics: string): void {
        // Lazy require so this Node-only dependency isn't pulled into Jest's
        // static module graph from any of the (many) test suites that
        // transitively import this writer.
        const taglib = require('node-taglib-sharp') as typeof import('node-taglib-sharp');

        const tagLibFile = taglib.File.createFromPath(filePath);
        try {
            tagLibFile.tag.lyrics = lyrics;
            tagLibFile.save();
        } finally {
            tagLibFile.dispose();
        }
    }
}
