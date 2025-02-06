import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
import logging
from datetime import datetime
import shutil

def find_nearest_values(df, timestamp):
    """Find the nearest value before the given timestamp for each column"""
    result = {}
    # Convert relevant columns to numeric
    numeric_columns = ['speed', 'gps', 'voltage', 'temperature', 'current', 
                      'battery', 'mileage', 'pwm', 'power']

    for column in numeric_columns:
        df[column] = pd.to_numeric(df[column], errors='coerce')

    # Find values at or before timestamp
    mask = df['timestamp'] <= timestamp
    if not any(mask):
        return {col: 0 for col in numeric_columns}

    last_idx = df[mask].index[-1]

    for column in numeric_columns:
        result[column] = int(df.loc[last_idx, column])
        if column == 'speed':
            # Calculate max speed up to this point
            speed_values = df.loc[mask, 'speed']
            result['max_speed'] = int(speed_values.max()) if not speed_values.empty else 0

    return result

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

    # Load font
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()

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
        # Read CSV directly
        df = pd.read_csv(csv_file)

        # Create timestamps based on CSV type
        if 'Date' in df.columns:  # darnkessbot
            df['timestamp'] = pd.to_datetime(df['Date'], format='%d.%m.%Y %H:%M:%S.%f').astype(np.int64) // 10**9
        else:  # wheellog
            df['timestamp'] = pd.to_datetime(df['date'] + ' ' + df['time']).astype(np.int64) // 10**9

        # Ensure preview directory exists
        os.makedirs('static/previews', exist_ok=True)
        preview_path = f'static/previews/{project_id}_preview.png'

        if os.path.exists(preview_path):
            os.remove(preview_path)

        # Find point with maximum speed
        df['speed'] = pd.to_numeric(df['speed'], errors='coerce')
        max_speed_idx = df['speed'].idxmax()
        max_speed_timestamp = df.loc[max_speed_idx, 'timestamp']

        # Get values at maximum speed point
        values = find_nearest_values(df, max_speed_timestamp)

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

        # Read CSV directly
        df = pd.read_csv(csv_file)

        # Create timestamps based on CSV type
        if 'Date' in df.columns:  # darnkessbot
            df['timestamp'] = pd.to_datetime(df['Date'], format='%d.%m.%Y %H:%M:%S.%f').astype(np.int64) // 10**9
        else:  # wheellog
            df['timestamp'] = pd.to_datetime(df['date'] + ' ' + df['time']).astype(np.int64) // 10**9

        # Calculate frame timestamps
        T_min = df['timestamp'].min()
        T_max = df['timestamp'].max()
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