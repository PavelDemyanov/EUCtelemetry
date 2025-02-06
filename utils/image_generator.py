import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
import logging
from datetime import datetime
import shutil

def detect_csv_type(df):
    """Detect CSV type based on column names"""
    if 'Date' in df.columns and 'Speed' in df.columns:
        return 'darnkessbot'
    elif 'date' in df.columns and 'speed' in df.columns:
        return 'wheellog'
    else:
        raise ValueError("Unknown CSV format")

def get_column_name(csv_type, base_name):
    """Get the correct column name based on CSV type"""
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

def find_nearest_values(df, timestamp, csv_type=None):
    """Find the nearest value before the given timestamp for each column"""
    # CSV type parameter is kept for backwards compatibility but not used anymore
    # as we're working with already processed data with normalized column names

    try:
        # Find values at or before timestamp
        mask = df['timestamp'] <= timestamp
        if not any(mask):
            return {
                'speed': 0,
                'max_speed': 0,
                'gps': 0,
                'voltage': 0,
                'temperature': 0,
                'current': 0,
                'battery': 0,
                'mileage': 0,
                'pwm': 0,
                'power': 0
            }

        last_idx = df[mask].index[-1]

        # Get all values at the found index
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

        # Calculate max speed up to this point
        result['max_speed'] = int(df.loc[mask, 'speed'].max())

        return result

    except Exception as e:
        logging.error(f"Error in find_nearest_values: {e}")
        raise

def create_rounded_box(width, height, radius):
    """Create a rounded rectangle"""
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        [(0, 0), (width-1, height-1)],
        radius=radius,
        fill=(0, 0, 0, 255),
        outline=None
    )
    image = image.filter(ImageFilter.GaussianBlur(radius=0.5))
    return image

def create_frame(values, resolution='fullhd', output_path=None, text_settings=None):
    """Create a frame with customizable text display settings"""
    # Set resolution
    if resolution == "4k":
        width, height = 3840, 2160
        scale_factor = 2.0
    else:  # fullhd
        width, height = 1920, 1080
        scale_factor = 1.0

    # Create background layer
    background = Image.new('RGBA', (width, height), (0, 0, 255, 255))
    overlay = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Scale settings according to resolution
    text_settings = text_settings or {}
    font_size = int(text_settings.get('font_size', 26) * scale_factor)
    top_padding = int(text_settings.get('top_padding', 14) * scale_factor)
    box_height = int(text_settings.get('bottom_padding', 47) * scale_factor)
    spacing = int(text_settings.get('spacing', 10) * scale_factor)
    vertical_position = int(text_settings.get('vertical_position', 1))
    border_radius = int(text_settings.get('border_radius', 13) * scale_factor)

    # Load SF UI Display Bold font
    try:
        font = ImageFont.truetype("fonts/sf-ui-display-bold.otf", font_size)
        logging.info("Successfully loaded SF UI Display Bold font")
    except Exception as e:
        logging.error(f"Critical error loading SF UI Display Bold font: {e}")
        logging.error("Font 'fonts/sf-ui-display-bold.otf' is required for text rendering")
        raise ValueError("Required font 'SF UI Display Bold' could not be loaded")

    # Parameters to display
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

    # Calculate dimensions
    element_widths = []
    text_widths = []
    text_heights = []
    total_width = 0

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

    # Position text
    max_text_height = max(text_heights)
    box_vertical_center = y_position + (box_height // 2)
    text_baseline_y = box_vertical_center - (max_text_height // 2)

    # Draw boxes and text
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

    # Combine layers and save
    result = Image.alpha_composite(background, overlay)

    if output_path:
        result_rgb = result.convert('RGB')
        result_rgb.save(output_path, format='PNG', quality=100)
        logging.info(f"Saved frame to {output_path}")

    return result

def create_preview_frame(csv_file, project_id, resolution='fullhd', text_settings=None):
    """Create a preview frame from the data point with maximum speed"""
    try:
        # Importing here to avoid circular imports
        from utils.csv_processor import process_csv_file
        from models import Project
        from flask import current_app

        # Get project to access folder number
        with current_app.app_context():
            project = Project.query.get(project_id)
            if not project:
                raise ValueError(f"Project {project_id} not found")

            # Process CSV file with folder number for unique processed file
            csv_type, processed_data = process_csv_file(csv_file, project.folder_number)

            # Convert to DataFrame for easier manipulation
            df = pd.DataFrame(processed_data)

            # Find timestamp with maximum speed
            max_speed_idx = df['speed'].idxmax()
            max_speed_timestamp = df.loc[max_speed_idx, 'timestamp']

            # Get values at maximum speed point using find_nearest_values
            values = find_nearest_values(df, max_speed_timestamp)

            # Ensure preview directory exists and create preview
            os.makedirs('previews', exist_ok=True)
            preview_path = f'previews/{project_id}_preview.png'

            if os.path.exists(preview_path):
                os.remove(preview_path)

            # Create and save preview frame
            create_frame(values, resolution, preview_path, text_settings)
            logging.info(f"Created preview frame at {preview_path}")
            return preview_path

    except Exception as e:
        logging.error(f"Error creating preview frame: {e}")
        raise

def generate_frames(csv_file, folder_number, resolution='fullhd', fps=29.97, text_settings=None):
    """Generate video frames with text overlay"""
    try:
        frames_dir = f'frames/project_{folder_number}'
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)
        os.makedirs(frames_dir, exist_ok=True)

        # Importing here to avoid circular imports
        from utils.csv_processor import process_csv_file

        # Process CSV file - will reuse existing processed file if available
        csv_type, processed_data = process_csv_file(csv_file, folder_number)
        df = pd.DataFrame(processed_data)

        # Calculate frame timestamps
        timestamps = df['timestamp'].astype(float)
        T_min = timestamps.min()
        T_max = timestamps.max()
        duration = T_max - T_min
        frame_count = int(duration * float(fps))

        logging.info(f"Generating {frame_count} frames at {fps} fps")
        frame_timestamps = np.linspace(T_min, T_max, frame_count)

        for i, timestamp in enumerate(frame_timestamps):
            values = find_nearest_values(df, timestamp)
            output_path = f'{frames_dir}/frame_{i:06d}.png'
            create_frame(values, resolution, output_path, text_settings)
            if i % 100 == 0:
                logging.info(f"Generated frame {i}/{frame_count}")

        logging.info(f"Successfully generated {frame_count} frames")
        return frame_count, duration

    except Exception as e:
        logging.error(f"Error generating frames: {e}")
        raise