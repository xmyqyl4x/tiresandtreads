import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';

interface Structure {
  add(child: Structure): Structure;
  end(): void;
}
interface TextOptions {
  readonly width?: number;
  readonly lineGap?: number;
  readonly link?: string;
  readonly underline?: boolean;
  readonly lineBreak?: boolean;
}
interface TaggedDocument extends Readable {
  y: number;
  registerFont(name: string, bytes: Buffer): this;
  font(name: string): this;
  fontSize(size: number): this;
  fillColor(color: string): this;
  text(value: string, options?: TextOptions): this;
  text(value: string, x: number, y: number, options?: TextOptions): this;
  heightOfString(value: string, options?: TextOptions): number;
  addPage(): this;
  struct(role: string, content?: () => void): Structure;
  addStructure(element: Structure): this;
  markContent(role: 'Artifact', options: { type: 'Pagination'; attached: readonly string[] }): this;
  endMarkedContent(): this;
  bufferedPageRange(): { start: number; count: number };
  switchToPage(index: number): this;
  end(): void;
}
interface DocumentOptions {
  readonly tagged: true;
  readonly bufferPages: true;
  readonly size: 'LETTER';
  readonly margins: { top: number; left: number; right: number; bottom: number };
  readonly lang: 'en-US';
  readonly displayTitle: true;
  readonly pdfVersion: '1.7';
  readonly info: Readonly<Record<string, string | Date>>;
}
// Narrow boundary for the tested, pinned PDFKit 0.20.1 API. No private internals or global patches.
export const TaggedPdfDocument = createRequire(import.meta.url)('pdfkit') as new (
  options: DocumentOptions,
) => TaggedDocument;
