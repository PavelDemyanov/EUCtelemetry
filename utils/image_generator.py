import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os
import logging
from datetime import datetime
import shutil

def find_nearest_values(data, timestamp):
    """Find the nearest value before the given timestamp for each column"""
    result = {}
    for column in ['speed', 'gps', 'voltage', 'temperature', 'current', 
                  'battery', 'mileage', 'pwm', 'power']:
        # Find the last value before or equal to the timestamp
        mask = data['timestamp'] <= timestamp
        if not any(mask):  # If no previous value exists
            result[column] = 0
        else:
            idx = np.where(mask)[0][-1]  # Get the last index where mask is True
            result[column] = data[column][idx]
    return result

def create_frame(values, timestamp, resolution='fullhd', output_path=None, text_settings=None):
    """Create a frame with customizable text display settings"""
    # Set resolution and calculate scale factor
    if resolution == "4k":
        width, height = 3840, 2160
        scale_factor = 2.0
    else:  # fullhd
        width, height = 1920, 1080
        scale_factor = 1.0

    # Create initial image with blue background (RGBA)
    image = Image.new('RGBA', (width, height), (0, 0, 255, 255))

    # Get text settings with defaults
    if text_settings is None:
        text_settings = {}

    # Apply text settings with defaults and scaling
    base_font_size = int(text_settings.get('font_size', 26))
    font_size = int(base_font_size * scale_factor)
    base_top_padding = int(text_settings.get('top_padding', 14))
    base_box_height = int(text_settings.get('bottom_padding', 47))
    base_spacing = int(text_settings.get('spacing', 10))
    vertical_position = int(text_settings.get('vertical_position', 1))
    base_border_radius = int(text_settings.get('border_radius', 13))

    # Scale padding, spacing, and border radius
    top_padding = int(base_top_padding * scale_factor)
    box_height = int(base_box_height * scale_factor)
    spacing = int(base_spacing * scale_factor)
    border_radius = int(base_border_radius * scale_factor)

    # Load font
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()

    # Parameters to display
    params = [
        ('Speed', values['speed']),
        ('GPS', values['gps']),
        ('Voltage', values['voltage']),
        ('Temp', values['temperature']),
        ('Current', values['current']),
        ('Battery', values['battery']),
        ('Mileage', values['mileage']),
        ('PWM', values['pwm']),
        ('Power', values['power'])
    ]

    # Calculate text dimensions and total width
    element_widths = []
    text_widths = []
    text_heights = []
    total_width = 0

    draw = ImageDraw.Draw(image)
    for label, value in params:
        text = f"{label}: {value}"
        text_bbox = draw.textbbox((0, 0), text, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]

        element_width = text_width + (2 * top_padding)
        element_widths.append(element_width)
        text_widths.append(text_width)
        text_heights.append(text_height)
        total_width += element_width

    total_width += spacing * (len(params) - 1)
    start_x = (width - total_width) // 2
    y_position = int((height * vertical_position) / 100)

    # Calculate text positioning
    max_text_height = max(text_heights)
    box_vertical_center = y_position + (box_height // 2)
    text_baseline_y = box_vertical_center - (max_text_height // 2)

    # Create a new RGBA image for compositing
    composite_image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    x_position = start_x

    # Draw each parameter box and text
    for i, ((label, value), element_width, text_width) in enumerate(zip(params, element_widths, text_widths)):
        text = f"{label}: {value}"

        # Create separate image for the rounded rectangle
        box_image = Image.new('RGBA', (element_width, box_height), (0, 0, 0, 0))
        box_draw = ImageDraw.Draw(box_image)

        # Draw rounded rectangle with explicit coordinates
        box_draw.rounded_rectangle(
            ((0, 0), (element_width - 1, box_height - 1)),
            radius=border_radius,
            fill=(0, 0, 0, 255)
        )

        # Composite the box onto our working image
        composite_image.paste(box_image, (x_position, y_position), box_image)

        # Add text
        draw = ImageDraw.Draw(composite_image)
        text_x = x_position + ((element_width - text_width) // 2)
        baseline_offset = int(max_text_height * 0.2)
        text_y = text_baseline_y - baseline_offset
        draw.text((text_x, text_y), text, fill=(255, 255, 255, 255), font=font)

        x_position += element_width + spacing

    # Composite the elements onto the blue background
    final_image = Image.alpha_composite(image, composite_image)

    # Convert to RGB for saving
    if output_path:
        final_image = final_image.convert('RGB')
        final_image.save(output_path, 'PNG')

    return final_image

def generate_frames(csv_file, folder_number, resolution='fullhd', fps=29.97, text_settings=None):
    """Generate video frames with text overlay"""
    try:
        frames_dir = f'frames/project_{folder_number}'
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)
        os.makedirs(frames_dir, exist_ok=True)

        from utils.csv_processor import process_csv_file
        _, data = process_csv_file(csv_file)

        for key in data:
            data[key] = np.array(data[key])

        T_min = np.min(data['timestamp'])
        T_max = np.max(data['timestamp'])
        duration = T_max - T_min
        frame_count = int(duration * float(fps))

        logging.info(f"Generating {frame_count} frames at {fps} fps")
        frame_timestamps = np.linspace(T_min, T_max, frame_count)

        for i, timestamp in enumerate(frame_timestamps):
            values = find_nearest_values(data, timestamp)
            output_path = f'{frames_dir}/frame_{i:06d}.png'
            create_frame(values, timestamp, resolution, output_path, text_settings)
            if i % 100 == 0:
                logging.info(f"Generated frame {i}/{frame_count}")

        logging.info(f"Successfully generated {frame_count} frames")
        return frame_count, duration

    except Exception as e:
        logging.error(f"Error generating frames: {str(e)}")
        raise

def create_preview_frame(csv_file, project_id, resolution='fullhd', text_settings=None):
    """Create a preview frame from the first row of data"""
    try:
        from utils.csv_processor import process_csv_file
        _, data = process_csv_file(csv_file)

        os.makedirs('static/previews', exist_ok=True)
        preview_path = f'static/previews/{project_id}_preview.png'

        if os.path.exists(preview_path):
            os.remove(preview_path)

        first_timestamp = data['timestamp'][0]
        values = find_nearest_values(data, first_timestamp)

        create_frame(values, first_timestamp, resolution, preview_path, text_settings)
        return preview_path

    except Exception as e:
        logging.error(f"Error creating preview frame: {str(e)}")
        raise