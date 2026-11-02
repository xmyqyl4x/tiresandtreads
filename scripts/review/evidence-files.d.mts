export interface FileReview {
  filesChecked: number;
  bytesRead: number;
  matchedPins: number;
  issues: { path: string; code: 'unreadable' | 'digest-mismatch' }[];
}
export function verifyReviewFiles(root: string, pins: unknown, references: unknown): FileReview;
