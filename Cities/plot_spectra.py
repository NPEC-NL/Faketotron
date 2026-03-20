import pandas as pd
import matplotlib.pyplot as plt
import re
from pathlib import Path
import matplotlib.colors as mcolors


def get_wavelength_columns(df):
    """Get wavelength columns from the dataframe."""
    wavelength_cols = [col for col in df.columns if re.match(r'^\d+(\.\d+)?$', str(col))]
    return wavelength_cols


def plot_spectra_frame(
    spectra_frame: pd.DataFrame,
    output_path: Path,
    *,
    title: str | None = None,
    ylabel: str = 'Intensity',
):
    """Plot one day of spectra using the same style as the batch city plotter."""
    wavelength_cols = get_wavelength_columns(spectra_frame)
    if not wavelength_cols:
        raise ValueError("No wavelength columns were found in the provided spectra frame.")
    if 'time_of_day' not in spectra_frame.columns:
        raise KeyError("The provided spectra frame must contain a 'time_of_day' column.")

    plot_frame = spectra_frame.reset_index(drop=True).copy()
    wavelengths = pd.to_numeric(wavelength_cols)
    plot_data = plot_frame[wavelength_cols].apply(pd.to_numeric, errors='coerce').to_numpy(dtype=float)
    time_series = pd.to_datetime(plot_frame['time_of_day'], format='%H:%M')
    time_of_day_hours = time_series.dt.hour + time_series.dt.minute / 60

    if time_of_day_hours.empty:
        raise ValueError("The provided spectra frame does not contain any rows to plot.")

    if title is None:
        location_name = plot_frame['location_name'].iloc[0] if 'location_name' in plot_frame.columns else 'Unknown'
        month_name = plot_frame['month_name'].iloc[0] if 'month_name' in plot_frame.columns else 'Unknown'
        title = f'Spectral Intensity over a Day for {location_name} - {month_name}'

    output_path.parent.mkdir(parents=True, exist_ok=True)

    fig, ax = plt.subplots(figsize=(12, 8))
    norm = mcolors.Normalize(vmin=time_of_day_hours.min(), vmax=time_of_day_hours.max())
    cmap = plt.get_cmap('viridis')

    for row_index in range(len(plot_data)):
        ax.plot(wavelengths, plot_data[row_index], color=cmap(norm(time_of_day_hours.iloc[row_index])))

    ax.set_xlabel('Wavelength (nm)')
    ax.set_ylabel(ylabel)
    ax.set_title(title)

    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    fig.colorbar(sm, ax=ax, label='Time of Day (hour)')

    start_time = plot_frame['time_of_day'].min()
    end_time = plot_frame['time_of_day'].max()
    ax.legend([f"Time range: {start_time} to {end_time}"], loc='upper right')

    fig.savefig(output_path)
    plt.close(fig)
    return output_path


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
            
        if 'month_name' in df.columns:
            for month_name in df['month_name'].unique():
                month_df = df[df['month_name'] == month_name]
                
                # Check for single measurement table
                if 'measurement_table' in month_df.columns:
                    measurement_tables = month_df['measurement_table'].unique()
                    if len(measurement_tables) > 1:
                        print(f"Warning: Multiple measurement tables found for {city_name} in {month_name}. Plotting combined data.")

                plot_filename = output_dir / f"{city_name}_{month_name}.png"
                plot_spectra_frame(
                    month_df,
                    plot_filename,
                    title=f'Spectral Intensity over a Day for {city_name} - {month_name}',
                )
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
