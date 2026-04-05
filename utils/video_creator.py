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


def create_composite_video(source_video, overlay_frames_dir, output_file, fps=29.97, codec='h264', progress_callback=None, source_width=None, source_height=None, bitrate=None):
    """Composite overlay frames onto source video using FFmpeg overlay filter.
    Preserves audio from source video."""
    try:
        os.makedirs(os.path.dirname(output_file) or '.', exist_ok=True)

        # Get overlay frame count
        frame_files = sorted([f for f in os.listdir(overlay_frames_dir) if f.startswith('frame_') and f.endswith('.png')])
        total_frames = len(frame_files)
        if total_frames == 0:
            raise ValueError('No overlay frames found')

        # Determine encoder
        if is_apple_silicon():
            encoder = 'h264_videotoolbox' if codec == 'h264' else 'hevc_videotoolbox'
        else:
            encoder = 'libx264' if codec == 'h264' else 'libx265'

        if not bitrate:
            bitrate = '12M'

        command = ['ffmpeg', '-y']

        # Hardware acceleration for decoding (Apple Silicon)
        if is_apple_silicon():
            command.extend(['-hwaccel', 'videotoolbox'])

        # Input: source video
        command.extend(['-i', source_video])

        # Input: overlay image sequence at specified FPS
        command.extend([
            '-framerate', str(fps),
            '-i', os.path.join(overlay_frames_dir, 'frame_%06d.png'),
        ])

        # Filter: scale overlay to match source video, then overlay with alpha
        if source_width and source_height:
            filter_str = f'[1:v]scale={source_width}:{source_height}[ov];[0:v][ov]overlay=0:0:shortest=1'
        else:
            filter_str = '[0:v][1:v]overlay=0:0:shortest=1'
        command.extend([
            '-filter_complex', filter_str,
        ])

        # Encoder settings
        if is_apple_silicon():
            command.extend([
                '-c:v', encoder,
                '-allow_sw', '1',
                '-b:v', bitrate,
                '-profile:v', 'main',
                '-pix_fmt', 'yuv420p',
            ])
            if codec == 'h265':
                command.extend(['-tag:v', 'hvc1'])
            else:
                command.extend(['-tag:v', 'avc1'])
        else:
            command.extend([
                '-c:v', encoder,
                '-pix_fmt', 'yuv420p',
            ])
            if codec == 'h264':
                command.extend(['-preset', 'medium', '-crf', '23'])
            else:
                command.extend(['-preset', 'medium', '-crf', '28', '-tag:v', 'hvc1'])

        # Copy audio from source
        command.extend(['-c:a', 'copy'])

        command.append(output_file)

        logging.info(f"FFmpeg composite command: {' '.join(command)}")

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            bufsize=1
        )

        frame_pattern = re.compile(r'frame=\s*(\d+)')
        error_output = []

        while True:
            line = process.stderr.readline()
            if not line and process.poll() is not None:
                break
            error_output.append(line)
            frame_match = frame_pattern.search(line)
            if frame_match and progress_callback:
                current_frame = int(frame_match.group(1))
                progress_callback(current_frame, total_frames, 'video')

        if process.returncode != 0:
            error_msg = ''.join(error_output)
            logging.error(f"FFmpeg composite error: {error_msg}")
            raise Exception(f"FFmpeg composite failed: {error_msg}")

        if progress_callback:
            progress_callback(total_frames, total_frames, 'video')

        return output_file

    except Exception as e:
        logging.error(f"Error creating composite video: {e}")
        raise


def create_video_from_frames(frames_dir, output_file, fps=29.97, codec='h264',
                              width=1920, height=1080, progress_callback=None, bitrate=None):
    """Create video directly from PNG frames (no source video, no overlay).
    Used for chroma-key / no-video mode in Video Editor."""
    try:
        os.makedirs(os.path.dirname(output_file) or '.', exist_ok=True)

        frame_files = sorted([f for f in os.listdir(frames_dir) if f.startswith('frame_') and f.endswith('.png')])
        total_frames = len(frame_files)
        if total_frames == 0:
            raise ValueError('No frames found')

        if is_apple_silicon():
            encoder = 'h264_videotoolbox' if codec == 'h264' else 'hevc_videotoolbox'
        else:
            encoder = 'libx264' if codec == 'h264' else 'libx265'

        if not bitrate:
            bitrate = '12M'

        command = [
            'ffmpeg', '-y',
            '-framerate', str(fps),
            '-i', os.path.join(frames_dir, 'frame_%06d.png'),
            '-c:v', encoder,
        ]

        if is_apple_silicon():
            command.extend(['-allow_sw', '1'])

        command.extend([
            '-b:v', bitrate,
            '-profile:v', 'main',
            '-pix_fmt', 'yuv420p',
            '-tag:v', 'avc1' if codec == 'h264' else 'hvc1',
            output_file
        ])

        logging.info(f'FFmpeg frames-only command: {" ".join(command)}')

        import re
        frame_pattern = re.compile(r'frame=\s*(\d+)')

        process = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True
        )

        error_output = []
        for line in process.stderr:
            if 'Error' in line or 'error' in line:
                logging.error(f"FFmpeg: {line.strip()}")
            error_output.append(line)
            frame_match = frame_pattern.search(line)
            if frame_match and progress_callback:
                current_frame = int(frame_match.group(1))
                progress_callback(current_frame, total_frames, 'video')

        process.wait()

        if process.returncode != 0:
            error_msg = ''.join(error_output)
            logging.error(f"FFmpeg frames-only error: {error_msg}")
            raise Exception(f"FFmpeg frames-only failed: {error_msg}")

        if progress_callback:
            progress_callback(total_frames, total_frames, 'video')

        return output_file

    except Exception as e:
        logging.error(f"Error creating video from frames: {e}")
        raise
