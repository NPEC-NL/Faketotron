# Add your own city to CitiesTab

This tutorial converts timestamped spectral measurements into the wide,
monthly average-day CSV accepted by `CitiesTab.tsx`.

## Your input can come from anywhere

Your original data may come from any city, spectrometer, database, CSV, Excel
workbook, NetCDF file, or API. The sampling times and wavelength grid are also
your choice. The essential requirement is that every measured spectrum has:

- a date and local time;
- wavelengths in nanometres;
- a measured spectral value at every wavelength.

The notebook reads a **long CSV** because it is the simplest common format.
One spectrum occupies several rows, with its timestamp repeated:

```text
timestamp,wavelength,spectral_value
2026-06-15 12:00,400,0.52
2026-06-15 12:00,405,0.57
2026-06-15 12:00,410,0.61
```

Column names can be anything; map them in `COLUMNS` in the configuration cell.
For Excel, NetCDF, or another source, replace `pd.read_csv(...)` with the
appropriate loading code. The averaging and export sections work once the
loaded table has timestamp, wavelength, and value columns.

## Granada is only an example

The included example is the complete Granada subset from the SKYSPECTRA-style
dataset used to create the existing city files:

`example_input/ES-UGR_Granada_spectral_horizontal_irradiance.csv`

It contains 108,054 genuine source rows covering 12 months. Its original local
source is:

`D:\Maarten\Old\Alan_Cities\spectral_horizontal_irradiance.csv`

Granada is not required and is not a template city users must copy. It was
selected only because its global horizontal spectral irradiance uses a regular
5 nm grid and provides a complete runnable example.

SKYSPECTRA is described by Balakrishnan et al. (2023), *SKYSPECTRA: An
Opensource Data Package of Worldwide Spectral Daylight*, Proceedings of the
30th CIE Session, DOI: 10.25039/x50.2023.OP026.

## Run the tutorial

1. Install Python 3 and pandas.
2. Open `add_your_own_city.ipynb`.
3. Change the input path, city information, and column mapping.
4. Run all cells.
5. Find the generated file in `output/`.

The notebook does not import repository modules.

## Normalized notebook input

Before averaging, the loaded data must be long-form: one row per timestamp and
wavelength. It must contain a local timestamp, wavelength in nm, and spectral
value. The example values are energy irradiance in `W/(m2*nm)`.

Location code, measurement setup, Sun inclusion, and patch dimensions are
configurable. Set unavailable source columns to `None`; the notebook then uses
the configured defaults.

Timestamps may include an abbreviation such as `1996-02-09 10:03 CET`. They
are grouped as local civil time and are not converted to UTC.

## Exact CitiesTab output format

The result must be a comma-separated CSV with a header and no pandas index. It
must contain exactly one city. Each row represents one complete spectrum for
one month and one local time bin.

### Required columns

| Column | Exact format |
| --- | --- |
| `location_name` | Non-empty city name, identical on every row |
| `month` | Integer from `1` through `12` |
| `time_bin_minutes` | Integer minutes after midnight, from `0` through `1439` |
| Numeric wavelength columns | One or more headers containing only a wavelength, such as `380`, `400`, `405`, or `750.5` |

Every wavelength cell contains that row's spectral value at that wavelength.

### Recommended complete metadata

The notebook writes the established pipeline columns in this order:

`location_code`, `location_name`, `measurement_table`, `month`, `month_name`,
`time_bin_minutes`, `time_of_day`, `measurement_setup`, `sun_included`, `patch`,
`patch_almucantar`, `patch_azimuth`, `samples_averaged`, followed by numeric
wavelength columns in ascending order.

| Column | Exact format |
| --- | --- |
| `location_code` | Short identifier such as `ES-UGR` |
| `measurement_table` | Description such as `spectral_horizontal_irradiance` |
| `month_name` | Display label such as `June` |
| `time_of_day` | Local `HH:MM`, consistent with `time_bin_minutes` |
| `measurement_setup` | Instrument/setup identifier; use one constant if no alternatives exist |
| `sun_included` | `TRUE` or `FALSE` |
| `patch`, `patch_almucantar`, `patch_azimuth` | Empty unless patch-radiance data requires them |
| `samples_averaged` | Number of source observations averaged into the row |

Example header:

```text
location_code,location_name,measurement_table,month,month_name,time_bin_minutes,time_of_day,measurement_setup,sun_included,patch,patch_almucantar,patch_azimuth,samples_averaged,380,385,390,...,780
```

Example data row:

```text
ES-UGR,Granada,spectral_horizontal_irradiance,6,June,720,12:00,1,TRUE,,,,4,0.12,0.14,0.16,...,0.08
```

Here `720` means 12:00 local time, `4` source spectra were averaged, and every
value from `0.12` onward corresponds positionally to a wavelength header.
Optional empty metadata fields remain empty between commas.

Rows must be unique for the combination of month, time bin, measurement table,
measurement setup, Sun inclusion, and patch dimensions. Do not combine
different cities in one upload.

### Units

The tutorial exports energy irradiance in `W/(m2*nm)` and omits a `unit`
column. CitiesTab therefore treats it as energy and converts it to photon units.

If values are already photon flux density in `umol/(s*m2*nm)`, add a `unit`
column containing `photon` on every row. Explicit `unit=energy` is also
accepted.

## Upload

1. Open **Cities** in the web application.
2. Select **Cities** as the source.
3. Upload the generated file under **City average-day CSV**.
4. Upload one room calibration CSV.
5. Select a month and fit the city to the room.
