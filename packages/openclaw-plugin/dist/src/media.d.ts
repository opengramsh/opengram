export declare function downloadMedia(url: string): Promise<{
    buffer: Buffer;
    filename: string;
    contentType: string;
}>;
