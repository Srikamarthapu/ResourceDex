export class AnalysisError extends Error {
  providerStatus?: number;
  constructor(
    public readonly code: 'not_configured' | 'timeout' | 'provider_unavailable' | 'invalid_output',
    message: string,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}
