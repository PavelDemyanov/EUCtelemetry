import logging
import pandas as pd
from datetime import datetime, timedelta

def get_csv_time_range(file_path, csv_type):
    """
    Get the time range (start and end timestamps) from a CSV file
    
    Args:
        file_path (str): Path to the CSV file
        csv_type (str): Type of CSV file ('darnkessbot' or 'wheellog')
        
    Returns:
        dict: Dictionary with start_time, end_time and total_duration in seconds
    """
    try:
        # Try reading with different encodings
        try:
            df = pd.read_csv(file_path, encoding='utf-8')
        except UnicodeDecodeError:
            df = pd.read_csv(file_path, encoding='latin1')
            
        # Extract timestamps based on CSV type
        if csv_type == 'darnkessbot':
            # DarknessBot format uses ISO format date strings in 'Date' column
            dates = pd.to_datetime(df['Date'])
        elif csv_type == 'wheellog':
            # WheelLog format uses separate date and time columns
            dates = pd.to_datetime(df['date'] + ' ' + df['time'])
        else:
            raise ValueError(f"Unsupported CSV type: {csv_type}")
            
        # Get start and end timestamps
        start_time = dates.min()
        end_time = dates.max()
        
        # Calculate total duration in seconds
        total_duration = int((end_time - start_time).total_seconds())
        
        return {
            'start_time': start_time,
            'end_time': end_time,
            'total_duration': total_duration,
            'start_time_str': start_time.strftime('%Y-%m-%d %H:%M:%S'),
            'end_time_str': end_time.strftime('%Y-%m-%d %H:%M:%S'),
            'duration_str': format_duration(total_duration)
        }
        
    except Exception as e:
        logging.error(f"Error getting time range from CSV: {e}")
        # Return default values if there's an error
        now = datetime.now()
        return {
            'start_time': now,
            'end_time': now + timedelta(minutes=10),
            'total_duration': 600,
            'start_time_str': now.strftime('%Y-%m-%d %H:%M:%S'),
            'end_time_str': (now + timedelta(minutes=10)).strftime('%Y-%m-%d %H:%M:%S'),
            'duration_str': '10:00'
        }
        
def format_duration(seconds):
    """Format duration in seconds to 'MM:SS' format"""
    minutes = seconds // 60
    remaining_seconds = seconds % 60
    return f"{minutes}:{remaining_seconds:02d}"