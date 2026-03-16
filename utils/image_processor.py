import math
from PIL import Image, ImageDraw, ImageFont

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


def create_speed_indicator(speed,
                           size=500,
                           speed_offset=(0, 0),
                           unit_offset=(0, 0),
                           speed_size=100,
                           unit_size=100,
                           indicator_scale=100,
                           resolution='fullhd',
                           locale='en',
                           show_background_arc=False):
    """
    Создает индикатор скорости в виде полукруглой дуги
    :param speed: Скорость (0-100 км/ч)
    :param size: Базовый размер изображения в пикселях
    :param speed_offset: Смещение текста скорости (x, y)
    :param unit_offset: Смещение текста единиц измерения (x, y)
    :param speed_size: Размер текста скорости в процентах (100 = стандартный)
    :param unit_size: Размер текста единиц измерения в процентах (100 = стандартный)
    :param indicator_scale: Масштаб дуги в процентах (100 = стандартный)
    :param resolution: Разрешение кадра ('fullhd' или '4k')
    :param locale: Язык локализации ('en' или 'ru')
    :return: PIL Image объект
    """
    # Создаем изображение стандартного размера (не масштабированное)
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    # Создаем маску для дуги с учетом масштаба
    arc_size = int(size * indicator_scale / 100)
    mask = Image.new('L', (arc_size, arc_size), 0)
    mask_draw = ImageDraw.Draw(mask)

    # Центр и радиус для дуги
    arc_center = arc_size // 2
    arc_radius = arc_size // 2 - 10

    # Параметры дуги
    start_angle = 150  # Начальный угол (0 км/ч)
    end_angle = 30  # Конечный угол (100 км/ч)

    # Масштабируем толщину дуги в зависимости от разрешения
    base_width = 20  # Базовая толщина для Full HD
    if resolution == '4k':
        base_width *= 2  # Удваиваем толщину для 4K

    arc_width = int(base_width * indicator_scale /
                    100)  # Применяем масштаб пользователя
    corner_radius = arc_width // 2

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
        color = red + (255,)

    # Рассчитываем угол для текущей скорости
    if end_angle < start_angle:
        end_angle += 360
    current_angle = start_angle + (end_angle -
                                   start_angle) * (min(speed, 100) / 100)
    current_angle %= 360

    # Рисуем дугу на маске
    mask_draw.arc([10, 10, arc_size - 10, arc_size - 10],
                  start=start_angle,
                  end=current_angle,
                  fill=255,
                  width=arc_width)

    # Добавляем закругленные концы
    start_x = arc_center + (arc_radius - arc_width // 2) * math.cos(
        math.radians(start_angle))
    start_y = arc_center + (arc_radius - arc_width // 2) * math.sin(
        math.radians(start_angle))
    end_x = arc_center + (arc_radius - arc_width // 2) * math.cos(
        math.radians(current_angle))
    end_y = arc_center + (arc_radius - arc_width // 2) * math.sin(
        math.radians(current_angle))

    mask_draw.ellipse([
        start_x - corner_radius, start_y - corner_radius,
        start_x + corner_radius, start_y + corner_radius
    ],
                      fill=255)
    mask_draw.ellipse([
        end_x - corner_radius, end_y - corner_radius, end_x + corner_radius,
        end_y + corner_radius
    ],
                      fill=255)

    # Создаем цветное изображение для дуги
    color_image = Image.new(
        'RGBA', (arc_size, arc_size),
        color if isinstance(color, tuple) else color[:3] + (255,))
    color_image.putalpha(mask)

    # Создаем финальное изображение с правильным размером
    final_image = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    # Draw background arc (gauge track) if enabled — matches Canvas preview
    if show_background_arc:
        bg_arc_img = Image.new('RGBA', (arc_size, arc_size), (0, 0, 0, 0))
        bg_draw = ImageDraw.Draw(bg_arc_img)
        # Full gauge range: 150° to 390° (same as Canvas degToRad(150) to degToRad(390))
        bg_draw.arc([10, 10, arc_size - 10, arc_size - 10],
                    start=150, end=390,
                    fill=(60, 60, 60, 128),  # rgba(60,60,60,0.5)
                    width=arc_width)
        # Rounded ends for background arc
        bg_start_angle = 150
        bg_end_angle = 390
        for angle in [bg_start_angle, bg_end_angle]:
            ex = arc_center + (arc_radius - arc_width // 2) * math.cos(math.radians(angle))
            ey = arc_center + (arc_radius - arc_width // 2) * math.sin(math.radians(angle))
            bg_draw.ellipse([ex - corner_radius, ey - corner_radius,
                             ex + corner_radius, ey + corner_radius],
                            fill=(60, 60, 60, 128))
        bg_paste_x = (size - arc_size) // 2
        bg_paste_y = (size - arc_size) // 2
        final_image.paste(bg_arc_img, (bg_paste_x, bg_paste_y), bg_arc_img)

    # Центрируем дугу на финальном изображении
    paste_x = (size - arc_size) // 2
    paste_y = (size - arc_size) // 2
    final_image.paste(color_image, (paste_x, paste_y), color_image)

    # Добавляем текст скорости (размер теперь зависит от разрешения)
    draw = ImageDraw.Draw(final_image)

    # Масштабируем базовые размеры шрифта в зависимости от разрешения
    resolution_scale = 1.0  #Always 1.0 now
    base_speed_font_size = int(
        (size // 4) * speed_size / 100 * resolution_scale)
    base_unit_font_size = int((size // 8) * unit_size / 100 * resolution_scale)

    try:
        speed_font = ImageFont.truetype("fonts/sf-ui-display-bold.otf",
                                        base_speed_font_size)
        unit_font = ImageFont.truetype("fonts/sf-ui-display-regular.otf",
                                       base_unit_font_size)
    except Exception as e:
        raise ValueError(f"Error loading fonts: {str(e)}")

    # Отрисовка значения скорости
    speed_text = str(int(speed))
    speed_bbox = draw.textbbox((0, 0), speed_text, font=speed_font)
    speed_text_width = speed_bbox[2] - speed_bbox[0]
    speed_text_height = speed_bbox[3] - speed_bbox[1]

    # Отрисовка "KM/H" или "КМ/Ч" в зависимости от локали
    unit_text = "КМ/Ч" if locale == 'ru' else "KM/H"
    unit_bbox = draw.textbbox((0, 0), unit_text, font=unit_font)
    unit_text_width = unit_bbox[2] - unit_bbox[0]
    unit_text_height = unit_bbox[3] - unit_bbox[1]

    # Scale offsets for positioning
    center = size // 2

    if show_background_arc:
        # Video Editor mode: match Canvas positioning exactly
        # Frontend uses offset * sf where sf = canvasWidth/1920
        # Gauge image is size px, equivalent to baseSize=250 at sf=1
        # So offset_scale = size / 250.0 to match frontend proportions
        offset_scale = size / 250.0
        scaled_speed_y = int(speed_offset[1] * offset_scale)
        scaled_unit_y = int(unit_offset[1] * offset_scale)

        # IMPORTANT: Pillow textbbox returns y0 != 0 (font ascent offset).
        # draw.text() positions from font origin, so actual pixels start at y + bbox[1].
        # We must subtract bbox[1] to center on the ACTUAL rendered pixels.
        speed_y0_offset = speed_bbox[1]  # typically ~40px for large bold font
        unit_y0_offset = unit_bbox[1]    # typically ~14px

        # Canvas: speed text centered at (gaugeCenter + speed_y * sf), textBaseline=middle
        speed_x = center - speed_text_width // 2
        speed_visual_center = center + scaled_speed_y
        speed_y = speed_visual_center - speed_text_height // 2 - speed_y0_offset

        # Canvas: KM/H at (gaugeCenter + speedFontSize/2 + unitFontSize/2 + unit_y * sf)
        unit_x = center - unit_text_width // 2
        unit_visual_center = center + base_speed_font_size // 2 + base_unit_font_size // 2 + scaled_unit_y
        unit_y = unit_visual_center - unit_text_height // 2 - unit_y0_offset
    else:
        # Classic mode: legacy positioning (group speed+unit centered)
        scaled_speed_offset_y = int(speed_offset[1] * resolution_scale)
        scaled_unit_offset_y = int(unit_offset[1] * resolution_scale)

        speed_x = center - speed_text_width // 2
        speed_y = center - speed_text_height // 2 - unit_text_height // 2 + scaled_speed_offset_y

        unit_x = center - unit_text_width // 2
        unit_y = speed_y + speed_text_height + 5 + scaled_unit_offset_y

    # Рисуем тексты
    draw.text((speed_x, speed_y),
              speed_text,
              fill=(255, 255, 255, 255),
              font=speed_font)
    draw.text((unit_x, unit_y),
              unit_text,
              fill=(255, 255, 255, 255),
              font=unit_font)

    return final_image


def overlay_speed_indicator(base_image,
                            speed,
                            position=(0, 0),
                            size=500,
                            speed_offset=(0, 0),
                            unit_offset=(0, 0),
                            speed_size=100,
                            unit_size=100,
                            indicator_scale=100,
                            resolution='fullhd',
                            locale='en'):
    """
    Накладывает индикатор скорости на базовое изображение
    :param base_image: Базовое изображение (PIL Image)
    :param speed: Скорость для отображения
    :param position: Позиция для размещения индикатора (x, y)
    :param size: Размер индикатора
    :param speed_offset: Смещение текста скорости
    :param unit_offset: Смещение текста единиц измерения
    :param speed_size: Размер текста скорости в процентах (100 = стандартный)
    :param unit_size: Размер текста единиц измерения в процентах (100 = стандартный)
    :param indicator_scale: Общий масштаб индикатора в процентах (100 = стандартный)
    :param resolution: Разрешение кадра ('fullhd' или '4k')
    :param locale: Язык локализации ('en' или 'ru')
    :return: PIL Image с наложенным индикатором
    """
    speed_indicator = create_speed_indicator(speed, size, speed_offset,
                                             unit_offset, speed_size,
                                             unit_size, indicator_scale,
                                             resolution, locale)
    if base_image.mode != 'RGBA':
        base_image = base_image.convert('RGBA')
    base_image.paste(speed_indicator, position, speed_indicator)
    return base_image