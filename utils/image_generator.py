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
    """
    Create a frame with customizable text display settings

    Args:
        values: Dictionary containing values to display
        timestamp: Timestamp for the frame
        resolution: 'fullhd' or '4k'
        output_path: Where to save the frame
        text_settings: Dictionary containing display settings:
            - vertical_position: Vertical position percentage (0-100)
            - top_padding: Padding above text
            - bottom_padding: Total height of the black box
            - spacing: Space between text blocks
            - font_size: Base font size before scaling
    """
    # Base resolution (Full HD)
    base_width, base_height = 1920, 1080

    # Set resolution and calculate scale factor
    if resolution == "4k":
        width, height = 3840, 2160
        scale_factor = 2.0
    else:  # fullhd
        width, height = 1920, 1080
        scale_factor = 1.0

    # Create image with blue background
    image = Image.new('RGB', (width, height), (0, 0, 255))
    draw = ImageDraw.Draw(image)

    # Get text settings with defaults
    if text_settings is None:
        text_settings = {}

    # Apply text settings with defaults
    base_font_size = int(text_settings.get('font_size', 26))
    font_size = int(base_font_size * scale_factor)
    base_top_padding = int(text_settings.get('top_padding', 10))
    base_box_height = int(text_settings.get('bottom_padding', 30))  # Общая высота плашки
    base_spacing = int(text_settings.get('spacing', 20))
    vertical_position = int(text_settings.get('vertical_position', 50))  # Позиция по вертикали в процентах

    # Scale padding and spacing
    top_padding = int(base_top_padding * scale_factor)
    box_height = int(base_box_height * scale_factor)
    spacing = int(base_spacing * scale_factor)

    # Load font with scaled size
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

    # Calculate total width of all elements
    total_width = 0
    element_widths = []
    text_heights = []
    for label, value in params:
        text = f"{label}: {value}"
        text_bbox = draw.textbbox((0, 0), text, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]
        # Add padding to element width
        element_width = text_width + (2 * top_padding)  # Padding on both sides
        element_widths.append(element_width)
        text_heights.append(text_height)
        total_width += element_width

    # Add spacing between elements to total width
    total_width += spacing * (len(params) - 1)

    # Calculate starting x position to center all elements
    start_x = (width - total_width) // 2

    # Calculate vertical position based on percentage
    y_position = int((height * vertical_position) / 100)

    # Current x position
    x_position = start_x

    # Draw parameters in a horizontal line
    max_text_height = max(text_heights)
    for i, ((label, value), element_width) in enumerate(zip(params, element_widths)):
        text = f"{label}: {value}"
        text_bbox = draw.textbbox((0, 0), text, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]

        # Calculate text position within box
        text_x = x_position + top_padding  # Add padding before text
        text_y = y_position + (box_height - text_height) // 2  # Center text vertically in box

        # Draw black background box
        draw.rectangle(
            [x_position, y_position, 
             x_position + element_width, y_position + box_height],
            fill='black'
        )

        # Draw white text
        draw.text((text_x, text_y), text, fill='white', font=font)

        # Move to next position
        x_position += element_width + spacing

    # Save frame
    image.save(output_path)

def generate_frames(csv_file, folder_number, resolution='fullhd', fps=29.97, text_settings=None):
    try:
        # Create project frames directory using folder_number
        frames_dir = f'frames/project_{folder_number}'
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)  # Clean up existing frames
        os.makedirs(frames_dir, exist_ok=True)

        # Process CSV data
        from utils.csv_processor import process_csv_file
        _, data = process_csv_file(csv_file)

        # Convert data to numpy arrays for efficient operations
        for key in data:
            data[key] = np.array(data[key])

        # Find T_min and T_max
        T_min = np.min(data['timestamp'])
        T_max = np.max(data['timestamp'])
        duration = T_max - T_min

        # Calculate number of frames based on duration and desired fps
        frame_count = int(duration * float(fps))

        logging.info(f"Generating {frame_count} frames for duration {duration:.2f} seconds at {fps} fps")

        # Generate evenly spaced timestamps for frames
        frame_timestamps = np.linspace(T_min, T_max, frame_count)

        # Generate a frame for each timestamp
        for i, timestamp in enumerate(frame_timestamps):
            # Find nearest values for this timestamp
            values = find_nearest_values(data, timestamp)
            output_path = f'{frames_dir}/frame_{i:06d}.png'
            create_frame(values, timestamp, resolution, output_path, text_settings)
            if i % 100 == 0:  # Log progress every 100 frames
                logging.info(f"Generated frame {i}/{frame_count}")

        logging.info(f"Successfully generated {frame_count} frames")
        logging.info(f"Total video duration based on timestamps: {duration:.2f} seconds")
        return frame_count, duration
    except Exception as e:
        logging.error(f"Error generating frames: {e}")
        raise

def create_preview_frame(csv_file, project_id, resolution='fullhd', text_settings=None):
    """Create a preview frame from the first row of data"""
    try:
        # Process CSV data
        from utils.csv_processor import process_csv_file
        _, data = process_csv_file(csv_file)

        # Create previews directory if it doesn't exist
        os.makedirs('static/previews', exist_ok=True)

        # Remove old preview if exists
        preview_path = f'static/previews/{project_id}_preview.png'
        if os.path.exists(preview_path):
            os.remove(preview_path)

        # Get the first timestamp and corresponding values
        first_timestamp = data['timestamp'][0]
        values = find_nearest_values(data, first_timestamp)

        # Generate the frame with text settings
        create_frame(values, first_timestamp, resolution, preview_path, text_settings)

        return preview_path
    except Exception as e:
        logging.error(f"Error creating preview frame: {e}")
        raise