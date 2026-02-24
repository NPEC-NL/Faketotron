# Faketotron
A protocol creation/edit web app for environmental treatment programs (temperature, humidity, CO₂, multi‑channel lighting), with exports for both **PSI-compatible** instrument protocols and **vendor‑neutral semantics** for reuse and reproducibility.

[](NPEC-logo-horizontal.png)

## Table of contents
- [Overview](#overview)
- [Documentation](#documentation)
- [Quick start](#quick-start)
- [Exports](#exports)
- [Disclaimer](#disclaimer)
- [License](#license)
- [Development](#development)

## Overview

Faketotron started as a mock editor for PSI *Fytotron Client* protocols, but its scope now emphasizes **scientific reuse**:
- edit/author chamber programs with explicit time-series controls (const/ramp/sine/csv-import)
- export PSI-compatible `.fyt` / `protocol.json` when needed
- export canonical semantic representations (`protocol_semantics.json`, `portable_semantics.json`) designed for **cross‑lab reuse**, including non‑PSI labs

## Documentation

- **Scientific semantics (normative):** [`Semantics.md`](Semantics.md)
- **User guide:** [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- **Data reuse notes:** [`docs/DATA_REUSE.md`](docs/DATA_REUSE.md)
- **LED channel reference:** [`docs/LED_SPECTRAL_RANGES.md`](docs/LED_SPECTRAL_RANGES.md)
- **Development notes:** [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- **Schemas:** `schema/v0.1.0/protocol_semantics.schema.json` and `schema/v0.1.0/portable_semantics.schema.json`

## Quick start

At \V2\workspace, run (requires Node.js and pnpm):

```bash
pnpm i
pnpm -C faketotron-v2-core build
pnpm -C web dev
```
You should then see it running at localhost.


## Exports

Faketotron exports multiple artifacts from the same protocol state:

- **Instrument-facing:** `.fyt`, `protocol.json`
- **Semantics (canonical):** `protocol_semantics.json` (protocol-aligned) and `portable_semantics.json` (vendor-neutral)

The semantics outputs encode UCUM units and explicitly define the mathematical meaning of phase primitives; lighting calibration and optional shelf-leakage are represented via per-wavelength regression metadata.

## Disclaimer

This project is an independent, non-commercial imitation of certain features from the 
Protocol Editor component of the *Fytotron Client* by Photon Systems Instruments (PSI).

It is intended solely for academic, educational, and research purposes.  
It is **not affiliated with, endorsed by, or produced by Photon Systems Instruments**.  
All trademarks, product names, and intellectual property rights remain the sole property of their respective owners.

This software is designed to generate `.fyt` files that are compatible with PSI instruments, 
but it does **not** connect to or control any real instruments and must **not** be used in 
any production, clinical, agricultural, or commercial environment.

### No Endorsement

Neither the name of the author(s), the university, nor the name "Photon Systems Instruments" 
may be used to endorse or promote products derived from this software without specific prior written permission.  
Any resemblance to the original *Fytotron Client* software is for educational simulation purposes only.

## License
This project is licensed under a custom **BSD-3-Clause Academic Use License**.  
This is **not** the standard BSD 3-Clause license — it includes a non-commercial restriction.  
See [LICENSE](LICENSE) for details.

## Development

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
