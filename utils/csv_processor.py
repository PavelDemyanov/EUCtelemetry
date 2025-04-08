import pandas as pd
from datetime import datetime
import logging
import os
import numpy as np

def parse_timestamp_darnkessbot(date_str):
    try:
        # Check if input is float or None
        if date_str is None or isinstance(date_str, float):
            return None

        # Convert to string if needed
        date_str = str(date_str).strip()
        
        # Быстрая проверка на пустую строку
        if not date_str:
            return None
            
        # Проверка на корректный формат без вызова datetime.strptime
        # Ожидаемый формат: DD.MM.YYYY HH:MM:SS.fff
        if len(date_str) < 10 or '.' not in date_str or ':' not in date_str:
            return None

        # Try to parse the date string
        dt = datetime.strptime(date_str, '%d.%m.%Y %H:%M:%S.%f')
        return dt.timestamp()
    except (ValueError, TypeError) as e:
        # Сокращаем количество повторяющихся логов ошибок
        if "does not match format" not in str(e):
            logging.error(f"Error parsing darnkessbot timestamp: {e}")
        return None

# Векторизированная версия parse_timestamp_darnkessbot для обработки всей колонки сразу
def parse_timestamps_darnkessbot_vectorized(date_series):
    """
    Векторизированная версия парсинга временных меток DarknessBot
    Работает со всей серией дат вместо построковой обработки
    """
    try:
        logging.info(f"Using vectorized timestamp parsing for {len(date_series)} rows")
        
        # Конвертируем в строки и удаляем пробелы
        date_series = date_series.astype(str).str.strip()
        
        # Создаем маску для отбора только строк с корректным форматом
        # Вместо проверки каждой строки отдельно, мы используем операции над всей серией
        mask = (date_series.str.len() >= 10) & \
               (date_series.str.contains('\.')) & \
               (date_series.str.contains(':'))
        
        # Временная серия с NaT для невалидных форматов
        timestamps = pd.Series([None] * len(date_series), index=date_series.index)
        
        # Выбираем только потенциально валидные строки для дальнейшей обработки
        valid_dates = date_series[mask]
        
        if len(valid_dates) == 0:
            logging.warning("No valid date strings found after filtering")
            return timestamps
            
        logging.info(f"Parsing {len(valid_dates)} timestamps after initial filtering")
        
        # Конвертируем валидные строки в datetime объекты
        try:
            # Используем pd.to_datetime вместо поэлементного применения datetime.strptime
            parsed_dates = pd.to_datetime(valid_dates, format='%d.%m.%Y %H:%M:%S.%f', errors='coerce')
            
            # Конвертируем datetime в unix timestamp (float)
            valid_timestamps = parsed_dates.values.astype('datetime64[s]').astype(np.float64)
            
            # Обновляем только валидные строки в исходной серии
            timestamps[mask] = valid_timestamps
            
            logging.info(f"Successfully parsed {(~timestamps.isna()).sum()} timestamps")
            
        except Exception as e:
            logging.error(f"Error in vectorized timestamp parsing: {e}")
            # Возвращаемся к построковой обработке в случае ошибок
            return date_series.apply(parse_timestamp_darnkessbot)
            
        return timestamps
    
    except Exception as e:
        logging.error(f"Unexpected error in vectorized timestamp parsing: {e}")
        # В случае критической ошибки возвращаемся к обычному методу
        return date_series.apply(parse_timestamp_darnkessbot)

def parse_timestamp_wheellog(date_str, time_str):
    try:
        # Check if either input is None or float
        if date_str is None or time_str is None or isinstance(date_str, float) or isinstance(time_str, float):
            return None

        # Convert to strings if needed
        date_str = str(date_str).strip()
        time_str = str(time_str).strip()
        
        # Быстрая проверка на пустые строки
        if not date_str or not time_str:
            return None
            
        # Предварительная проверка на корректный формат
        # Ожидаемый формат: YYYY-MM-DD HH:MM:SS.fff
        if len(date_str) < 10 or '-' not in date_str or len(time_str) < 8 or ':' not in time_str:
            return None

        # Try to parse the date
        dt_str = f"{date_str} {time_str}"
        dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S.%f')
        return dt.timestamp()
    except (ValueError, TypeError) as e:
        # Сокращаем количество повторяющихся логов ошибок
        if "does not match format" not in str(e):
            logging.error(f"Error parsing wheellog timestamp: {e}")
        return None

# Векторизованная версия разбора временных меток WheelLog
def parse_timestamps_wheellog_vectorized(date_series, time_series):
    """
    Векторизованная версия парсинга временных меток WheelLog
    Работает со всей серией дат и времени вместо построковой обработки
    """
    try:
        logging.info(f"Using vectorized wheellog timestamp parsing for {len(date_series)} rows")
        
        # Проверяем, что размеры совпадают
        if len(date_series) != len(time_series):
            logging.error(f"Date and time series lengths don't match: {len(date_series)} vs {len(time_series)}")
            # Возвращаемся к построковой обработке
            return pd.Series([parse_timestamp_wheellog(d, t) for d, t in zip(date_series, time_series)])
        
        # Конвертируем в строки и удаляем пробелы
        date_series = date_series.astype(str).str.strip()
        time_series = time_series.astype(str).str.strip()
        
        # Создаем маску для отбора только строк с корректным форматом
        date_mask = (date_series.str.len() >= 10) & (date_series.str.contains('-'))
        time_mask = (time_series.str.len() >= 8) & (time_series.str.contains(':'))
        
        # Общая маска для валидных дат и времени
        mask = date_mask & time_mask
        
        # Временная серия с None для невалидных форматов
        timestamps = pd.Series([None] * len(date_series), index=date_series.index)
        
        # Выбираем только потенциально валидные строки для дальнейшей обработки
        valid_dates = date_series[mask]
        valid_times = time_series[mask]
        
        if len(valid_dates) == 0:
            logging.warning("No valid date/time strings found after filtering")
            return timestamps
            
        logging.info(f"Parsing {len(valid_dates)} wheellog timestamps after initial filtering")
        
        # Создаем комбинированные строки даты-времени
        combined_dt_strings = valid_dates + ' ' + valid_times
        
        try:
            # Используем pd.to_datetime вместо поэлементного применения datetime.strptime
            parsed_dates = pd.to_datetime(combined_dt_strings, format='%Y-%m-%d %H:%M:%S.%f', errors='coerce')
            
            # Конвертируем datetime в unix timestamp (float)
            valid_timestamps = parsed_dates.values.astype('datetime64[s]').astype(np.float64)
            
            # Обновляем только валидные строки в исходной серии
            timestamps.loc[mask] = valid_timestamps
            
            logging.info(f"Successfully parsed {(~timestamps.isna()).sum()} wheellog timestamps")
            
        except Exception as e:
            logging.error(f"Error in vectorized wheellog timestamp parsing: {e}")
            # Возвращаемся к построковой обработке в случае ошибок
            return pd.Series([parse_timestamp_wheellog(d, t) for d, t in zip(date_series, time_series)])
            
        return timestamps
    
    except Exception as e:
        logging.error(f"Unexpected error in vectorized wheellog timestamp parsing: {e}")
        # В случае критической ошибки возвращаемся к обычному методу
        return pd.Series([parse_timestamp_wheellog(d, t) for d, t in zip(date_series, time_series)])

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
            csv_type = existing_csv_type or detect_csv_type(df)
            
            # Для обработанных файлов установим тип по умолчанию
            if csv_type == 'processed':
                csv_type = 'darnkessbot'  # Используем как значение по умолчанию
                logging.info("Using 'darnkessbot' as default type for processed file")

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
        # Get file size in MB before reading
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        logging.info(f"CSV file size: {file_size_mb:.2f} MB")
        
        # For analytics, if the file is very large, use sampling to reduce load
        # Check if this is being called from the analytics function or for frame generation
        is_analytics = folder_number is None
        sample_rate = 1
        
        # If file is large and this is for analytics, use sampling
        if is_analytics and file_size_mb > 20:  # If file is larger than 20MB
            # Calculate sample rate based on file size
            sample_rate = max(1, int(file_size_mb / 20))
            logging.info(f"Large CSV file detected. Using sample rate of 1:{sample_rate}")
            
            # Use pandas chunksize parameter to process file in chunks for large files
            if file_size_mb > 100:  # Over 100MB, process in chunks
                chunks = []
                for chunk in pd.read_csv(file_path, chunksize=100000):  # Process 100K rows at a time
                    chunks.append(chunk.iloc[::sample_rate])  # Sample every Nth row
                df = pd.concat(chunks)
            else:
                # Sample every Nth row for medium-sized files
                df = pd.read_csv(file_path).iloc[::sample_rate]
        else:
            # Normal processing for smaller files or frame generation
            df = pd.read_csv(file_path)
        
        logging.info(f"Processing CSV file: {file_path}, rows after sampling: {len(df)}")
        logging.info(f"CSV columns: {df.columns.tolist()}")

        # Use existing type if provided, otherwise detect
        csv_type = existing_csv_type
        if csv_type is None:
            csv_type = detect_csv_type(df)
            logging.info(f"Detected CSV type: {csv_type}")

        if csv_type == 'processed':
            # Данные уже в нужном формате, просто преобразуем их
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
            
            # Для уже обработанных данных просто возвращаем их как есть
            processed_data = raw_data
            # Устанавливаем дефолтный тип CSV
            csv_type = 'darnkessbot'
            
        elif csv_type == 'darnkessbot':
            # Parse timestamps using vectorized operations where possible
            try:
                # Предварительная фильтрация: отбрасываем строки с невалидными датами
                # без использования apply к каждой строке
                df = df[df['Date'].notna()]  # Отбрасываем None/NaN
                
                # Проверяем формат даты с помощью регулярных выражений (быстрее)
                import re
                date_pattern = re.compile(r'^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}\.\d+$')
                valid_format = df['Date'].astype(str).str.match(date_pattern)
                df = df[valid_format]
                
                # Тогда применяем векторизованную версию parse_timestamp_darnkessbot
                # Это значительно быстрее для больших CSV-файлов
                logging.info(f"Parsing timestamps for {len(df)} rows after filtering")
                
                # Используем векторизованную функцию вместо apply
                df['timestamp'] = parse_timestamps_darnkessbot_vectorized(df['Date'])
                valid_timestamp_mask = df['timestamp'].notna()
                
                # Финальная фильтрация только тех строк, где timestamp был успешно создан
                df = df[valid_timestamp_mask]
                
                logging.info(f"Successfully parsed {len(df)} timestamps")
            except Exception as e:
                logging.error(f"Error during timestamp parsing: {e}")
                # Если что-то пошло не так, вернемся к старому методу
                df['timestamp'] = df['Date'].apply(parse_timestamp_darnkessbot)
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
            # Parse timestamps using vectorized operations where possible
            try:
                # Предварительная фильтрация: отбрасываем строки с невалидными датами
                df = df[(df['date'].notna()) & (df['time'].notna())]  # Отбрасываем None/NaN
                
                # Проверяем формат даты и времени с помощью регулярных выражений (быстрее)
                import re
                date_pattern = re.compile(r'^\d{4}-\d{2}-\d{2}$')
                time_pattern = re.compile(r'^\d{2}:\d{2}:\d{2}\.\d+$')
                
                valid_date_format = df['date'].astype(str).str.match(date_pattern)
                valid_time_format = df['time'].astype(str).str.match(time_pattern)
                
                df = df[valid_date_format & valid_time_format]
                
                # Применяем векторизованную функцию parse_timestamps_wheellog_vectorized
                logging.info(f"Parsing timestamps for {len(df)} rows after filtering")
                
                # Используем векторизованную функцию вместо построчного apply
                df['timestamp'] = parse_timestamps_wheellog_vectorized(df['date'], df['time'])
                valid_timestamp_mask = df['timestamp'].notna()
                
                # Финальная фильтрация только тех строк, где timestamp был успешно создан
                df = df[valid_timestamp_mask]
                
                logging.info(f"Successfully parsed {len(df)} timestamps")
            except Exception as e:
                logging.error(f"Error during wheellog timestamp parsing: {e}")
                # Если что-то пошло не так, вернемся к старому методу
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