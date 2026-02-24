<img src="NPEC-logo-horizontal.png" width="200" />

# Faketotron
A protocol creation/edit web app for environmental treatment programs (temperature, humidity, CO₂, multi‑channel lighting), with exports for both **PSI-compatible** instrument protocols and **vendor‑neutral semantics** for reuse and reproducibility.

Faketotron started as a mock editor for PSI *Fytotron Client* growth chamber condition controller, but its scope now emphasizes **scientific reuse**:
- edit/author chamber protocols with both Fytotron Client style editor and graphical UI.
- export PSI-compatible binary `.fyt` that can be directly loaded to the machines, or `.json` that is human readable.
- export canonical semantic representations (`protocol_semantics.json`, `portable_semantics.json`) designed for **cross‑lab reuse**, including non‑PSI labs

## Documentation

### For NPEC users who use Faketotron for experiments: Please go directly to the [User guide](docs/USER_GUIDE.md)

If you want to ensure long term, cross platform reproducibility: follow the **Data reuse notes:** [`docs/DATA_REUSE.md`](docs/DATA_REUSE.md).

### Other docs:
- **Scientific semantics (normative):** [`Semantics.md`](Semantics.md)
- **Schemas:** `schema/v0.1.0/protocol_semantics.schema.json` and `schema/v0.1.0/portable_semantics.schema.json`
- **LED channel reference:** [`docs/LED_SPECTRAL_RANGES.md`](docs/LED_SPECTRAL_RANGES.md)

## Resources

- The **`/Reference Protocols`** folder contains some protocols that we previously used for our experiment. If you are unsure about how to start with creating your own protocol, you can take them as reference.

- The **`/Light Calibration`** folder contains annual light calibration data that can be used for creating light spectrum curve visualization and file download, which is essential for long term reproducibility.

## Exports

### Protocol matching exports
Faketotron exports multiple artifacts from the same protocol state:

- **Instrument-facing:** `.fyt`, `protocol.json`
- **Semantics (canonical):** `protocol_semantics.json` (protocol-aligned) and `portable_semantics.json` (vendor-neutral)

The semantics outputs encode UCUM units and explicitly define the mathematical meaning of phase primitives; lighting calibration and optional shelf-leakage are represented via per-wavelength regression metadata.

### Optional manual exports
Faketotron can also create light curve .csv file or a MIAPPE-like environment variable list (for the standard 1-day cycle).

These exports are, however, optional and does not guarantee automatic percise match between the protocol.

## Development

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

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
