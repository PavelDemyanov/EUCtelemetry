import pandas as pd
from datetime import datetime
import logging
import os
import numpy as np

def parse_timestamp_darnkessbot(date_str):
    try:
        # Check if input is float
        if isinstance(date_str, float):
            return None

        # Convert to string if needed
        date_str = str(date_str).strip()

        # Try to parse the date string
        dt = datetime.strptime(date_str, '%d.%m.%Y %H:%M:%S.%f')
        return dt.timestamp()
    except (ValueError, TypeError) as e:
        logging.error(f"Error parsing darnkessbot timestamp: {e}")
        return None

def parse_timestamp_wheellog(date_str, time_str):
    try:
        # Check if either input is float
        if isinstance(date_str, float) or isinstance(time_str, float):
            return None

        # Convert to strings if needed
        date_str = str(date_str).strip()
        time_str = str(time_str).strip()

        # Try to parse the date
        dt_str = f"{date_str} {time_str}"
        dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S.%f')
        return dt.timestamp()
    except (ValueError, TypeError) as e:
        logging.error(f"Error parsing wheellog timestamp: {e}")
        return None

def detect_csv_type(df):
    """Detect CSV type based on column names"""
    logging.info(f"Detecting CSV type. Available columns: {df.columns.tolist()}")

    # Define required columns for each type
    darnkessbot_cols = ['Date', 'Temperature', 'GPS Speed', 'Total mileage', 'Battery level', 
                      'Speed', 'PWM', 'Current', 'Voltage', 'Power']
    wheellog_cols = ['date', 'time', 'speed', 'totaldistance', 'battery_level', 
                   'pwm', 'voltage', 'current', 'power', 'gps_speed', 'system_temp']

    # Check if all required columns exist for each type
    is_darnkessbot = all(col in df.columns for col in darnkessbot_cols)
    is_wheellog = all(col in df.columns for col in wheellog_cols)

    logging.info(f"CSV type detection results - DarknessBot: {is_darnkessbot}, WheelLog: {is_wheellog}")

    if is_darnkessbot:
        return 'darnkessbot'
    elif is_wheellog:
        return 'wheellog'
    else:
        # Log which columns are missing for each type
        if not is_darnkessbot:
            missing_darnkessbot = [col for col in darnkessbot_cols if col not in df.columns]
            logging.info(f"Missing DarknessBot columns: {missing_darnkessbot}")
        if not is_wheellog:
            missing_wheellog = [col for col in wheellog_cols if col not in df.columns]
            logging.info(f"Missing WheelLog columns: {missing_wheellog}")
        raise ValueError("CSV format not recognized")

def process_mileage(series, csv_type):
    """Process mileage values based on CSV type"""
    try:
        # Convert to numeric, replacing any non-numeric values with NaN
        series = pd.to_numeric(series, errors='coerce')

        # Replace infinite values with NaN
        series = series.replace([float('inf'), float('-inf')], np.nan)

        # Fill NaN values with 0
        series = series.fillna(0)

        if len(series) == 0:
            return series

        # Round all values to integers first
        series = series.round().astype(int)

        # Get the first value
        first_value = series.iloc[0]

        # Calculate differences from first value
        processed = series - first_value

        if csv_type == 'wheellog':
            # Remove last 3 digits by integer division
            processed = (processed / 1000).astype(int)

        # Make first value 0
        processed.iloc[0] = 0

        return processed
    except Exception as e:
        logging.error(f"Error processing mileage: {e}")
        raise

def clean_numeric_column(series):
    """Clean numeric column by handling NA and infinite values"""
    # Replace infinite values with 0
    series = series.replace([float('inf'), float('-inf')], 0)
    # Fill NA/NaN values with 0
    series = series.fillna(0)
    # Round and convert to integer
    return series.round().astype(int)

def remove_consecutive_duplicates(data):
    """Remove consecutive duplicate rows based on specified columns"""
    try:
        # Create DataFrame from the processed data
        df = pd.DataFrame(data)

        # Define columns to check for duplicates
        columns_to_check = ['speed', 'gps', 'voltage', 'temperature', 'current', 
                          'battery', 'mileage', 'pwm', 'power']

        # Create mask for consecutive duplicates
        duplicate_mask = ~(df[columns_to_check].shift() == df[columns_to_check]).all(axis=1)

        # Keep first row and non-consecutive duplicates
        clean_df = df[duplicate_mask]

        # Convert back to dictionary format
        return {col: clean_df[col].tolist() for col in df.columns}
    except Exception as e:
        logging.error(f"Error removing consecutive duplicates: {e}")
        raise

def interpolate_numeric_data(data, columns_to_interpolate):
    """Interpolate missing values in numeric columns using two-way interpolation"""
    try:
        # Create DataFrame from the data
        df = pd.DataFrame(data)

        # Interpolate specified columns
        for col in columns_to_interpolate:
            if col in df.columns:
                # Convert to float for interpolation
                df[col] = pd.to_numeric(df[col], errors='coerce')

                # Replace infinite values with NaN
                df[col] = df[col].replace([float('inf'), float('-inf')], np.nan)

                # Fill NaN with 0 before interpolation
                df[col] = df[col].fillna(0)

                # Apply two-way interpolation
                df[col] = df[col].interpolate(method='linear', limit_direction='both')

                # Ensure all values are finite after interpolation
                df[col] = df[col].replace([float('inf'), float('-inf')], 0)

                # Round and convert back to integer
                df[col] = df[col].round().astype(int)

        # Convert back to dictionary format
        return {col: df[col].tolist() for col in df.columns}
    except Exception as e:
        logging.error(f"Error during interpolation: {e}")
        raise

def process_csv_file(file_path, folder_number=None, existing_csv_type=None, interpolate_values=True):
    """Process CSV file and save processed data with unique project identifier"""
    try:
        # Create processed data directory if it doesn't exist
        os.makedirs('processed_data', exist_ok=True)

        # Define processed file path
        processed_csv_path = None
        if folder_number is not None:
            processed_csv_path = os.path.join('processed_data', f'project_{folder_number}_{os.path.basename(file_path)}')

        # Check if processed file already exists
        if processed_csv_path and os.path.exists(processed_csv_path):
            # Load existing processed data
            logging.info(f"Loading existing processed CSV from {processed_csv_path}")
            df = pd.read_csv(processed_csv_path)
            csv_type = existing_csv_type or ('darnkessbot' if 'Date' in df.columns else 'wheellog')

            # Convert DataFrame to dictionary format
            processed_data = {
                'timestamp': df['timestamp'].tolist(),
                'speed': df['speed'].tolist(),
                'gps': df['gps'].tolist(),
                'voltage': df['voltage'].tolist(),
                'temperature': df['temperature'].tolist(),
                'current': df['current'].tolist(),
                'battery': df['battery'].tolist(),
                'mileage': df['mileage'].tolist(),
                'pwm': df['pwm'].tolist(),
                'power': df['power'].tolist()
            }

            # Apply interpolation if requested
            if interpolate_values:
                columns_to_interpolate = ['speed', 'gps', 'voltage', 'temperature', 'current', 
                                      'battery', 'mileage', 'pwm', 'power']
                processed_data = interpolate_numeric_data(processed_data, columns_to_interpolate)

            # Remove consecutive duplicates
            processed_data = remove_consecutive_duplicates(processed_data)
            return csv_type, processed_data

        # If file doesn't exist, process the CSV
        df = pd.read_csv(file_path)
        logging.info(f"Processing new CSV file: {file_path}")
        logging.info(f"CSV columns: {df.columns.tolist()}")

        # Use existing type if provided, otherwise detect
        csv_type = existing_csv_type
        if csv_type is None:
            csv_type = detect_csv_type(df)
            logging.info(f"Detected CSV type: {csv_type}")

        if csv_type == 'darnkessbot':
            # Parse timestamps and create a mask for valid timestamps
            df['timestamp'] = df['Date'].apply(parse_timestamp_darnkessbot)
            valid_timestamp_mask = df['timestamp'].notna()

            # Filter out rows with invalid timestamps
            df = df[valid_timestamp_mask]

            raw_data = {
                'timestamp': df['timestamp'],
                'speed': pd.to_numeric(df['Speed'], errors='coerce'),
                'gps': pd.to_numeric(df['GPS Speed'], errors='coerce'),
                'voltage': pd.to_numeric(df['Voltage'], errors='coerce'),
                'temperature': pd.to_numeric(df['Temperature'], errors='coerce'),
                'current': pd.to_numeric(df['Current'], errors='coerce'),
                'battery': pd.to_numeric(df['Battery level'], errors='coerce'),
                'mileage': pd.to_numeric(df['Total mileage'], errors='coerce'),
                'pwm': pd.to_numeric(df['PWM'], errors='coerce'),
                'power': pd.to_numeric(df['Power'], errors='coerce')
            }

            # Apply interpolation before cleaning if requested
            if interpolate_values:
                columns_to_interpolate = ['speed', 'gps', 'voltage', 'temperature', 'current', 
                                      'battery', 'mileage', 'pwm', 'power']
                raw_data = interpolate_numeric_data(raw_data, columns_to_interpolate)

            # Clean and process the data
            processed_data = {
                'timestamp': raw_data['timestamp'],
                'speed': clean_numeric_column(pd.Series(raw_data['speed'])),
                'gps': clean_numeric_column(pd.Series(raw_data['gps'])),
                'voltage': clean_numeric_column(pd.Series(raw_data['voltage'])),
                'temperature': clean_numeric_column(pd.Series(raw_data['temperature'])),
                'current': clean_numeric_column(pd.Series(raw_data['current'])),
                'battery': clean_numeric_column(pd.Series(raw_data['battery'])),
                'mileage': process_mileage(pd.Series(raw_data['mileage']), csv_type),
                'pwm': clean_numeric_column(pd.Series(raw_data['pwm'])),
                'power': clean_numeric_column(pd.Series(raw_data['power']))
            }

        else:  # wheellog
            # Parse timestamps and create a mask for valid timestamps
            df['timestamp'] = df.apply(lambda x: parse_timestamp_wheellog(x['date'], x['time']), axis=1)
            valid_timestamp_mask = df['timestamp'].notna()

            # Filter out rows with invalid timestamps
            df = df[valid_timestamp_mask]

            raw_data = {
                'timestamp': df['timestamp'],
                'speed': pd.to_numeric(df['speed'], errors='coerce'),
                'gps': pd.to_numeric(df['gps_speed'], errors='coerce'),
                'voltage': pd.to_numeric(df['voltage'], errors='coerce'),
                'temperature': pd.to_numeric(df['system_temp'], errors='coerce'),
                'current': pd.to_numeric(df['current'], errors='coerce'),
                'battery': pd.to_numeric(df['battery_level'], errors='coerce'),
                'mileage': pd.to_numeric(df['totaldistance'], errors='coerce'),
                'pwm': pd.to_numeric(df['pwm'], errors='coerce'),
                'power': pd.to_numeric(df['power'], errors='coerce')
            }

            # Apply interpolation before cleaning if requested
            if interpolate_values:
                columns_to_interpolate = ['speed', 'gps', 'voltage', 'temperature', 'current', 
                                      'battery', 'mileage', 'pwm', 'power']
                raw_data = interpolate_numeric_data(raw_data, columns_to_interpolate)

            # Clean and process the data
            processed_data = {
                'timestamp': raw_data['timestamp'],
                'speed': clean_numeric_column(pd.Series(raw_data['speed'])),
                'gps': clean_numeric_column(pd.Series(raw_data['gps'])),
                'voltage': clean_numeric_column(pd.Series(raw_data['voltage'])),
                'temperature': clean_numeric_column(pd.Series(raw_data['temperature'])),
                'current': clean_numeric_column(pd.Series(raw_data['current'])),
                'battery': clean_numeric_column(pd.Series(raw_data['battery'])),
                'mileage': process_mileage(pd.Series(raw_data['mileage']), csv_type),
                'pwm': clean_numeric_column(pd.Series(raw_data['pwm'])),
                'power': clean_numeric_column(pd.Series(raw_data['power']))
            }

        # Remove consecutive duplicates
        processed_data = remove_consecutive_duplicates(processed_data)

        # Save processed data if folder_number is provided
        if processed_csv_path:
            processed_df = pd.DataFrame(processed_data)
            processed_df.to_csv(processed_csv_path, index=False)
            logging.info(f"Saved processed CSV to {processed_csv_path}")

        return csv_type, processed_data

    except Exception as e:
        logging.error(f"Error processing CSV file: {e}")
        raise