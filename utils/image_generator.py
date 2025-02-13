import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
import logging
import shutil
import concurrent.futures
import threading
from functools import lru_cache
from utils.hardware_detection import is_apple_silicon

# Если используется Metal, можно инициализировать его, но если он не дает выигрыша — код работает по CPU.
# Здесь пример инициализации Metal (если потребуется), но далее он не используется для отрисовки через PIL.
_metal_context = None
_metal_device = None
_metal_initialized = False

def _initialize_metal():
    global _metal_context, _metal_device, _metal_initialized
    if _metal_initialized:
        return _metal_context is not None
    if is_apple_silicon() and not _metal_initialized:
        try:
            from Quartz import CIContext
            from Metal import MTLCreateSystemDefaultDevice
            _metal_device = MTLCreateSystemDefaultDevice()
            if _metal_device:
                _metal_context = CIContext.contextWithMTLDevice_(_metal_device)
                logging.info("Successfully initialized Metal context and device")
                _metal_initialized = True
                return True
        except Exception as e:
            logging.warning(f"Failed to initialize Metal: {e}")
            _metal_initialized = True
    return False

# --- Функции для кэширования шрифта и закругленных блоков ---

_font_cache = {}

def _get_font(font_path, size):
    cache_key = f"{font_path}_{size}"
    if cache_key not in _font_cache:
        try:
            _font_cache[cache_key] = ImageFont.truetype(font_path, size)
            logging.debug(f"Cached font {font_path} at size {size}")
        except Exception as e:
            logging.error(f"Error loading font {font_path}: {e}")
            raise ValueError(f"Could not load font {font_path}")
    return _font_cache[cache_key]

_box_cache = {}

def create_rounded_box(width, height, radius):
    cache_key = f"{width}_{height}_{radius}"
    if cache_key not in _box_cache:
        image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle(
            [(0, 0), (width - 1, height - 1)],
            radius=radius,
            fill=(0, 0, 0, 255)
        )
        image = image.filter(ImageFilter.GaussianBlur(radius=0.5))
        _box_cache[cache_key] = image
        logging.debug(f"Created and cached rounded box {cache_key}")
    return _box_cache[cache_key].copy()

# --- Функция создания кадра (PNG) ---

def create_frame(values, resolution='fullhd', output_path=None, text_settings=None):
    # Определяем разрешение и масштаб
    if resolution == "4k":
        width, height = 3840, 2160
        scale_factor = 2.0
    else:  # fullhd
        width, height = 1920, 1080
        scale_factor = 1.0

    # Создаем фон и оверлей
    background = Image.new('RGBA', (width, height), (0, 0, 255, 255))
    overlay = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    text_settings = text_settings or {}
    font_size = int(text_settings.get('font_size', 26) * scale_factor)
    top_padding = int(text_settings.get('top_padding', 14) * scale_factor)
    box_height = int(text_settings.get('bottom_padding', 47) * scale_factor)
    spacing = int(text_settings.get('spacing', 10) * scale_factor)
    vertical_position = int(text_settings.get('vertical_position', 1))
    border_radius = int(text_settings.get('border_radius', 13) * scale_factor)

    try:
        font = _get_font("fonts/sf-ui-display-bold.otf", font_size)
    except Exception as e:
        logging.error(f"Error loading font: {e}")
        raise

    # Формируем параметры для вывода текста
    params = [
        ('Speed', f"{values['speed']} km/h"),
        ('Max Speed', f"{values['max_speed']} km/h"),
        ('GPS', f"{values['gps']} km/h"),
        ('Voltage', f"{values['voltage']} V"),
        ('Temp', f"{values['temperature']} °C"),
        ('Current', f"{values['current']} A"),
        ('Battery', f"{values['battery']} %"),
        ('Mileage', f"{values['mileage']} km"),
        ('PWM', f"{values['pwm']} %"),
        ('Power', f"{values['power']} W")
    ]

    element_widths = []
    text_widths = []
    text_heights = []
    total_width = 0

    # Вычисляем размеры для каждого текстового элемента
    for label, value in params:
        bbox = draw.textbbox((0, 0), f"{label}: {value}", font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        element_width = text_width + (2 * top_padding)
        element_widths.append(element_width)
        text_widths.append(text_width)
        text_heights.append(text_height)
        total_width += element_width

    total_width += spacing * (len(params) - 1)
    start_x = (width - total_width) // 2
    y_position = int((height * vertical_position) / 100)

    max_text_height = max(text_heights)
    box_vertical_center = y_position + (box_height // 2)
    text_baseline_y = box_vertical_center - (max_text_height // 2)

    # Рисуем каждый текстовый блок с закругленным фоном
    x_position = start_x
    for i, ((label, value), element_width, text_width) in enumerate(zip(params, element_widths, text_widths)):
        box = create_rounded_box(element_width, box_height, border_radius)
        overlay.paste(box, (x_position, y_position), box)
        text = f"{label}: {value}"
        text_x = x_position + ((element_width - text_width) // 2)
        baseline_offset = int(max_text_height * 0.2)
        text_y = text_baseline_y - baseline_offset
        draw.text((text_x, text_y), text, fill=(255, 255, 255, 255), font=font)
        x_position += element_width + spacing

    # Добавляем полукруглую дугу скорости
    # Размер дуги - 20% от ширины экрана
    gauge_size = int(width * 0.2)
    gauge_thickness = int(gauge_size * 0.1)  # Толщина дуги - 10% от размера

    # Центр дуги
    center_x = width // 2
    center_y = height // 2

    # Координаты прямоугольника, в который вписана дуга
    gauge_bbox = [
        center_x - gauge_size // 2,  # left
        center_y - gauge_size // 2,  # top
        center_x + gauge_size // 2,  # right
        center_y + gauge_size // 2   # bottom
    ]

    # Рисуем фоновую дугу (серую)
    # Используем углы 270-90 для получения верхней полуокружности
    draw.arc(gauge_bbox, 270, 90, fill=(128, 128, 128, 128), width=gauge_thickness)

    # Рассчитываем угол для текущей скорости
    speed = min(100, values['speed'])  # Ограничиваем до 100
    # Преобразуем скорость в угол (270 -> 90 градусов)
    # При скорости 0 - угол 270, при скорости 100 - угол 90
    angle = 270 - (speed * 180 / 100)

    # Рисуем дугу скорости (яркую)
    if speed > 0:
        draw.arc(gauge_bbox, 270, angle, fill=(255, 255, 255, 255), width=gauge_thickness)

    # Компонуем итоговое изображение
    result = Image.alpha_composite(background, overlay)

    if output_path:
        result.convert('RGB').save(output_path, format='PNG', quality=95, optimize=True)
        logging.debug(f"Saved frame to {output_path}")

    return result

# --- Функция генерации кадров с обновлением прогресс-бара ---

def generate_frames(csv_file, folder_number, resolution='fullhd', fps=29.97, text_settings=None, progress_callback=None):
    """
    Генерирует кадры для видео с наложением текста.

    Параметры:
      csv_file: путь к CSV файлу
      folder_number: номер проекта/папки
      resolution: 'fullhd' или '4k'
      fps: частота кадров
      text_settings: настройки для текста (словарь)
      progress_callback: функция обратного вызова, принимающая (completed_frames, total_frames, 'frames')
                         для обновления прогресс-бара
    """
    try:
        frames_dir = f'frames/project_{folder_number}'
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)
        os.makedirs(frames_dir, exist_ok=True)

        from utils.csv_processor import process_csv_file
        csv_type, processed_data = process_csv_file(csv_file, folder_number)
        df = pd.DataFrame(processed_data)

        # Преобразуем нужные столбцы в массивы NumPy для быстрого поиска
        ts_array = df['timestamp'].to_numpy()
        speed_array = df['speed'].to_numpy(dtype=int)
        gps_array = df['gps'].to_numpy(dtype=int)
        voltage_array = df['voltage'].to_numpy(dtype=int)
        temperature_array = df['temperature'].to_numpy(dtype=int)
        current_array = df['current'].to_numpy(dtype=int)
        battery_array = df['battery'].to_numpy(dtype=int)
        mileage_array = df['mileage'].to_numpy(dtype=int)
        pwm_array = df['pwm'].to_numpy(dtype=int)
        power_array = df['power'].to_numpy(dtype=int)
        max_speed_array = np.maximum.accumulate(speed_array)

        T_min = ts_array.min()
        T_max = ts_array.max()
        frame_count = int((T_max - T_min) * fps)
        logging.info(f"Generating {frame_count} frames at {fps} fps")
        frame_timestamps = np.linspace(T_min, T_max, frame_count)

        completed_frames = 0
        lock = threading.Lock()

        def process_frame(i, timestamp):
            nonlocal completed_frames
            idx = np.searchsorted(ts_array, timestamp, side='right') - 1
            if idx < 0:
                values = {key: 0 for key in ['speed', 'max_speed', 'gps', 'voltage', 'temperature',
                                              'current', 'battery', 'mileage', 'pwm', 'power']}
            else:
                values = {key: int(arr[idx]) for key, arr in zip(
                    ['speed', 'gps', 'voltage', 'temperature', 'current', 'battery', 'mileage', 'pwm', 'power'],
                    [speed_array, gps_array, voltage_array, temperature_array, current_array, battery_array,
                     mileage_array, pwm_array, power_array]
                )}
                values['max_speed'] = int(max_speed_array[idx])
            output_path = f'{frames_dir}/frame_{i:06d}.png'
            create_frame(values, resolution, output_path, text_settings)
            with lock:
                completed_frames += 1
                # Обновляем прогресс каждые 10 кадров или при завершении всех
                if progress_callback and (completed_frames % 10 == 0 or completed_frames == frame_count):
                    progress_callback(completed_frames, frame_count, 'frames')

        max_workers = os.cpu_count() or 4
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(process_frame, i, ts) for i, ts in enumerate(frame_timestamps)]
            concurrent.futures.wait(futures)

        logging.info(f"Successfully generated {frame_count} frames")
        return frame_count, (T_max - T_min)

    except Exception as e:
        logging.error(f"Error in generate_frames: {e}")
        raise

# --- Прочие функции (create_preview_frame, find_nearest_values, get_column_name, detect_csv_type) ---

def find_nearest_values(df, timestamp):
    mask = df['timestamp'] <= timestamp
    if not mask.any():
        return {key: 0 for key in ['speed','max_speed','gps','voltage','temperature',
                                   'current','battery','mileage','pwm','power']}
    last_idx = df[mask].index[-1]
    result = {
        'speed': int(df.loc[last_idx, 'speed']),
        'gps': int(df.loc[last_idx, 'gps']),
        'voltage': int(df.loc[last_idx, 'voltage']),
        'temperature': int(df.loc[last_idx, 'temperature']),
        'current': int(df.loc[last_idx, 'current']),
        'battery': int(df.loc[last_idx, 'battery']),
        'mileage': int(df.loc[last_idx, 'mileage']),
        'pwm': int(df.loc[last_idx, 'pwm']),
        'power': int(df.loc[last_idx, 'power'])
    }
    result['max_speed'] = int(df.loc[mask, 'speed'].max())
    return result

def get_column_name(csv_type, base_name):
    column_mapping = {
        'darnkessbot': {
            'speed': 'Speed',
            'gps': 'GPS Speed',
            'voltage': 'Voltage',
            'temperature': 'Temperature',
            'current': 'Current',
            'battery': 'Battery level',
            'mileage': 'Total mileage',
            'pwm': 'PWM',
            'power': 'Power'
        },
        'wheellog': {
            'speed': 'speed',
            'gps': 'gps_speed',
            'voltage': 'voltage',
            'temperature': 'system_temp',
            'current': 'current',
            'battery': 'battery_level',
            'mileage': 'totaldistance',
            'pwm': 'pwm',
            'power': 'power'
        }
    }
    return column_mapping[csv_type][base_name]

def detect_csv_type(df):
    if 'Date' in df.columns and 'Speed' in df.columns:
        return 'darnkessbot'
    elif 'date' in df.columns and 'speed' in df.columns:
        return 'wheellog'
    else:
        raise ValueError("Unknown CSV format")

def create_preview_frame(csv_file, project_id, resolution='fullhd', text_settings=None):
    try:
        from utils.csv_processor import process_csv_file
        from models import Project
        from flask import current_app

        with current_app.app_context():
            project = Project.query.get(project_id)
            if not project:
                raise ValueError(f"Project {project_id} not found")
            csv_type, processed_data = process_csv_file(csv_file, project.folder_number)
            df = pd.DataFrame(processed_data)
            max_speed_idx = df['speed'].idxmax()
            max_speed_timestamp = df.loc[max_speed_idx, 'timestamp']
            values = find_nearest_values(df, max_speed_timestamp)
            os.makedirs('previews', exist_ok=True)
            preview_path = f'previews/{project_id}_preview.png'
            if os.path.exists(preview_path):
                os.remove(preview_path)
            create_frame(values, resolution, preview_path, text_settings)
            logging.info(f"Created preview frame: {preview_path}")
            return preview_path

    except Exception as e:
        logging.error(f"Error in create_preview_frame: {e}")
        raise