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
            bitrate = '20M'  # Higher bitrate for 4K
        else:  # fullhd
            width, height = 1920, 1080
            bitrate = '8M'  # Standard bitrate for 1080p

        logging.info(f"Creating video with fps={fps}, codec={codec}, resolution={resolution}")

        # Build ffmpeg command with hardware acceleration if available
        command = ['ffmpeg', '-y']  # Overwrite output file

        # Check for Apple Silicon and configure hardware acceleration
        if is_apple_silicon():
            logging.info("Using Apple Silicon hardware acceleration (VideoToolbox)")
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
                encoder = 'hevc_videotoolbox'  # Use VideoToolbox hardware encoder for HEVC

            # Configure hardware encoder settings
            command.extend([
                '-r', str(fps),
                '-i', f'{frames_dir}/frame_%06d.png',
                '-c:v', encoder,
                '-allow_sw', '1',  # Allow software fallback if needed
                '-b:v', bitrate,
                '-maxrate', bitrate,
                '-bufsize', bitrate,
                '-profile:v', 'main',  # Use main profile for better compatibility
                '-pix_fmt', 'yuv420p',
                '-s', f'{width}x{height}'
            ])

            # Add specific settings for HEVC/H265
            if codec == 'h265':
                command.extend([
                    '-tag:v', 'hvc1',  # Use proper HEVC tag for better compatibility
                    '-alpha_quality', '0',  # Disable alpha channel encoding
                    '-vtag', 'hvc1'  # Additional tag for HEVC
                ])
            else:
                command.extend([
                    '-tag:v', 'avc1'  # Use proper H.264 tag
                ])
        else:
            # Software encoding configuration
            command.extend([
                '-r', str(fps),
                '-i', f'{frames_dir}/frame_%06d.png',
                '-c:v', encoder,
                '-pix_fmt', 'yuv420p',
                '-s', f'{width}x{height}'
            ])

            # Add codec-specific quality settings for software encoding
            if codec == 'h264':
                command.extend([
                    '-preset', 'medium',  # Balance between speed and quality
                    '-crf', '23'  # Constant Rate Factor (lower = better quality)
                ])
            else:  # h265
                command.extend([
                    '-preset', 'medium',
                    '-crf', '28',  # HEVC typically uses higher CRF values
                    '-tag:v', 'hvc1'  # Use proper HEVC tag
                ])

        # Add output file
        command.append(output_file)

        # Log the complete ffmpeg command for debugging
        logging.info(f"FFmpeg command: {' '.join(command)}")

        # Get total frame count for progress calculation
        frame_files = [f for f in os.listdir(frames_dir) if f.startswith('frame_') and f.endswith('.png')]
        total_frames = len(frame_files)

        # Run ffmpeg with progress monitoring
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            bufsize=1
        )

        # Track progress
        frame_pattern = re.compile(r'frame=\s*(\d+)')
        current_frame = 0
        error_output = []

        # Read stderr line by line
        while True:
            line = process.stderr.readline()
            if not line and process.poll() is not None:
                break

            error_output.append(line)
            frame_match = frame_pattern.search(line)
            if frame_match:
                current_frame = int(frame_match.group(1))
                if progress_callback:
                    progress_callback(current_frame, total_frames, 'video')
            logging.debug(f"FFmpeg output: {line.strip()}")

        # Check process return code
        if process.returncode != 0:
            error_msg = ''.join(error_output)
            logging.error(f"FFmpeg error output: {error_msg}")
            raise Exception(f"FFmpeg encoding failed: {error_msg}")

        # Ensure 100% progress for video encoding
        if progress_callback:
            progress_callback(total_frames, total_frames, 'video')

        return output_file
    except Exception as e:
        logging.error(f"Error creating video: {e}")
        raise