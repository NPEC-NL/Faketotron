import pandas as pd
import matplotlib.pyplot as plt
import os
import re
from pathlib import Path
import matplotlib.colors as mcolors
import numpy as np

def get_wavelength_columns(df):
    """Get wavelength columns from the dataframe."""
    wavelength_cols = [col for col in df.columns if re.match(r'^\d+(\.\d+)?$', str(col))]
    return wavelength_cols

def plot_city_month_spectra(input_dir: Path, output_dir: Path):
    """
    Generates plots for each city and month from CSV files.
    """
    if not input_dir.exists():
        print(f"Input directory {input_dir} does not exist.")
        return

    output_dir.mkdir(parents=True, exist_ok=True)

    for csv_file in input_dir.glob('*_average_day_by_month.csv'):
        print(f"Processing {csv_file.name}...")
        df = pd.read_csv(csv_file)
        
        # Fallback to file name if location_name or month_name are not present
        if 'location_name' in df.columns:
            city_name = df['location_name'].iloc[0]
        else:
            city_name = csv_file.name.split('_')[1]

        wavelength_cols = get_wavelength_columns(df)
        if not wavelength_cols:
            print(f"No wavelength data found in {csv_file.name}. Skipping.")
            continue
            
        wavelengths = pd.to_numeric(wavelength_cols)

        if 'month_name' in df.columns:
            for month_name in df['month_name'].unique():
                month_df = df[df['month_name'] == month_name]
                
                # Check for single measurement table
                if 'measurement_table' in month_df.columns:
                    measurement_tables = month_df['measurement_table'].unique()
                    if len(measurement_tables) > 1:
                        print(f"Warning: Multiple measurement tables found for {city_name} in {month_name}. Plotting combined data.")
                
                plot_data = month_df[wavelength_cols].to_numpy()
                time_of_day_series = pd.to_datetime(month_df['time_of_day'], format='%H:%M').dt.hour + pd.to_datetime(month_df['time_of_day'], format='%H:%M').dt.minute / 60

                if time_of_day_series.empty:
                    print(f"No time data for {city_name} - {month_name}. Skipping.")
                    continue
                
                fig, ax = plt.subplots(figsize=(12, 8))
                
                norm = mcolors.Normalize(vmin=time_of_day_series.min(), vmax=time_of_day_series.max())
                cmap = plt.get_cmap('viridis')
                
                for i in range(len(plot_data)):
                    ax.plot(wavelengths, plot_data[i], color=cmap(norm(time_of_day_series.iloc[i])))

                ax.set_xlabel('Wavelength (nm)')
                ax.set_ylabel('Intensity')
                ax.set_title(f'Spectral Intensity over a Day for {city_name} - {month_name}')
                
                sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
                sm.set_array([])
                cbar = fig.colorbar(sm, ax=ax, label='Time of Day (hour)')
                
                start_time = month_df['time_of_day'].min()
                end_time = month_df['time_of_day'].max()
                ax.legend([f"Time range: {start_time} to {end_time}"], loc='upper right')

                plot_filename = output_dir / f"{city_name}_{month_name}.png"
                fig.savefig(plot_filename)
                plt.close(fig)
                print(f"Saved plot: {plot_filename}")
        else:
            print(f"No 'month_name' column in {csv_file.name}. Can't create monthly plots.")


if __name__ == '__main__':
    # The user-provided path contained a typo "D:\Maarten", it should be "D:\Maarten"
    # Correcting it to use a raw string literal and ensure it's a directory.
    # The user also specified D:\Maarten\Alan_Cities\Per_City_Per_Month_Output
    input_directory = Path(r"D:\Maarten\Alan_Cities\Per_City_Per_Month_Output")
    
    # Assuming the script is in Cities/, so ../Cities/Output/Plots
    output_directory = Path(r"D:\Maarten\Alan_Cities\Per_City_Per_Month_Output\Plots")
    
    plot_city_month_spectra(input_directory, output_directory)
