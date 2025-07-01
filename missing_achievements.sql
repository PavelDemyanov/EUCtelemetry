-- SQL script to add missing achievements to production database
-- Run this only if achievements are still missing after code deployment

INSERT INTO achievement (achievement_id, title, description, icon, formula, is_active, created_at, updated_at)
VALUES 
    ('sleep', 'Sleep', 'You''re a sleepy rider — your maximum speed was only 15 km/h!', 'sleep.svg', 'max_speed <= 15', true, NOW(), NOW()),
    ('fast', 'Fast', 'You''re a fast rider — you hit 70 km/h!', 'fast.svg', 'max_speed >= 70', true, NOW(), NOW()),
    ('superfast', 'Super Fast', 'You''re a super fast rider — you hit 100 km/h!', 'superfast.svg', 'max_speed >= 100', true, NOW(), NOW()),
    ('suicidalmadman', 'Suicidal madman', 'You''re a suicidal madman — you hit 150 km/h!', 'suicidalmadman.svg', 'max_speed >= 150', true, NOW(), NOW()),
    ('dead', 'Dead', 'You''re dead — you hit 200 km/h!', 'dead.svg', 'max_speed >= 200', true, NOW(), NOW())
ON CONFLICT (achievement_id) DO NOTHING;

-- Verify all achievements are present
SELECT achievement_id, title, is_active FROM achievement ORDER BY achievement_id;