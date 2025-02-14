from PIL import Image, ImageDraw
import math

def interpolate_color(color1, color2, factor):
    """
    Интерполирует между двумя цветами с заданным фактором
    :param color1: Начальный цвет (R,G,B)
    :param color2: Конечный цвет (R,G,B)
    :param factor: Фактор интерполяции (0.0 - 1.0)
    :return: Интерполированный цвет (R,G,B)
    """
    r1, g1, b1 = color1[:3]
    r2, g2, b2 = color2[:3]
    r = int(r1 + (r2 - r1) * factor)
    g = int(g1 + (g2 - g1) * factor)
    b = int(b1 + (b2 - b1) * factor)
    return (r, g, b)

def create_speed_indicator(speed, size=500):
    """
    Создает индикатор скорости в виде полукруглой дуги
    :param speed: Скорость (0-100 км/ч)
    :param size: Размер изображения в пикселях
    :return: PIL Image объект
    """
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    
    # Если скорость равна 0, возвращаем пустое изображение
    if speed == 0:
        return image

    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(image)
    mask_draw = ImageDraw.Draw(mask)

    center = size // 2
    radius = size // 2 - 10
    start_angle = 150  # Начальный угол (0 км/ч) - 5 часов
    end_angle = 30     # Конечный угол (100 км/ч) - 1 час
    arc_width = 20
    corner_radius = arc_width // 2  # Радиус закругления

    # Определяем цвет в зависимости от скорости
    green = (0, 255, 0)
    yellow = (255, 255, 0)
    red = (255, 0, 0)

    if speed < 70:
        factor = speed / 70
        color = interpolate_color(green, yellow, factor)
    elif speed < 85:
        factor = (speed - 70) / 15
        color = interpolate_color(yellow, red, factor)
    else:
        color = red + (255,)  # Добавляем альфа-канал

    # Рассчитываем угол для текущей скорости
    if end_angle < start_angle:
        end_angle += 360
    current_angle = start_angle + (end_angle - start_angle) * (min(speed, 100) / 100)
    current_angle %= 360

    # Рисуем дугу на маске
    mask_draw.arc([10, 10, size-10, size-10], start=start_angle, end=current_angle, fill=255, width=arc_width)

    # Добавляем закругленные концы
    start_x = center + (radius - arc_width // 2) * math.cos(math.radians(start_angle))
    start_y = center + (radius - arc_width // 2) * math.sin(math.radians(start_angle))
    end_x = center + (radius - arc_width // 2) * math.cos(math.radians(current_angle))
    end_y = center + (radius - arc_width // 2) * math.sin(math.radians(current_angle))

    mask_draw.ellipse([start_x - corner_radius, start_y - corner_radius, 
                    start_x + corner_radius, start_y + corner_radius], fill=255)
    mask_draw.ellipse([end_x - corner_radius, end_y - corner_radius, 
                    end_x + corner_radius, end_y + corner_radius], fill=255)

    # Создаем цветное изображение
    color_image = Image.new('RGBA', (size, size), color if isinstance(color, tuple) else color[:3] + (255,))

    # Применяем маску к цветному изображению
    color_image.putalpha(mask)

    # Накладываем цветное изображение на основное
    image = Image.alpha_composite(image, color_image)

    return image

def overlay_speed_indicator(base_image, speed, position=(0, 0), size=500):
    """
    Накладывает индикатор скорости на базовое изображение
    :param base_image: Базовое изображение (PIL Image)
    :param speed: Скорость для отображения
    :param position: Позиция для размещения индикатора (x, y)
    :param size: Размер индикатора
    :return: PIL Image с наложенным индикатором
    """
    speed_indicator = create_speed_indicator(speed, size)
    if base_image.mode != 'RGBA':
        base_image = base_image.convert('RGBA')
    base_image.paste(speed_indicator, position, speed_indicator)
    return base_image
