import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
import logging
from datetime import datetime
import shutil

def find_nearest_values(data, timestamp):
    """Find the nearest value before the given timestamp for each column and max speed up to this point"""
    result = {}
    for column in ['speed', 'gps', 'voltage', 'temperature', 'current', 
                  'battery', 'mileage', 'pwm', 'power']:
        mask = data['timestamp'] <= timestamp
        if not any(mask):
            result[column] = 0
        else:
            idx = np.where(mask)[0][-1]
            result[column] = data[column][idx]

            # Calculate max speed up to this point
            if column == 'speed':
                speed_values = data['speed'][data['timestamp'] <= timestamp]
                result['max_speed'] = int(np.max(speed_values)) if len(speed_values) > 0 else 0

    return result

def create_rounded_box(width, height, radius):
    """Create a rounded rectangle with simple PIL approach"""
    # Create a new image with transparency
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Draw rounded rectangle
    draw.rounded_rectangle(
        [(0, 0), (width-1, height-1)],
        radius=radius,
        fill=(0, 0, 0, 255),  # Black with full opacity
        outline=None
    )

    # Apply slight blur for smoother edges
    image = image.filter(ImageFilter.GaussianBlur(radius=0.5))

    return image

def create_frame(values, timestamp, resolution='fullhd', output_path=None, text_settings=None):
    """Create a frame with customizable text display settings"""
    # Set resolution
    if resolution == "4k":
        width, height = 3840, 2160
        scale_factor = 2.0
    else:  # fullhd
        width, height = 1920, 1080
        scale_factor = 1.0

    # Create background layer with solid blue color
    background = Image.new('RGBA', (width, height), (0, 0, 255, 255))

    # Create transparent overlay for boxes and text
    overlay = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Get text settings with defaults
    if text_settings is None:
        text_settings = {}

    # Scale all settings according to resolution
    base_font_size = int(text_settings.get('font_size', 26))
    font_size = int(base_font_size * scale_factor)
    base_top_padding = int(text_settings.get('top_padding', 14))
    base_box_height = int(text_settings.get('bottom_padding', 47))
    base_spacing = int(text_settings.get('spacing', 10))
    vertical_position = int(text_settings.get('vertical_position', 1))
    base_border_radius = int(text_settings.get('border_radius', 13))

    # Scale padding, spacing and border radius
    top_padding = int(base_top_padding * scale_factor)
    box_height = int(base_box_height * scale_factor)
    spacing = int(base_spacing * scale_factor)
    border_radius = int(base_border_radius * scale_factor)

    logging.info(f"Creating frame with border_radius={border_radius}, box_height={box_height}")

    # Load font
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()

    # Parameters to display with units
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
        text = f"{label}: {value}"
        bbox = draw.textbbox((0, 0), text, font=font)
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

    # Calculate text positioning
    max_text_height = max(text_heights)
    box_vertical_center = y_position + (box_height // 2)
    text_baseline_y = box_vertical_center - (max_text_height // 2)

    # Draw boxes and text
    x_position = start_x
    for i, ((label, value), element_width, text_width) in enumerate(zip(params, element_widths, text_widths)):
        # Create rounded rectangle box
        box = create_rounded_box(element_width, box_height, border_radius)

        # Paste box onto overlay
        overlay.paste(box, (x_position, y_position), box)

        # Add text
        text = f"{label}: {value}"
        text_x = x_position + ((element_width - text_width) // 2)
        baseline_offset = int(max_text_height * 0.2)
        text_y = text_baseline_y - baseline_offset
        draw.text((text_x, text_y), text, fill=(255, 255, 255, 255), font=font)

        x_position += element_width + spacing

    # Combine background and overlay
    result = Image.alpha_composite(background, overlay)

    if output_path:
        # Convert to RGB for PNG output
        result_rgb = result.convert('RGB')
        result_rgb.save(output_path, format='PNG', quality=100)
        logging.info(f"Saved frame to {output_path} with border_radius={border_radius}")

    return result

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
        logging.info(f"Created preview frame at {preview_path}")
        return preview_path

    except Exception as e:
        logging.error(f"Error creating preview frame: {str(e)}")
        raise