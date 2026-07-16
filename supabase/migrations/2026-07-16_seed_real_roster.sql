-- ============================================================================
-- Seed the real EBC/JPFD employee roster (A/B/C platoons) and current
-- (2026-07-16) leave status, replacing the empty/placeholder roster.
--
-- Requires 2026-07-16_add_ac_rank_and_station_override.sql to have run first.
--
-- Idempotent / non-destructive:
--   - companies: upserted by code (existing placeholder rows get corrected
--     station/district/suffix_rule values, nothing is deleted).
--   - employees: inserted with new emp_number values (3001-3225), which do
--     not collide with the placeholder seed's 1001-1012 range.
--   - leave_records: inserted for shift_date 2026-07-16, status = 'Active'.
--
-- NOTE: this does not delete the 12 placeholder employees (emp_number
-- 1001-1012) or their leave_records from the original seed. If any real
-- duty_ledger / payroll_rows / timesheet history has already accumulated
-- against those placeholder employee ids, deleting them blind could either
-- fail on a foreign key or orphan real history -- that decision needs a
-- human who can see the live data, not an automated migration. See the
-- commented block at the bottom of this file to deactivate them instead.
-- ============================================================================

insert into companies (code, station, district, suffix_rule, records_only, station_override) values
  ('E118', 'Station 11', 120, '5 · Capt+LT+OP+2FF', false, null),
  ('E128', 'Station 12', 120, '5 · Capt+LT+2OP+FF', false, null),
  ('E198', 'Station 19', 120, '4 · Capt+OP+2FF', false, null),
  ('L117', 'Station 11', 120, '4 · LT+OP+2FF', false, 'Station 14'),
  ('C120', 'District 120 HQ', 120, '1 · DC', true, null),
  ('E148', 'Station 14', 140, '5 · Capt+LT+OP+2FF', false, null),
  ('E158', 'Station 15', 140, '5 · Capt+LT+OP+2FF', false, null),
  ('S159', 'Station 15', 140, '5 · LT+OP+3FF', false, null),
  ('E188', 'Station 18', 140, '5 · Capt+LT+OP+2FF', false, null),
  ('L187', 'Station 18', 140, '4 · LT+OP+2FF', false, null),
  ('C140', 'District 140 HQ', 140, '1 · DC', true, null),
  ('E138', 'Station 13', 160, '5 · Capt+LT+OP+2FF', false, null),
  ('L137', 'Station 13', 160, '4 · LT+OP+2FF', false, null),
  ('E168', 'Station 16', 160, '5 · Capt+LT+OP+2FF', false, null),
  ('S169', 'Station 16', 160, '4 · LT+OP+2FF', false, null),
  ('E178', 'Station 17', 160, '5 · Capt+LT+OP+2FF', false, null),
  ('L177', 'Station 17', 160, '4 · LT+OP+2FF', false, null),
  ('E208', 'Station 20', 160, '5 · Capt+LT+OP+2FF', false, null),
  ('C160', 'District 160 HQ', 160, '1 · DC', true, null),
  ('C102', 'HQ', null, '1 · AC', true, null)
on conflict (code) do update set
  station = excluded.station,
  district = excluded.district,
  suffix_rule = excluded.suffix_rule,
  records_only = excluded.records_only,
  station_override = excluded.station_override,
  updated_at = now();

insert into employees (emp_number, last_name, first_name, middle_initial, rank, platoon, company_code, supervisor, status) values
  (3001, 'Bertucci Jr.', 'Ronald', 'J', 'DC', 'A', 'C120', true, 'Active'),
  (3002, 'Cunningham', 'C', null, 'Capt', 'A', 'E118', true, 'Active'),
  (3003, 'Parr', 'J', null, 'LT', 'A', 'E118', true, 'Active'),
  (3004, 'Ruffin', 'J', null, 'OP', 'A', 'E118', false, 'Active'),
  (3005, 'Soldani', 'J', null, 'FF', 'A', 'E118', false, 'Active'),
  (3006, 'Dimak', 'S', null, 'FF', 'A', 'E118', false, 'Active'),
  (3007, 'Wakefield', 'T', null, 'Capt', 'A', 'E128', true, 'Active'),
  (3008, 'May', 'J', null, 'LT', 'A', 'E128', true, 'Active'),
  (3009, 'Crucia', 'B', null, 'OP', 'A', 'E128', false, 'Active'),
  (3010, 'Lowe', 'B', null, 'OP', 'A', 'E128', false, 'Active'),
  (3011, 'Rizzuto', 'M', null, 'FF', 'A', 'E128', false, 'Active'),
  (3012, 'Beck', 'B', null, 'Capt', 'A', 'E198', true, 'Active'),
  (3013, 'Fox', 'B', null, 'OP', 'A', 'E198', false, 'Active'),
  (3014, 'Weinmann', 'J', null, 'FF', 'A', 'E198', false, 'Active'),
  (3015, 'Rodriguez', 'B', null, 'FF', 'A', 'E198', false, 'Active'),
  (3016, 'Haas IV', 'William', 'J', 'DC', 'A', 'C140', true, 'Active'),
  (3017, 'Labat', 'Michael', null, 'Capt', 'A', 'E148', true, 'Active'),
  (3018, 'Ward', 'Scott', null, 'LT', 'A', 'E148', true, 'Active'),
  (3019, 'Chenet', 'Henry', null, 'OP', 'A', 'E148', false, 'Active'),
  (3020, 'Orkus', 'Steve', null, 'FF', 'A', 'E148', false, 'Active'),
  (3021, 'Tournier', 'Shane', null, 'FF', 'A', 'E148', false, 'Active'),
  (3022, 'Barthel', 'B', null, 'LT', 'A', 'L117', true, 'Active'),
  (3023, 'Hoffmann', 'Wayne', null, 'Sub-LT', 'A', 'L117', true, 'Active'),
  (3024, 'Greco', 'S', null, 'OP', 'A', 'L117', false, 'Active'),
  (3025, 'Linn', 'C', null, 'FF', 'A', 'L117', false, 'Active'),
  (3026, 'Terrebonne', 'B', null, 'FF', 'A', 'L117', false, 'Active'),
  (3027, 'Willhoft', 'J', null, 'Capt', 'A', 'E158', true, 'Active'),
  (3028, 'Penot', 'Chad', null, 'LT', 'A', 'E158', true, 'Active'),
  (3029, 'Marks', 'Brandon', null, 'OP', 'A', 'E158', false, 'Active'),
  (3030, 'Raymond IV', 'Michael', null, 'FF', 'A', 'E158', false, 'Active'),
  (3031, 'Gaudet', 'C', null, 'FF', 'A', 'E158', false, 'Active'),
  (3032, 'Thezan', 'D', null, 'LT', 'A', 'S159', true, 'Active'),
  (3033, 'Figaro', 'N', null, 'OP', 'A', 'S159', false, 'Active'),
  (3034, 'Adkins', 'R', null, 'FF', 'A', 'S159', false, 'Active'),
  (3035, 'Alvarado', 'A', null, 'FF', 'A', 'S159', false, 'Active'),
  (3036, 'McGoey', 'J', null, 'FF', 'A', 'S159', false, 'Active'),
  (3037, 'Perre', 'Chris', null, 'Capt', 'A', 'E188', true, 'Active'),
  (3038, 'Bienvenu', 'Marc', null, 'LT', 'A', 'E188', true, 'Active'),
  (3039, 'Calamari', 'M', null, 'OP', 'A', 'E188', false, 'Active'),
  (3040, 'Marino', 'B', null, 'FF', 'A', 'E188', false, 'Active'),
  (3041, 'Cole', 'C', null, 'FF', 'A', 'E188', false, 'Active'),
  (3042, 'Cinquemano', 'A', null, 'LT', 'A', 'L187', true, 'Active'),
  (3043, 'Gradwhol', 'C', null, 'OP', 'A', 'L187', false, 'Active'),
  (3044, 'Puipuro', 'N', null, 'FF', 'A', 'L187', false, 'Active'),
  (3045, 'Babin', 'M', null, 'FF', 'A', 'L187', false, 'Active'),
  (3046, 'Burkett', 'Craig', 'M', 'DC', 'A', 'C160', true, 'Active'),
  (3047, 'Hux', 'Michael', null, 'Capt', 'A', 'E138', true, 'Active'),
  (3048, 'Grechauer', 'Jared', null, 'LT', 'A', 'E138', true, 'Active'),
  (3049, 'Mosbey', 'Joshua', null, 'OP', 'A', 'E138', false, 'Active'),
  (3050, 'Manino', 'Matt', null, 'FF', 'A', 'E138', false, 'Active'),
  (3051, 'Raines', 'Dylan', null, 'FF', 'A', 'E138', false, 'Active'),
  (3052, 'Civello', 'D', null, 'LT', 'A', 'L137', true, 'Active'),
  (3053, 'English', 'Jarrod', null, 'OP', 'A', 'L137', false, 'Active'),
  (3054, 'Mire', 'C', null, 'FF', 'A', 'L137', false, 'Active'),
  (3055, 'Raines', 'B', null, 'FF', 'A', 'L137', false, 'Active'),
  (3056, 'Bruzeau', 'R', null, 'Capt', 'A', 'E168', true, 'Active'),
  (3057, 'Stromeyer', 'S', null, 'LT', 'A', 'E168', true, 'Active'),
  (3058, 'Rome', 'E', null, 'OP', 'A', 'E168', false, 'Active'),
  (3059, 'Balser', 'L', null, 'FF', 'A', 'E168', false, 'Active'),
  (3060, 'Dudenhoeffer', 'J', null, 'FF', 'A', 'E168', false, 'Active'),
  (3061, 'Hebert', 'Matt', null, 'Capt', 'A', 'E178', true, 'Active'),
  (3062, 'Esteves', 'Brad', null, 'LT', 'A', 'E178', true, 'Active'),
  (3063, 'Boudoin', 'C', null, 'OP', 'A', 'E178', false, 'Active'),
  (3064, 'Guidry', 'Chris', null, 'FF', 'A', 'E178', false, 'Active'),
  (3065, 'Boudoin', 'Jason', null, 'FF', 'A', 'E178', false, 'Active'),
  (3066, 'Curole', 'N', null, 'LT', 'A', 'L177', true, 'Active'),
  (3067, 'Rucker', 'M', null, 'OP', 'A', 'L177', false, 'Active'),
  (3068, 'Lindsey', 'B', null, 'FF', 'A', 'L177', false, 'Active'),
  (3069, 'Pelicano', 'D', null, 'FF', 'A', 'L177', false, 'Active'),
  (3070, 'Gaudin', 'M', null, 'Capt', 'A', 'E208', true, 'Active'),
  (3071, 'Mullen', 'B', null, 'LT', 'A', 'E208', true, 'Active'),
  (3072, 'Jambon', 'K', null, 'OP', 'A', 'E208', false, 'Active'),
  (3073, 'Soto', 'M', null, 'FF', 'A', 'E208', false, 'Active'),
  (3074, 'Lowe', 'B', null, 'FF', 'A', 'E208', false, 'Active'),
  (3075, 'Easley', 'R', null, 'AC', 'A', 'C102', true, 'Active'),
  (3076, 'Krupp III', 'Emmett', null, 'DC', 'C', 'C120', true, 'Active'),
  (3077, 'Cook', 'D', null, 'Capt', 'C', 'E118', true, 'Active'),
  (3078, 'Withmeyer', 'D', null, 'LT', 'C', 'E118', true, 'Active'),
  (3079, 'Dill', 'S', null, 'OP', 'C', 'E118', false, 'Active'),
  (3080, 'Fury', 'W', null, 'FF', 'C', 'E118', false, 'Active'),
  (3081, 'Tew', 'J', null, 'FF', 'C', 'E118', false, 'Active'),
  (3082, 'Vitellaro', 'R', null, 'Capt', 'C', 'E128', true, 'Active'),
  (3083, 'Winchester', 'J', null, 'LT', 'C', 'E128', true, 'Active'),
  (3084, 'Bush', 'S', null, 'OP', 'C', 'E128', false, 'Active'),
  (3085, 'Spencer', 'K', null, 'FF', 'C', 'E128', false, 'Active'),
  (3086, 'Lorenzo', 'F', null, 'FF', 'C', 'E128', false, 'Active'),
  (3087, 'Adams', 'F', null, 'Capt', 'C', 'E198', true, 'Active'),
  (3088, 'Decker', 'M', null, 'LT', 'C', 'E198', true, 'Active'),
  (3089, 'Rigney', 'T', null, 'OP', 'C', 'E198', false, 'Active'),
  (3090, 'Navarro', 'N', null, 'FF', 'C', 'E198', false, 'Active'),
  (3091, 'Lobell', 'B', null, 'LT', 'C', 'L117', true, 'Active'),
  (3092, 'Cookmeyer', 'N', null, 'OP', 'C', 'L117', false, 'Active'),
  (3093, 'Hirstius', 'R', null, 'FF', 'C', 'L117', false, 'Active'),
  (3094, 'Lebon', 'P', null, 'FF', 'C', 'L117', false, 'Active'),
  (3095, 'Barrios Jr.', 'Brent', 'J', 'DC', 'C', 'C140', true, 'Active'),
  (3096, 'Schulin', 'S', null, 'Capt', 'C', 'E148', true, 'Active'),
  (3097, 'LaSalle', 'S', null, 'LT', 'C', 'E148', true, 'Active'),
  (3098, 'Gaudet', 'D', null, 'OP', 'C', 'E148', false, 'Active'),
  (3099, 'Liberto', 'D', null, 'FF', 'C', 'E148', false, 'Active'),
  (3100, 'Nunez', 'N', null, 'FF', 'C', 'E148', false, 'Active'),
  (3101, 'Schoder', 'M', null, 'Capt', 'C', 'E158', true, 'Active'),
  (3102, 'Puleo', 'R', null, 'LT', 'C', 'E158', true, 'Active'),
  (3103, 'Shillington', 'M', null, 'OP', 'C', 'E158', false, 'Active'),
  (3104, 'Willhoft Jr.', 'J', null, 'FF', 'C', 'E158', false, 'Active'),
  (3105, 'Ricalde', 'D', null, 'FF', 'C', 'E158', false, 'Active'),
  (3106, 'O''Neal', 'R', null, 'LT', 'C', 'S159', true, 'Active'),
  (3107, 'Rosenbohm', 'A', null, 'OP', 'C', 'S159', false, 'Active'),
  (3108, 'Dupuy', 'N', null, 'FF', 'C', 'S159', false, 'Active'),
  (3109, 'Bayer', 'A', null, 'FF', 'C', 'S159', false, 'Active'),
  (3110, 'Hale', 'S', null, 'FF', 'C', 'S159', false, 'Active'),
  (3111, 'Guyton', 'P', null, 'Capt', 'C', 'E188', true, 'Active'),
  (3112, 'Marino', 'J', null, 'LT', 'C', 'E188', true, 'Active'),
  (3113, 'Rodriguez', 'M', null, 'OP', 'C', 'E188', false, 'Active'),
  (3114, 'Juneau', 'M', null, 'FF', 'C', 'E188', false, 'Active'),
  (3115, 'Segretto', 'J', null, 'FF', 'C', 'E188', false, 'Active'),
  (3116, 'Monvoisin', 'K', null, 'LT', 'C', 'L187', true, 'Active'),
  (3117, 'Giusti', 'M', null, 'OP', 'C', 'L187', false, 'Active'),
  (3118, 'Cookmeyer', 'B', null, 'FF', 'C', 'L187', false, 'Active'),
  (3119, 'Hoffman', 'D', null, 'FF', 'C', 'L187', false, 'Active'),
  (3120, 'Corona III', 'Frank', null, 'DC', 'C', 'C160', true, 'Active'),
  (3121, 'Rigney', 'C', null, 'Capt', 'C', 'E138', true, 'Active'),
  (3122, 'Porche', 'E', null, 'LT', 'C', 'E138', true, 'Active'),
  (3123, 'Rivere', 'R', null, 'OP', 'C', 'E138', false, 'Active'),
  (3124, 'Gennaro', 'M', null, 'OP', 'C', 'E138', false, 'Active'),
  (3125, 'Mortillaro', 'P', null, 'FF', 'C', 'E138', false, 'Active'),
  (3126, 'Elvir', 'S', null, 'FF', 'C', 'E138', false, 'Active'),
  (3127, 'Schindler', 'B', null, 'LT', 'C', 'L137', true, 'Active'),
  (3128, 'Pansano', 'A', null, 'OP', 'C', 'L137', false, 'Active'),
  (3129, 'Brelet', 'B', null, 'FF', 'C', 'L137', false, 'Active'),
  (3130, 'Klumpp', 'J', null, 'Capt', 'C', 'E168', true, 'Active'),
  (3131, 'Boyle', 'J', null, 'LT', 'C', 'E168', true, 'Active'),
  (3132, 'Adams', 'M', null, 'OP', 'C', 'E168', false, 'Active'),
  (3133, 'Koch', 'C', null, 'FF', 'C', 'E168', false, 'Active'),
  (3134, 'Rodrigue', 'C', null, 'FF', 'C', 'E168', false, 'Active'),
  (3135, 'Rigney', 'S', null, 'LT', 'C', 'S169', true, 'Active'),
  (3136, 'Floyd', 'M', null, 'OP', 'C', 'S169', false, 'Active'),
  (3137, 'Galland', 'C', null, 'FF', 'C', 'S169', false, 'Active'),
  (3138, 'Dupuy', 'C', null, 'Capt', 'C', 'E178', true, 'Active'),
  (3139, 'Moser', 'E', null, 'LT', 'C', 'E178', true, 'Active'),
  (3140, 'Teachworth', 'M', null, 'OP', 'C', 'E178', false, 'Active'),
  (3141, 'Demma', 'J', null, 'FF', 'C', 'E178', false, 'Active'),
  (3142, 'Balestra', 'M', null, 'FF', 'C', 'E178', false, 'Active'),
  (3143, 'Smith', 'B', null, 'LT', 'C', 'L177', true, 'Active'),
  (3144, 'Collins', 'J', null, 'OP', 'C', 'L177', false, 'Active'),
  (3145, 'Virgadamo', 'T', null, 'FF', 'C', 'L177', false, 'Active'),
  (3146, 'Richards', 'B', null, 'FF', 'C', 'L177', false, 'Active'),
  (3147, 'Segretto Jr.', 'J', null, 'Capt', 'C', 'E208', true, 'Active'),
  (3148, 'Alvarez', 'R', null, 'LT', 'C', 'E208', true, 'Active'),
  (3149, 'Hymel', 'J', null, 'OP', 'C', 'E208', false, 'Active'),
  (3150, 'Bradshaw', 'R', null, 'FF', 'C', 'E208', false, 'Active'),
  (3151, 'Garcia', 'A', null, 'FF', 'C', 'E208', false, 'Active'),
  (3152, 'Aitken', 'J', null, 'AC', 'C', 'C102', true, 'Active'),
  (3153, 'Cook', 'D', null, 'Capt', 'B', 'E118', true, 'Active'),
  (3154, 'Rodrigue', 'S', null, 'LT', 'B', 'E118', true, 'Active'),
  (3155, 'Lambert', 'A', null, 'OP', 'B', 'E118', false, 'Active'),
  (3156, 'Farrelly', 'J', null, 'FF', 'B', 'E118', false, 'Active'),
  (3157, 'Hardy', 'R', null, 'FF', 'B', 'E118', false, 'Active'),
  (3158, 'Holiday', 'M', null, 'Capt', 'B', 'E128', true, 'Active'),
  (3159, 'Dunn', 'K', null, 'LT', 'B', 'E128', true, 'Active'),
  (3160, 'Jacob', 'G', null, 'OP', 'B', 'E128', false, 'Active'),
  (3161, 'Seitz', 'A', null, 'FF', 'B', 'E128', false, 'Active'),
  (3162, 'Taylor', 'C', null, 'FF', 'B', 'E128', false, 'Active'),
  (3163, 'Galland', 'T', null, 'Capt', 'B', 'E198', true, 'Active'),
  (3164, 'Conzonere', 'N', null, 'LT', 'B', 'E198', true, 'Active'),
  (3165, 'Heffner', 'R', null, 'OP', 'B', 'E198', false, 'Active'),
  (3166, 'Falgout', 'M', null, 'FF', 'B', 'E198', false, 'Active'),
  (3167, 'Roser', 'Todd', null, 'DC', 'B', 'C140', true, 'Active'),
  (3168, 'Harper', 'F', null, 'LT', 'B', 'L117', true, 'Active'),
  (3169, 'Jones', 'A', null, 'OP', 'B', 'L117', false, 'Active'),
  (3170, 'Bell', 'C', null, 'FF', 'B', 'L117', false, 'Active'),
  (3171, 'Huth', 'J', null, 'Capt', 'B', 'E148', true, 'Active'),
  (3172, 'Bozeman', 'T', null, 'LT', 'B', 'E148', true, 'Active'),
  (3173, 'Couvillion', 'C', null, 'OP', 'B', 'E148', false, 'Active'),
  (3174, 'Hymel', 'C', null, 'FF', 'B', 'E148', false, 'Active'),
  (3175, 'Esteves', 'T', null, 'FF', 'B', 'E148', false, 'Active'),
  (3176, 'Schultz', 'T', null, 'Capt', 'B', 'E158', true, 'Active'),
  (3177, 'Gegenheimer', 'G', null, 'LT', 'B', 'E158', true, 'Active'),
  (3178, 'Shannon', 'J', null, 'OP', 'B', 'E158', false, 'Active'),
  (3179, 'Hopkins', 'B', null, 'FF', 'B', 'E158', false, 'Active'),
  (3180, 'Jones', 'J', null, 'FF', 'B', 'E158', false, 'Active'),
  (3181, 'Rodrigue', 'B', null, 'LT', 'B', 'S159', true, 'Active'),
  (3182, 'Davis', 'J', null, 'OP', 'B', 'S159', false, 'Active'),
  (3183, 'Mattio', 'B', null, 'FF', 'B', 'S159', false, 'Active'),
  (3184, 'Thomassie', 'C', null, 'FF', 'B', 'S159', false, 'Active'),
  (3185, 'Leblanc', 'K', null, 'Capt', 'B', 'E188', true, 'Active'),
  (3186, 'Hardy', 'R', null, 'LT', 'B', 'E188', true, 'Active'),
  (3187, 'Wilson', 'J', null, 'OP', 'B', 'E188', false, 'Active'),
  (3188, 'Smith', 'J', null, 'FF', 'B', 'E188', false, 'Active'),
  (3189, 'Sterling', 'J', null, 'FF', 'B', 'E188', false, 'Active'),
  (3190, 'Colomb', 'M', null, 'Sub-LT', 'B', 'L187', true, 'Active'),
  (3191, 'Clark', 'C', null, 'OP', 'B', 'L187', false, 'Active'),
  (3192, 'Crossen', 'J', null, 'FF', 'B', 'L187', false, 'Active'),
  (3193, 'Balser', 'Milton', null, 'DC', 'B', 'C160', true, 'Active'),
  (3194, 'Lemoine', 'M', null, 'Capt', 'B', 'E138', true, 'Active'),
  (3195, 'Moskau', 'T', null, 'Sub-LT', 'B', 'E138', true, 'Active'),
  (3196, 'Glover', 'P', null, 'OP', 'B', 'E138', false, 'Active'),
  (3197, 'Baltz', 'J', null, 'FF', 'B', 'E138', false, 'Active'),
  (3198, 'Juneau', 'G', null, 'FF', 'B', 'E138', false, 'Active'),
  (3199, 'Juneau', 'C', null, 'LT', 'B', 'L137', true, 'Active'),
  (3200, 'Arbaugh', 'M', null, 'OP', 'B', 'L137', false, 'Active'),
  (3201, 'Soignier', 'S', null, 'FF', 'B', 'L137', false, 'Active'),
  (3202, 'Loisel', 'C', null, 'FF', 'B', 'L137', false, 'Active'),
  (3203, 'Crossen', 'K', null, 'Capt', 'B', 'E168', true, 'Active'),
  (3204, 'Gremillion', 'M', null, 'LT', 'B', 'E168', true, 'Active'),
  (3205, 'Calamari', 'M', null, 'OP', 'B', 'E168', false, 'Active'),
  (3206, 'Mire', 'D', null, 'FF', 'B', 'E168', false, 'Active'),
  (3207, 'Labat', 'M', 'J', 'LT', 'B', 'S169', true, 'Active'),
  (3208, 'Crombie', 'B', null, 'OP', 'B', 'S169', false, 'Active'),
  (3209, 'Crossen', 'W', null, 'FF', 'B', 'S169', false, 'Active'),
  (3210, 'Nelson', 'D', null, 'FF', 'B', 'S169', false, 'Active'),
  (3211, 'Patureau', 'J', null, 'Sub-CAPT', 'B', 'E178', true, 'Active'),
  (3212, 'Glorioso', 'M', null, 'Capt', 'B', 'E178', true, 'Active'),
  (3213, 'Carver', 'C', null, 'LT', 'B', 'E178', true, 'Active'),
  (3214, 'Brown', 'A', null, 'OP', 'B', 'E178', false, 'Active'),
  (3215, 'Abide', 'J', null, 'FF', 'B', 'E178', false, 'Active'),
  (3216, 'Giarrusso', 'M', null, 'LT', 'B', 'L177', true, 'Active'),
  (3217, 'Tew', 'J', null, 'OP', 'B', 'L177', false, 'Active'),
  (3218, 'Moskau', 'P', null, 'FF', 'B', 'L177', false, 'Active'),
  (3219, 'Hughes', 'E', null, 'FF', 'B', 'L177', false, 'Active'),
  (3220, 'Schultz', 'W', null, 'FF', 'B', 'L177', false, 'Active'),
  (3221, 'Mooney', 'C', null, 'Capt', 'B', 'E208', true, 'Active'),
  (3222, 'Vaccaro', 'S', null, 'LT', 'B', 'E208', true, 'Active'),
  (3223, 'Lama', 'A', null, 'OP', 'B', 'E208', false, 'Active'),
  (3224, 'White', 'C', null, 'FF', 'B', 'E208', false, 'Active'),
  (3225, 'Cardinale', 'J', null, 'AC', 'B', 'C102', true, 'Active')
on conflict (emp_number) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-001', id, 'ISSL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3022
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-002', id, 'AL', '2026-07-16', '07:00', '19:00', 'AL - 13 hrs', 'Active', now()
from employees where emp_number = 3153
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-003', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3159
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-004', id, 'SL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3161
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-005', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3162
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-006', id, 'AL', '2026-07-16', '07:00', '19:00', 'AL - 9 hrs', 'Active', now()
from employees where emp_number = 3163
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-007', id, 'SL', '2026-07-16', '07:00', '19:00', 'SL - 5 hrs', 'Active', now()
from employees where emp_number = 3166
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-008', id, 'AL', '2026-07-16', '07:00', '19:00', 'AL - 2 hrs', 'Active', now()
from employees where emp_number = 3168
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-009', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3169
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-010', id, 'FODI', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3170
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-011', id, 'SL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3183
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-012', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3203
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-013', id, 'CT', '2026-07-16', '07:00', '19:00', 'CT - 17 hrs', 'Active', now()
from employees where emp_number = 3209
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-014', id, 'SL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3212
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-015', id, 'ISSL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3216
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-016', id, 'ISSL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3218
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-017', id, 'SL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3219
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-018', id, 'ISSL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3220
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-019', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3222
on conflict (entry_id) do nothing;

-- District 120 B Platoon District Chief was left out of this seed --
-- the source roster explicitly marked that name unconfirmed
-- ("District 120 -- District Chief: (confirm who 120 B is)"). Add them
-- once confirmed:
-- insert into employees (emp_number, last_name, first_name, rank, platoon, company_code, supervisor, status)
-- values (3226, '<last>', '<first>', 'DC', 'B', 'C120', true, 'Active');

-- Optional manual cleanup, run only after confirming no real duty_ledger /
-- payroll_rows / timesheet_segments / shift_close history references these
-- placeholder employees:
-- delete from leave_records where employee_id in (select id from employees where emp_number between 1001 and 1012);
-- delete from employees where emp_number between 1001 and 1012;
