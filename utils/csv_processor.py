import pandas as pd
from datetime import datetime
import logging

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
                'speed': df['Speed'],
                'gps': df['GPS Speed'],
                'voltage': df['Voltage'],
                'temperature': df['Temperature'],
                'current': df['Current'],
                'battery': df['Battery level'],
                'mileage': df['Total mileage'],
                'pwm': df['PWM'],
                'power': df['Power']
            }
        else:  # wheellog
            df['timestamp'] = df.apply(lambda x: parse_timestamp_wheellog(x['date'], x['time']), axis=1)
            processed_data = {
                'timestamp': df['timestamp'],
                'speed': df['speed'],
                'gps': df['gps_speed'],
                'voltage': df['voltage'],
                'temperature': df['system_temp'],
                'current': df['current'],
                'battery': df['battery_level'],
                'mileage': df['totaldistance'],
                'pwm': df['pwm'],
                'power': df['power']
            }
        
        return csv_type, processed_data
    except Exception as e:
        logging.error(f"Error processing CSV file: {e}")
        raise
