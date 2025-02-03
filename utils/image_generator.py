from PIL import Image, ImageDraw, ImageFont
import os
import logging
from datetime import datetime

def create_frame(data, frame_number, resolution, output_path):
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
    timestamp = data['timestamp'][frame_number]
    dt = datetime.fromtimestamp(timestamp)
    formatted_time = dt.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]

    params = [
        ('Time', formatted_time),
        ('Speed', data['speed'][frame_number]),
        ('GPS', data['gps'][frame_number]),
        ('Voltage', data['voltage'][frame_number]),
        ('Temp', data['temperature'][frame_number]),
        ('Current', data['current'][frame_number]),
        ('Battery', data['battery'][frame_number]),
        ('Mileage', data['mileage'][frame_number]),
        ('PWM', data['pwm'][frame_number]),
        ('Power', data['power'][frame_number])
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
        from datetime import datetime
        _, data = process_csv_file(csv_file)

        # Generate frames - one per timestamp
        frame_count = len(data['timestamp'])
        logging.info(f"Generating {frame_count} frames based on timestamps")

        for i in range(frame_count):
            output_path = f'{frames_dir}/frame_{i:06d}.png'
            create_frame(data, i, resolution, output_path)
            if i % 100 == 0:  # Log progress every 100 frames
                logging.info(f"Generated frame {i}/{frame_count}")

        logging.info(f"Successfully generated {frame_count} frames")
        return frame_count
    except Exception as e:
        logging.error(f"Error generating frames: {e}")
        raise