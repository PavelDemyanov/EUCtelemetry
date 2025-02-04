import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os
import logging
from datetime import datetime

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

def create_frame(values, timestamp, resolution, output_path):
    # Set resolution
    if resolution == "4k":
        width, height = 3840, 2160
    else:  # fullhd
        width, height = 1920, 1080

    # Create image with blue background
    image = Image.new('RGB', (width, height), (0, 0, 255))
    draw = ImageDraw.Draw(image)

    # Load font
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 32)
    except:
        font = ImageFont.load_default()

    # Format timestamp
    dt = datetime.fromtimestamp(timestamp)
    formatted_time = dt.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]

    # Parameters to display
    params = [
        ('Time', formatted_time),
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

    # Calculate positions
    x_start = 50
    y_position = height // 2
    spacing = width // (len(params) + 1)

    # Draw parameters
    for i, (label, value) in enumerate(params):
        x = x_start + (i * spacing)
        text = f"{label}: {value}" if isinstance(value, str) else f"{label}: {value:.2f}"

        # Get text size
        text_bbox = draw.textbbox((0, 0), text, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]

        # Draw black background
        padding = 10
        draw.rectangle(
            (x - padding, y_position - padding,
             x + text_width + padding, y_position + text_height + padding),
            fill='black'
        )

        # Draw white text
        draw.text((x, y_position), text, fill='white', font=font)

    # Save frame
    image.save(output_path)

def generate_frames(csv_file, project_id, resolution='fullhd', frame_count=None):
    try:
        # Create project frames directory
        frames_dir = f'frames/project_{project_id}'
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

        # If frame_count not specified, use the number of unique timestamps
        if frame_count is None:
            frame_count = len(np.unique(data['timestamp']))

        logging.info(f"Generating {frame_count} frames for duration {duration:.2f} seconds")

        # Generate evenly spaced timestamps for frames
        frame_timestamps = np.linspace(T_min, T_max, frame_count)

        # Generate a frame for each timestamp
        for i, timestamp in enumerate(frame_timestamps):
            # Find nearest values for this timestamp
            values = find_nearest_values(data, timestamp)
            output_path = f'{frames_dir}/frame_{i:06d}.png'
            create_frame(values, timestamp, resolution, output_path)
            if i % 100 == 0:  # Log progress every 100 frames
                logging.info(f"Generated frame {i}/{frame_count}")

        logging.info(f"Successfully generated {frame_count} frames")
        logging.info(f"Total video duration based on timestamps: {duration:.2f} seconds")
        return frame_count, duration
    except Exception as e:
        logging.error(f"Error generating frames: {e}")
        raise