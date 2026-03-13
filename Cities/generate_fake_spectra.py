import pandas as pd
import numpy as np
import os
from pathlib import Path

def generate_spectrum(wavelengths, peak_wl=550, width=50):
    """Generates a simple Gaussian-like spectrum."""
    return np.exp(-((wavelengths - peak_wl) ** 2) / (2 * width ** 2))

def create_fake_spectral_data(
    output_dir="fake_city_data",
    location="AMS",
    setup="SETUP1",
    year=2024,
    month=1,
    days=[15, 16],
):
    """Creates a fake spectral_horizontal_irradiance.csv file."""
    wavelengths = np.arange(380, 781, 5)
    
    timestamps = []
    for day in days:
        for hour in range(8, 18): # From 8am to 5pm
            for minute in range(0, 60, 30): # Every 30 minutes
                timestamps.append(
                    pd.Timestamp(year=year, month=month, day=day, hour=hour, minute=minute)
                )

    records = []
    spectrum_shape = generate_spectrum(wavelengths)
    for ts in timestamps:
        time_factor = np.sin((ts.hour - 6) * np.pi / 12)
        
        for i, wl in enumerate(wavelengths):
            irradiance = 100 * time_factor * spectrum_shape[i] * np.random.uniform(0.9, 1.1)
            records.append({
                "location_code": location,
                "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                "measurement_setup": setup,
                "wavelength": wl,
                "spectral_horizontal_irradiance": irradiance if irradiance > 0 else 0
            })
            
    df = pd.DataFrame(records)
    
    # Create the other spectral files as empty files for now
    for fname in ["spectral_direct_irradiance.csv", "spectral_patch_radiance.csv"]:
        (Path(output_dir) / fname).touch()

    output_path = os.path.join(output_dir, "spectral_horizontal_irradiance.csv")
    df.to_csv(output_path, index=False)
    print(f"Generated fake spectral data at {output_path}")

if __name__ == "__main__":
    create_fake_spectral_data()
