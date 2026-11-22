// SPDX-License-Identifier: Apache-2.0

/**
 * The typed error for malformed configuration data.
 *
 * A malformed configuration is different from a valid request the engine cannot yet
 * serve. Parsers throw this error instead of guessing at invalid schema or policy data.
 * A valid but unsupported request does not throw; it returns structured blockers.
 * @see docs/RELEASE_1_0.md and the corresponding domain guide.
 */

/**
 * Error thrown when external configuration data does not match a public
 * runtime schema.
 */
export class InvalidConfigurationError extends TypeError {
  readonly code = "INVALID_CONFIGURATION";

  /** 2.28.0: `options.cause` keeps an underlying error (for example a caller-supplied decoder's own exception). */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InvalidConfigurationError";
  }
}
