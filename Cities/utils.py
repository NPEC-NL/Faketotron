import pandas as pd
import numpy as np
import os

def load_calibration_data(room: str, base_path: str = 'Jeti_Spectrometer'):
    """
    Loads the calibration data for a specific room.
    Args:
        room (str): The room identifier (e.g., 'G4', 'G5').
        base_path (str): The base path to the calibration files.
    Returns:
        dict: A dictionary where keys are lamp names and values are pandas DataFrames
              containing the spectral data at different intensities.
    """
    file_name = f"{room}_Calibration_File.csv"
    if room == 'G4':
        file_name = f"{room}_Calibration_file.csv" #Fixing case for G4
    file_path = os.path.join(base_path, file_name)

    if not os.path.exists(file_path):
        print(f"Calibration file for room {room} not found at {file_path}")
        return None

    # Define the number of lamps for each room
    room_lamp_config = {
        'G4': 3, 'G5': 3, 'G8': 3,
        'G6': 6, 'G7': 6
    }
    num_lamps = room_lamp_config.get(room)
    if not num_lamps:
        print(f"Unknown room configuration for {room}")
        return None

    # Load the spectral data, skipping metadata
    header_row_index = 0
    with open(file_path, 'r', encoding='latin-1') as f:
        for i, line in enumerate(f):
            if 'Wavelength [nm]' in line:
                header_row_index = i
                break
    
    df = pd.read_csv(file_path, sep=';', skiprows=header_row_index, decimal=',', encoding='latin-1')
    df = df.rename(columns={'Wavelength [nm]': 'wavelength'})
    df = df.dropna(axis=1, how='all')

    # Get the column headers that represent lamp measurements
    measurement_cols = [col for col in df.columns if col.startswith('Ee')]
    
    # Distribute the measurement columns among the lamps
    cols_per_lamp = len(measurement_cols) // num_lamps
    lamp_groups = {}
    for i in range(num_lamps):
        lamp_name = f"Lamp {i+1}"
        start_col_index = i * cols_per_lamp
        end_col_index = start_col_index + cols_per_lamp
        lamp_groups[lamp_name] = measurement_cols[start_col_index:end_col_index]

    lamp_data = {}
    h = 6.62607015e-34  # J*s
    c = 299792458      # m/s
    N_A = 6.02214076e23 # mol^-1
    
    for lamp_name, cols in lamp_groups.items():
        if not cols:
            continue
        lamp_df = df[['wavelength'] + cols].copy()
        
        for i, col in enumerate(cols):
            conversion_factor = (lamp_df['wavelength'] * 1e-9) / (h * c * N_A) * 1e6
            
            micromol_col_name = f"{i*5}%"
            lamp_df[micromol_col_name] = lamp_df[col] * conversion_factor
            lamp_df = lamp_df.drop(columns=col)
        
        lamp_data[lamp_name] = lamp_df
        
    return lamp_data

def create_target_spectrum(wavelengths):
    """
    Creates a placeholder target spectrum.
    This function generates a dummy target spectrum for 24 hours at 5-minute intervals.
    The spectrum is a simple sine wave shape for demonstration.
    """
    timestamps = pd.to_datetime(pd.date_range(start='2024-01-01', periods=288, freq='5min'))
    target_df = pd.DataFrame(index=timestamps, columns=wavelengths)

    for ts in timestamps:
        # Create a simple spectrum that changes over time (e.g., sine wave)
        time_factor = np.sin(ts.hour * np.pi / 24)
        # A simple Gaussian-like spectrum shape
        spectrum = 100 * time_factor * np.exp(-((wavelengths - 550) ** 2) / (2 * 50 ** 2))
        target_df.loc[ts] = spectrum

    return target_df
