export declare function sendText(args: {
    to: string;
    text: string;
}): Promise<{
    channel: "opengram";
    messageId: string;
}>;
export declare function sendMedia(args: {
    to: string;
    text?: string;
    mediaUrl?: string;
}): Promise<{
    channel: "opengram";
    messageId: string;
}>;
