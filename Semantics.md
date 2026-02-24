# Faketotron Semantics (v0.1.0)

This document specifies the **scientific semantics** of Faketotron protocols and the design rationale behind the semantics layer. It is written for researchers who want to **reuse, compare, or reproduce** environmental treatment programs across laboratories and (eventually) across non‑PSI growth systems.

Faketotron controls **environmental conditions** (temperature, humidity, CO₂, and multi‑channel lighting). The semantics layer provides a canonical representation that separates *scientific meaning* from *vendor implementation details*.

---

## 1. Motivation: why a semantics layer exists

Instrument protocols are often optimized for control firmware rather than archival science. Common issues include:

- **Encoded values** (e.g., storing 21 °C as 210 via an instrument convention).
- **Device-relative actuation scales** (e.g., light as `%` of driver output).
- **Implicit time semantics** (manual start vs wall‑clock anchored schedules).
- **Vendor-specific identifiers** that block reuse outside the original ecosystem.

The semantics layer turns these protocol artifacts into a representation that remains interpretable when the original vendor conventions are unknown.

---

## 2. Design philosophy

### 2.1 Canonicalization without losing reproducibility
The semantics representation simultaneously supports:

1. **Scientific interpretability**: physical units, explicit time semantics, explicit functional meaning of schedules.
2. **Operational reproducibility**: enough binding information to regenerate vendor protocols when desired.

### 2.2 Semantics are not constraints
Profile range checks, step limits, and “allowed channels” are engineering constraints of particular devices and UI implementations. They are intentionally **not treated as scientific semantics**.

### 2.3 Ontology mapping as a curated claim
Ontology terms encode *experimental intent*, not just numeric values. Fine-grained labels (e.g., “high temperature”) may depend on biological baselines and laboratory conventions. Therefore, mappings to ontology terms are recorded with explicit **relation qualifiers** (exact / close / broad / narrow) rather than inferred automatically.

---

## 3. Artifacts

Faketotron may export two closely related semantics artifacts from the same in-memory protocol:

### 3.1 `protocol_semantics.json` (protocol-aligned canonical)
A canonical representation that stays structurally aligned to the vendor-facing protocol organization (sections/parts/phases and vendor machine variables), while adding semantic meaning:

- explicit time semantics (manual start vs wall‑clock anchor)
- PECO mappings
- UCUM canonical units
- explicit mathematical meaning for curve primitives
- spectral calibration and leakage metadata for lighting

### 3.2 `portable_semantics.json` (vendor-neutral canonical)
A vendor-neutral view expressed in terms of stable channel identifiers (e.g., `env.air.temperature`, `light.blue.1`). It retains the same mathematical program semantics and spectral metadata while omitting vendor bindings.

These outputs are consistent: the portable artifact is a projection of the protocol-aligned canonical model with vendor bindings removed.

---

## 4. Schema contract and location

Semantics artifacts conform to versioned JSON Schemas stored in the repository:

- `schema/v0.1.0/protocol_semantics.schema.json`
- `schema/v0.1.0/portable_semantics.schema.json`

Each exported JSON includes a schema header:

- `schema.name` — stable schema family identifier  
- `schema.version` — semantic version (here: `0.1.0`)  
- `schema.id` — a resolvable schema identifier (ideally a raw GitHub URL pinned to a tag/release)

Even without runtime schema validation in the webapp, the schema serves as the scientific interoperability contract for downstream consumers.

---

## 5. Units: UCUM is normative

To remove ambiguity and support cross-lab tooling, canonical units MUST be UCUM codes:

- Temperature: `Cel`
- Fractions/driver output: `%`
- CO₂ setpoint: `ppm`
- Spectral photon irradiance: `umol.m-2.s-1.nm-1`

Vendor/source units from the instrument protocol may be recorded separately (e.g., `"celsius"` in the raw PSI protocol) but the semantics layer uses UCUM for canonical meaning.

---

## 6. Temporal semantics

### 6.1 Start semantics
Faketotron distinguishes:

- **Manual start**: schedule begins when the operator presses “start”.
- **Wall-clock anchored**: schedule is anchored to a local time-of-day (logical start time).

This distinction is critical for photoperiod and circadian-sensitive experiments.

### 6.2 Repeat semantics
Some instruments encode “infinite repetition” via sentinel integers (e.g., `2147483647`). Semantics files record both:

- the raw machine-compatible repeat value (when applicable), and
- the canonical interpretation (e.g., `forever`).

---

## 7. Curve primitives as mathematical objects

Control programs are expressed as sequences of phases. Each phase is a function on a time interval.

Let phase *i* start at absolute time `t0` (seconds since protocol start) with duration `D > 0`. The phase applies on:

- **t ∈ [t0, t0 + D)** (half‑open interval)

### 7.1 `const`
Constant setpoint across the phase interval:

- **y(t) = v**

### 7.2 `ramp`
Linear interpolation from `start` to `end` over `D`:

- **y(t) = start + (end − start) · (t − t0) / D**

Device implementations may approximate this target using discrete command updates; the semantics layer records the intended continuous function.

### 7.3 `sine`
Sine control may be specified using min/max form and translated to standard form:

Standard form:
- **y(t) = A · sin(ωt + φ) + C**

Translation:
- **A = (Max − Min) / 2**
- **ω = 2π / Period**
- **φ = 2π · Offset / Period**
- **C = (Max + Min) / 2**

### 7.4 `cloud`
A stochastic/algorithmic generator may be represented as a distinct type. If an explicit trace is required for reproducibility, export it as `csv-import`.

### 7.5 `csv-import`
An explicit time-value trace defined by points, with a declared interpolation rule. This representation can encode arbitrary waveforms and serves as the most explicit form of a schedule.

---

## 8. Ontology mapping (PECO)

Environmental treatments can be annotated with PECO terms (Plant Experimental Conditions Ontology). Each mapping includes a relation qualifier:

- **exact**: matches definition
- **close**: nearly matches, minor mismatch or missing specificity
- **broad**: more general than intended meaning (safe fallback)
- **narrow**: more specific than intended meaning (stronger claim)

Because some device channels do not have a one-to-one PECO class (e.g., “cyan” vs “green”), qualifiers are important for honest, machine-readable claims.

---

## 9. Lighting: spectrum-aware semantics

### 9.1 Why light is not reduced to PPFD
Multi-channel LED control changes the **spectral distribution**, not only total intensity. Reducing control to PPFD is lossy. Therefore, the canonical control variable remains:

- **% of driver output per channel** (UCUM `%`)

Derived physical quantities (including PPFD) may be computed downstream using calibration metadata, but are not treated as the primary control semantics.

### 9.2 Spectral calibration model (SpectraPen regression)
Calibration files are derived from PSI SpectraPen measurements where the instrument outputs dense spectra:

- wavelength (nm) → spectral photon irradiance (µmol·m⁻²·s⁻¹·nm⁻¹)

Measurements are taken at multiple LED driver percentages and positions. For each wavelength sample point λ, a linear regression is fitted:

- **E(λ) = A(λ) · p + b(λ)**

where:
- `p` is LED driver output in `%`
- `E(λ)` is spectral photon irradiance in `umol.m-2.s-1.nm-1`

Semantics calibration entries explicitly declare this model and reference the CSV containing the per‑wavelength `A` and `b` columns.

---

## 10. Two-shelf geometry and light leakage

In some chamber configurations, channels with suffix `2` refer to the **upper shelf** (e.g., `CoolWhite2`, `DeepRed2`), while the corresponding suffixless/`1` channel refers to the **lower shelf**.

Because upper shelf lighting can leak into the lower shelf volume, leakage may be calibrated using the same spectral regression approach:

- place the spectrometer on the **lower shelf**
- set **lower shelf LEDs to 0**
- vary **upper shelf** driver `%`
- fit per‑wavelength regression for the leakage contribution

Leakage is then composed additively in the spectral domain:

- **E_low_actual(λ) = E_low_set(λ) + E_leak(λ)**
- **E_leak(λ) = A(λ) · p_upper + b(λ)**

Leakage calibration is recorded only when explicitly provided (it may be negligible in many experiments).

---

## 11. Extensibility

The semantics model is intended to grow without breaking existing consumers:

- new environmental channels can be added (e.g., airflow, nutrient dosing)
- richer spectral representations can be introduced (e.g., measured spectrum curves)
- additional ontologies may be linked, while PECO remains the current primary ontology

The guiding principle is to encode **scientific meaning** explicitly while keeping vendor bindings optional and quarantined.

---

## 12. Recommended publication practice

For maximum reusability, publish:

- the raw vendor protocol (when available), and
- `protocol_semantics.json` and/or `portable_semantics.json` with the schema version cited.

This enables both operational reproduction and cross-platform scientific interpretation.
