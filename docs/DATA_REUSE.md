# Data reuse and reproducibility

This document summarizes how Faketotron exports are intended to be reused by researchers, including non‑PSI laboratories.

## Recommended artifacts to publish

When releasing an experiment configuration, publish:

- the vendor protocol artifacts (when available): `.fyt` and/or `protocol.json`
- `protocol_semantics.json` (protocol-aligned canonical semantics)
- `portable_semantics.json` (vendor-neutral semantics)
- the schema version used: `schema/v0.1.0/*`
- any referenced calibration CSVs (SpectraPen regressions and optional leakage regressions)

## Why semantics matter

The semantics artifacts are designed to preserve:
- canonical units (UCUM) and explicit time semantics
- mathematical meaning of curves (const/ramp/sine/csv-import)
- PECO annotations for treatment intent
- spectrum-aware lighting semantics via calibration references

See `Semantics.md` for the normative description of the semantics model and calibration equations.
