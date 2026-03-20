import pandas as pd
import numpy as np
from pathlib import Path
from scipy.optimize import nnls

try:
    from .utils import load_calibration_data
except ImportError:
    from utils import load_calibration_data

def calculate_lamp_percentages(target_spectrum_df, room):
    """
    Calculates the lamp percentages for a given room to match the target spectrum.
    """
    print(f"\nProcessing room: {room}")
    
    # Step 5: Load Lamp Configuration
    calibration_data = load_calibration_data(room, base_path="Jeti_Spectrometer")
    if not calibration_data:
        return

    lamp_names = list(calibration_data.keys())
    
    # Get the wavelengths for the current room
    current_lamp_name = list(calibration_data.keys())[0]
    current_wavelengths = calibration_data[current_lamp_name]['wavelength'].values

    A_cols = []
    for data in calibration_data.values():
        # Find the column with the highest percentage
        max_percent_col = max(data.columns[1:], key=lambda c: int(c.strip('%')))
        A_cols.append(data.set_index('wavelength')[max_percent_col].values)
    
    A = np.array(A_cols).T

    # Interpolate A to match the target spectrum's wavelengths
    ref_wavelengths = target_spectrum_df.columns.astype(float).values
    if not np.array_equal(current_wavelengths, ref_wavelengths):
        A_interp = np.zeros((len(ref_wavelengths), A.shape[1]))
        for i in range(A.shape[1]):
            A_interp[:, i] = np.interp(ref_wavelengths, current_wavelengths, A[:, i])
        A = A_interp

    # Step 6: Apply Optimization
    results = []
    for timestamp, target_spectrum in target_spectrum_df.iterrows():
        b = target_spectrum.values
        
        # fillna with 0 for the target spectrum
        b = np.nan_to_num(b)
        
        percentages, _ = nnls(A, b)
        
        result_row = {'timestamp': timestamp}
        for i, lamp_name in enumerate(lamp_names):
            result_row[f"{lamp_name}_%"] = percentages[i] * 100 # as percentage
        results.append(result_row)

    results_df = pd.DataFrame(results)
    
    # Step 9: Export Final Hardware CSV
    output_filename = f"Cities/{room}_final_lamp_percentages.csv"
    results_df.to_csv(output_filename, index=False)
    print(f"Saved results for {room} to {output_filename}")

def main():
    data_dir = Path("fake_city_data")
    
    # Step 1 & 2: Load and filter data
    print("Step 1 & 2: Loading and filtering data...")
    irradiance_df = pd.read_csv(data_dir / "spectral_horizontal_irradiance.csv")
    location_df = pd.read_csv(data_dir / "meta_location.csv")
    
    # I only need the city name
    irradiance_df = irradiance_df.merge(location_df[['location_code', 'city']], on='location_code')
    
    irradiance_df['timestamp'] = pd.to_datetime(irradiance_df['timestamp'])
    
    january_ams_data = irradiance_df[
        (irradiance_df['city'] == 'Amsterdam') &
        (irradiance_df['timestamp'].dt.month == 1)
    ].copy()
    print("Filtered for Amsterdam, January.")

    # Step 3: Average the Spectra
    print("\nStep 3: Averaging spectra...")
    
    # Create a time bin for every 5 minutes from midnight
    january_ams_data['minutes_from_midnight'] = january_ams_data['timestamp'].dt.hour * 60 + january_ams_data['timestamp'].dt.minute
    bins = np.arange(0, 24 * 60 + 5, 5)
    labels = bins[:-1]
    january_ams_data['time_bin'] = pd.cut(january_ams_data['minutes_from_midnight'], bins=bins, labels=labels, right=False, include_lowest=True)
    
    # Group by time bin and wavelength, and calculate the mean
    avg_spectrum = january_ams_data.groupby(['time_bin', 'wavelength'])['spectral_horizontal_irradiance'].mean().unstack()

    # Convert bin labels to time strings
    def bin_to_time(bin_label):
        minutes_total = int(bin_label)
        hours = minutes_total // 60
        minutes = minutes_total % 60
        return f"{hours:02d}:{minutes:02d}"

    avg_spectrum.index = avg_spectrum.index.astype(str).map(bin_to_time)
    avg_spectrum = avg_spectrum.sort_index()

    print("Averaged spectra created.")
    
    # Step 4: Export Baseline CSV
    print("\nStep 4: Exporting baseline CSV...")
    output_path = Path("Cities") / "baseline_target_spectrum.csv"
    avg_spectrum.to_csv(output_path)
    print(f"Saved baseline spectrum to {output_path}")

    # Steps 5, 6, 9
    print("\nStarting Steps 5, 6, 9: Calculating lamp percentages...")
    target_spectrum_df = pd.read_csv(output_path, index_col=0)
    
    rooms = ['G4', 'G5', 'G6', 'G7', 'G8']
    for room in rooms:
        calculate_lamp_percentages(target_spectrum_df, room)

if __name__ == '__main__':
    main()
