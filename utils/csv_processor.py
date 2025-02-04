import pandas as pd
from datetime import datetime
import logging
import os

def parse_timestamp_darnkessbot(date_str):
    try:
        dt = datetime.strptime(date_str, '%d.%m.%Y %H:%M:%S.%f')
        return dt.timestamp()
    except ValueError as e:
        logging.error(f"Error parsing darnkessbot timestamp: {e}")
        raise

def parse_timestamp_wheellog(date_str, time_str):
    try:
        dt_str = f"{date_str} {time_str}"
        dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S.%f')
        return dt.timestamp()
    except ValueError as e:
        logging.error(f"Error parsing wheellog timestamp: {e}")
        raise

def detect_csv_type(df):
    darnkessbot_cols = ['Date', 'Temperature', 'GPS Speed', 'Total mileage', 'Battery level', 
                        'Speed', 'PWM', 'Current', 'Voltage', 'Power']
    wheellog_cols = ['power', 'totaldistance', 'time', 'date', 'pwm', 'battery_level', 
                    'speed', 'system_temp', 'current', 'gps_speed', 'voltage']

    if all(col in df.columns for col in darnkessbot_cols):
        return 'darnkessbot'
    elif all(col in df.columns for col in wheellog_cols):
        return 'wheellog'
    else:
        raise ValueError("CSV format not recognized")

def clean_numeric_column(series):
    """Clean numeric column by handling NA and infinite values"""
    # Replace infinite values with 0
    series = series.replace([float('inf'), float('-inf')], 0)
    # Fill NA/NaN values with 0
    series = series.fillna(0)
    # Round and convert to integer
    return series.round().astype(int)

def process_csv_file(file_path):
    try:
        df = pd.read_csv(file_path)
        csv_type = detect_csv_type(df)

        if csv_type == 'darnkessbot':
            df['timestamp'] = df['Date'].apply(parse_timestamp_darnkessbot)
            processed_data = {
                'timestamp': df['timestamp'],
                'speed': clean_numeric_column(df['Speed']),
                'gps': clean_numeric_column(df['GPS Speed']),
                'voltage': clean_numeric_column(df['Voltage']),
                'temperature': clean_numeric_column(df['Temperature']),
                'current': clean_numeric_column(df['Current']),
                'battery': clean_numeric_column(df['Battery level']),
                'mileage': clean_numeric_column(df['Total mileage']),
                'pwm': clean_numeric_column(df['PWM']),
                'power': clean_numeric_column(df['Power'])
            }
        else:  # wheellog
            df['timestamp'] = df.apply(lambda x: parse_timestamp_wheellog(x['date'], x['time']), axis=1)
            processed_data = {
                'timestamp': df['timestamp'],
                'speed': clean_numeric_column(df['speed']),
                'gps': clean_numeric_column(df['gps_speed']),
                'voltage': clean_numeric_column(df['voltage']),
                'temperature': clean_numeric_column(df['system_temp']),
                'current': clean_numeric_column(df['current']),
                'battery': clean_numeric_column(df['battery_level']),
                'mileage': clean_numeric_column(df['totaldistance']),
                'pwm': clean_numeric_column(df['pwm']),
                'power': clean_numeric_column(df['power'])
            }

        # Create processed data directory if it doesn't exist
        os.makedirs('processed_data', exist_ok=True)

        # Convert processed data to DataFrame and save
        processed_df = pd.DataFrame(processed_data)
        processed_csv_path = f'processed_data/processed_{os.path.basename(file_path)}'
        processed_df.to_csv(processed_csv_path, index=False)

        return csv_type, processed_data
    except Exception as e:
        logging.error(f"Error processing CSV file: {e}")
        raise