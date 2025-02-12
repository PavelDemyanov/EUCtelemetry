from PIL import Image, ImageDraw
import math

def interpolate_color(color1, color2, factor):
    """Interpolate between two colors using the given factor (0-1)."""
    return tuple(int(color1[i] + (color2[i] - color1[i]) * factor) for i in range(3))

def draw_speed_arc(speed, image_size=(400, 400), arc_width=40, output_path="output.png"):
    """
    Create a speed arc visualization.

    Args:
        speed (int): Current speed (0-100 km/h)
        image_size (tuple): Image dimensions (width, height)
        arc_width (int): Width of the arc
        output_path (str): Path to save the output PNG
    """
    # Mirror the angles (150° -> 210°, 390° -> -30° or 330°)
    start_angle = 210  # Mirrored from 150°
    end_angle = -30    # Mirrored from 390°

    # Calculate current angle based on speed
    speed = min(max(speed, 0), 100)  # Clamp speed between 0 and 100
    current_angle = start_angle + (end_angle - start_angle) * (speed / 100)

    # Define colors and determine arc color based on speed
    green = (0, 255, 0)
    yellow = (255, 255, 0)
    red = (255, 0, 0)

    if speed <= 70:
        # Green to Yellow transition (0-70 km/h)
        factor = speed / 70
        arc_color = interpolate_color(green, yellow, factor)
    elif speed <= 85:
        # Yellow to Red transition (70-85 km/h)
        factor = (speed - 70) / 15
        arc_color = interpolate_color(yellow, red, factor)
    else:
        # Solid Red (85-100 km/h)
        arc_color = red

    # Create image with transparent background
    img = Image.new("RGBA", image_size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Calculate arc bounds to fit in the center
    # Use 80% of the smallest dimension for the arc diameter
    size = min(image_size[0], image_size[1]) * 0.8
    margin = (size * 0.1)  # 10% margin

    # Calculate the bbox coordinates to center the arc
    left = (image_size[0] - size) / 2
    top = (image_size[1] - size) / 2
    right = left + size
    bottom = top + size

    bbox = [left, top, right, bottom]

    # Convert RGB tuple to string format that PIL accepts
    arc_color_str = "#{:02x}{:02x}{:02x}".format(*arc_color)

    # Draw the arc with rounded ends
    draw.arc(bbox, start=start_angle, end=current_angle, fill=arc_color_str, width=arc_width)

    # Save the image
    img.save(output_path, "PNG")
    return img

def test_all_speeds():
    """Test function to generate arcs for different speeds."""
    test_speeds = [0, 25, 50, 75, 100]
    for speed in test_speeds:
        output_path = f"speed_arc_{speed}.png"
        draw_speed_arc(speed, output_path=output_path)
        print(f"Generated arc for {speed} km/h: {output_path}")

if __name__ == "__main__":
    test_all_speeds()