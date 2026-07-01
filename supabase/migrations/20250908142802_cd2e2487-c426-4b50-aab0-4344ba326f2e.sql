-- Standardize Tamil Nadu district names to have only 38 unique districts

-- 1. Erode variations
UPDATE public.schools SET district = 'Erode' WHERE district = 'Erode Dist';

-- 2. Kancheepuram variations  
UPDATE public.schools SET district = 'Kancheepuram' WHERE district = 'Kanchipuram';

-- 3. Kanniyakumari variations
UPDATE public.schools SET district = 'Kanniyakumari' WHERE district = 'Kanyakumari';

-- 4. Nilgiris variations (standardize to The Nilgiris)
UPDATE public.schools SET district = 'The Nilgiris' WHERE district IN ('Nilgiri', 'Nilgiris');

-- 5. Pudukkottai variations
UPDATE public.schools SET district = 'Pudukkottai' WHERE district = 'Puthukkottai';

-- 6. Sivagangai variations
UPDATE public.schools SET district = 'Sivagangai' WHERE district = 'Sivaganga';

-- 7. Tirupathur variations
UPDATE public.schools SET district = 'Tirupathur' WHERE district = 'Thirupathur';

-- 8. Tiruvallur variations
UPDATE public.schools SET district = 'Tiruvallur' WHERE district = 'Thiruvallur';

-- 9. Tiruvarur variations
UPDATE public.schools SET district = 'Tiruvarur' WHERE district = 'Thiruvarur';

-- 10. Thoothukudi variations
UPDATE public.schools SET district = 'Thoothukudi' WHERE district = 'Thoothukkudi';

-- 11. Tiruchirappalli variations
UPDATE public.schools SET district = 'Tiruchirappalli' WHERE district = 'Trichy';

-- 12. Villupuram variations
UPDATE public.schools SET district = 'Villupuram' WHERE district = 'Viluppuram';