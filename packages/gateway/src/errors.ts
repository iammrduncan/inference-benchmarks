export type ErrorCode = 'invalid_json' | 'invalid_request' | 'invalid_schema' |
  'unauthorized' | 'not_found' | 'request_too_large' | 'unsupported_media_type' |
  'rate_limited' | 'overloaded' | 'deadline_exceeded' | 'provider_unavailable' | 'provider_authentication_failed' |
  'invalid_provider_output' | 'internal_error';

const messages: Record<ErrorCode, string> = {
  invalid_json: 'Invalid JSON.', invalid_request: 'Request does not match the supported contract.',
  invalid_schema: 'Unsupported or unsafe output schema.', unauthorized: 'Invalid proxy credential.',
  not_found: 'Route not found.', request_too_large: 'Request exceeds a local limit.',
  unsupported_media_type: 'Only uncompressed application/json is supported.',
  rate_limited: 'Inference rate limit reached.', overloaded: 'Inference capacity is full.',
  deadline_exceeded: 'Request deadline exceeded.', provider_unavailable: 'Inference provider unavailable.',
  provider_authentication_failed: 'Inference provider rejected its API key.',
  invalid_provider_output: 'Inference result failed validation.', internal_error: 'Internal error.',
};
export class Fault extends Error {
  constructor(readonly code: ErrorCode, readonly status: number) { super(messages[code]); }
}
export function invalid(): never { throw new Fault('invalid_request', 422); }
export function badOutput(): never { throw new Fault('invalid_provider_output', 502); }
