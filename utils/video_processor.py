import pandas as pd
from PIL import Image
import os
from .image_processor import overlay_speed_indicator

def process_frames_with_speed(csv_path, frames_folder, output_folder, indicator_size=500, indicator_position=(50, 50)):
    """
    Обрабатывает кадры, накладывая на них индикатор скорости на основе данных из CSV
    :param csv_path: Путь к CSV файлу с данными о скорости
    :param frames_folder: Папка с исходными кадрами
    :param output_folder: Папка для сохранения обработанных кадров
    :param indicator_size: Размер индикатора скорости
    :param indicator_position: Позиция индикатора на кадре (x, y)
    """
    # Создаем выходную директорию, если она не существует
    os.makedirs(output_folder, exist_ok=True)
    
    # Загружаем данные о скорости из CSV
    df = pd.read_csv(csv_path)
    
    # Получаем список файлов кадров
    frame_files = sorted([f for f in os.listdir(frames_folder) if f.endswith(('.png', '.jpg', '.jpeg'))])
    
    # Проверяем, что количество кадров совпадает с количеством записей в CSV
    if len(frame_files) != len(df):
        raise ValueError(f"Количество кадров ({len(frame_files)}) не совпадает с количеством записей в CSV ({len(df)})")
    
    # Обрабатываем каждый кадр
    for i, frame_file in enumerate(frame_files):
        # Получаем скорость из CSV
        speed = df.iloc[i]['speed']
        
        # Загружаем кадр
        frame_path = os.path.join(frames_folder, frame_file)
        frame = Image.open(frame_path)
        
        # Накладываем индикатор скорости
        processed_frame = overlay_speed_indicator(frame, speed, indicator_position, indicator_size)
        
        # Сохраняем обработанный кадр
        output_path = os.path.join(output_folder, frame_file)
        processed_frame.save(output_path, 'PNG')
