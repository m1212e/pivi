// @m1212e/rumble imports `lib-address` unconditionally at module load, for an
// address-validation scalar pivi's schema never opts into. Its published
// build is broken under Vite's SSR module runner — `dist/entry-node.mjs`
// calls a bare `require()` that only exists under Node's CJS loader, not a
// real ESM `import`. Since we never touch the address feature, this stands
// in with harmless no-ops instead of fighting that package's module format.
// See resolve.alias in vite.config.ts.
export class AddressValidationError extends Error {}
export class CountryMissingError extends Error {}
export class InvalidStateError extends Error {}
export class InvalidZipError extends Error {}
export class MissingFieldError extends Error {}

export function isValidCountryCode(): boolean {
	return true;
}

export function validateAddress(): Record<string, never> {
	return {};
}
