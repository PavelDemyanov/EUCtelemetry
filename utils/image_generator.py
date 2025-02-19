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
from utils.image_processor import create_speed_indicator

_metal_initialized = False
_metal_context = None
_metal_device = None

_LOCALIZATION = {
    'en': {
        'speed': 'Speed',
        'max_speed': 'Max Speed',
        'gps': 'GPS',
        'voltage': 'Voltage',
        'temp': 'Temp',
        'current': 'Current',
        'battery': 'Battery',
        'mileage': 'Mileage',
        'pwm': 'PWM',
        'power': 'Power',
        'units': {
            'speed': 'km/h',
            'voltage': 'V',
            'temp': '°C',
            'current': 'A',
            'battery': '%',
            'mileage': 'km',
            'pwm': '%',
            'power': 'W'
        }
    },
    'ru': {
        'speed': 'Скорость',
        'max_speed': 'Максимум',
        'gps': 'GPS',
        'voltage': 'Напряжение',
        'temp': 'Температура',
        'current': 'Ток',
        'battery': 'Батарея',
        'mileage': 'Пробег',
        'pwm': 'ШИМ',
        'power': 'Мощность',
        'units': {
            'speed': 'км/ч',
            'voltage': 'В',
            'temp': '°C',
            'current': 'А',
            'battery': '%',
            'mileage': 'км',
            'pwm': '%',
            'power': 'Вт'
        }
    }
}


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
                logging.info(
                    "Successfully initialized Metal context and device")
                _metal_initialized = True
                return True
        except Exception as e:
            logging.warning(f"Failed to initialize Metal: {e}")
            _metal_initialized = True
    return False


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
        draw.rounded_rectangle([(0, 0), (width - 1, height - 1)],
                               radius=radius,
                               fill=(0, 0, 0, 255))
        image = image.filter(ImageFilter.GaussianBlur(radius=0.5))
        _box_cache[cache_key] = image
        logging.debug(f"Created and cached rounded box {cache_key}")
    return _box_cache[cache_key].copy()


        def create_frame(values,
              resolution='fullhd',
              output_path=None,
              text_settings=None,
              locale='en'):
        try:
        # Определяем разрешение и масштаб
        if resolution == "4k":
        width, height = 3840, 2160
        scale_factor = 2.0
        indicator_size = 1000  # Увеличенный размер для 4K
        else:  # fullhd
        width, height = 1920, 1080
        scale_factor = 1.0
        indicator_size = 500  # Стандартный размер для Full HD

        # Создаем синий фон и прозрачный оверлей
        background = Image.new('RGBA', (width, height), (0, 0, 255, 255))
        overlay = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        text_settings = text_settings or {}

        # Get visibility settings with defaults
        show_speed = text_settings.get('show_speed', True)
        show_max_speed = text_settings.get('show_max_speed', True)
        show_gps = text_settings.get('show_gps', False)
        show_voltage = text_settings.get('show_voltage', True)
        show_temp = text_settings.get('show_temp', True)
        show_battery = text_settings.get('show_battery', False)
        show_mileage = text_settings.get('show_mileage', True)
        show_pwm = text_settings.get('show_pwm', True)
        show_power = text_settings.get('show_power', True)
        show_bottom_elements = text_settings.get('show_bottom_elements', True)

        # Получаем настройки позиционирования индикатора и текста
        indicator_x_percent = float(text_settings.get('indicator_x', 50))
        indicator_y_percent = float(text_settings.get('indicator_y', 80))
        speed_y_offset = int(text_settings.get('speed_y', 0))
        unit_y_offset = int(text_settings.get('unit_y', 0))
        speed_size = float(text_settings.get('speed_size', 100))
        unit_size = float(text_settings.get('unit_size', 100))
        indicator_scale = float(text_settings.get('indicator_scale', 100))

        # Only create and paste speed indicator if bottom elements are enabled
        if show_bottom_elements:
        loc = _LOCALIZATION.get(locale, _LOCALIZATION['en'])
        speed_indicator = create_speed_indicator(
            values['speed'],
            size=indicator_size,
            speed_offset=(0, speed_y_offset),
            unit_offset=(0, unit_y_offset),
            speed_size=speed_size,
            unit_size=unit_size,
            indicator_scale=indicator_scale,
            resolution=resolution,
            locale=locale)

        indicator_x = int((width - indicator_size) * indicator_x_percent / 100)
        indicator_y = int((height - indicator_size) * indicator_y_percent / 100)
        background.paste(speed_indicator, (indicator_x, indicator_y),
                          speed_indicator)

        font_size = int(text_settings.get('font_size', 26) * scale_factor)
        top_padding = int(text_settings.get('top_padding', 14) * scale_factor)
        box_height = int(text_settings.get('bottom_padding', 47) * scale_factor)
        spacing = int(text_settings.get('spacing', 10) * scale_factor)
        vertical_position = int(text_settings.get('vertical_position', 1))
        border_radius = int(text_settings.get('border_radius', 13) * scale_factor)

        try:
        regular_font = _get_font("fonts/sf-ui-display-regular.otf", font_size)
        bold_font = _get_font("fonts/sf-ui-display-bold.otf", font_size)
        except Exception as e:
        logging.error(f"Error loading font: {e}")
        raise

        # Filter params based on visibility settings
        loc = _LOCALIZATION.get(locale, _LOCALIZATION['en'])
        params = []

        # Add each parameter only if its visibility is enabled
        if show_speed:
        params.append((loc['speed'], f"{values['speed']}", loc['units']['speed']))
        if show_max_speed:
        params.append((loc['max_speed'], f"{values['max_speed']}", loc['units']['speed']))
        if show_gps and 'gps' in values:
        params.append((loc['gps'], f"{values['gps']}", loc['units']['speed']))
        if show_voltage:
        params.append((loc['voltage'], f"{values['voltage']}", loc['units']['voltage']))
        if show_temp:
        params.append((loc['temp'], f"{values['temperature']}", loc['units']['temp']))
        if show_battery and 'battery' in values:
        params.append((loc['battery'], f"{values['battery']}", loc['units']['battery']))
        if show_mileage:
        params.append((loc['mileage'], f"{values['mileage']}", loc['units']['mileage']))
        if show_pwm:
        params.append((loc['pwm'], f"{values['pwm']}", loc['units']['pwm']))
        if show_power:
        params.append((loc['power'], f"{values['power']}", loc['units']['power']))

        if params:  # Only proceed if there are visible elements
        element_widths = []
        text_widths = []
        text_heights = []
        total_width = 0

        for label, value, unit in params:
            label_bbox = draw.textbbox((0, 0), f"{label}: ", font=regular_font)
            value_bbox = draw.textbbox((0, 0), value, font=bold_font)
            unit_bbox = draw.textbbox((0, 0), f" {unit}", font=regular_font)

            text_width = (label_bbox[2] - label_bbox[0]) + (value_bbox[2] - value_bbox[0]) + (
                        unit_bbox[2] - unit_bbox[0])
            text_height = max(label_bbox[3] - label_bbox[1],
                              value_bbox[3] - value_bbox[1],
                              unit_bbox[3] - unit_bbox[1])

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

        x_position = start_x
        for i, ((label, value, unit), element_width, text_width) in enumerate(
                zip(params, element_widths, text_widths)):
            # Определяем цвет плашки и текста в зависимости от значения PWM и Battery
            box_color = (0, 0, 0, 255)  # Стандартный черный цвет
            text_color = (255, 255, 255, 255)  # Стандартный белый цвет

            # Применяем масштабирование к размерам
            scaled_element_width = int(element_width * scale_factor)
            scaled_box_height = int(box_height * scale_factor)
            scaled_border_radius = int(border_radius * scale_factor)

            # Создаем и масштабируем плашку
            box = create_rounded_box(scaled_element_width, scaled_box_height, scaled_border_radius)

            # Изменяем цвет плашки если нужно
            if box_color != (0, 0, 0, 255):
                colored_box = Image.new('RGBA', box.size, box_color)
                colored_box.putalpha(box.split()[3])  # Используем альфа-канал от оригинальной плашки
                box = colored_box

            # Верхний край увеличенной плашки совпадает с верхним краем остальных плашек
            vertical_offset = scaled_box_height - box_height  # Теперь растём только вниз
            overlay.paste(box, (x_position, y_position), box)

            # Масштабируем размер шрифта
            scaled_font_size = int(font_size * scale_factor)
            scaled_regular_font = _get_font("fonts/sf-ui-display-regular.otf", scaled_font_size)
            scaled_bold_font = _get_font("fonts/sf-ui-display-bold.otf", scaled_font_size)

            # Измеряем характеристики шрифта для точного центрирования
            label_text = f"{label}: "
            value_text = value
            unit_text = f" {unit}"

            label_bbox = draw.textbbox((0, 0), label_text, font=scaled_regular_font)
            value_bbox = draw.textbbox((0, 0), value_text, font=scaled_bold_font)
            unit_bbox = draw.textbbox((0, 0), unit_text, font=scaled_regular_font)

            label_width = label_bbox[2] - label_bbox[0]
            value_width = value_bbox[2] - value_bbox[0]
            unit_width = unit_bbox[2] - unit_bbox[0]

            # Общая ширина текста
            text_width = label_width + value_width + unit_width

            # Вычисляем центр по вертикали плашки
            box_center = y_position + (scaled_box_height // 2)

            # Центрируем текст по вертикали
            text_height = max(label_bbox[3] - label_bbox[1], value_bbox[3] - value_bbox[1], unit_bbox[3] - unit_bbox[1])
            text_y = box_center - (text_height // 2)

            # Центрируем по горизонтали
            text_x = x_position + ((scaled_element_width - text_width) // 2)

            # Рисуем элементы: label, value и unit
            draw.text((text_x, text_y), label_text, fill=text_color, font=scaled_regular_font)
            draw.text((text_x + label_width, text_y), value_text, fill=text_color, font=scaled_bold_font)
            draw.text((text_x + label_width + value_width, text_y), unit_text, fill=text_color, font=scaled_regular_font)

            # Обновляем позицию для следующей плашки с учетом масштабирования
            x_position += scaled_element_width + spacing

        result = Image.alpha_composite(background, overlay)

        if output_path:
        result.convert('RGB').save(output_path,
                                    format='PNG',
                                    quality=95,
                                    optimize=True)
        logging.debug(f"Saved frame to {output_path}")

        return result

        except Exception as e:
        logging.error(f"Error in create_frame: {e}")
        raise


def create_frame(values,
     resolution='fullhd',
     output_path=None,
     text_settings=None,
     locale='en'):
try:
# Определяем разрешение и масштаб
if resolution == "4k":
width, height = 3840, 2160
scale_factor = 2.0
indicator_size = 1000  # Увеличенный размер для 4K
else:  # fullhd
width, height = 1920, 1080
scale_factor = 1.0
indicator_size = 500  # Стандартный размер для Full HD

# Создаем синий фон и прозрачный оверлей
background = Image.new('RGBA', (width, height), (0, 0, 255, 255))
overlay = Image.new('RGBA', (width, height), (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)

text_settings = text_settings or {}

# Получаем настройки видимости с дефолтными значениями
show_speed = text_settings.get('show_speed', True)
show_max_speed = text_settings.get('show_max_speed', True)
show_gps = text_settings.get('show_gps', False)
show_voltage = text_settings.get('show_voltage', True)
show_temp = text_settings.get('show_temp', True)
show_battery = text_settings.get('show_battery', False)
show_mileage = text_settings.get('show_mileage', True)
show_pwm = text_settings.get('show_pwm', True)
show_power = text_settings.get('show_power', True)
show_bottom_elements = text_settings.get('show_bottom_elements', True)

# Получаем настройки позиционирования индикатора и текста
indicator_x_percent = float(text_settings.get('indicator_x', 50))
indicator_y_percent = float(text_settings.get('indicator_y', 80))
speed_y_offset = int(text_settings.get('speed_y', 0))
unit_y_offset = int(text_settings.get('unit_y', 0))
speed_size = float(text_settings.get('speed_size', 100))
unit_size = float(text_settings.get('unit_size', 100))
indicator_scale = float(text_settings.get('indicator_scale', 100))

# Создаем индикатор скорости, если требуется
if show_bottom_elements:
loc = _LOCALIZATION.get(locale, _LOCALIZATION['en'])
speed_indicator = create_speed_indicator(
    values['speed'],
    size=indicator_size,
    speed_offset=(0, speed_y_offset),
    unit_offset=(0, unit_y_offset),
    speed_size=speed_size,
    unit_size=unit_size,
    indicator_scale=indicator_scale,
    resolution=resolution,
    locale=locale)

indicator_x = int((width - indicator_size) * indicator_x_percent / 100)
indicator_y = int((height - indicator_size) * indicator_y_percent / 100)
background.paste(speed_indicator, (indicator_x, indicator_y),
                  speed_indicator)

font_size = int(text_settings.get('font_size', 26) * scale_factor)
top_padding = int(text_settings.get('top_padding', 14) * scale_factor)
box_height = int(text_settings.get('bottom_padding', 47) * scale_factor)
spacing = int(text_settings.get('spacing', 10) * scale_factor)
vertical_position = int(text_settings.get('vertical_position', 1))
border_radius = int(text_settings.get('border_radius', 13) * scale_factor)

try:
regular_font = _get_font("fonts/sf-ui-display-regular.otf", font_size)
bold_font = _get_font("fonts/sf-ui-display-bold.otf", font_size)
except Exception as e:
logging.error(f"Error loading font: {e}")
raise

# Фильтруем параметры на основе видимости
loc = _LOCALIZATION.get(locale, _LOCALIZATION['en'])
params = []

if show_speed:
params.append((loc['speed'], f"{values['speed']}", loc['units']['speed']))
if show_max_speed:
params.append((loc['max_speed'], f"{values['max_speed']}", loc['units']['speed']))
if show_gps and 'gps' in values:
params.append((loc['gps'], f"{values['gps']}", loc['units']['speed']))
if show_voltage:
params.append((loc['voltage'], f"{values['voltage']}", loc['units']['voltage']))
if show_temp:
params.append((loc['temp'], f"{values['temperature']}", loc['units']['temp']))
if show_battery and 'battery' in values:
params.append((loc['battery'], f"{values['battery']}", loc['units']['battery']))
if show_mileage:
params.append((loc['mileage'], f"{values['mileage']}", loc['units']['mileage']))
if show_pwm:
params.append((loc['pwm'], f"{values['pwm']}", loc['units']['pwm']))
if show_power:
params.append((loc['power'], f"{values['power']}", loc['units']['power']))

if params:  # Если есть видимые элементы
element_widths = []
text_widths = []
text_heights = []
total_width = 0

for label, value, unit in params:
    label_bbox = draw.textbbox((0, 0), f"{label}: ", font=regular_font)
    value_bbox = draw.textbbox((0, 0), value, font=bold_font)
    unit_bbox = draw.textbbox((0, 0), f" {unit}", font=regular_font)

    text_width = (label_bbox[2] - label_bbox[0]) + (value_bbox[2] - value_bbox[0]) + (
                unit_bbox[2] - unit_bbox[0])
    text_height = max(label_bbox[3] - label_bbox[1],
                      value_bbox[3] - value_bbox[1],
                      unit_bbox[3] - unit_bbox[1])

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

x_position = start_x
for i, ((label, value, unit), element_width, text_width) in enumerate(
        zip(params, element_widths, text_widths)):
    # Применяем цветовые правила для плашки
    box_color = (0, 0, 0, 255)  # Черный
    text_color = (255, 255, 255, 255)  # Белый

    # Применяем масштабирование
    scaled_element_width = int(element_width * scale_factor)
    scaled_box_height = int(box_height * scale_factor)
    scaled_border_radius = int(border_radius * scale_factor)

    # Создаем плашку с округлыми углами
    box = create_rounded_box(scaled_element_width, scaled_box_height, scaled_border_radius)

    # Рисуем плашку
    overlay.paste(box, (x_position, y_position), box)

    # Масштабируем шрифт
    scaled_font_size = int(font_size * scale_factor)
    scaled_regular_font = _get_font("fonts/sf-ui-display-regular.otf", scaled_font_size)
    scaled_bold_font = _get_font("fonts/sf-ui-display-bold.otf", scaled_font_size)

    # Вычисляем координаты для текста
    label_text = f"{label}: "
    value_text = value
    unit_text = f" {unit}"

    label_bbox = draw.textbbox((0, 0), label_text, font=scaled_regular_font)
    value_bbox = draw.textbbox((0, 0), value_text, font=scaled_bold_font)
    unit_bbox = draw.textbbox((0, 0), unit_text, font=scaled_regular_font)

    label_width = label_bbox[2] - label_bbox[0]
    value_width = value_bbox[2] - value_bbox[0]
    unit_width = unit_bbox[2] - unit_bbox[0]

    # Общая ширина текста
    text_width = label_width + value_width + unit_width

    # Центрируем текст по вертикали
    text_height = max(label_bbox[3] - label_bbox[1], value_bbox[3] - value_bbox[1], unit_bbox[3] - unit_bbox[1])
    box_center = y_position + (scaled_box_height // 2)
    text_y = box_center - (text_height // 2)

    # Центрируем текст по горизонтали
    text_x = x_position + ((scaled_element_width - text_width) // 2)

    # Рисуем текст
    draw.text((text_x, text_y), label_text, fill=text_color, font=scaled_regular_font)
    draw.text((text_x + label_width, text_y), value_text, fill=text_color, font=scaled_bold_font)
    draw.text((text_x + label_width + value_width, text_y), unit_text, fill=text_color, font=scaled_regular_font)

    # Обновляем позицию для следующей плашки
    x_position += scaled_element_width + spacing

result = Image.alpha_composite(background, overlay)

if output_path:
result.convert('RGB').save(output_path, format='PNG', quality=95, optimize=True)
logging.debug(f"Saved frame to {output_path}")

return result

except Exception as e:
logging.error(f"Error in create_frame: {e}")
raise


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


def create_preview_frame(csv_file,
                         project_id,
                         resolution='fullhd',
                         text_settings=None,
                         locale='en'):
    try:
        from utils.csv_processor import process_csv_file
        from models import Project
        from flask import current_app

        with current_app.app_context():
            project = Project.query.get(project_id)
            if not project:
                raise ValueError(f"Project {project_id} not found")
            csv_type, processed_data = process_csv_file(
                csv_file, project.folder_number)
            df = pd.DataFrame(processed_data)
            max_speed_idx = df['speed'].idxmax()
            max_speed_timestamp = df.loc[max_speed_idx, 'timestamp']
            values = find_nearest_values(df, max_speed_timestamp)
            os.makedirs('previews', exist_ok=True)
            preview_path = f'previews/{project_id}_preview.png'
            if os.path.exists(preview_path):
                os.remove(preview_path)
            create_frame(values,
                         resolution,
                         preview_path,
                         text_settings,
                         locale=locale)
            logging.info(
                f"Created preview frame: {preview_path} with locale: {locale}")
            return preview_path

    except Exception as e:
        logging.error(f"Error in create_preview_frame: {e}")
        raise