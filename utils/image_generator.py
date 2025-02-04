from PIL import Image, ImageDraw, ImageFont
import os
import logging
from datetime import datetime
import numpy as np
import json

def find_nearest_timestamp_index(timestamps, target):
    """Find index of nearest timestamp to target value"""
    timestamps = np.array(timestamps)
    idx = (np.abs(timestamps - target)).argmin()
    return idx

def create_frame(data, timestamp_idx, resolution, output_path):
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

    # Parameters to display
    timestamp = data['timestamp'][timestamp_idx]
    dt = datetime.fromtimestamp(timestamp)
    formatted_time = dt.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]

    params = [
        ('Time', formatted_time),
        ('Speed', data['speed'][timestamp_idx]),
        ('GPS', data['gps'][timestamp_idx]),
        ('Voltage', data['voltage'][timestamp_idx]),
        ('Temp', data['temperature'][timestamp_idx]),
        ('Current', data['current'][timestamp_idx]),
        ('Battery', data['battery'][timestamp_idx]),
        ('Mileage', data['mileage'][timestamp_idx]),
        ('PWM', data['pwm'][timestamp_idx]),
        ('Power', data['power'][timestamp_idx])
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

def generate_frames(csv_file, project_id, resolution='fullhd'):
    try:
        # Create project frames directory
        frames_dir = f'frames/project_{project_id}'
        os.makedirs(frames_dir, exist_ok=True)

        # Process CSV data
        from utils.csv_processor import process_csv_file
        _, data = process_csv_file(csv_file)

        # Get unique timestamps and sort them
        timestamps = sorted(set(data['timestamp']))
        total_duration = timestamps[-1] - timestamps[0]

        # Save timestamps to a file
        timestamps_file = f'timestamps/project_{project_id}_timestamps.json'
        os.makedirs('timestamps', exist_ok=True)
        with open(timestamps_file, 'w') as f:
            json.dump({
                'timestamps': timestamps,
                'duration': total_duration,
                'frame_count': len(timestamps)
            }, f)

        # Calculate frame count based on timestamps
        frame_count = len(timestamps)
        logging.info(f"Generating {frame_count} frames based on timestamps")

        # Generate a frame for each unique timestamp
        for i, timestamp in enumerate(timestamps):
            # Find the nearest data point for this timestamp
            idx = find_nearest_timestamp_index(data['timestamp'], timestamp)
            output_path = f'{frames_dir}/frame_{i:06d}.png'
            create_frame(data, idx, resolution, output_path)
            if i % 100 == 0:  # Log progress every 100 frames
                logging.info(f"Generated frame {i}/{frame_count}")

        logging.info(f"Successfully generated {frame_count} frames")
        logging.info(f"Total video duration based on timestamps: {total_duration:.2f} seconds")
        return frame_count, timestamps_file, total_duration
    except Exception as e:
        logging.error(f"Error generating frames: {e}")
        raise