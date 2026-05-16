## ADDED Requirements

### Requirement: Load-bearing git/finish modules carry @ts-check + JSDoc
The system SHALL ensure that `src/git/index.js` and `src/finish/index.js` enable JS type-checking via a top-of-file `// @ts-check` pragma and document every exported function with JSDoc covering `@param`, `@returns`, and intentional throws.

#### Scenario: Exported functions documented
- **WHEN** a maintainer reads any exported function from `src/git/index.js` or `src/finish/index.js`
- **THEN** the function has a one-line summary and JSDoc tags for parameters, return type, and any throws it intentionally raises
- **AND** recurring object shapes are declared once as `@typedef` near the top of the file.

#### Scenario: Type-check passes
- **WHEN** `tsc --noEmit --allowJs --checkJs` is run against `src/git/index.js` and `src/finish/index.js`
- **THEN** the command exits with status 0
- **AND** no new errors are introduced relative to the prior baseline.
