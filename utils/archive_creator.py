import os
import zipfile
import logging
from datetime import datetime

def create_png_archive(project_id, project_folder_number, project_name):
    """Create a ZIP archive of PNG frames for a project"""
    try:
        # Define paths
        frames_dir = f'frames/project_{project_folder_number}'
        archive_filename = f'project_{project_id}_frames.zip'
        archive_path = os.path.join('archives', archive_filename)
        
        # Create archives directory if it doesn't exist
        os.makedirs('archives', exist_ok=True)
        
        # Check if frames directory exists
        if not os.path.exists(frames_dir):
            logging.error(f"Frames directory not found: {frames_dir}")
            return None
        
        # Get all PNG files from the frames directory
        png_files = [f for f in os.listdir(frames_dir) if f.lower().endswith('.png')]
        
        if not png_files:
            logging.error(f"No PNG files found in {frames_dir}")
            return None
        
        # Estimate archive size before creating (rough estimate: PNG files are usually large)
        total_size = 0
        for png_file in png_files:
            file_path = os.path.join(frames_dir, png_file)
            if os.path.exists(file_path):
                total_size += os.path.getsize(file_path)
        
        # Check if estimated size exceeds limit (100MB)
        max_size = 100 * 1024 * 1024  # 100MB
        if total_size > max_size:
            size_mb = total_size / (1024 * 1024)
            logging.warning(f"Archive would be too large: {size_mb:.1f}MB (limit: 100MB). Skipping creation.")
            return f"TOO_LARGE:{size_mb:.1f}"  # Return size info with the error
        
        # Create ZIP archive
        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for png_file in sorted(png_files):
                file_path = os.path.join(frames_dir, png_file)
                # Add file to archive with a clean name
                zipf.write(file_path, png_file)
        
        # Verify final archive size
        final_size = os.path.getsize(archive_path)
        if final_size > max_size:
            # Remove the archive if it's too large
            os.remove(archive_path)
            size_mb = final_size / (1024 * 1024)
            logging.warning(f"Created archive was too large: {size_mb:.1f}MB (limit: 100MB). Removed.")
            return f"TOO_LARGE:{size_mb:.1f}"
        
        logging.info(f"Created PNG archive: {archive_path} with {len(png_files)} files ({final_size / (1024*1024):.1f}MB)")
        return archive_filename
        
    except Exception as e:
        logging.error(f"Error creating PNG archive: {str(e)}")
        return None

def delete_png_archive(archive_filename):
    """Delete PNG archive file"""
    try:
        if archive_filename:
            archive_path = os.path.join('archives', archive_filename)
            if os.path.exists(archive_path):
                os.remove(archive_path)
                logging.info(f"Deleted PNG archive: {archive_path}")
                return True
        return True
    except Exception as e:
        logging.error(f"Error deleting PNG archive: {str(e)}")
        return False