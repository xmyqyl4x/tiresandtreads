export interface TemplateProfile {
  readonly senderName: string;
  readonly postalAddress: readonly string[];
  readonly origin: string;
  readonly routes: Readonly<{
    report: string;
    preferences: string;
    confirmation: string;
    privacy: string;
  }>;
}
// Supplied by a trusted caller from its frozen, authorized context. Templates never mint authority.
export interface TemplateContext {
  readonly reportId: string;
  readonly version: number;
  readonly comparisonRevision: string | null;
  readonly expiresAt: string;
  readonly viewUrl: string;
  readonly preferencesUrl: string;
  readonly offersConfirmationUrl: string | null;
}
export interface PresentedOption {
  readonly kind: 'catalog' | 'quote';
  readonly fitment: string | null;
  readonly climate: string | null;
  readonly product: string | null;
  readonly difference: string | null;
  readonly evidenceLabel: string;
  readonly id: string;
  readonly label: string;
  readonly size: string;
  readonly status: string;
  readonly score: string;
  readonly quantity: string;
  readonly installed: string;
  readonly merchandise: string;
  readonly evidence: string;
  readonly reasons: readonly string[];
}
export interface ReportPresentation {
  readonly reference: Readonly<{
    reportId: string;
    version: number;
    comparisonRevision: string | null;
  }>;
  readonly asOf: string;
  readonly fixture: boolean;
  readonly senderName: string;
  readonly postalAddress: readonly string[];
  readonly locale: 'en-US';
  readonly title: string;
  readonly subject: string;
  readonly disclosure: string;
  readonly inputSummary: string;
  readonly options: readonly PresentedOption[];
  readonly comparison: readonly PresentedOption[];
  readonly decisions: readonly string[];
  readonly provenance: readonly string[];
  readonly learning: readonly Readonly<{ title: string; url: string }>[];
  readonly links: Readonly<{
    view: string;
    preferences: string;
    confirmation: string | null;
    privacy: string;
    expiresAt: string;
  }>;
}
export interface TemplateFonts {
  readonly regular: Uint8Array;
  readonly bold: Uint8Array;
}
