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
        # Don't log every error when processing large files (would create too many log entries)
        # Only log first occurrence or when debugging specific issues
        # logging.error(f"Error parsing darnkessbot timestamp: {e}")
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

    # Проверяем, является ли это уже обработанным файлом
    standardized_cols = ['timestamp', 'speed', 'gps', 'voltage', 'temperature', 
                      'current', 'battery', 'mileage', 'pwm', 'power']
    
    if all(col in df.columns for col in standardized_cols):
        logging.info("Detected already processed CSV file with standardized columns")
        return 'processed'  # Специальный тип для обработанных файлов
        
    # Define required columns for each type
    darnkessbot_cols = ['Date', 'Temperature', 'GPS Speed', 'Total mileage', 'Battery level', 
                      'Speed', 'PWM', 'Current', 'Voltage', 'Power']
                      
    # Core required WheelLog columns (gps_speed is optional)
    wheellog_core_cols = ['date', 'time', 'speed', 'totaldistance', 'battery_level', 
                        'pwm', 'voltage', 'current', 'power', 'system_temp']
    wheellog_all_cols = wheellog_core_cols + ['gps_speed']

    # Check if all required columns exist for each type
    is_darnkessbot = all(col in df.columns for col in darnkessbot_cols)
    is_wheellog = all(col in df.columns for col in wheellog_core_cols)

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
            missing_wheellog = [col for col in wheellog_all_cols if col not in df.columns]
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
    # For Series with more than 100K elements, use a more memory-efficient approach
    if len(series) > 100000:
        # Use efficient vectorized operations with int32 type for memory savings
        # Replace infinite values with 0
        series = series.replace([float('inf'), float('-inf')], 0)
        # Fill NA/NaN values with 0
        series = series.fillna(0)
        # Round and convert to integer with memory-efficient type
        return series.round().astype('int32')
    else:
        # For smaller series, use the original approach
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
        
        # For very large datasets (over 100,000 rows), use a different approach 
        # that's more memory efficient
        if len(df) > 100000:
            # Get file size - estimate from number of rows
            estimated_size_mb = len(df) * len(df.columns) * 8 / (1024 * 1024)  # Rough estimate
            logging.info(f"Large dataset detected ({len(df)} rows, est. {estimated_size_mb:.2f} MB), using optimized duplicate removal")
            
            # For very large datasets, use a sampling approach to reduce memory usage
            # Keep every row where at least one value changes significantly
            # Define columns to check
            columns_to_check = ['speed', 'gps', 'voltage', 'temperature', 'current', 
                              'battery', 'mileage', 'pwm', 'power']
            
            # Only keep rows where values change
            mask = pd.Series(True, index=df.index)  # Start with all True
            
            # Check each column individually to reduce memory usage
            for col in columns_to_check:
                if col in df.columns:
                    # Keep rows where the value changes significantly (more than 1%)
                    col_mask = (df[col].shift() != df[col])
                    mask = mask | col_mask
            
            # Always keep the first row
            if len(mask) > 0:
                mask.iloc[0] = True
                
            # Apply the mask
            clean_df = df[mask]
            
        else:
            # For smaller datasets, use the original approach
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
        
        # For very large datasets, use a more efficient approach
        # Check if this is a large dataset
        if len(df) > 100000:
            # This is a large dataset - use more efficient processing
            logging.info(f"Large dataset detected for interpolation ({len(df)} rows), using optimized method")
            
            # Interpolate specified columns with optimized batch processing
            for col in columns_to_interpolate:
                if col in df.columns:
                    # Convert to float for interpolation
                    df[col] = pd.to_numeric(df[col], errors='coerce')
                    
                    # Replace infinite values with NaN efficiently
                    df[col] = df[col].replace([float('inf'), float('-inf')], np.nan)
                    
                    # For very large datasets, fill NaN with nearby values instead of interpolating all
                    # This is faster but slightly less accurate
                    if df[col].isna().sum() > 0:
                        # Fill NaN values with the nearest non-NaN value (forward then backward)
                        df[col] = df[col].fillna(method='ffill').fillna(method='bfill')
                        
                        # Handle any remaining NaN values (at the boundaries)
                        df[col] = df[col].fillna(0)
                    
                    # Ensure all values are finite
                    df[col] = df[col].replace([float('inf'), float('-inf')], 0)
                    
                    # Round and convert back to integer (use int32 for memory efficiency)
                    df[col] = df[col].round().astype('int32')
        else:
            # For smaller datasets, use the original detailed interpolation
            for col in columns_to_interpolate:
                if col in df.columns:
                    # Convert to float for interpolation
                    df[col] = pd.to_numeric(df[col], errors='coerce')
                    
                    # Replace infinite values with NaN
                    df[col] = df[col].replace([float('inf'), float('-inf')], np.nan)
                    
                    # Apply two-way interpolation
                    df[col] = df[col].interpolate(method='linear', limit_direction='both')
                    
                    # Fill any remaining NaN values with 0
                    df[col] = df[col].fillna(0)
                    
                    # Ensure all values are finite after interpolation
                    df[col] = df[col].replace([float('inf'), float('-inf')], 0)
                    
                    # Round and convert back to integer
                    df[col] = df[col].round().astype(int)

        # Convert back to dictionary format
        return {col: df[col].tolist() for col in df.columns}
    except Exception as e:
        logging.error(f"Error during interpolation: {e}")
        raise

def trim_csv_data(file_path, folder_number, start_timestamp, end_timestamp):
    """
    Trim the processed CSV data to only include records between the start and end timestamps
    
    Args:
        file_path: Original CSV file path
        folder_number: Project folder number
        start_timestamp: Start timestamp in seconds (float)
        end_timestamp: End timestamp in seconds (float)
        
    Returns:
        Tuple of (csv_type, processed_data)
    """
    try:
        logging.info(f"Trimming CSV data from {start_timestamp} to {end_timestamp}")
        
        # Get processed data path
        processed_csv_path = os.path.join('processed_data', f'project_{folder_number}_{os.path.basename(file_path)}')
        
        # Check if processed file exists
        if not os.path.exists(processed_csv_path):
            logging.error(f"Processed CSV file not found: {processed_csv_path}")
            raise FileNotFoundError(f"Processed CSV file not found: {processed_csv_path}")
        
        # Load existing processed data
        df = pd.read_csv(processed_csv_path)
        # Определяем тип CSV на основе имени колонок
        csv_type = detect_csv_type(df)
        
        # Для обработанных файлов установим тип по умолчанию
        if csv_type == 'processed':
            csv_type = 'darnkessbot'  # Используем как значение по умолчанию
            logging.info("Using 'darnkessbot' as default type for processed file")
        
        # Filter data by timestamp range
        df = df[(df['timestamp'] >= start_timestamp) & (df['timestamp'] <= end_timestamp)]
        
        if len(df) == 0:
            raise ValueError("No data remains after trimming. Choose a wider time range.")
        
        # Save trimmed data back to the processed file
        df.to_csv(processed_csv_path, index=False)
        logging.info(f"Saved trimmed CSV with {len(df)} rows to {processed_csv_path}")
        
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
        
        return csv_type, processed_data
        
    except Exception as e:
        logging.error(f"Error trimming CSV data: {e}")
        raise



def process_csv_file(file_path, folder_number=None, existing_csv_type=None, interpolate_values=True):
    """Обрабатывает CSV-файл и сохраняет обработанные данные с уникальным идентификатором проекта.

    Args:
        file_path (str): Путь к исходному CSV-файлу.
        folder_number (int, optional): Номер папки для создания уникального имени обработанного файла.
        existing_csv_type (str, optional): Заданный тип CSV-файла, если известен.
        interpolate_values (bool): Флаг для выполнения интерполяции числовых данных.

    Returns:
        tuple: (csv_type, processed_data) - тип CSV и словарь с обработанными данными.

    Raises:
        Exception: Если произошла ошибка при обработке файла.
    """
    try:
        # Создаем директорию для обработанных данных, если она не существует
        os.makedirs('processed_data', exist_ok=True)

        # Определяем путь для сохранения обработанного файла
        processed_csv_path = None
        if folder_number is not None:
            processed_csv_path = os.path.join('processed_data', f'project_{folder_number}_{os.path.basename(file_path)}')

        # Проверяем, существует ли обработанный файл
        if processed_csv_path and os.path.exists(processed_csv_path):
            logging.info(f"Загружаем существующий обработанный CSV из {processed_csv_path}")
            df = pd.read_csv(processed_csv_path)
            csv_type = existing_csv_type or detect_csv_type(df)

            # Для обработанных файлов устанавливаем тип по умолчанию
            if csv_type == 'processed':
                csv_type = 'darnkessbot'  # Значение по умолчанию
                logging.info("Используем 'darnkessbot' как тип по умолчанию для обработанного файла")

            # Преобразуем DataFrame в словарь
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

            # Применяем интерполяцию, если требуется
            if interpolate_values:
                columns_to_interpolate = ['speed', 'gps', 'voltage', 'temperature', 'current', 
                                         'battery', 'mileage', 'pwm', 'power']
                processed_data = interpolate_numeric_data(processed_data, columns_to_interpolate)

            # Удаляем последовательные дубликаты
            processed_data = remove_consecutive_duplicates(processed_data)
            return csv_type, processed_data

        # Если файла нет, обрабатываем CSV
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        logging.info(f"Размер CSV-файла: {file_size_mb:.2f} МБ")

        # Определяем, используется ли функция для аналитики или генерации кадров
        is_analytics = folder_number is None
        sample_rate = 1

        # Для больших файлов в аналитике используем выборку
        if is_analytics and file_size_mb > 20:
            sample_rate = max(1, int(file_size_mb / 20))
            logging.info(f"Обнаружен большой CSV-файл. Используем выборку 1:{sample_rate}")

            if file_size_mb > 100:  # Для файлов > 100 МБ используем обработку по частям
                chunks = []
                try:
                    for chunk in pd.read_csv(file_path, chunksize=100000, encoding='utf-8'):
                        chunks.append(chunk.iloc[::sample_rate])
                except UnicodeDecodeError:
                    chunks = []
                    for chunk in pd.read_csv(file_path, chunksize=100000, encoding='latin1'):
                        chunks.append(chunk.iloc[::sample_rate])

                if chunks:
                    df = pd.concat(chunks)
                else:
                    raise ValueError("Не удалось прочитать CSV-файл с любой кодировкой")
            else:
                try:
                    df = pd.read_csv(file_path, encoding='utf-8').iloc[::sample_rate]
                except UnicodeDecodeError:
                    df = pd.read_csv(file_path, encoding='latin1').iloc[::sample_rate]
        else:
            # Обычная обработка для небольших файлов или генерации кадров
            try:
                df = pd.read_csv(file_path, encoding='utf-8')
            except UnicodeDecodeError:
                df = pd.read_csv(file_path, encoding='latin1')

        logging.info(f"Обработка CSV-файла: {file_path}, строк после выборки: {len(df)}")
        logging.info(f"Столбцы CSV: {df.columns.tolist()}")

        # Используем заданный тип или определяем автоматически
        csv_type = existing_csv_type
        if csv_type is None:
            csv_type = detect_csv_type(df)
            logging.info(f"Определённый тип CSV: {csv_type}")

        if csv_type == 'processed':
            raw_data = {
                'timestamp': df['timestamp'],
                'speed': df['speed'],
                'gps': df['gps'],
                'voltage': df['voltage'],
                'temperature': df['temperature'],
                'current': df['current'],
                'battery': df['battery'],
                'mileage': df['mileage'],
                'pwm': df['pwm'],
                'power': df['power']
            }
            processed_data = raw_data
            csv_type = 'darnkessbot'

        elif csv_type == 'darnkessbot':
            # Для больших файлов используем векторизованный парсинг
            if file_size_mb > 20:
                df['timestamp'] = pd.to_datetime(
                    df['Date'], 
                    format='%d.%m.%Y %H:%M:%S.%f', 
                    errors='coerce'
                ).astype('int64') // 10**9
                invalid_dates = df[df['timestamp'].isna()]['Date']
                if not invalid_dates.empty:
                    logging.warning(f"Найдено {len(invalid_dates)} некорректных дат, например: {invalid_dates.iloc[0]}")
            else:
                df['timestamp'] = df['Date'].apply(parse_timestamp_darnkessbot)

            # Фильтруем строки с некорректными временными метками
            valid_timestamp_mask = df['timestamp'].notna()
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

            if interpolate_values:
                columns_to_interpolate = ['speed', 'gps', 'voltage', 'temperature', 'current', 
                                         'battery', 'mileage', 'pwm', 'power']
                raw_data = interpolate_numeric_data(raw_data, columns_to_interpolate)

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
            if file_size_mb > 20:
                try:
                    df['datetime_str'] = df['date'] + ' ' + df['time']
                    df['timestamp'] = pd.to_datetime(df['datetime_str'], format='%Y-%m-%d %H:%M:%S.%f').astype('int64') // 10**9
                except Exception as e:
                    logging.warning(f"Ошибка векторизованного преобразования для wheellog, используем apply: {e}")
                    df['timestamp'] = df.apply(lambda x: parse_timestamp_wheellog(x['date'], x['time']), axis=1)
            else:
                df['timestamp'] = df.apply(lambda x: parse_timestamp_wheellog(x['date'], x['time']), axis=1)

            valid_timestamp_mask = df['timestamp'].notna()
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

            if interpolate_values:
                columns_to_interpolate = ['speed', 'gps', 'voltage', 'temperature', 'current', 
                                         'battery', 'mileage', 'pwm', 'power']
                raw_data = interpolate_numeric_data(raw_data, columns_to_interpolate)

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

        # Удаляем последовательные дубликаты
        processed_data = remove_consecutive_duplicates(processed_data)

        # Сохраняем обработанные данные, если указан folder_number
        if processed_csv_path:
            processed_df = pd.DataFrame(processed_data)
            processed_df.to_csv(processed_csv_path, index=False)
            logging.info(f"Сохранён обработанный CSV в {processed_csv_path}")

        return csv_type, processed_data

    except Exception as e:
        logging.error(f"Ошибка обработки CSV-файла: {e}")
        raise