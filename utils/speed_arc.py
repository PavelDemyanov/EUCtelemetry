from PIL import Image, ImageDraw
import math

def draw_speed_arc(speed: int, 
                  image_size: tuple = (800, 800),
                  arc_width: int = 20,
                  output_path: str = "output.png") -> None:
    """
    Draw a speed visualization arc.
    
    Args:
        speed: Current speed (0-100 km/h)
        image_size: Output image dimensions (width, height)
        arc_width: Thickness of the arc
        output_path: Where to save the output PNG
    """
    # Clamp speed to valid range
    speed = max(0, min(100, speed))
    
    # Create transparent image
    image = Image.new('RGBA', image_size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # Calculate dimensions
    width, height = image_size
    center = (width // 2, height // 2)
    radius = min(width, height) // 2 - arc_width
    
    # Calculate angles
    start_angle = 210  # Mirrored from 150°
    speed_angle = -30 + (speed * (240) / 100)  # Maps 0-100 to 210°→-30°
    
    # Calculate color based on speed
    if speed <= 70:
        # Green to Yellow (0,255,0) → (255,255,0)
        red = int((speed * 255) / 70)
        green = 255
        blue = 0
    elif speed <= 85:
        # Yellow to Red (255,255,0) → (255,0,0)
        red = 255
        green = int(255 * (85 - speed) / 15)
        blue = 0
    else:
        # Pure Red
        red = 255
        green = 0
        blue = 0
    
    # Convert angles to radians for PIL
    start_rad = math.radians(start_angle)
    end_rad = math.radians(speed_angle)
    
    # Draw the arc
    bbox = (center[0] - radius, center[1] - radius,
            center[0] + radius, center[1] + radius)
    
    draw.arc(bbox, start_angle, speed_angle, 
             fill=(red, green, blue, 255), width=arc_width)
    
    # Save the image
    image.save(output_path, 'PNG')
    return image

if __name__ == "__main__":
    # Test the function with different speeds
    test_speeds = [10, 50, 75, 100]
    for speed in test_speeds:
        draw_speed_arc(speed, output_path=f"speed_arc_{speed}.png")
