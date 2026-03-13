from utils import load_calibration_data, create_target_spectrum
from scipy.optimize import nnls
import numpy as np
import pandas as pd
import os

if __name__ == '__main__':
    rooms = ['G4', 'G5', 'G6', 'G7', 'G8']
    
    # Use wavelengths from one of the calibration files as reference
    ref_calib_data = load_calibration_data('G4')
    if not ref_calib_data:
        exit()
    
    ref_lamp_name = list(ref_calib_data.keys())[0]
    ref_wavelengths = ref_calib_data[ref_lamp_name]['wavelength'].values

    target_spectrum_df = create_target_spectrum(ref_wavelengths)

    for room in rooms:
        print(f"Processing room: {room}")
        calibration_data = load_calibration_data(room)
        if not calibration_data:
            continue

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

        # Interpolate A if wavelengths are different
        if not np.array_equal(current_wavelengths, ref_wavelengths):
            A_interp = np.zeros((len(ref_wavelengths), A.shape[1]))
            for i in range(A.shape[1]):
                A_interp[:, i] = np.interp(ref_wavelengths, current_wavelengths, A[:, i])
            A = A_interp

        results = []
        for timestamp, target_spectrum in target_spectrum_df.iterrows():
            b = target_spectrum.values
            
            # Use nnls to find the optimal lamp percentages
            percentages, _ = nnls(A, b)
            
            result_row = {'timestamp': timestamp}
            for i, lamp_name in enumerate(lamp_names):
                result_row[f"{lamp_name}_%"] = percentages[i] * 100 # as percentage
            results.append(result_row)

        results_df = pd.DataFrame(results)
        output_filename = f"{room}_lamp_percentages.csv"
        results_df.to_csv(output_filename, index=False)
        print(f"Saved results for {room} to {output_filename}")
        print(results_df.head())
        print("-" * 30)
