import platform
import subprocess
import logging

# Global cache for hardware detection
_is_apple_silicon_cache = None
_hardware_info_cache = None

def is_apple_silicon():
    """
    Detect if the current machine is running on Apple Silicon (M1/M2/etc)
    Result is cached after first check
    """
    global _is_apple_silicon_cache

    if _is_apple_silicon_cache is not None:
        return _is_apple_silicon_cache

    try:
        if platform.system() != 'Darwin':
            _is_apple_silicon_cache = False
            return False

        # Run sysctl to get CPU brand
        result = subprocess.run(['sysctl', '-n', 'machdep.cpu.brand_string'], 
                              capture_output=True, text=True)

        _is_apple_silicon_cache = 'Apple' in result.stdout
        if _is_apple_silicon_cache:
            logging.info("Apple Silicon detected (cached)")

        return _is_apple_silicon_cache
    except Exception as e:
        logging.error(f"Error detecting hardware: {e}")
        _is_apple_silicon_cache = False
        return False

def get_hardware_info():
    """
    Get detailed hardware information for logging purposes
    Result is cached after first call
    """
    global _hardware_info_cache

    if _hardware_info_cache is not None:
        return _hardware_info_cache

    _hardware_info_cache = {
        'platform': platform.platform(),
        'machine': platform.machine(),
        'processor': platform.processor(),
        'is_apple_silicon': is_apple_silicon()
    }

    logging.debug(f"Hardware info cached: {_hardware_info_cache}")
    return _hardware_info_cache