from PIL import Image, ImageDraw
import math

def draw_speed_arc(speed: int, image_size: tuple = (800, 800), arc_width: int = 20) -> Image.Image:
    """
    Draw a speed arc visualization.
    
    Args:
        speed: Current speed (0-100 km/h)
        image_size: Output image dimensions (width, height)
        arc_width: Width of the arc in pixels
        
    Returns:
        PIL Image with the drawn arc
    """
    # Create transparent image
    img = Image.new('RGBA', image_size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Calculate dimensions
    width, height = image_size
    center = (width // 2, height - height // 6)  # Position arc at bottom
    radius = min(width, height) // 3
    
    # Calculate arc angles (mirrored horizontally)
    start_angle = 210  # 150° mirrored becomes 210°
    max_angle = -30   # 390° mirrored becomes -30°
    current_angle = start_angle - (speed / 100) * (start_angle - max_angle)
    
    # Calculate color based on speed
    if speed <= 70:
        # Green to Yellow gradient (0-70 km/h)
        green = 255
        red = int((speed / 70) * 255)
        color = (red, green, 0)
    elif speed <= 85:
        # Yellow to Red gradient (70-85 km/h)
        red = 255
        green = int(255 * (1 - (speed - 70) / 15))
        color = (red, green, 0)
    else:
        # Pure Red (85-100 km/h)
        color = (255, 0, 0)
    
    # Convert angles to radians for PIL
    start_rad = math.radians(start_angle)
    end_rad = math.radians(current_angle)
    
    # Calculate bounding box for the arc
    bbox = [
        center[0] - radius,
        center[1] - radius,
        center[0] + radius,
        center[1] + radius
    ]
    
    # Draw the arc with rounded ends
    draw.arc(bbox, start_angle, current_angle, fill=color, width=arc_width)
    
    # Draw rounded ends
    end_points = [
        (
            center[0] + radius * math.cos(math.radians(angle)),
            center[1] + radius * math.sin(math.radians(angle))
        )
        for angle in [start_angle, current_angle]
    ]
    
    for point in end_points:
        draw.ellipse([
            point[0] - arc_width//2,
            point[1] - arc_width//2,
            point[0] + arc_width//2,
            point[1] + arc_width//2
        ], fill=color)
    
    return img

def overlay_speed_arc(base_image: Image.Image, speed: int, arc_width: int = 20) -> Image.Image:
    """
    Overlay speed arc on an existing image.
    
    Args:
        base_image: Base image to overlay the arc on
        speed: Current speed (0-100 km/h)
        arc_width: Width of the arc in pixels
        
    Returns:
        PIL Image with overlaid speed arc
    """
    # Create speed arc with same dimensions as base image
    arc_image = draw_speed_arc(speed, base_image.size, arc_width)
    
    # Create new image with alpha channel
    result = Image.new('RGBA', base_image.size)
    
    # Paste base image and overlay arc
    result.paste(base_image, (0, 0))
    result.alpha_composite(arc_image)
    
    return result
