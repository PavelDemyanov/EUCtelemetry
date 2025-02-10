import platform
import subprocess
import logging

def is_apple_silicon():
    """
    Detect if the current machine is running on Apple Silicon (M1/M2/etc)
    """
    try:
        if platform.system() != 'Darwin':
            return False
        
        # Run sysctl to get CPU brand
        result = subprocess.run(['sysctl', '-n', 'machdep.cpu.brand_string'], 
                              capture_output=True, text=True)
        
        if 'Apple' in result.stdout:
            logging.info("Apple Silicon detected")
            return True
            
        return False
    except Exception as e:
        logging.error(f"Error detecting hardware: {e}")
        return False

def get_hardware_info():
    """
    Get detailed hardware information for logging purposes
    """
    info = {
        'platform': platform.platform(),
        'machine': platform.machine(),
        'processor': platform.processor(),
        'is_apple_silicon': False
    }
    
    try:
        info['is_apple_silicon'] = is_apple_silicon()
    except Exception as e:
        logging.error(f"Error getting hardware info: {e}")
    
    return info
