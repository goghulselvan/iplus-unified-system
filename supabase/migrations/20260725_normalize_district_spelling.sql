-- District is free text with no canonical constraint; manual entries (source='manual'
-- for every one of these, confirmed) introduced alternate spellings of real districts
-- already present under their official district_codes name. Normalize both tables to
-- the exact spelling in district_codes (state_code 33 = Tamil Nadu).

CREATE TEMP TABLE district_fixes AS SELECT * FROM (VALUES
  ('Erode Dist',     'Erode'),
  ('Kanchipuram',    'Kancheepuram'),
  ('Kanyakumari',    'Kanniyakumari'),
  ('Nilgiri',        'Nilgiris'),
  ('The Nilgiris',   'Nilgiris'),
  ('Puthukkottai',   'Pudukkottai'),
  ('Sivaganga',      'Sivagangai'),
  ('Thiruvallur',    'Tiruvallur'),
  ('Thoothukkudi',   'Thoothukudi'),
  ('Viluppuram',     'Villupuram'),
  ('Chennai Region', 'Chennai')
) AS t(wrong, correct);

UPDATE prospect_schools ps
SET district = f.correct
FROM district_fixes f
WHERE ps.district = f.wrong;

UPDATE schools s
SET district = f.correct
FROM district_fixes f
WHERE s.district = f.wrong;
