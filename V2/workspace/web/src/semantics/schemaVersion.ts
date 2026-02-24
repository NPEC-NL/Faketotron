/**
 * Centralized semantics schema identifiers.
 *
 * NOTE (dev): These schemas are stored in the repository root under `schema/<version>/`
 * If you update schemas, update the version below and ensure the schema JSON files are 
 * updated in the same commit.
 *
 * For published datasets, you SHOULD point `id` to a stable, tag-pinned raw GitHub URL.
 */

export const SCHEMA_VERSION = "0.1.0";

/** Replace this with your tag-pinned raw GitHub base when publishing. */
export const SCHEMA_ID_BASE = "https://raw.githubusercontent.com/NPEC-NL/Faketotron/V2";

export const PROTOCOL_SEMANTICS_SCHEMA = {
  name: "faketotron.protocol_semantics",
  version: SCHEMA_VERSION,
  id: `${SCHEMA_ID_BASE}/schema/v0.1.0/protocol_semantics.schema.json`
} as const;

export const PORTABLE_SEMANTICS_SCHEMA = {
  name: "faketotron.portable_semantics",
  version: SCHEMA_VERSION,
  id: `${SCHEMA_ID_BASE}/schema/v0.1.0/portable_semantics.schema.json`
} as const;
