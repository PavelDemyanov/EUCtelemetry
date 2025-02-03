import ffmpeg
import os
import logging

def create_video(project_id, fps=29.97, codec='h264'):
    try:
        frames_dir = f'frames/project_{project_id}'
        output_file = f'videos/project_{project_id}.mp4'
        
        # Ensure the videos directory exists
        os.makedirs('videos', exist_ok=True)
        
        # Build ffmpeg command
        stream = (
            ffmpeg
            .input(f'{frames_dir}/frame_%06d.png', r=fps)
            .output(output_file, vcodec=codec, pix_fmt='yuv420p')
            .overwrite_output()
        )
        
        # Run the ffmpeg command
        ffmpeg.run(stream, capture_stdout=True, capture_stderr=True)
        
        return output_file
    except ffmpeg.Error as e:
        logging.error(f"FFmpeg error: {e.stderr.decode()}")
        raise
    except Exception as e:
        logging.error(f"Error creating video: {e}")
        raise
