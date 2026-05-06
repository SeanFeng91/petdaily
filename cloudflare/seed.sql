PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO "PetProfile" (
  "id", "name", "breed", "sex", "birthday", "avatarUrl", "currentWeight", "notes", "createdAt", "updatedAt"
) VALUES (
  'pet_doubao', '豆包', '西高地白梗', 'female', '2026-02-05T00:00:00.000Z', '/photos/westie-portrait.svg', 3.2,
  '3 个月幼犬，正在建立定点如厕、少量多餐和外出适应。',
  '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z'
);

INSERT OR IGNORE INTO "WeightRecord" ("id", "petId", "measuredAt", "weightKg", "note", "createdAt") VALUES
  ('weight_0421', 'pet_doubao', '2026-04-21T00:10:00.000Z', 2.82, '早餐前称重，记录条件保持一致。', '2026-05-05T00:00:00.000Z'),
  ('weight_0424', 'pet_doubao', '2026-04-24T00:10:00.000Z', 2.93, '早餐前称重，记录条件保持一致。', '2026-05-05T00:00:00.000Z'),
  ('weight_0427', 'pet_doubao', '2026-04-27T00:10:00.000Z', 3.02, '早餐前称重，记录条件保持一致。', '2026-05-05T00:00:00.000Z'),
  ('weight_0430', 'pet_doubao', '2026-04-30T00:10:00.000Z', 3.11, '早餐前称重，记录条件保持一致。', '2026-05-05T00:00:00.000Z'),
  ('weight_0503', 'pet_doubao', '2026-05-03T00:10:00.000Z', 3.2, '早餐前称重，记录条件保持一致。', '2026-05-05T00:00:00.000Z');

INSERT OR IGNORE INTO "Reminder" ("id", "petId", "kind", "title", "scheduledTime", "weekdays", "active", "nextDueAt", "note", "createdAt", "updatedAt") VALUES
  ('reminder_breakfast', 'pet_doubao', 'FOOD', '早餐 45g 幼犬粮', '07:30', '1,2,3,4,5,6,7', 1, NULL, '少量温水泡软，观察食欲。', '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z'),
  ('reminder_morning_potty', 'pet_doubao', 'POTTY', '早餐后外出如厕', '08:05', '1,2,3,4,5,6,7', 1, NULL, '饭后 15-30 分钟带到固定地点。', '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z'),
  ('reminder_training_snack', 'pet_doubao', 'FOOD', '午间训练零食', '12:30', '1,2,3,4,5,6,7', 1, NULL, '用于召回和坐下训练，不超过全天热量 10%。', '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z'),
  ('reminder_dinner', 'pet_doubao', 'FOOD', '晚餐 45g 幼犬粮', '18:30', '1,2,3,4,5,6,7', 1, NULL, '晚餐后避免剧烈运动。', '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z'),
  ('reminder_sleep_potty', 'pet_doubao', 'POTTY', '睡前如厕', '22:00', '1,2,3,4,5,6,7', 1, NULL, '降低夜间笼内尿垫压力。', '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z'),
  ('reminder_deworm', 'pet_doubao', 'DEWORM', '下一次体内外驱虫', '09:00', '1,2,3,4,5,6,7', 1, '2026-05-18T01:00:00.000Z', '按兽医建议确认剂量。', '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z');

INSERT OR IGNORE INTO "TimelineEvent" ("id", "petId", "type", "title", "note", "happenedAt", "amount", "unit", "metadata", "photoUrl", "createdAt") VALUES
  ('event_food_0504_am', 'pet_doubao', 'FOOD', '早餐完成', '幼犬粮泡软，5 分钟吃完。', '2026-05-03T23:38:00.000Z', 45, 'g', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_potty_0504_am', 'pet_doubao', 'POTTY', '饭后尿尿', '在楼下草地完成，奖励及时。', '2026-05-04T00:18:00.000Z', 1, '次', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_stool_0504_am', 'pet_doubao', 'STOOL', '便便成型', '颜色正常，形态偏软但成型。', '2026-05-04T00:32:00.000Z', 1, '次', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_note_0504', 'pet_doubao', 'NOTE', '笼内安静训练', '午睡前哼叫 2 分钟后安静。', '2026-05-04T06:20:00.000Z', NULL, NULL, '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_food_0504_pm', 'pet_doubao', 'FOOD', '晚餐完成', '食欲稳定。', '2026-05-04T10:35:00.000Z', 45, 'g', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_potty_0504_pm', 'pet_doubao', 'POTTY', '睡前尿尿', '固定口令有效。', '2026-05-04T14:08:00.000Z', 1, '次', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_weight_0503', 'pet_doubao', 'WEIGHT', '早餐前称重', '保持同一电子秤。', '2026-05-03T00:10:00.000Z', 3.2, 'kg', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_food_0505_am', 'pet_doubao', 'FOOD', '早餐完成', '精神好，未挑食。', '2026-05-04T23:35:00.000Z', 44, 'g', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_potty_0505_am', 'pet_doubao', 'POTTY', '饭后尿尿', '比昨天更快进入状态。', '2026-05-05T00:09:00.000Z', 1, '次', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_photo_0505', 'pet_doubao', 'PHOTO', '第一次认真看镜头', '耳朵还没完全立稳。', '2026-05-05T01:20:00.000Z', NULL, NULL, '{}', '/photos/westie-window.svg', '2026-05-05T00:00:00.000Z'),
  ('event_stool_0505', 'pet_doubao', 'STOOL', '上午便便', '状态正常。', '2026-05-05T02:18:00.000Z', 1, '次', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_food_0505_pm', 'pet_doubao', 'FOOD', '晚餐完成', '饭后 20 分钟外出。', '2026-05-05T10:30:00.000Z', 45, 'g', '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_vaccine_0501', 'pet_doubao', 'VACCINE', '疫苗记录复核', '已记录下一次加强针时间，实际以宠物医院为准。', '2026-05-01T08:00:00.000Z', NULL, NULL, '{}', NULL, '2026-05-05T00:00:00.000Z'),
  ('event_deworm_0502', 'pet_doubao', 'DEWORM', '体外驱虫观察', '滴剂后 48 小时内避免洗澡。', '2026-05-02T01:15:00.000Z', NULL, NULL, '{}', NULL, '2026-05-05T00:00:00.000Z');

INSERT OR IGNORE INTO "PhotoAsset" ("id", "petId", "url", "caption", "takenAt", "linkedEventId", "createdAt") VALUES
  ('photo_portrait', 'pet_doubao', '/photos/westie-portrait.svg', '到家第一天，先熟悉气味。', '2026-05-01T03:00:00.000Z', NULL, '2026-05-05T00:00:00.000Z'),
  ('photo_window', 'pet_doubao', '/photos/westie-window.svg', '窗边观察新世界。', '2026-05-05T01:20:00.000Z', 'event_photo_0505', '2026-05-05T00:00:00.000Z'),
  ('photo_training', 'pet_doubao', '/photos/westie-training.svg', '坐下训练第 4 天。', '2026-05-03T08:30:00.000Z', NULL, '2026-05-05T00:00:00.000Z'),
  ('photo_sleep', 'pet_doubao', '/photos/westie-sleep.svg', '睡前终于安静下来。', '2026-05-04T14:20:00.000Z', NULL, '2026-05-05T00:00:00.000Z');

INSERT OR IGNORE INTO "Expense" ("id", "petId", "category", "itemName", "amountCents", "purchasedAt", "note", "createdAt") VALUES
  ('expense_food', 'pet_doubao', 'FOOD', '幼犬粮 2kg', 23800, '2026-05-01T12:00:00.000Z', '主粮先按原主人品牌过渡。', '2026-05-05T00:00:00.000Z'),
  ('expense_pad', 'pet_doubao', 'DAILY', '尿垫 100 片', 6900, '2026-05-02T03:00:00.000Z', '定点如厕阶段消耗较快。', '2026-05-05T00:00:00.000Z'),
  ('expense_snuffle', 'pet_doubao', 'TOY', '嗅闻垫', 8800, '2026-05-03T07:20:00.000Z', '用于消耗精力。', '2026-05-05T00:00:00.000Z'),
  ('expense_vaccine', 'pet_doubao', 'MEDICAL', '疫苗复核挂号', 6000, '2026-05-01T08:00:00.000Z', '确认下一针时间。', '2026-05-05T00:00:00.000Z'),
  ('expense_grooming', 'pet_doubao', 'GROOMING', '针梳和指甲剪', 5200, '2026-05-04T05:40:00.000Z', '开始适应触碰护理。', '2026-05-05T00:00:00.000Z');

INSERT OR IGNORE INTO "AiInsight" ("id", "petId", "scope", "title", "body", "riskLevel", "generatedAt", "createdAt") VALUES (
  'insight_seed_daily', 'pet_doubao', 'daily', '豆包今日养育建议',
  '饮食和如厕记录已经能形成基本节奏。继续把饭后 15-30 分钟外出固定下来，并每周固定早餐前称重。健康相关判断不能替代兽医诊断；若出现持续腹泻、呕吐、拒食或精神差，请及时联系兽医。',
  'info', '2026-05-05T02:00:00.000Z', '2026-05-05T00:00:00.000Z'
);
