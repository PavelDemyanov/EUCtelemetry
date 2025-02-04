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

def process_csv_file(file_path):
    try:
        df = pd.read_csv(file_path)
        csv_type = detect_csv_type(df)

        if csv_type == 'darnkessbot':
            df['timestamp'] = df['Date'].apply(parse_timestamp_darnkessbot)
            processed_data = {
                'timestamp': df['timestamp'],
                'speed': df['Speed'].round().astype(int),
                'gps': df['GPS Speed'].round().astype(int),
                'voltage': df['Voltage'].round().astype(int),
                'temperature': df['Temperature'].round().astype(int),
                'current': df['Current'].round().astype(int),
                'battery': df['Battery level'].round().astype(int),
                'mileage': df['Total mileage'].round().astype(int),
                'pwm': df['PWM'].round().astype(int),
                'power': df['Power'].round().astype(int)
            }
        else:  # wheellog
            df['timestamp'] = df.apply(lambda x: parse_timestamp_wheellog(x['date'], x['time']), axis=1)
            processed_data = {
                'timestamp': df['timestamp'],
                'speed': df['speed'].round().astype(int),
                'gps': df['gps_speed'].round().astype(int),
                'voltage': df['voltage'].round().astype(int),
                'temperature': df['system_temp'].round().astype(int),
                'current': df['current'].round().astype(int),
                'battery': df['battery_level'].round().astype(int),
                'mileage': df['totaldistance'].round().astype(int),
                'pwm': df['pwm'].round().astype(int),
                'power': df['power'].round().astype(int)
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