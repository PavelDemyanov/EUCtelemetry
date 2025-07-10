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
from concurrent.futures import ThreadPoolExecutor
import cairosvg
import io

_metal_initialized = False
_metal_context = None
_metal_device = None

# Cache for loaded icons - clear cache when restarting
_icon_cache = {}

def clear_icon_cache():
    """Clear the icon cache to force reload of updated SVG files."""
    global _icon_cache
    _icon_cache.clear()
    logging.info("Icon cache cleared")

def load_icon(icon_name, size=24, color='white'):
    """Load and cache an icon from PNG file, return PIL Image with inversion if needed."""
    cache_key = f"{icon_name}_{size}_{color}"
    
    if cache_key in _icon_cache:
        return _icon_cache[cache_key]
    
    try:
        # Load PNG file
        icon_path = os.path.join('static', 'icons', 'icons_telemetry', f'{icon_name}.png')
        
        if not os.path.exists(icon_path):
            logging.warning(f"Icon file not found: {icon_path}")
            return None
        
        logging.debug(f"Loading icon: {icon_path}")
        
        # Load PNG image
        icon_image = Image.open(icon_path).convert('RGBA')
        
        # Resize to required size
        icon_image = icon_image.resize((size, size), Image.Resampling.LANCZOS)
        
        # Invert colors if we need white icons (since PNG icons are black)
        if color == 'white':
            # Create a new image with inverted colors
            pixels = icon_image.load()
            for y in range(icon_image.height):
                for x in range(icon_image.width):
                    r, g, b, a = pixels[x, y]
                    # Only invert if pixel is not transparent
                    if a > 0:
                        # Invert RGB values
                        pixels[x, y] = (255 - r, 255 - g, 255 - b, a)
        
        # Cache the result
        _icon_cache[cache_key] = icon_image
        
        return icon_image
        
    except Exception as e:
        logging.error(f"Error loading icon {icon_name}: {e}")
        return None

def get_icon_name_for_label(label, loc):
    """Map label text to icon filename."""
    # Create a mapping from localized labels to icon names
    label_to_icon = {
        loc['speed']: 'speed',
        loc['max_speed']: 'max_speed', 
        loc['voltage']: 'voltage',
        loc['temp']: 'temp',
        loc['battery']: 'battery',
        loc['gps']: 'gps',
        loc['mileage']: 'mileage',
        loc['pwm']: 'pwm',
        loc['power']: 'power',
        loc['current']: 'current'
    }
    
    return label_to_icon.get(label, 'speed')  # Default to speed icon

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

def calculate_max_widths_for_static_boxes(df, text_settings, use_icons=False, locale='en', resolution='fullhd'):
    """Calculate maximum text width for each telemetry parameter to ensure static box sizes"""
    try:
        # Get localization
        loc = _LOCALIZATION.get(locale, _LOCALIZATION['en'])
        
        # Load fonts with resolution scaling
        base_font_size = text_settings.get('font_size', 26)
        # Apply resolution scaling
        if resolution == '4k':
            font_size = int(base_font_size * 2)  # 4K scaling factor
        else:
            font_size = base_font_size
        
        regular_font = _get_font('fonts/sf-ui-display-regular.otf', font_size)
        bold_font = _get_font('fonts/sf-ui-display-bold.otf', font_size)
        
        # Create dummy draw object for text measurement
        dummy_image = Image.new('RGBA', (100, 100), (0, 0, 0, 0))
        draw = ImageDraw.Draw(dummy_image)
        
        # Icon size calculation
        icon_size = int(font_size * 0.8) if use_icons else 0
        
        max_widths = {}
        
        # Define all possible parameters to check
        parameters = [
            ('speed', loc['speed'], loc['units']['speed'], 'speed'),
            ('max_speed', loc['max_speed'], loc['units']['speed'], 'max_speed'),
            ('voltage', loc['voltage'], loc['units']['voltage'], 'voltage'),
            ('temp', loc['temp'], loc['units']['temp'], 'temperature'),
            ('battery', loc['battery'], loc['units']['battery'], 'battery'),
            ('mileage', loc['mileage'], loc['units']['mileage'], 'mileage'),
            ('pwm', loc['pwm'], loc['units']['pwm'], 'pwm'),
            ('power', loc['power'], loc['units']['power'], 'power'),
            ('current', loc['current'], loc['units']['current'], 'current'),
        ]
        
        # Add GPS if available
        if 'gps' in df.columns:
            parameters.append(('gps', loc['gps'], loc['units']['speed'], 'gps'))
        
        for param_key, label, unit, column_name in parameters:
            max_text_width = 0
            
            # Special handling for max_speed - use same sizing as speed
            if param_key == 'max_speed':
                # Use 'speed' column data for max_speed sizing
                if 'speed' in df.columns:
                    max_abs_value = df['speed'].abs().max()
                    min_value = df['speed'].min()
                else:
                    # Fallback to 3 characters if no speed data
                    max_abs_value = 999
                    min_value = 0
                
                # Determine the maximum number of characters needed
                max_chars = len(str(int(max_abs_value)))
                if min_value < 0:
                    max_chars += 1  # Add one for the negative sign
                    
            elif column_name in df.columns:
                # Find the maximum absolute value to determine character count
                max_abs_value = df[column_name].abs().max()
                min_value = df[column_name].min()
                
                # Determine the maximum number of characters needed
                # Consider negative sign if minimum value is negative
                max_chars = len(str(int(max_abs_value)))
                if min_value < 0:
                    max_chars += 1  # Add one for the negative sign
            else:
                # Column not available, skip
                max_widths[param_key] = 0
                continue
            
            # Limit maximum width for specific parameters to 3 characters
            if param_key in ['speed', 'max_speed', 'gps', 'pwm', 'battery', 'temp']:
                max_chars = min(max_chars, 3)
                
            # Create a test string with maximum character count using '0's
            test_value_str = '0' * max_chars
            
            if use_icons:
                # Calculate width with icon
                value_bbox = draw.textbbox((0, 0), test_value_str, font=bold_font)
                unit_bbox = draw.textbbox((0, 0), f" {unit}", font=regular_font)
                text_width = icon_size + 5 + (value_bbox[2] - value_bbox[0]) + (unit_bbox[2] - unit_bbox[0])
            else:
                # Calculate width with text label
                label_bbox = draw.textbbox((0, 0), f"{label}: ", font=regular_font)
                value_bbox = draw.textbbox((0, 0), test_value_str, font=bold_font)
                unit_bbox = draw.textbbox((0, 0), f" {unit}", font=regular_font)
                text_width = (label_bbox[2] - label_bbox[0]) + (value_bbox[2] - value_bbox[0]) + (unit_bbox[2] - unit_bbox[0])
            
            max_text_width = text_width
            max_widths[param_key] = max_text_width
        
        logging.info(f"Calculated static box max widths: {max_widths}")
        return max_widths
        
    except Exception as e:
        logging.error(f"Error calculating max widths for static boxes: {e}")
        return {}


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


def clear_box_cache():
    """Clear the box cache to force regeneration of rounded boxes."""
    global _box_cache
    _box_cache.clear()
    logging.debug("Box cache cleared")


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
                  locale='en',
                  static_box_widths=None):
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
        show_current = text_settings.get('show_current', True)  # Add current visibility setting
        show_bottom_elements = text_settings.get('show_bottom_elements', True)
        use_icons = text_settings.get('use_icons', False)  # Add icons setting

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
        # Icon size scales with font size to maintain proportions
        icon_size = max(12, int(font_size * 0.8))  # Icon size proportional to font size
        icon_vertical_offset = int(text_settings.get('icon_vertical_offset', 5))  # Icon vertical offset in pixels
        icon_horizontal_spacing = int(text_settings.get('icon_horizontal_spacing', 10))  # Icon horizontal spacing in pixels
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
        if show_current:  # Add current display
            params.append((loc['current'], f"{values['current']}", loc['units']['current']))

        if params:  # Only proceed if there are visible elements
            element_widths = []
            text_widths = []
            text_heights = []
            static_content_widths = []  # List to store static content widths for each element
            total_width = 0

            for label, value, unit in params:
                # Determine parameter key for static width lookup
                param_key = None
                if label == loc['speed']:
                    param_key = 'speed'
                elif label == loc['max_speed']:
                    param_key = 'max_speed'
                elif label == loc['voltage']:
                    param_key = 'voltage'
                elif label == loc['temp']:
                    param_key = 'temp'
                elif label == loc['battery']:
                    param_key = 'battery'
                elif label == loc['mileage']:
                    param_key = 'mileage'
                elif label == loc['pwm']:
                    param_key = 'pwm'
                elif label == loc['power']:
                    param_key = 'power'
                elif label == loc['current']:
                    param_key = 'current'
                elif label == loc.get('gps'):
                    param_key = 'gps'
                
                # Calculate text width and height dynamically first (for proper spacing)
                if use_icons:
                    # For icons, calculate width differently
                    value_bbox = draw.textbbox((0, 0), value, font=bold_font)
                    unit_bbox = draw.textbbox((0, 0), f" {unit}", font=regular_font)
                    
                    dynamic_text_width = icon_size + icon_horizontal_spacing + (value_bbox[2] - value_bbox[0]) + (unit_bbox[2] - unit_bbox[0])  # Icon + spacing + value + unit
                    text_height = max(icon_size, value_bbox[3] - value_bbox[1], unit_bbox[3] - unit_bbox[1])
                else:
                    # Original text-based layout
                    label_bbox = draw.textbbox((0, 0), f"{label}: ", font=regular_font)
                    value_bbox = draw.textbbox((0, 0), value, font=bold_font)
                    unit_bbox = draw.textbbox((0, 0), f" {unit}", font=regular_font)

                    dynamic_text_width = (label_bbox[2] - label_bbox[0]) + (value_bbox[2] - value_bbox[0]) + (unit_bbox[2] - unit_bbox[0])
                    text_height = max(label_bbox[3] - label_bbox[1],
                                      value_bbox[3] - value_bbox[1],
                                      unit_bbox[3] - unit_bbox[1])
                
                # Use static width for both box sizing and content centering if available
                if static_box_widths and param_key and param_key in static_box_widths:
                    # Use static width for both element sizing and content centering
                    static_content_width = static_box_widths[param_key]
                    text_width = static_content_width  # Use only static width for fixed box size
                else:
                    text_width = dynamic_text_width
                    static_content_width = None

                element_width = text_width + (2 * top_padding)
                element_widths.append(element_width)
                text_widths.append(text_width)
                text_heights.append(text_height)
                static_content_widths.append(static_content_width)  # Store static content width for each element
                total_width += element_width

            total_width += spacing * (len(params) - 1)
            start_x = (width - total_width) // 2
            y_position = int((height * vertical_position) / 100)

            max_text_height = max(text_heights)
            box_vertical_center = y_position + (box_height // 2)
            text_baseline_y = box_vertical_center - (max_text_height // 2)

            x_position = start_x
            for i, ((label, value, unit), element_width, text_width, static_content_width) in enumerate(zip(params, element_widths, text_widths, static_content_widths)):
                box_color = (0, 0, 0, 255)  # Стандартный черный цвет
                text_color = (255, 255, 255, 255)  # Стандартный белый цвет

                if label == loc['pwm']:
                    pwm_value = int(value)
                    if 80 <= pwm_value <= 90:
                        box_color = (255, 255, 0, 255)  # Желтый цвет для PWM 80-90
                        text_color = (0, 0, 0, 255)  # Черный текст
                    elif pwm_value > 90:
                        box_color = (255, 0, 0, 255)  # Красный цвет для PWM > 90
                        text_color = (0, 0, 0, 255)  # Черный текст
                elif label == loc['battery']:
                    battery_value = int(value)
                    if 10 <= battery_value <= 30:
                        box_color = (255, 255, 0, 255)  # Желтый цвет для Battery 10-30
                        text_color = (0, 0, 0, 255)  # Черный текст
                    elif battery_value < 10:
                        box_color = (255, 0, 0, 255)  # Красный цвет для Battery < 10
                        text_color = (0, 0, 0, 255)  # Черный текст

                box = create_rounded_box(element_width, box_height, border_radius)
                if box_color != (0, 0, 0, 255):
                    colored_box = Image.new('RGBA', box.size, box_color)
                    colored_box.putalpha(box.split()[3])
                    box = colored_box

                overlay.paste(box, (x_position, y_position), box)

                # Use static content width for centering if available
                content_width_for_centering = dynamic_text_width if static_content_width else text_width
                text_x = x_position + ((element_width - content_width_for_centering) // 2)
                baseline_offset = int(max_text_height * 0.2)
                text_y = text_baseline_y - baseline_offset

                if use_icons:
                    # Draw with icon instead of text label
                    icon_name = get_icon_name_for_label(label, loc)
                    
                    # Determine icon color based on box color
                    # If box is colored (yellow/red), use black icon for better visibility
                    icon_color = 'black' if box_color != (0, 0, 0, 255) else 'white'
                    icon = load_icon(icon_name, icon_size, icon_color)
                    
                    if icon:
                        # Calculate text metrics for proper alignment
                        value_bbox = draw.textbbox((0, 0), value, font=bold_font)
                        
                        # Get actual text height from bounding box
                        text_height = value_bbox[3] - value_bbox[1]
                        
                        # Position icon to be vertically centered with the text
                        # Align the center of the icon with the center of the text
                        text_center_y = text_y + (text_height // 2)
                        icon_y = text_center_y - (icon_size // 2) + icon_vertical_offset
                        
                        overlay.paste(icon, (text_x, icon_y), icon)
                        
                        # Draw value after icon
                        value_x = text_x + icon_size + icon_horizontal_spacing
                        draw.text((value_x, text_y), value, fill=text_color, font=bold_font)
                        
                        # Draw unit after value
                        value_width = value_bbox[2] - value_bbox[0]
                        draw.text((value_x + value_width, text_y), f" {unit}", fill=text_color, font=regular_font)
                    else:
                        # Fallback to text if icon not found
                        draw.text((text_x, text_y), f"{label}: {value} {unit}", fill=text_color, font=regular_font)
                else:
                    # Original text-based rendering
                    label_bbox = draw.textbbox((0, 0), f"{label}: ", font=regular_font)
                    label_width = label_bbox[2] - label_bbox[0]
                    draw.text((text_x, text_y),
                              f"{label}: ",
                              fill=text_color,
                              font=regular_font)

                    value_bbox = draw.textbbox((0, 0), value, font=bold_font)
                    value_width = value_bbox[2] - value_bbox[0]
                    draw.text((text_x + label_width, text_y),
                              value,
                              fill=text_color,
                              font=bold_font)

                    draw.text((text_x + label_width + value_width, text_y),
                              f" {unit}",
                              fill=text_color,
                              font=regular_font)

                x_position += element_width + spacing

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


def generate_frames(csv_file,
                    folder_number,
                    resolution='fullhd',
                    fps=29.97,
                    text_settings=None,
                    progress_callback=None,
                    interpolate_values=True,
                    locale='en'):
    try:
        frames_dir = f'frames/project_{folder_number}'
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)
        os.makedirs(frames_dir, exist_ok=True)

        # Process CSV file using the processor
        from utils.csv_processor import process_csv_file
        csv_type, processed_data = process_csv_file(csv_file, folder_number)
        df = pd.DataFrame(processed_data)

        # Sort dataframe by timestamp to ensure proper interpolation
        df = df.sort_values('timestamp')
        
        # Calculate static box widths if enabled
        static_box_widths = None
        if text_settings and text_settings.get('static_box_size', False):
            use_icons = text_settings.get('use_icons', False)
            static_box_widths = calculate_max_widths_for_static_boxes(df, text_settings, use_icons, locale, resolution)
            # Clear box cache to force regeneration with new sizes
            clear_box_cache()
        else:
            # Also clear cache when switching from static to dynamic
            clear_box_cache()

        # Calculate frame timestamps
        T_min = df['timestamp'].min()
        T_max = df['timestamp'].max()
        frame_count = int((T_max - T_min) * fps)
        logging.info(
            f"Generating {frame_count} frames at {fps} fps with interpolation {'enabled' if interpolate_values else 'disabled'}"
        )
        frame_timestamps = np.linspace(T_min, T_max, frame_count)

        completed_frames = 0
        lock = threading.Lock()
        stop_event = threading.Event()

        def process_frame(args):
            i, timestamp = args
            nonlocal completed_frames

            # Check for stop signal
            if stop_event.is_set():
                raise InterruptedError("Frame generation stopped by user")

            try:
                # Use interpolated values for frame generation if enabled
                values = find_nearest_values(df,
                                              timestamp,
                                              interpolate=interpolate_values)
                output_path = f'{frames_dir}/frame_{i:06d}.png'
                create_frame(values,
                               resolution,
                               output_path,
                               text_settings,
                               locale=locale,
                               static_box_widths=static_box_widths)

                with lock:
                    completed_frames += 1
                    if progress_callback and (completed_frames % 10 == 0
                                               or completed_frames == frame_count):
                        try:
                            progress_callback(completed_frames, frame_count, 'frames')
                        except InterruptedError:
                            stop_event.set()
                            raise

            except InterruptedError:
                stop_event.set()
                raise
            except Exception as e:
                logging.error(f"Error processing frame {i}: {e}")
                raise

        max_workers = os.cpu_count() or 4
        frame_args = list(enumerate(frame_timestamps))
        chunk_size = 100  # Process frames in smaller chunks for better interrupt handling

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            try:
                for i in range(0, len(frame_args), chunk_size):
                    if stop_event.is_set():
                        raise InterruptedError("Frame generation stopped by user")

                    chunk = frame_args[i:i + chunk_size]
                    futures = [executor.submit(process_frame, args) for args in chunk]

                    for future in futures:
                        try:
                            future.result()  # This will raise any exceptions from the worker
                        except InterruptedError:
                            stop_event.set()
                            executor.shutdown(wait=False)
                            raise
                        except Exception as e:
                            logging.error(f"Error in frame generation: {e}")
                            stop_event.set()
                            executor.shutdown(wait=False)
                            raise

            except InterruptedError:
                logging.info("Frame generation interrupted by user")
                raise
            except Exception as e:
                logging.error(f"Error during frame generation: {e}")
                raise
            finally:
                if stop_event.is_set():
                    executor.shutdown(wait=False)

        logging.info(f"Successfully generated {frame_count} frames")
        return frame_count, (T_max - T_min)

    except Exception as e:
        logging.error(f"Error in generate_frames: {e}")
        raise


def find_nearest_values(df, timestamp, interpolate=True):
    """Find nearest or interpolated values for the given timestamp"""
    # Define the default set of columns to search for
    standard_columns = [
        'speed', 'voltage', 'temperature', 'current', 
        'battery', 'mileage', 'pwm', 'power'
    ]
    
    # Check if 'gps' column exists in the DataFrame
    has_gps = 'gps' in df.columns
    if has_gps:
        all_columns = standard_columns + ['gps']
    else:
        all_columns = standard_columns
    
    # If timestamp is before the first data point, return zeros
    if timestamp < df['timestamp'].iloc[0]:
        result = {key: 0 for key in all_columns}
        result['max_speed'] = 0
        return result

    # Find the indices of the surrounding data points
    after_mask = df['timestamp'] >= timestamp
    before_mask = df['timestamp'] <= timestamp

    if not after_mask.any() or not before_mask.any():
        # If timestamp is outside the range, use the last available values
        last_idx = df.index[-1]
        result = {
            'speed': int(df.loc[last_idx, 'speed']),
            'voltage': int(df.loc[last_idx, 'voltage']),
            'temperature': int(df.loc[last_idx, 'temperature']),
            'current': int(df.loc[last_idx, 'current']),
            'battery': int(df.loc[last_idx, 'battery']),
            'mileage': int(df.loc[last_idx, 'mileage']),
            'pwm': int(df.loc[last_idx, 'pwm']),
            'power': int(df.loc[last_idx, 'power']),
            'max_speed': int(df.loc[:before_mask, 'speed'].max())
        }
        
        # Add GPS data if it exists
        if has_gps:
            result['gps'] = int(df.loc[last_idx, 'gps'])
            
        return result

    # Get indices of surrounding points
    after_idx = df[after_mask].index[0]
    before_idx = df[before_mask].index[-1]

    # If exact match found or interpolation is disabled, return nearest values
    if before_idx == after_idx or not interpolate:
        use_idx = before_idx
        if not interpolate and timestamp - df.loc[
                before_idx, 'timestamp'] > df.loc[after_idx,
                                                  'timestamp'] - timestamp:
            use_idx = after_idx

        result = {
            'speed': int(df.loc[use_idx, 'speed']),
            'voltage': int(df.loc[use_idx, 'voltage']),
            'temperature': int(df.loc[use_idx, 'temperature']),
            'current': int(df.loc[use_idx, 'current']),
            'battery': int(df.loc[use_idx, 'battery']),
            'mileage': int(df.loc[use_idx, 'mileage']),
            'pwm': int(df.loc[use_idx, 'pwm']),
            'power': int(df.loc[use_idx, 'power'])
        }
        
        # Add GPS data if it exists
        if has_gps:
            result['gps'] = int(df.loc[use_idx, 'gps'])
            
        result['max_speed'] = int(df.loc[:use_idx, 'speed'].max())
        return result

    # Calculate interpolation factor
    t0 = df.loc[before_idx, 'timestamp']
    t1 = df.loc[after_idx, 'timestamp']
    factor = (timestamp - t0) / (t1 - t0)

    # Interpolate all numeric values
    result = {}
    # Define the standard columns to interpolate
    standard_columns = [
        'speed', 'voltage', 'temperature', 'current', 'battery',
        'mileage', 'pwm', 'power'
    ]
    
    # Add GPS if available
    columns_to_interpolate = standard_columns + (['gps'] if has_gps else [])
    
    for key in columns_to_interpolate:
        v0 = float(df.loc[before_idx, key])
        v1 = float(df.loc[after_idx, key])
        interpolated_value = v0 + factor * (v1 - v0)
        result[key] = int(round(interpolated_value))

    # Calculate max speed up to current point
    result['max_speed'] = int(df.loc[:before_idx, 'speed'].max())

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
            
            # Calculate static box widths if enabled
            static_box_widths = None
            if text_settings and text_settings.get('static_box_size', False):
                use_icons = text_settings.get('use_icons', False)
                static_box_widths = calculate_max_widths_for_static_boxes(df, text_settings, use_icons, locale, resolution)
                # Clear box cache to force regeneration with new sizes
                clear_box_cache()
            else:
                # Also clear cache when switching from static to dynamic
                clear_box_cache()
            
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
                         locale=locale,
                         static_box_widths=static_box_widths)
            logging.info(
                f"Created preview frame: {preview_path} with locale: {locale}")
            return preview_path

    except Exception as e:
        logging.error(f"Error in create_preview_frame: {e}")
        raise