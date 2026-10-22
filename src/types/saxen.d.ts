/**
 * saxen 的类型声明（库本身不带 TypeScript 类型），只覆盖文档文字提取用到的非代理模式 API。
 */
declare module 'saxen' {
    type DecodeEntities = (value: string) => string;

    export class Parser {
        constructor(options?: { proxy?: false });
        /** `attrs` returns raw (entity-encoded) values, or false when the attributes are malformed. */
        on(event: 'openTag', handler: (name: string, attrs: () => Record<string, string> | false, decode: DecodeEntities, selfClosing: boolean) => void): this;
        on(event: 'closeTag', handler: (name: string, decode: DecodeEntities, selfClosing: boolean) => void): this;
        on(event: 'text', handler: (value: string, decode: DecodeEntities) => void): this;
        on(event: 'cdata', handler: (value: string) => void): this;
        on(event: 'error', handler: (error: Error) => void): this;
        /** Parses a complete document; with the default error handler, malformed XML throws. */
        parse(xml: string): Error | null;
        stop(): void;
    }
}
