import ffmpeg
import os
import logging
from extensions import db
from models import Project
import subprocess
import re
from utils.hardware_detection import is_apple_silicon

def create_video(folder_number, fps=29.97, codec='h264', resolution='fullhd', progress_callback=None):
    try:
        frames_dir = f'frames/project_{folder_number}'
        output_file = f'videos/project_{folder_number}.mp4'

        # Ensure the videos directory exists
        os.makedirs('videos', exist_ok=True)

        # Map codec names to FFmpeg encoder names
        codec_map = {
            'h264': 'libx264',
            'h265': 'libx265'
        }

        # Get the correct encoder name
        encoder = codec_map.get(codec, 'libx264')

        # Set video parameters based on resolution
        if resolution == '4k':
            width, height = 3840, 2160
        else:  # fullhd
            width, height = 1920, 1080

        logging.info(f"Creating video with fps={fps}, codec={codec}, resolution={resolution}")

        # Build ffmpeg command with hardware acceleration if available
        command = ['ffmpeg', '-y']  # Overwrite output file

        # Check for Apple Silicon
        if is_apple_silicon():
            logging.info("Using Apple Silicon hardware acceleration")
            if codec == 'h264':
                command.extend([
                    '-hwaccel', 'videotoolbox',
                    '-hwaccel_output_format', 'videotoolbox_vld'
                ])
                encoder = 'h264_videotoolbox'  # Use VideoToolbox hardware encoder
            elif codec == 'h265':
                command.extend([
                    '-hwaccel', 'videotoolbox',
                    '-hwaccel_output_format', 'videotoolbox_vld'
                ])
                encoder = 'hevc_videotoolbox'  # Use VideoToolbox hardware encoder

        # Add input options
        command.extend([
            '-r', str(fps),
            '-i', f'{frames_dir}/frame_%06d.png',
            '-c:v', encoder,
            '-pix_fmt', 'yuv420p',
            '-s', f'{width}x{height}'
        ])

        # Add codec-specific options
        if not is_apple_silicon():
            # Software encoding quality settings
            command.extend(['-crf', '23' if codec == 'h264' else '28'])
        else:
            # Hardware encoding quality settings
            command.extend(['-b:v', '8M' if resolution == '4k' else '4M'])

        # Add output file
        command.append(output_file)

        # Get total frame count for progress calculation
        frame_files = [f for f in os.listdir(frames_dir) if f.startswith('frame_') and f.endswith('.png')]
        total_frames = len(frame_files)

        # Run ffmpeg with progress monitoring
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )

        # Track progress
        frame_pattern = re.compile(r'frame=\s*(\d+)')
        current_frame = 0

        for line in process.stderr:
            frame_match = frame_pattern.search(line)
            if frame_match:
                current_frame = int(frame_match.group(1))
                if progress_callback:
                    progress_callback(current_frame, total_frames, 'video')

        # Wait for process to complete
        process.wait()

        if process.returncode != 0:
            raise Exception("FFmpeg encoding failed")

        # Ensure 100% progress for video encoding
        if progress_callback:
            progress_callback(total_frames, total_frames, 'video')

        return output_file
    except Exception as e:
        logging.error(f"Error creating video: {e}")
        raise