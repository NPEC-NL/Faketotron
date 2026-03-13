
import pandas as pd
import numpy as np
import os

def load_calibration_data(room: str, base_path: str = r'C:\thesis\NPEC_Faketron\Jeti_Spectrometer'):
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

    # Read the lamp names from the 'Name' row (line 5)
    lamp_names_df = pd.read_csv(file_path, sep=';', skiprows=4, nrows=1, header=None)
    lamp_names = lamp_names_df.iloc[0].tolist()
    
    # Clean up lamp names
    lamp_names = [name.strip() for name in lamp_names if isinstance(name, str) and name.strip()]

    # Load the spectral data, skipping metadata
    # The actual data starts after the line 'Wavelength [nm];Ee [W/(sqm*nm)];...'
    # We find this line number to use as the header row
    header_row_index = 0
    with open(file_path, 'r') as f:
        for i, line in enumerate(f):
            if 'Wavelength [nm]' in line:
                header_row_index = i
                break
    
    df = pd.read_csv(file_path, sep=';', skiprows=header_row_index, decimal=',')
    df = df.rename(columns={'Wavelength [nm]': 'wavelength'})

    # Get the column headers that represent lamp measurements
    measurement_cols = [col for col in df.columns if col.startswith('Ee')]
    
    # Group columns by lamp type. Let's assume 3 types based on gaps in # in csv
    # This is a bit of a guess and might need refinement.
    # From the file, it seems like there are groups of 20-21 measurements.
    
    lamp_data = {}
    # Based on G4 file:
    # Lamp 1: from column index 1 to 21
    # Lamp 2: from column index 22 to 42
    # Lamp 3: from column index 43 to 63
    
    num_lamps = len(lamp_names)
    num_cols = len(measurement_cols)
    cols_per_lamp = 21 # Assuming 0-100% in 5% steps = 21 measurements
    
    if num_lamps == 3: # Assuming G4, G5, G8 structure
        lamp_groups = {
            lamp_names[0]: measurement_cols[0:21],
            lamp_names[1]: measurement_cols[21:42],
            lamp_names[2]: measurement_cols[42:63]
        }
    elif num_lamps == 6: # Assuming G6, G7 structure
        lamp_groups = {
            lamp_names[0]: measurement_cols[0:21],
            lamp_names[1]: measurement_cols[21:42],
            lamp_names[2]: measurement_cols[42:63],
            lamp_names[3]: measurement_cols[63:84],
            lamp_names[4]: measurement_cols[84:105],
            lamp_names[5]: measurement_cols[105:126]
        }
    else:
        print(f"Unhandled number of lamps ({num_lamps}) in room {room}")
        return None

    h = 6.62607015e-34  # J*s
    c = 299792458      # m/s
    N_A = 6.02214076e23 # mol^-1
    
    for lamp_name, cols in lamp_groups.items():
        lamp_df = df[['wavelength'] + cols].copy()
        
        # Convert from W/m^2/nm to umol/m^2/s/nm
        for i, col in enumerate(cols):
            # umol/s/m2/nm = (W/m2/nm) * lambda * 1e-9 / (h*c) / N_A * 1e6
            conversion_factor = (lamp_df['wavelength'] * 1e-9) / (h * c * N_A) * 1e6
            
            # New column name for micromol
            micromol_col_name = f"{i*5}%"
            lamp_df[micromol_col_name] = lamp_df[col] * conversion_factor
            lamp_df = lamp_df.drop(columns=col)
            
        lamp_data[lamp_name] = lamp_df
        
    return lamp_data

if __name__ == '__main__':
    g4_data = load_calibration_data('G4')
    if g4_data:
        print("Successfully loaded data for G4.")
        for lamp, data in g4_data.items():
            print(f"Lamp: {lamp}")
            print(data.head())
            print(f"Columns: {data.columns.tolist()}")
            # print total PAR for 100%
            par_data = data[(data['wavelength'] >= 400) & (data['wavelength'] <= 700)]
            total_par = par_data['100%'].sum()
            print(f"Total PAR at 100%: {total_par:.2f} umol/m^2/s")

    g6_data = load_calibration_data('G6')
    if g6_data:
        print("\nSuccessfully loaded data for G6.")
        for lamp, data in g6_data.items():
            print(f"Lamp: {lamp}")
            print(data.head())
            # print total PAR for 100%
            par_data = data[(data['wavelength'] >= 400) & (data['wavelength'] <= 700)]
            total_par = par_data['100%'].sum()
            print(f"Total PAR at 100%: {total_par:.2f} umol/m^2/s")

