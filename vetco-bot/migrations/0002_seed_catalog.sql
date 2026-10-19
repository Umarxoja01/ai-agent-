-- Starting catalog from Umar's product library (_LIBRARY/PRODUCTS, 2026-09-17).
-- Prices are unknown (NULL = "price on request"). Doses are Umar's words, not checked
-- against the official instructions, so dose_verified = 0 and the bot does not show them.
-- The last four have only a photo in the library: inactive until VETCO fills them in.
-- After the first catalog sync from Google Sheets this data is replaced by the sheet.

INSERT INTO products (id, sort, category, category_uz, category_ru, name, name_ru, maker, form_uz, form_ru, ingredient, dose_uz, dose_ru, dose_verified, unit_uz, unit_ru, price, in_stock, active, alternatives, updated_at) VALUES
('bistrepen', 10, 'antibiotik', 'Antibiotiklar', 'Антибиотики', 'Bistrepen', 'Бистрепен', 'Brovafarma', 'Inʼeksiya uchun suspenziya, 100 ml', 'Суспензия для инъекций, 100 мл', NULL, 'Qoʻy, echki: 1 ml / 10 kg tirik vazn; mol: 1 ml / 20 kg tirik vazn', 'Овцы, козы: 1 мл / 10 кг живой массы; КРС: 1 мл / 20 кг живой массы', 0, 'flakon', 'флакон', NULL, 1, 1, NULL, '2026-09-17T00:00:00.000Z'),
('kefen', 20, 'ogriq', 'Ogʻriq qoldiruvchi va isitma tushiruvchi', 'Обезболивающие и жаропонижающие', 'Kefen', 'Кефен', 'Brovafarma', 'Inʼeksiya eritmasi, 100 ml', 'Раствор для инъекций, 100 мл', 'ketoprofen', '4 ml / 100 kg tirik vazn', '4 мл / 100 кг живой массы', 0, 'flakon', 'флакон', NULL, 1, 1, 'fluneks', '2026-09-17T00:00:00.000Z'),
('fluneks', 30, 'ogriq', 'Ogʻriq qoldiruvchi va isitma tushiruvchi', 'Обезболивающие и жаропонижающие', 'Fluneks', 'Флунекс', 'NITA-FARM', 'Flakon, 100 ml', 'Флакон, 100 мл', 'flunixin meglumine', '4 ml / 100 kg tirik vazn', '4 мл / 100 кг живой массы', 0, 'flakon', 'флакон', NULL, 1, 1, 'kefen', '2026-09-17T00:00:00.000Z'),
('butofan', 40, 'vitamin', 'Vitaminlar', 'Витамины', 'Butofan', 'Бутофан', 'NITA-FARM', 'Flakon, 100 ml', 'Флакон, 100 мл', 'butaphosphan, cyanocobalamin', '1 ml / 20 kg tirik vazn', '1 мл / 20 кг живой массы', 0, 'flakon', 'флакон', NULL, 1, 1, 'fosbevit', '2026-09-17T00:00:00.000Z'),
('fosbevit', 50, 'vitamin', 'Vitaminlar', 'Витамины', 'Fos-Bevit', 'Фос-Бевит', 'Brovafarma', 'Inʼeksiya eritmasi, 100 ml', 'Раствор для инъекций, 100 мл', NULL, '1 ml / 20 kg tirik vazn', '1 мл / 20 кг живой массы', 0, 'flakon', 'флакон', NULL, 1, 1, 'butofan', '2026-09-17T00:00:00.000Z'),
('azitronit', 60, 'boshqa', 'Boshqa preparatlar', 'Другие препараты', 'Azitronit', 'Азитронит', NULL, NULL, NULL, NULL, NULL, NULL, 0, 'flakon', 'флакон', NULL, 1, 0, NULL, '2026-09-17T00:00:00.000Z'),
('tseftioklin', 70, 'boshqa', 'Boshqa preparatlar', 'Другие препараты', 'Tseftioklin', 'Цефтиоклин', NULL, NULL, NULL, NULL, NULL, NULL, 0, 'flakon', 'флакон', NULL, 1, 0, NULL, '2026-09-17T00:00:00.000Z'),
('kaltsiy_borglyukonat', 80, 'boshqa', 'Boshqa preparatlar', 'Другие препараты', 'Kalsiy borglyukonat', 'Кальция борглюконат', NULL, NULL, NULL, NULL, NULL, NULL, 0, 'flakon', 'флакон', NULL, 1, 0, NULL, '2026-09-17T00:00:00.000Z'),
('kofein_benzoat', 90, 'boshqa', 'Boshqa preparatlar', 'Другие препараты', 'Kofein-natriy benzoat', 'Кофеин-бензоат натрия', NULL, NULL, NULL, NULL, NULL, NULL, 0, 'flakon', 'флакон', NULL, 1, 0, NULL, '2026-09-17T00:00:00.000Z');
