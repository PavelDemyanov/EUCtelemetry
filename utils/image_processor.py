from PIL import Image, ImageDraw, ImageFont
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

def create_speed_indicator(speed, size=500, speed_offset=(0, 0), unit_offset=(0, 0), speed_size=100, unit_size=100, indicator_scale=100):
    """
    Создает индикатор скорости в виде полукруглой дуги
    :param speed: Скорость (0-100 км/ч)
    :param size: Базовый размер изображения в пикселях
    :param speed_offset: Смещение текста скорости (x, y)
    :param unit_offset: Смещение текста единиц измерения (x, y)
    :param speed_size: Размер текста скорости в процентах (100 = стандартный)
    :param unit_size: Размер текста единиц измерения в процентах (100 = стандартный)
    :param indicator_scale: Общий масштаб индикатора в процентах (100 = стандартный)
    :return: PIL Image объект
    """
    # Применяем масштабирование к базовому размеру
    scaled_size = int(size * indicator_scale / 100)
    image = Image.new('RGBA', (scaled_size, scaled_size), (0, 0, 0, 0))

    # Если скорость равна 0, все равно отображаем шкалу и значение
    mask = Image.new('L', (scaled_size, scaled_size), 0)
    draw = ImageDraw.Draw(image)
    mask_draw = ImageDraw.Draw(mask)

    center = scaled_size // 2
    radius = scaled_size // 2 - 10
    start_angle = 150  # Начальный угол (0 км/ч) - 5 часов
    end_angle = 30     # Конечный угол (100 км/ч) - 1 час
    arc_width = int(20 * indicator_scale / 100)  # Масштабируем ширину дуги
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
    mask_draw.arc([10, 10, scaled_size-10, scaled_size-10], start=start_angle, end=current_angle, fill=255, width=arc_width)

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
    color_image = Image.new('RGBA', (scaled_size, scaled_size), color if isinstance(color, tuple) else color[:3] + (255,))

    # Применяем маску к цветному изображению
    color_image.putalpha(mask)

    # Накладываем цветное изображение на основное
    image = Image.alpha_composite(image, color_image)

    # Добавляем текст скорости
    draw = ImageDraw.Draw(image)

    # Применяем масштабирование к размерам шрифтов
    base_speed_font_size = int((scaled_size // 4) * speed_size / 100)
    base_unit_font_size = int((scaled_size // 8) * unit_size / 100)

    speed_font_size = base_speed_font_size
    unit_font_size = base_unit_font_size

    try:
        speed_font = ImageFont.truetype("fonts/sf-ui-display-bold.otf", speed_font_size)
        unit_font = ImageFont.truetype("fonts/sf-ui-display-regular.otf", unit_font_size)
    except Exception as e:
        raise ValueError(f"Error loading fonts: {str(e)}")

    # Отрисовка значения скорости
    speed_text = str(int(speed))
    speed_bbox = draw.textbbox((0, 0), speed_text, font=speed_font)
    speed_text_width = speed_bbox[2] - speed_bbox[0]
    speed_text_height = speed_bbox[3] - speed_bbox[1]

    # Отрисовка "KM/H"
    unit_text = "KM/H"
    unit_bbox = draw.textbbox((0, 0), unit_text, font=unit_font)
    unit_text_width = unit_bbox[2] - unit_bbox[0]
    unit_text_height = unit_bbox[3] - unit_bbox[1]

    # Позиционирование текста с учетом смещений
    speed_x = center - speed_text_width // 2
    speed_y = center - speed_text_height // 2 - unit_text_height // 2 + speed_offset[1]

    unit_x = center - unit_text_width // 2
    unit_y = speed_y + speed_text_height + 5 + unit_offset[1]  # Добавляем небольшой отступ между текстами

    # Рисуем тексты
    draw.text((speed_x, speed_y), speed_text, fill=(255, 255, 255, 255), font=speed_font)
    draw.text((unit_x, unit_y), unit_text, fill=(255, 255, 255, 255), font=unit_font)

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